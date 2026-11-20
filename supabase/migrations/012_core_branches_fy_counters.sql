-- ====================================================================
-- Migration 012: Stage 1 Kala Core — Branches, Financial Years,
--                Document Counters & Optimistic Concurrency (row_version)
-- Prerequisite:  011_core_multicompany_tenancy.sql
-- ====================================================================

BEGIN;

-- Required for non-overlapping financial year date ranges per business
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --------------------------------------------------------------------
-- SECTION 1: Branches (Multi-Branch & Multi-Warehouse Support)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.branches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  gstin TEXT,
  state_code CHAR(2),
  address TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT branches_code_check CHECK (CHAR_LENGTH(TRIM(code)) BETWEEN 1 AND 20),
  CONSTRAINT branches_name_check CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 2 AND 120),
  CONSTRAINT branches_business_id_id_key UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_business_code
  ON public.branches (business_id, UPPER(TRIM(code)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_single_default
  ON public.branches (business_id)
  WHERE is_default IS TRUE;

CREATE INDEX IF NOT EXISTS idx_branches_business_id
  ON public.branches (business_id);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.branches FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branches TO authenticated;

DROP POLICY IF EXISTS "members_select_branches" ON public.branches;
DROP POLICY IF EXISTS "owners_manage_branches" ON public.branches;

CREATE POLICY "members_select_branches" ON public.branches
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "owners_manage_branches" ON public.branches
  FOR ALL TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- Backfill a default MAIN branch for every existing business
INSERT INTO public.branches (business_id, code, name, gstin, state_code, address, is_default, is_active)
SELECT
  b.id,
  'MAIN',
  b.name || ' - Main Branch',
  NULLIF(UPPER(TRIM(COALESCE(b.settings->>'gstin', ''))), ''),
  CASE
    WHEN NULLIF(UPPER(TRIM(COALESCE(b.settings->>'gstin', ''))), '') ~ '^[0-9]{2}'
      THEN SUBSTRING(UPPER(TRIM(b.settings->>'gstin')) FROM 1 FOR 2)
    ELSE NULL
  END,
  NULLIF(TRIM(COALESCE(b.settings->>'address', '')), ''),
  TRUE,
  TRUE
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.branches br WHERE br.business_id = b.id
);

-- Link inventory_locations & orders to branches (nullable for backward compatibility)
ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

UPDATE public.inventory_locations il
SET branch_id = br.id
FROM public.branches br
WHERE br.business_id = il.business_id
  AND br.is_default IS TRUE
  AND il.branch_id IS NULL;

UPDATE public.orders o
SET branch_id = br.id
FROM public.branches br
WHERE br.business_id = o.business_id
  AND br.is_default IS TRUE
  AND o.branch_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_business_branch_fkey') THEN
    ALTER TABLE public.inventory_locations
      ADD CONSTRAINT inventory_locations_business_branch_fkey
      FOREIGN KEY (business_id, branch_id)
      REFERENCES public.branches (business_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_business_branch_fkey') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_business_branch_fkey
      FOREIGN KEY (business_id, branch_id)
      REFERENCES public.branches (business_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- SECTION 2: Financial Years (Non-Overlapping & Lockable)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.financial_years (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_years_date_order_check CHECK (end_date > start_date),
  CONSTRAINT financial_years_label_check CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 4 AND 30),
  CONSTRAINT financial_years_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT financial_years_no_overlap EXCLUDE USING gist (
    business_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_years_business_label
  ON public.financial_years (business_id, UPPER(TRIM(label)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_years_single_active
  ON public.financial_years (business_id)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_financial_years_business_id
  ON public.financial_years (business_id);

ALTER TABLE public.financial_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.financial_years FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.financial_years TO authenticated;

DROP POLICY IF EXISTS "members_select_financial_years" ON public.financial_years;
DROP POLICY IF EXISTS "owners_manage_financial_years" ON public.financial_years;

CREATE POLICY "members_select_financial_years" ON public.financial_years
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "owners_manage_financial_years" ON public.financial_years
  FOR ALL TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- Backfill current Indian Financial Year (Apr 1 - Mar 31) for every existing business
DO $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_start_year INT := CASE WHEN EXTRACT(MONTH FROM v_today) >= 4 THEN EXTRACT(YEAR FROM v_today)::INT ELSE EXTRACT(YEAR FROM v_today)::INT - 1 END;
  v_start_date DATE := make_date(v_start_year, 4, 1);
  v_end_date DATE := make_date(v_start_year + 1, 3, 31);
  v_label TEXT := 'FY ' || v_start_year::TEXT || '-' || RIGHT((v_start_year + 1)::TEXT, 2);
BEGIN
  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked)
  SELECT b.id, v_label, v_start_date, v_end_date, TRUE, FALSE
  FROM public.businesses b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_years fy WHERE fy.business_id = b.id
  );
END $$;

-- Guard helper: resolves & asserts an open financial year for a business + date
CREATE OR REPLACE FUNCTION public.assert_financial_year_open(
  p_business_id BIGINT,
  p_doc_date DATE
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
BEGIN
  IF p_business_id IS NULL OR p_doc_date IS NULL THEN
    RAISE EXCEPTION 'Business ID and document date are required for financial year check.';
  END IF;

  SELECT * INTO v_fy
  FROM public.financial_years fy
  WHERE fy.business_id = p_business_id
    AND p_doc_date BETWEEN fy.start_date AND fy.end_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Date % does not fall within any configured financial year for this business.', p_doc_date;
  END IF;

  IF v_fy.is_locked THEN
    RAISE EXCEPTION 'Financial year "%" is locked and cannot accept new or modified transactions.', v_fy.label;
  END IF;

  RETURN v_fy.id;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: Unique, Strictly Ordered Document Counters
-- Scoped per (business_id, branch_id, fy_id, doc_type)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_document_counters (
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  fy_id BIGINT NOT NULL,
  doc_type TEXT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, branch_id, fy_id, doc_type),
  CONSTRAINT bdc_business_branch_fkey FOREIGN KEY (business_id, branch_id) REFERENCES public.branches (business_id, id) ON DELETE CASCADE,
  CONSTRAINT bdc_business_fy_fkey FOREIGN KEY (business_id, fy_id) REFERENCES public.financial_years (business_id, id) ON DELETE CASCADE
);

ALTER TABLE public.business_document_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_document_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_document_no(
  p_business_id BIGINT,
  p_branch_id BIGINT,
  p_fy_id BIGINT,
  p_doc_type TEXT,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc_type TEXT;
  v_prefix TEXT;
  v_fy_label TEXT;
  v_fy_short TEXT;
  v_val BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  v_doc_type := UPPER(TRIM(COALESCE(p_doc_type, '')));
  IF v_doc_type = '' OR CHAR_LENGTH(v_doc_type) > 30 THEN
    RAISE EXCEPTION 'Valid doc_type is required';
  END IF;

  SELECT label INTO v_fy_label
  FROM public.financial_years
  WHERE id = p_fy_id AND business_id = p_business_id;

  IF v_fy_label IS NULL THEN
    RAISE EXCEPTION 'Financial year % not found for business %', p_fy_id, p_business_id;
  END IF;

  v_fy_short := REGEXP_REPLACE(v_fy_label, '^FY\s*', '', 'i');

  v_prefix := NULLIF(UPPER(TRIM(COALESCE(p_prefix, ''))), '');
  IF v_prefix IS NULL THEN
    SELECT UPPER(TRIM(code)) INTO v_prefix
    FROM public.branches
    WHERE id = p_branch_id AND business_id = p_business_id;
    v_prefix := COALESCE(v_prefix, 'DOC') || '-' || LEFT(v_doc_type, 3);
  END IF;

  INSERT INTO public.business_document_counters (business_id, branch_id, fy_id, doc_type, last_value)
  VALUES (p_business_id, p_branch_id, p_fy_id, v_doc_type, 1)
  ON CONFLICT (business_id, branch_id, fy_id, doc_type)
  DO UPDATE SET last_value = business_document_counters.last_value + 1
  RETURNING last_value INTO v_val;

  RETURN v_prefix || '/' || v_fy_short || '/' || LPAD(v_val::TEXT, 4, '0');
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 4: Optimistic Concurrency Control (row_version)
-- --------------------------------------------------------------------

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_row_version_branches ON public.branches;
CREATE TRIGGER trg_bump_row_version_branches BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS trg_bump_row_version_products ON public.products;
CREATE TRIGGER trg_bump_row_version_products BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS trg_bump_row_version_parties ON public.parties;
CREATE TRIGGER trg_bump_row_version_parties BEFORE UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS trg_bump_row_version_agents ON public.agents;
CREATE TRIGGER trg_bump_row_version_agents BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

DROP TRIGGER IF EXISTS trg_bump_row_version_orders ON public.orders;
CREATE TRIGGER trg_bump_row_version_orders BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();

-- --------------------------------------------------------------------
-- SECTION 5: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_financial_year_open(BIGINT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_document_no(BIGINT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.assert_financial_year_open(BIGINT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_no(BIGINT, BIGINT, BIGINT, TEXT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
