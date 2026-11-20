-- ====================================================================
-- Migration 015: Stage 2 Kala Inventory — Product Variants,
--                Inventory Lots, Serialized Takas & Split Lineage
-- Prerequisite:  014_stage1_security_hardening.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Extend products & inventory_stock for Unified Valuation
-- --------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'SET',
  ADD COLUMN IF NOT EXISTS uom TEXT NOT NULL DEFAULT 'SET',
  ADD COLUMN IF NOT EXISTS hsn_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_tracking_mode_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_tracking_mode_check
      CHECK (tracking_mode IN ('SET', 'TAKA', 'PIECE'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_uom_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_uom_check
      CHECK (uom IN ('SET', 'PCS', 'MTR', 'KG'));
  END IF;
END $$;

ALTER TABLE public.inventory_stock
  ADD COLUMN IF NOT EXISTS reserved_sets INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_reserved_cost_check') THEN
    ALTER TABLE public.inventory_stock
      ADD CONSTRAINT inventory_stock_reserved_cost_check
      CHECK (reserved_sets >= 0 AND reserved_sets <= sets AND avg_unit_cost >= 0);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_bump_row_version_inventory_stock ON public.inventory_stock;
CREATE TRIGGER trg_bump_row_version_inventory_stock
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

-- --------------------------------------------------------------------
-- SECTION 2: Product Variants (Color / Size / Grade)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_variants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,
  sku TEXT NOT NULL,
  color_name TEXT,
  color_code TEXT,
  size_label TEXT,
  rate_override NUMERIC(10, 2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_variants_sku_check CHECK (CHAR_LENGTH(TRIM(sku)) BETWEEN 1 AND 80),
  CONSTRAINT product_variants_rate_check CHECK (rate_override IS NULL OR rate_override >= 0),
  CONSTRAINT product_variants_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT product_variants_business_product_fkey FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_business_sku
  ON public.product_variants (business_id, UPPER(TRIM(sku)));

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants (business_id, product_id);

DROP TRIGGER IF EXISTS trg_bump_row_version_product_variants ON public.product_variants;
CREATE TRIGGER trg_bump_row_version_product_variants
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_variants FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_variants TO authenticated;

DROP POLICY IF EXISTS "members_select_product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "members_write_product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "owners_delete_product_variants" ON public.product_variants;

CREATE POLICY "members_select_product_variants" ON public.product_variants
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_write_product_variants" ON public.product_variants
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "members_update_product_variants" ON public.product_variants
  FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "owners_delete_product_variants" ON public.product_variants
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- --------------------------------------------------------------------
-- SECTION 3: Inventory Lots (Dye Batches / Mill Lots)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_lots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  variant_id BIGINT,
  lot_no TEXT NOT NULL,
  supplier_party_id BIGINT,
  mill_party_id BIGINT,
  shade_no TEXT,
  gsm NUMERIC(7, 2),
  width_inches NUMERIC(6, 2),
  landed_cost_per_unit NUMERIC(12, 4) NOT NULL DEFAULT 0,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_lots_no_check CHECK (CHAR_LENGTH(TRIM(lot_no)) BETWEEN 1 AND 60),
  CONSTRAINT inventory_lots_cost_check CHECK (landed_cost_per_unit >= 0),
  CONSTRAINT inventory_lots_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT inventory_lots_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_lots_business_product_fkey FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_lots_business_variant_fkey FOREIGN KEY (business_id, variant_id)
    REFERENCES public.product_variants (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_lots_business_lot_no
  ON public.inventory_lots (business_id, UPPER(TRIM(lot_no)));

CREATE INDEX IF NOT EXISTS idx_inventory_lots_product
  ON public.inventory_lots (business_id, product_id);

DROP TRIGGER IF EXISTS trg_bump_row_version_inventory_lots ON public.inventory_lots;
CREATE TRIGGER trg_bump_row_version_inventory_lots
  BEFORE UPDATE ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_lots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_lots TO authenticated;

DROP POLICY IF EXISTS "members_select_inventory_lots" ON public.inventory_lots;
CREATE POLICY "members_select_inventory_lots" ON public.inventory_lots
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 4: Serialized Takas & Immutable Split Lineage
-- Direct INSERT/UPDATE/DELETE revoked; mutated strictly via RPCs.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_takas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  lot_id BIGINT NOT NULL,
  parent_taka_id BIGINT,
  product_id BIGINT NOT NULL,
  variant_id BIGINT,
  location_id BIGINT NOT NULL,
  taka_no TEXT NOT NULL,
  barcode_value TEXT,
  initial_meters NUMERIC(10, 2) NOT NULL,
  current_meters NUMERIC(10, 2) NOT NULL,
  weight_kg NUMERIC(10, 3),
  status TEXT NOT NULL DEFAULT 'in_stock',
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_takas_no_check CHECK (CHAR_LENGTH(TRIM(taka_no)) BETWEEN 1 AND 60),
  CONSTRAINT inventory_takas_meters_check CHECK (initial_meters > 0 AND current_meters >= 0 AND current_meters <= initial_meters),
  CONSTRAINT inventory_takas_status_check CHECK (
    status IN ('in_stock', 'reserved', 'in_process', 'split', 'dispatched', 'consumed', 'damaged')
  ),
  CONSTRAINT inventory_takas_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT inventory_takas_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_takas_business_lot_fkey FOREIGN KEY (business_id, lot_id)
    REFERENCES public.inventory_lots (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_takas_business_parent_fkey FOREIGN KEY (business_id, parent_taka_id)
    REFERENCES public.inventory_takas (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_takas_business_product_fkey FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_takas_business_variant_fkey FOREIGN KEY (business_id, variant_id)
    REFERENCES public.product_variants (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_takas_business_location_fkey FOREIGN KEY (business_id, location_id)
    REFERENCES public.inventory_locations (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_takas_business_taka_no
  ON public.inventory_takas (business_id, UPPER(TRIM(taka_no)));

CREATE INDEX IF NOT EXISTS idx_inventory_takas_lot
  ON public.inventory_takas (business_id, lot_id);

CREATE INDEX IF NOT EXISTS idx_inventory_takas_location_status
  ON public.inventory_takas (business_id, location_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_takas_parent
  ON public.inventory_takas (business_id, parent_taka_id)
  WHERE parent_taka_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_bump_row_version_inventory_takas ON public.inventory_takas;
CREATE TRIGGER trg_bump_row_version_inventory_takas
  BEFORE UPDATE ON public.inventory_takas
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

ALTER TABLE public.inventory_takas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_takas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_takas TO authenticated;

DROP POLICY IF EXISTS "members_select_inventory_takas" ON public.inventory_takas;
CREATE POLICY "members_select_inventory_takas" ON public.inventory_takas
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- Immutable Taka Split Lineage Table
CREATE TABLE IF NOT EXISTS public.taka_splits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  parent_taka_id BIGINT NOT NULL,
  child_taka_id BIGINT NOT NULL,
  meters_allocated NUMERIC(10, 2) NOT NULL CHECK (meters_allocated > 0),
  transaction_group_id UUID NOT NULL,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT taka_splits_distinct_check CHECK (parent_taka_id <> child_taka_id),
  CONSTRAINT taka_splits_business_parent_fkey FOREIGN KEY (business_id, parent_taka_id)
    REFERENCES public.inventory_takas (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT taka_splits_business_child_fkey FOREIGN KEY (business_id, child_taka_id)
    REFERENCES public.inventory_takas (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_taka_splits_child
  ON public.taka_splits (business_id, child_taka_id);

CREATE INDEX IF NOT EXISTS idx_taka_splits_parent
  ON public.taka_splits (business_id, parent_taka_id);

ALTER TABLE public.taka_splits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taka_splits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.taka_splits TO authenticated;

DROP POLICY IF EXISTS "members_select_taka_splits" ON public.taka_splits;
CREATE POLICY "members_select_taka_splits" ON public.taka_splits
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
