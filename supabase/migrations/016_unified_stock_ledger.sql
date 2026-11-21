-- ====================================================================
-- Migration 016: Stage 2 Kala Inventory — Unified Append-Only
--                stock_ledger & Chronological Valuation Guard
-- Prerequisite:  015_inventory_variants_lots_takas.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Append-Only Unified stock_ledger
-- Single source of truth for SET, PIECE, and TAKA/METER inventory.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  fy_id BIGINT NOT NULL,
  transaction_group_id UUID NOT NULL,
  reversal_of_id BIGINT REFERENCES public.stock_ledger(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL,
  variant_id BIGINT,
  lot_id BIGINT,
  taka_id BIGINT,
  location_id BIGINT NOT NULL,
  movement_type TEXT NOT NULL,
  movement_date DATE NOT NULL,
  qty_delta NUMERIC(12, 3) NOT NULL,
  pcs_delta INTEGER NOT NULL DEFAULT 0,
  uom TEXT NOT NULL,
  unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  value_delta NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ref_doc_type TEXT NOT NULL,
  ref_doc_id BIGINT,
  source_document_line_id BIGINT,
  idempotency_key UUID,
  created_by UUID,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT stock_ledger_movement_type_check CHECK (
    movement_type IN (
      'OPENING_BALANCE',
      'INTAKE',
      'PURCHASE_IN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'DISPATCH',
      'RETURN_IN',
      'RETURN_OUT',
      'JOB_OUT',
      'JOB_IN',
      'SPLIT_OUT',
      'SPLIT_IN',
      'PRODUCTION_CONSUME',
      'PRODUCTION_OUT',
      'ADJUSTMENT'
    )
  ),
  CONSTRAINT stock_ledger_uom_check CHECK (uom IN ('SET', 'PCS', 'MTR', 'KG')),
  CONSTRAINT stock_ledger_qty_nonzero_check CHECK (qty_delta <> 0),
  CONSTRAINT stock_ledger_cost_nonneg_check CHECK (unit_cost >= 0),
  CONSTRAINT stock_ledger_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_fy_fkey FOREIGN KEY (business_id, fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_product_fkey FOREIGN KEY (business_id, product_id)
    REFERENCES public.products (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_variant_fkey FOREIGN KEY (business_id, variant_id)
    REFERENCES public.product_variants (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_lot_fkey FOREIGN KEY (business_id, lot_id)
    REFERENCES public.inventory_lots (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_taka_fkey FOREIGN KEY (business_id, taka_id)
    REFERENCES public.inventory_takas (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_ledger_business_location_fkey FOREIGN KEY (business_id, location_id)
    REFERENCES public.inventory_locations (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_biz_prod_loc_date
  ON public.stock_ledger (business_id, product_id, location_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_biz_taka
  ON public.stock_ledger (business_id, taka_id)
  WHERE taka_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_ledger_tx_group
  ON public.stock_ledger (business_id, transaction_group_id);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_posted_at
  ON public.stock_ledger (business_id, posted_at DESC);

ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

-- Append-only: SELECT only for active company members; writes strictly via SECURITY DEFINER RPCs
REVOKE ALL ON TABLE public.stock_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_ledger TO authenticated;

DROP POLICY IF EXISTS "members_select_stock_ledger" ON public.stock_ledger;
CREATE POLICY "members_select_stock_ledger" ON public.stock_ledger
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- Strict immutability trigger on stock_ledger
CREATE OR REPLACE FUNCTION public.guard_stock_ledger_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger is strictly append-only; rows cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stock_ledger_immutable ON public.stock_ledger;
CREATE TRIGGER trg_guard_stock_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_stock_ledger_immutable();

-- --------------------------------------------------------------------
-- SECTION 2: Backfill Opening Balances from Existing inventory_stock
-- Ensures verify_inventory_integrity() reconciles immediately on
-- existing databases with pre-Stage-2 stock balances.
-- --------------------------------------------------------------------

INSERT INTO public.stock_ledger (
  business_id,
  branch_id,
  fy_id,
  transaction_group_id,
  product_id,
  location_id,
  movement_type,
  movement_date,
  qty_delta,
  pcs_delta,
  uom,
  unit_cost,
  value_delta,
  ref_doc_type,
  ref_doc_id,
  created_by,
  posted_at,
  notes
)
SELECT
  s.business_id,
  COALESCE(loc.branch_id, br.id),
  fy.id,
  gen_random_uuid(),
  s.product_id,
  s.location_id,
  'OPENING_BALANCE',
  fy.start_date,
  s.sets::NUMERIC(12, 3),
  s.total_pcs,
  'SET',
  COALESCE(s.avg_unit_cost, 0),
  ROUND((s.sets * COALESCE(s.avg_unit_cost, 0))::NUMERIC, 2),
  'MIGRATION_016',
  s.id,
  NULL,
  NOW(),
  'Opening balance migrated from inventory_stock'
FROM public.inventory_stock s
JOIN public.inventory_locations loc ON loc.id = s.location_id
JOIN public.branches br ON br.business_id = s.business_id AND br.is_default IS TRUE
JOIN public.financial_years fy ON fy.business_id = s.business_id AND fy.is_active IS TRUE
WHERE s.sets > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.stock_ledger sl
    WHERE sl.business_id = s.business_id
      AND sl.product_id = s.product_id
      AND sl.location_id = s.location_id
      AND sl.ref_doc_type = 'MIGRATION_016'
      AND sl.ref_doc_id = s.id
  );

-- --------------------------------------------------------------------
-- SECTION 3: Internal Chronological Posting Guard (MWAC Protection)
-- Blocks posting a stock movement dated earlier than the latest
-- already-posted movement for the same (business, product, location).
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_chronological_stock_date(
  p_business_id BIGINT,
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_movement_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest_date DATE;
BEGIN
  SELECT MAX(sl.movement_date)
  INTO v_latest_date
  FROM public.stock_ledger sl
  WHERE sl.business_id = p_business_id
    AND sl.product_id = p_product_id
    AND sl.location_id = p_location_id;

  IF v_latest_date IS NOT NULL AND p_movement_date < v_latest_date THEN
    RAISE EXCEPTION 'Backdated stock posting rejected: movement date % precedes latest posted movement (%) for this product and location.',
      p_movement_date, v_latest_date;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_chronological_stock_date(BIGINT, BIGINT, BIGINT, DATE) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
