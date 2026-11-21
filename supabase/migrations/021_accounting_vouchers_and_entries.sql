-- ====================================================================
-- Migration 021: Stage 3 Kala Finance — Strictly Immutable Vouchers,
--                Voucher Entries, Single-Reversal Guard & Deferred
--                Double-Entry Balance Trigger
-- Prerequisite:  020_accounting_coa_and_cost_centers.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Vouchers Header Table (public.vouchers)
-- Direct client writes revoked; mutated strictly via SECURITY DEFINER RPCs.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vouchers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  fy_id BIGINT NOT NULL,
  voucher_no TEXT NOT NULL,
  voucher_type TEXT NOT NULL,
  voucher_date DATE NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(14, 6) NOT NULL DEFAULT 1.000000,
  ref_doc_type TEXT,
  ref_doc_id BIGINT,
  reversed_voucher_id BIGINT,
  narration TEXT,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  base_total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  idempotency_key UUID,
  created_by UUID NOT NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vouchers_no_check CHECK (CHAR_LENGTH(TRIM(voucher_no)) BETWEEN 1 AND 60),
  CONSTRAINT vouchers_type_check CHECK (
    voucher_type IN (
      'SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN',
      'RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA', 'REVERSAL'
    )
  ),
  CONSTRAINT vouchers_exchange_rate_check CHECK (exchange_rate > 0),
  CONSTRAINT vouchers_amounts_nonneg_check CHECK (total_amount >= 0 AND base_total_amount >= 0),
  CONSTRAINT vouchers_status_check CHECK (status IN ('draft', 'posted')),
  CONSTRAINT vouchers_reversal_self_check CHECK (reversed_voucher_id IS NULL OR reversed_voucher_id <> id),
  CONSTRAINT vouchers_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT vouchers_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT vouchers_business_fy_fkey FOREIGN KEY (business_id, fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT vouchers_business_reversed_fkey FOREIGN KEY (business_id, reversed_voucher_id)
    REFERENCES public.vouchers (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_business_fy_no
  ON public.vouchers (business_id, fy_id, UPPER(TRIM(voucher_no)));

-- Single-Reversal Uniqueness Guard: a posted voucher can NEVER be reversed twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_single_reversal
  ON public.vouchers (business_id, reversed_voucher_id)
  WHERE reversed_voucher_id IS NOT NULL AND status = 'posted';

CREATE INDEX IF NOT EXISTS idx_vouchers_business_fy_date
  ON public.vouchers (business_id, fy_id, voucher_date DESC);

CREATE INDEX IF NOT EXISTS idx_vouchers_business_type_status
  ON public.vouchers (business_id, voucher_type, status);

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vouchers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vouchers TO authenticated;

DROP POLICY IF EXISTS "members_select_vouchers" ON public.vouchers;
CREATE POLICY "members_select_vouchers" ON public.vouchers
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 2: Voucher Entries Line Table (public.voucher_entries)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voucher_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  voucher_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  cost_center_id BIGINT,
  debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  base_debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  base_credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_narration TEXT,
  CONSTRAINT voucher_entries_dc_exclusive_check CHECK (
    debit >= 0 AND credit >= 0
    AND NOT (debit > 0 AND credit > 0)
    AND (debit > 0 OR credit > 0)
  ),
  CONSTRAINT voucher_entries_base_dc_exclusive_check CHECK (
    base_debit >= 0 AND base_credit >= 0
    AND NOT (base_debit > 0 AND base_credit > 0)
    AND (base_debit > 0 OR base_credit > 0)
  ),
  CONSTRAINT voucher_entries_business_voucher_fkey FOREIGN KEY (business_id, voucher_id)
    REFERENCES public.vouchers (business_id, id) ON DELETE CASCADE,
  CONSTRAINT voucher_entries_business_account_fkey FOREIGN KEY (business_id, account_id)
    REFERENCES public.accounts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT voucher_entries_business_cc_fkey FOREIGN KEY (business_id, cost_center_id)
    REFERENCES public.cost_centers (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher
  ON public.voucher_entries (business_id, voucher_id);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_account
  ON public.voucher_entries (business_id, account_id);

ALTER TABLE public.voucher_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.voucher_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.voucher_entries TO authenticated;

DROP POLICY IF EXISTS "members_select_voucher_entries" ON public.voucher_entries;
CREATE POLICY "members_select_voucher_entries" ON public.voucher_entries
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 3: Absolute Post-Immutability Triggers
-- Once a voucher is 'posted', neither the voucher nor its entries may
-- ever be updated, deleted, or appended to.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_posted_voucher_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted voucher "%" (id: %) is strictly immutable and cannot be modified or deleted. Use reverse_voucher_tx() instead.',
      OLD.voucher_no, OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_voucher_immutable ON public.vouchers;
CREATE TRIGGER trg_guard_posted_voucher_immutable
  BEFORE UPDATE OR DELETE ON public.vouchers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_posted_voucher_immutable();

CREATE OR REPLACE FUNCTION public.guard_posted_voucher_entries_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voucher_id BIGINT;
  v_status TEXT;
BEGIN
  v_voucher_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;

  SELECT status INTO v_status
  FROM public.vouchers
  WHERE id = v_voucher_id;

  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Entries of posted voucher (id: %) are strictly immutable and cannot be inserted, updated, or deleted.',
      v_voucher_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_voucher_entries_immutable ON public.voucher_entries;
CREATE TRIGGER trg_guard_posted_voucher_entries_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_posted_voucher_entries_immutable();

-- --------------------------------------------------------------------
-- SECTION 4: Deferred Double-Entry Balance Enforcement Trigger
-- Asserts SUM(base_debit) = SUM(base_credit) AND SUM(base_debit) > 0
-- AND at least 2 lines for every posted voucher at transaction commit.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_voucher_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voucher_id BIGINT;
  v_status TEXT;
  v_sum_dr NUMERIC(14, 2);
  v_sum_cr NUMERIC(14, 2);
  v_line_count INT;
BEGIN
  IF TG_TABLE_NAME = 'vouchers' THEN
    v_voucher_id := NEW.id;
    v_status := NEW.status;
  ELSE
    v_voucher_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
    SELECT status INTO v_status FROM public.vouchers WHERE id = v_voucher_id;
  END IF;

  IF v_status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(base_debit), 0),
    COALESCE(SUM(base_credit), 0),
    COUNT(*)
  INTO v_sum_dr, v_sum_cr, v_line_count
  FROM public.voucher_entries
  WHERE voucher_id = v_voucher_id;

  IF v_line_count < 2 OR v_sum_dr <= 0 OR v_sum_dr <> v_sum_cr THEN
    RAISE EXCEPTION 'Voucher (id: %) is unbalanced: lines=%, total_base_debit=%, total_base_credit=%',
      v_voucher_id, v_line_count, v_sum_dr, v_sum_cr;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_balanced_on_entries ON public.voucher_entries;
CREATE CONSTRAINT TRIGGER trg_voucher_balanced_on_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.voucher_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_voucher_balanced();

DROP TRIGGER IF EXISTS trg_voucher_balanced_on_header ON public.vouchers;
CREATE CONSTRAINT TRIGGER trg_voucher_balanced_on_header
  AFTER INSERT OR UPDATE OF status ON public.vouchers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_voucher_balanced();

COMMIT;

NOTIFY pgrst, 'reload schema';

