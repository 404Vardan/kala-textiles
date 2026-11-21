-- ====================================================================
-- Migration 027: Stage 3 Kala Finance — Party Subledger (C1),
--                Per-FY Opening Balances & Carry-Forward (C2),
--                and Freight Recovery Account Classification (C3)
-- Prerequisite:  026_accounting_party_dimension_and_allocation_currency.sql
--
-- Keeps migrations 020–026 immutable while implementing Rev 3 C1/C2/C3:
--   1. C3: Separates 4410 Freight & Packing Recovery (income) from
--      5310 Bardana & Packing Expense (expense) and adds account_sub_ledger_type.
--   2. C1: Introduces party_subledger_bills keyed by (business_id, voucher_entry_id),
--      links bill_allocations to source_bill_id / settlement_bill_id,
--      caps allocations strictly at the party control-account entry amount
--      (never vouchers.base_total_amount), and adds signed GL control
--      reconciliation verify_subledger_control_tieout().
--   3. C2: Introduces per-FY account_opening_balances + zero-double-counting
--      fy_open_bill_snapshots, set_opening_balance_tx(), full Trial Balance
--      (Opening + Period = Closing), and permanent-vs-nominal FY carry-forward
--      in close_financial_year_tx().
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: C3 — Account Sub-Ledger Classification & Standard Textile COA
-- --------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_sub_ledger_type TEXT NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND conname = 'accounts_sub_ledger_type_check'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_sub_ledger_type_check
      CHECK (account_sub_ledger_type IN ('NONE', 'PARTY', 'BANK', 'CASH', 'TAX', 'INVENTORY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.voucher_entries'::regclass
      AND conname = 'voucher_entries_business_id_id_key'
  ) THEN
    ALTER TABLE public.voucher_entries
      ADD CONSTRAINT voucher_entries_business_id_id_key UNIQUE (business_id, id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_business_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.accounts (
    business_id, code, name, account_group, sub_group,
    opening_balance, opening_balance_type, is_system, account_sub_ledger_type
  ) VALUES
    (p_business_id, '1000', 'Cash in Hand', 'asset', 'Current Assets', 0, 'DR', TRUE, 'CASH'),
    (p_business_id, '1010', 'Bank Account', 'asset', 'Current Assets', 0, 'DR', TRUE, 'BANK'),
    (p_business_id, '1020', 'Cheques in Hand', 'asset', 'Current Assets', 0, 'DR', TRUE, 'BANK'),
    (p_business_id, '1100', 'Sundry Debtors', 'asset', 'Accounts Receivable', 0, 'DR', TRUE, 'PARTY'),
    (p_business_id, '1200', 'Inventory Asset', 'asset', 'Current Assets', 0, 'DR', TRUE, 'INVENTORY'),
    (p_business_id, '1300', 'Input CGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE, 'TAX'),
    (p_business_id, '1310', 'Input SGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE, 'TAX'),
    (p_business_id, '1320', 'Input IGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE, 'TAX'),
    (p_business_id, '2000', 'Sundry Creditors', 'liability', 'Accounts Payable', 0, 'CR', TRUE, 'PARTY'),
    (p_business_id, '2010', 'Mill / Job-Worker Payables', 'liability', 'Accounts Payable', 0, 'CR', TRUE, 'PARTY'),
    (p_business_id, '2020', 'Agent Brokerage Payable', 'liability', 'Accounts Payable', 0, 'CR', TRUE, 'PARTY'),
    (p_business_id, '2030', 'Customer Advances', 'liability', 'Current Liabilities', 0, 'CR', TRUE, 'PARTY'),
    (p_business_id, '2100', 'Output CGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE, 'TAX'),
    (p_business_id, '2110', 'Output SGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE, 'TAX'),
    (p_business_id, '2120', 'Output IGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE, 'TAX'),
    (p_business_id, '2200', 'TDS Payable', 'liability', 'Duties & Taxes', 0, 'CR', TRUE, 'TAX'),
    (p_business_id, '3000', 'Owner Capital', 'equity', 'Capital Account', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '3100', 'Retained Earnings / Reserves', 'equity', 'Reserves & Surplus', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '4000', 'Sales Revenue', 'income', 'Direct Income', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '4100', 'Sales Returns', 'income', 'Direct Income', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '4300', 'Realised Foreign Exchange Gain', 'income', 'Indirect Income', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '4400', 'Bank Charges Recovered', 'income', 'Indirect Income', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '4410', 'Freight & Packing Recovery', 'income', 'Indirect Income', 0, 'CR', TRUE, 'NONE'),
    (p_business_id, '5000', 'Purchases', 'expense', 'Direct Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5100', 'Cost of Goods Sold', 'expense', 'Direct Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5200', 'Job Work & Mill Charges', 'expense', 'Direct Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5300', 'Freight & Forwarding Expense', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5310', 'Bardana & Packing Expense', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5400', 'Discount Allowed', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5450', 'Agent Brokerage / Adat', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5500', 'Round Off', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5600', 'Bank & Cheque Bounce Charges', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE'),
    (p_business_id, '5700', 'Realised Foreign Exchange Loss', 'expense', 'Indirect Expenses', 0, 'DR', TRUE, 'NONE')
  ON CONFLICT (business_id, UPPER(TRIM(code))) DO UPDATE SET
    account_sub_ledger_type = EXCLUDED.account_sub_ledger_type;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_chart_of_accounts(BIGINT) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_biz RECORD;
BEGIN
  FOR v_biz IN SELECT id FROM public.businesses LOOP
    PERFORM public.seed_default_chart_of_accounts(v_biz.id);
  END LOOP;
END $$;

-- --------------------------------------------------------------------
-- SECTION 2: C1 — Party Subledger Open-Bill Table (party_subledger_bills)
-- Long-lived across financial years; keyed by (business_id, voucher_entry_id).
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.party_subledger_bills (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL,
  origin_fy_id BIGINT NOT NULL,
  voucher_id BIGINT NOT NULL,
  voucher_entry_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  party_id BIGINT NOT NULL,
  bill_role TEXT NOT NULL,
  normal_side TEXT NOT NULL,
  bill_no TEXT NOT NULL,
  document_date DATE NOT NULL,
  due_date DATE,
  currency_code CHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate NUMERIC(14, 6) NOT NULL DEFAULT 1.000000,
  original_txn_amount NUMERIC(14, 2) NOT NULL,
  original_base_amount NUMERIC(14, 2) NOT NULL,
  allocated_txn_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  allocated_base_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remaining_txn_amount NUMERIC(14, 2) GENERATED ALWAYS AS (original_txn_amount - allocated_txn_amount) STORED,
  remaining_base_amount NUMERIC(14, 2) GENERATED ALWAYS AS (original_base_amount - allocated_base_amount) STORED,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT psb_role_check CHECK (
    bill_role IN (
      'RECEIVABLE_BILL', 'PAYABLE_BILL',
      'RECEIVABLE_SETTLEMENT', 'PAYABLE_SETTLEMENT',
      'ADVANCE_RECEIVED', 'ADVANCE_PAID'
    )
  ),
  CONSTRAINT psb_side_check CHECK (normal_side IN ('DR', 'CR')),
  CONSTRAINT psb_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT psb_rate_check CHECK (exchange_rate > 0),
  CONSTRAINT psb_amounts_check CHECK (
    original_txn_amount > 0 AND original_base_amount > 0
    AND allocated_txn_amount >= 0 AND allocated_txn_amount <= original_txn_amount
    AND allocated_base_amount >= 0 AND allocated_base_amount <= original_base_amount
  ),
  CONSTRAINT psb_status_check CHECK (status IN ('open', 'partially_settled', 'settled', 'reversed')),
  CONSTRAINT psb_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT psb_business_entry_key UNIQUE (business_id, voucher_entry_id),
  CONSTRAINT psb_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT psb_business_fy_fkey FOREIGN KEY (business_id, origin_fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT psb_business_voucher_fkey FOREIGN KEY (business_id, voucher_id)
    REFERENCES public.vouchers (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT psb_business_entry_fkey FOREIGN KEY (business_id, voucher_entry_id)
    REFERENCES public.voucher_entries (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT psb_business_account_fkey FOREIGN KEY (business_id, account_id)
    REFERENCES public.accounts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT psb_business_party_fkey FOREIGN KEY (business_id, party_id)
    REFERENCES public.parties (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_psb_business_party_status
  ON public.party_subledger_bills (business_id, party_id, status);

CREATE INDEX IF NOT EXISTS idx_psb_business_voucher
  ON public.party_subledger_bills (business_id, voucher_id);

ALTER TABLE public.party_subledger_bills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.party_subledger_bills FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.party_subledger_bills TO authenticated;

DROP POLICY IF EXISTS "members_select_party_subledger_bills" ON public.party_subledger_bills;
CREATE POLICY "members_select_party_subledger_bills" ON public.party_subledger_bills
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- Link bill_allocations to exact party_subledger_bills rows
ALTER TABLE public.bill_allocations
  ADD COLUMN IF NOT EXISTS source_bill_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_bill_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_allocations'::regclass
      AND conname = 'bill_allocations_business_source_bill_fkey'
  ) THEN
    ALTER TABLE public.bill_allocations
      ADD CONSTRAINT bill_allocations_business_source_bill_fkey
      FOREIGN KEY (business_id, source_bill_id)
      REFERENCES public.party_subledger_bills (business_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_allocations'::regclass
      AND conname = 'bill_allocations_business_settlement_bill_fkey'
  ) THEN
    ALTER TABLE public.bill_allocations
      ADD CONSTRAINT bill_allocations_business_settlement_bill_fkey
      FOREIGN KEY (business_id, settlement_bill_id)
      REFERENCES public.party_subledger_bills (business_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- SECTION 3: C2 — Per-FY account_opening_balances & fy_open_bill_snapshots
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_opening_balances (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  branch_id BIGINT,
  party_id BIGINT,
  currency_code CHAR(3) NOT NULL DEFAULT 'INR',
  opening_txn_debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  opening_txn_credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  opening_base_debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  opening_base_credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'MANUAL',
  source_fy_id BIGINT,
  source_ref TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT aob_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT aob_txn_dc_check CHECK (
    opening_txn_debit >= 0 AND opening_txn_credit >= 0
    AND NOT (opening_txn_debit > 0 AND opening_txn_credit > 0)
  ),
  CONSTRAINT aob_base_dc_check CHECK (
    opening_base_debit >= 0 AND opening_base_credit >= 0
    AND NOT (opening_base_debit > 0 AND opening_base_credit > 0)
  ),
  CONSTRAINT aob_source_type_check CHECK (source_type IN ('MANUAL', 'FY_CARRY_FORWARD', 'RELY_MIGRATION')),
  CONSTRAINT aob_source_fy_check CHECK (
    (source_type = 'FY_CARRY_FORWARD' AND source_fy_id IS NOT NULL AND source_fy_id <> fy_id)
    OR (source_type <> 'FY_CARRY_FORWARD' AND source_fy_id IS NULL)
  ),
  CONSTRAINT aob_business_fy_fkey FOREIGN KEY (business_id, fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT aob_business_account_fkey FOREIGN KEY (business_id, account_id)
    REFERENCES public.accounts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT aob_business_branch_fkey FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT aob_business_party_fkey FOREIGN KEY (business_id, party_id)
    REFERENCES public.parties (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT aob_business_source_fy_fkey FOREIGN KEY (business_id, source_fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aob_grain
  ON public.account_opening_balances (
    business_id, fy_id, account_id, COALESCE(branch_id, 0), COALESCE(party_id, 0), currency_code
  );

CREATE OR REPLACE FUNCTION public.guard_aob_locked_fy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fy_id BIGINT;
  v_locked BOOLEAN;
BEGIN
  v_fy_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.fy_id ELSE NEW.fy_id END;
  SELECT is_locked INTO v_locked FROM public.financial_years WHERE id = v_fy_id;
  IF v_locked IS TRUE THEN
    RAISE EXCEPTION 'Opening balances for locked financial year (id: %) are immutable.', v_fy_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_aob_locked_fy ON public.account_opening_balances;
CREATE TRIGGER trg_guard_aob_locked_fy
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_aob_locked_fy();

ALTER TABLE public.account_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_opening_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_opening_balances TO authenticated;

DROP POLICY IF EXISTS "members_select_aob" ON public.account_opening_balances;
CREATE POLICY "members_select_aob" ON public.account_opening_balances
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- Immutable composition snapshot of open bills at the start of each carried-forward FY (zero extra GL movement)
CREATE TABLE IF NOT EXISTS public.fy_open_bill_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_id BIGINT NOT NULL,
  bill_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  party_id BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'INR',
  carried_txn_amount NUMERIC(14, 2) NOT NULL CHECK (carried_txn_amount > 0),
  carried_base_amount NUMERIC(14, 2) NOT NULL CHECK (carried_base_amount > 0),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('DR', 'CR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fy_obs_unique_bill_fy UNIQUE (business_id, fy_id, bill_id),
  CONSTRAINT fy_obs_business_fy_fkey FOREIGN KEY (business_id, fy_id)
    REFERENCES public.financial_years (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT fy_obs_business_bill_fkey FOREIGN KEY (business_id, bill_id)
    REFERENCES public.party_subledger_bills (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT fy_obs_business_account_fkey FOREIGN KEY (business_id, account_id)
    REFERENCES public.accounts (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT fy_obs_business_party_fkey FOREIGN KEY (business_id, party_id)
    REFERENCES public.parties (business_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.guard_fy_obs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'fy_open_bill_snapshots is strictly append-only; rows cannot be modified or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_fy_obs_immutable ON public.fy_open_bill_snapshots;
CREATE TRIGGER trg_guard_fy_obs_immutable
  BEFORE UPDATE OR DELETE ON public.fy_open_bill_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_fy_obs_immutable();

ALTER TABLE public.fy_open_bill_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fy_open_bill_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fy_open_bill_snapshots TO authenticated;

DROP POLICY IF EXISTS "members_select_fy_obs" ON public.fy_open_bill_snapshots;
CREATE POLICY "members_select_fy_obs" ON public.fy_open_bill_snapshots
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 4: set_opening_balance_tx() (Per-FY Opening Balance Entry RPC)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_opening_balance_tx(
  p_business_id BIGINT,
  p_fy_id BIGINT,
  p_account_id BIGINT,
  p_opening_debit NUMERIC DEFAULT 0,
  p_opening_credit NUMERIC DEFAULT 0,
  p_party_id BIGINT DEFAULT NULL,
  p_branch_id BIGINT DEFAULT NULL,
  p_currency_code CHAR(3) DEFAULT 'INR',
  p_source_type TEXT DEFAULT 'MANUAL',
  p_source_ref TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_fy_locked BOOLEAN;
  v_currency CHAR(3);
  v_aob_id BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT (public.is_business_owner(p_business_id) OR public.has_permission(p_business_id, 'vouchers.post')) THEN
    RAISE EXCEPTION 'Unauthorized: missing permission to set opening balances';
  END IF;

  SELECT is_locked INTO v_fy_locked
  FROM public.financial_years
  WHERE id = p_fy_id AND business_id = p_business_id
  FOR SHARE;

  IF v_fy_locked IS NULL THEN
    RAISE EXCEPTION 'Financial year % not found in business %', p_fy_id, p_business_id;
  END IF;
  IF v_fy_locked IS TRUE THEN
    RAISE EXCEPTION 'Cannot set opening balances on locked financial year %', p_fy_id;
  END IF;

  IF p_source_type NOT IN ('MANUAL', 'RELY_MIGRATION') THEN
    RAISE EXCEPTION 'set_opening_balance_tx only accepts MANUAL or RELY_MIGRATION source_type';
  END IF;

  IF p_opening_debit < 0 OR p_opening_credit < 0 OR (p_opening_debit > 0 AND p_opening_credit > 0) THEN
    RAISE EXCEPTION 'Opening debit and credit must be non-negative and mutually exclusive';
  END IF;

  v_currency := UPPER(TRIM(COALESCE(p_currency_code, 'INR')));

  INSERT INTO public.account_opening_balances (
    business_id, fy_id, account_id, branch_id, party_id, currency_code,
    opening_txn_debit, opening_txn_credit, opening_base_debit, opening_base_credit,
    source_type, source_ref, created_by
  ) VALUES (
    p_business_id, p_fy_id, p_account_id, p_branch_id, p_party_id, v_currency,
    p_opening_debit, p_opening_credit, p_opening_debit, p_opening_credit,
    p_source_type, p_source_ref, v_uid
  )
  ON CONFLICT (business_id, fy_id, account_id, COALESCE(branch_id, 0), COALESCE(party_id, 0), currency_code)
  DO UPDATE SET
    opening_txn_debit = EXCLUDED.opening_txn_debit,
    opening_txn_credit = EXCLUDED.opening_txn_credit,
    opening_base_debit = EXCLUDED.opening_base_debit,
    opening_base_credit = EXCLUDED.opening_base_credit,
    source_type = EXCLUDED.source_type,
    source_ref = EXCLUDED.source_ref
  RETURNING id INTO v_aob_id;

  RETURN jsonb_build_object(
    'success', true,
    'opening_balance_id', v_aob_id,
    'fy_id', p_fy_id,
    'account_id', p_account_id,
    'opening_base_debit', p_opening_debit,
    'opening_base_credit', p_opening_credit
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 5: Upgrade post_voucher_tx() & reverse_voucher_tx()
-- Automatically create party_subledger_bills rows for every entry posted
-- to a PARTY control account (keyed by exact voucher_entry_id).
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_voucher_tx(
  p_business_id BIGINT,
  p_branch_id BIGINT,
  p_voucher_type TEXT,
  p_voucher_date DATE,
  p_entries JSONB,
  p_narration TEXT DEFAULT NULL,
  p_ref_doc_type TEXT DEFAULT NULL,
  p_ref_doc_id BIGINT DEFAULT NULL,
  p_currency_code CHAR(3) DEFAULT 'INR',
  p_exchange_rate NUMERIC DEFAULT 1.0,
  p_idempotency_key UUID DEFAULT NULL,
  p_party_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_fy_locked BOOLEAN;
  v_voucher_type TEXT;
  v_currency CHAR(3);
  v_voucher_no TEXT;
  v_voucher_id BIGINT;
  v_entry_id BIGINT;
  v_elem JSONB;
  v_account_id BIGINT;
  v_acc_group TEXT;
  v_acc_sub_type TEXT;
  v_cc_id BIGINT;
  v_line_party_id BIGINT;
  v_debit NUMERIC(14, 2);
  v_credit NUMERIC(14, 2);
  v_base_debit NUMERIC(14, 2);
  v_base_credit NUMERIC(14, 2);
  v_line_narration TEXT;
  v_bill_role TEXT;
  v_normal_side TEXT;
  v_total_debit NUMERIC(14, 2) := 0;
  v_total_credit NUMERIC(14, 2) := 0;
  v_total_base_debit NUMERIC(14, 2) := 0;
  v_total_base_credit NUMERIC(14, 2) := 0;
  v_line_count INT := 0;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.has_permission(p_business_id, 'vouchers.post') THEN
    RAISE EXCEPTION 'Unauthorized: missing vouchers.post permission for business %', p_business_id;
  END IF;

  v_voucher_type := UPPER(TRIM(COALESCE(p_voucher_type, '')));
  IF v_voucher_type = 'REVERSAL' THEN
    RAISE EXCEPTION 'Reversal vouchers must be created via reverse_voucher_tx()';
  END IF;

  IF v_voucher_type NOT IN (
    'SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN',
    'RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA'
  ) THEN
    RAISE EXCEPTION 'Invalid voucher_type: %', p_voucher_type;
  END IF;

  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'exchange_rate must be greater than zero';
  END IF;

  v_currency := UPPER(TRIM(COALESCE(p_currency_code, 'INR')));
  IF CHAR_LENGTH(v_currency) <> 3 THEN
    RAISE EXCEPTION 'currency_code must be a 3-letter ISO code';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'A voucher requires at least 2 balanced entries';
  END IF;

  IF p_party_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.parties pt WHERE pt.id = p_party_id AND pt.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Party % not found in business %', p_party_id, p_business_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      p_branch_id::TEXT || ':' || v_voucher_type || ':' || p_voucher_date::TEXT || ':' ||
      v_currency || ':' || p_exchange_rate::TEXT || ':' || COALESCE(p_party_id::TEXT, '') || ':' || p_entries::TEXT
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'POST_VOUCHER', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_voucher_date);
  SELECT is_locked INTO v_fy_locked
  FROM public.financial_years
  WHERE id = v_fy_id AND business_id = p_business_id
  FOR SHARE;

  IF v_fy_locked IS NOT FALSE THEN
    RAISE EXCEPTION 'Financial year % is locked and cannot accept new vouchers', v_fy_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Branch % is not active for business %', p_branch_id, p_business_id;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_account_id := NULLIF(TRIM(COALESCE(v_elem->>'account_id', '')), '')::BIGINT;
    v_cc_id := NULLIF(TRIM(COALESCE(v_elem->>'cost_center_id', '')), '')::BIGINT;
    v_line_party_id := NULLIF(TRIM(COALESCE(v_elem->>'party_id', '')), '')::BIGINT;
    v_debit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'debit', '')), '')::NUMERIC(14, 2), 0);
    v_credit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'credit', '')), '')::NUMERIC(14, 2), 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Each voucher entry must specify an account_id';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = v_account_id AND a.business_id = p_business_id AND a.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Account % is not active in business %', v_account_id, p_business_id;
    END IF;

    IF v_cc_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.cost_centers cc
      WHERE cc.id = v_cc_id AND cc.business_id = p_business_id AND cc.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Cost centre % is not active in business %', v_cc_id, p_business_id;
    END IF;

    IF v_line_party_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.parties pt WHERE pt.id = v_line_party_id AND pt.business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'Line party % not found in business %', v_line_party_id, p_business_id;
    END IF;

    IF v_debit < 0 OR v_credit < 0 OR (v_debit > 0 AND v_credit > 0) OR (v_debit = 0 AND v_credit = 0) THEN
      RAISE EXCEPTION 'Each voucher entry must have strictly positive debit OR credit (not both)';
    END IF;

    v_base_debit := ROUND((v_debit * p_exchange_rate)::NUMERIC, 2);
    v_base_credit := ROUND((v_credit * p_exchange_rate)::NUMERIC, 2);

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_total_base_debit := v_total_base_debit + v_base_debit;
    v_total_base_credit := v_total_base_credit + v_base_credit;
    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Voucher is unbalanced in transaction currency (%): total_debit (%) <> total_credit (%)',
      v_currency, v_total_debit, v_total_credit;
  END IF;

  IF v_total_base_debit <= 0 OR v_total_base_debit <> v_total_base_credit THEN
    RAISE EXCEPTION 'Voucher is unbalanced in base currency: total_base_debit (%) <> total_base_credit (%)',
      v_total_base_debit, v_total_base_credit;
  END IF;

  v_voucher_no := public.next_document_no(p_business_id, p_branch_id, v_fy_id, 'VCH_' || v_voucher_type, LEFT(v_voucher_type, 3));

  INSERT INTO public.vouchers (
    business_id, branch_id, fy_id, voucher_no, voucher_type, voucher_date,
    currency_code, exchange_rate, party_id, ref_doc_type, ref_doc_id, narration,
    total_amount, base_total_amount, status, idempotency_key, created_by
  ) VALUES (
    p_business_id, p_branch_id, v_fy_id, v_voucher_no, v_voucher_type, p_voucher_date,
    v_currency, p_exchange_rate, p_party_id, p_ref_doc_type, p_ref_doc_id, p_narration,
    v_total_debit, v_total_base_debit, 'draft', p_idempotency_key, v_uid
  )
  RETURNING id INTO v_voucher_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_account_id := (v_elem->>'account_id')::BIGINT;
    v_cc_id := NULLIF(TRIM(COALESCE(v_elem->>'cost_center_id', '')), '')::BIGINT;
    v_line_party_id := COALESCE(
      NULLIF(TRIM(COALESCE(v_elem->>'party_id', '')), '')::BIGINT,
      p_party_id
    );
    v_debit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'debit', '')), '')::NUMERIC(14, 2), 0);
    v_credit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'credit', '')), '')::NUMERIC(14, 2), 0);
    v_base_debit := ROUND((v_debit * p_exchange_rate)::NUMERIC, 2);
    v_base_credit := ROUND((v_credit * p_exchange_rate)::NUMERIC, 2);
    v_line_narration := NULLIF(TRIM(COALESCE(v_elem->>'narration', '')), '');

    INSERT INTO public.voucher_entries (
      business_id, voucher_id, account_id, cost_center_id, party_id,
      debit, credit, base_debit, base_credit, line_narration
    ) VALUES (
      p_business_id, v_voucher_id, v_account_id, v_cc_id, v_line_party_id,
      v_debit, v_credit, v_base_debit, v_base_credit, v_line_narration
    )
    RETURNING id INTO v_entry_id;

    -- Auto-create party_subledger_bills row for PARTY control account entries with party_id
    SELECT a.account_group, a.account_sub_ledger_type
    INTO v_acc_group, v_acc_sub_type
    FROM public.accounts a
    WHERE a.id = v_account_id AND a.business_id = p_business_id;

    IF v_acc_sub_type = 'PARTY' AND v_line_party_id IS NOT NULL THEN
      IF v_debit > 0 THEN
        v_normal_side := 'DR';
        v_bill_role := CASE WHEN v_acc_group = 'asset' THEN 'RECEIVABLE_BILL' ELSE 'PAYABLE_SETTLEMENT' END;
      ELSE
        v_normal_side := 'CR';
        v_bill_role := CASE WHEN v_acc_group = 'asset' THEN 'RECEIVABLE_SETTLEMENT' ELSE 'PAYABLE_BILL' END;
      END IF;

      INSERT INTO public.party_subledger_bills (
        business_id, branch_id, origin_fy_id, voucher_id, voucher_entry_id,
        account_id, party_id, bill_role, normal_side, bill_no, document_date,
        currency_code, exchange_rate, original_txn_amount, original_base_amount, status
      ) VALUES (
        p_business_id, p_branch_id, v_fy_id, v_voucher_id, v_entry_id,
        v_account_id, v_line_party_id, v_bill_role, v_normal_side, v_voucher_no, p_voucher_date,
        v_currency, p_exchange_rate,
        GREATEST(v_debit, v_credit), GREATEST(v_base_debit, v_base_credit), 'open'
      );
    END IF;
  END LOOP;

  UPDATE public.vouchers
  SET status = 'posted', posted_at = NOW()
  WHERE id = v_voucher_id;

  PERFORM public.record_audit_event(
    p_business_id, 'voucher', v_voucher_id::TEXT, 'POST',
    NULL, jsonb_build_object(
      'voucher_no', v_voucher_no,
      'voucher_type', v_voucher_type,
      'voucher_date', p_voucher_date,
      'party_id', p_party_id,
      'currency_code', v_currency,
      'base_total_amount', v_total_base_debit,
      'line_count', v_line_count
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'voucher_id', v_voucher_id,
    'voucher_no', v_voucher_no,
    'voucher_type', v_voucher_type,
    'fy_id', v_fy_id,
    'party_id', p_party_id,
    'total_amount', v_total_debit,
    'base_total_amount', v_total_base_debit,
    'status', 'posted'
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- Upgrade reverse_voucher_tx() to mirror PARTY control entries in party_subledger_bills
CREATE OR REPLACE FUNCTION public.reverse_voucher_tx(
  p_business_id BIGINT,
  p_voucher_id BIGINT,
  p_reversal_date DATE DEFAULT CURRENT_DATE,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_req_hash TEXT;
  v_claim JSONB;
  v_orig public.vouchers%ROWTYPE;
  v_fy_id BIGINT;
  v_fy_locked BOOLEAN;
  v_rev_no TEXT;
  v_rev_id BIGINT;
  v_reason TEXT;
  v_e RECORD;
  v_rev_entry_id BIGINT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.has_permission(p_business_id, 'vouchers.reverse') THEN
    RAISE EXCEPTION 'Unauthorized: missing vouchers.reverse permission for business %', p_business_id;
  END IF;

  v_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(p_voucher_id::TEXT || ':' || p_reversal_date::TEXT || ':' || v_reason);
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'REVERSE_VOUCHER', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  SELECT * INTO v_orig
  FROM public.vouchers
  WHERE id = p_voucher_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher % not found in business %', p_voucher_id, p_business_id;
  END IF;

  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted vouchers can be reversed (current status: %)', v_orig.status;
  END IF;

  IF v_orig.voucher_type = 'REVERSAL' THEN
    RAISE EXCEPTION 'A reversal voucher cannot itself be reversed';
  END IF;

  IF p_reversal_date < v_orig.voucher_date THEN
    RAISE EXCEPTION 'Reversal date (%) cannot precede original voucher date (%)', p_reversal_date, v_orig.voucher_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vouchers rv
    WHERE rv.business_id = p_business_id
      AND rv.reversed_voucher_id = p_voucher_id
      AND rv.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Voucher "%" has already been reversed', v_orig.voucher_no;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bill_allocations ba
    WHERE ba.business_id = p_business_id
      AND (ba.invoice_voucher_id = p_voucher_id OR ba.settlement_voucher_id = p_voucher_id)
  ) THEN
    RAISE EXCEPTION 'Cannot reverse voucher "%" because it has active bill allocations. Issue a credit/debit note or adjustment instead.', v_orig.voucher_no;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_reversal_date);
  SELECT is_locked INTO v_fy_locked
  FROM public.financial_years
  WHERE id = v_fy_id AND business_id = p_business_id
  FOR SHARE;

  IF v_fy_locked IS NOT FALSE THEN
    RAISE EXCEPTION 'Financial year % is locked and cannot accept reversal vouchers', v_fy_id;
  END IF;

  v_rev_no := public.next_document_no(p_business_id, v_orig.branch_id, v_fy_id, 'VCH_REVERSAL', 'REV');

  INSERT INTO public.vouchers (
    business_id, branch_id, fy_id, voucher_no, voucher_type, voucher_date,
    currency_code, exchange_rate, party_id, ref_doc_type, ref_doc_id, reversed_voucher_id,
    narration, total_amount, base_total_amount, status, idempotency_key, created_by
  ) VALUES (
    p_business_id, v_orig.branch_id, v_fy_id, v_rev_no, 'REVERSAL', p_reversal_date,
    v_orig.currency_code, v_orig.exchange_rate, v_orig.party_id, 'VOUCHER_REVERSAL', v_orig.id, v_orig.id,
    'Reversal of ' || v_orig.voucher_no || ': ' || v_reason,
    v_orig.total_amount, v_orig.base_total_amount, 'draft', p_idempotency_key, v_uid
  )
  RETURNING id INTO v_rev_id;

  -- Mark original subledger bills reversed
  UPDATE public.party_subledger_bills
  SET status = 'reversed', updated_at = NOW()
  WHERE business_id = p_business_id AND voucher_id = v_orig.id;

  FOR v_e IN (
    SELECT e.*, a.account_group, a.account_sub_ledger_type
    FROM public.voucher_entries e
    JOIN public.accounts a ON a.id = e.account_id AND a.business_id = e.business_id
    WHERE e.business_id = p_business_id AND e.voucher_id = v_orig.id
    ORDER BY e.id ASC
  ) LOOP
    INSERT INTO public.voucher_entries (
      business_id, voucher_id, account_id, cost_center_id, party_id,
      debit, credit, base_debit, base_credit, line_narration
    ) VALUES (
      p_business_id, v_rev_id, v_e.account_id, v_e.cost_center_id, v_e.party_id,
      v_e.credit, v_e.debit, v_e.base_credit, v_e.base_debit,
      'Reversal: ' || COALESCE(v_e.line_narration, v_orig.voucher_no)
    )
    RETURNING id INTO v_rev_entry_id;

    -- Insert offsetting reversed subledger bill row so signed subledger matches signed GL
    IF v_e.account_sub_ledger_type = 'PARTY' AND v_e.party_id IS NOT NULL THEN
      INSERT INTO public.party_subledger_bills (
        business_id, branch_id, origin_fy_id, voucher_id, voucher_entry_id,
        account_id, party_id, bill_role, normal_side, bill_no, document_date,
        currency_code, exchange_rate, original_txn_amount, original_base_amount, status
      ) VALUES (
        p_business_id, v_orig.branch_id, v_fy_id, v_rev_id, v_rev_entry_id,
        v_e.account_id, v_e.party_id,
        CASE
          WHEN v_e.credit > 0 AND v_e.account_group = 'asset' THEN 'RECEIVABLE_BILL'
          WHEN v_e.credit > 0 THEN 'PAYABLE_SETTLEMENT'
          WHEN v_e.account_group = 'asset' THEN 'RECEIVABLE_SETTLEMENT'
          ELSE 'PAYABLE_BILL'
        END,
        CASE WHEN v_e.credit > 0 THEN 'DR' ELSE 'CR' END,
        v_rev_no, p_reversal_date,
        v_orig.currency_code, v_orig.exchange_rate,
        GREATEST(v_e.debit, v_e.credit), GREATEST(v_e.base_debit, v_e.base_credit), 'reversed'
      );
    END IF;
  END LOOP;

  UPDATE public.vouchers SET status = 'posted', posted_at = NOW() WHERE id = v_rev_id;

  PERFORM public.record_audit_event(
    p_business_id, 'voucher', v_rev_id::TEXT, 'REVERSE',
    jsonb_build_object('original_voucher_id', v_orig.id, 'original_voucher_no', v_orig.voucher_no),
    jsonb_build_object('reversal_voucher_no', v_rev_no, 'reason', v_reason, 'party_id', v_orig.party_id)
  );

  v_result := jsonb_build_object(
    'success', true,
    'reversal_voucher_id', v_rev_id,
    'reversal_voucher_no', v_rev_no,
    'reversed_voucher_id', v_orig.id,
    'party_id', v_orig.party_id,
    'status', 'posted'
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 6: Upgrade allocate_bill_payment_tx() (C1 Control-Account Entry Cap)
-- Caps allocation strictly against party_subledger_bills.original_base_amount
-- (the exact party control-account entry, NEVER vouchers.base_total_amount!).
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_bill_payment_tx(
  p_business_id BIGINT,
  p_invoice_voucher_id BIGINT,
  p_settlement_voucher_id BIGINT,
  p_allocated_amount NUMERIC,
  p_allocation_date DATE DEFAULT CURRENT_DATE,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_fy_locked BOOLEAN;
  v_inv public.vouchers%ROWTYPE;
  v_set public.vouchers%ROWTYPE;
  v_src_bill public.party_subledger_bills%ROWTYPE;
  v_set_bill public.party_subledger_bills%ROWTYPE;
  v_alloc_id BIGINT;
  v_new_src_alloc NUMERIC(14, 2);
  v_new_set_alloc NUMERIC(14, 2);
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.has_permission(p_business_id, 'vouchers.post') THEN
    RAISE EXCEPTION 'Unauthorized: missing vouchers.post permission for business %', p_business_id;
  END IF;

  IF p_invoice_voucher_id IS NULL OR p_settlement_voucher_id IS NULL OR p_invoice_voucher_id = p_settlement_voucher_id THEN
    RAISE EXCEPTION 'Distinct invoice_voucher_id and settlement_voucher_id are required';
  END IF;

  IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
    RAISE EXCEPTION 'allocated_amount (in base currency INR) must be greater than zero';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      p_invoice_voucher_id::TEXT || ':' || p_settlement_voucher_id::TEXT || ':' ||
      p_allocated_amount::TEXT || ':' || p_allocation_date::TEXT
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'ALLOCATE_BILL', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_allocation_date);
  SELECT is_locked INTO v_fy_locked
  FROM public.financial_years
  WHERE id = v_fy_id AND business_id = p_business_id
  FOR SHARE;

  IF v_fy_locked IS NOT FALSE THEN
    RAISE EXCEPTION 'Financial year % is locked and cannot accept bill allocations', v_fy_id;
  END IF;

  -- Lock vouchers in deterministic id order
  PERFORM 1
  FROM public.vouchers v
  WHERE v.business_id = p_business_id
    AND v.id IN (p_invoice_voucher_id, p_settlement_voucher_id)
  ORDER BY v.id ASC
  FOR UPDATE;

  SELECT * INTO v_inv FROM public.vouchers WHERE id = p_invoice_voucher_id AND business_id = p_business_id;
  SELECT * INTO v_set FROM public.vouchers WHERE id = p_settlement_voucher_id AND business_id = p_business_id;

  IF v_inv.id IS NULL OR v_set.id IS NULL THEN
    RAISE EXCEPTION 'Invoice or settlement voucher not found in business %', p_business_id;
  END IF;

  IF v_inv.status <> 'posted' OR v_set.status <> 'posted' THEN
    RAISE EXCEPTION 'Both invoice and settlement vouchers must be posted before allocation';
  END IF;

  IF v_inv.voucher_type = 'SALES' THEN
    IF v_set.voucher_type NOT IN ('RECEIPT', 'SALES_RETURN', 'JOURNAL') THEN
      RAISE EXCEPTION 'SALES invoice cannot be settled by % voucher', v_set.voucher_type;
    END IF;
  ELSIF v_inv.voucher_type = 'PURCHASE' THEN
    IF v_set.voucher_type NOT IN ('PAYMENT', 'PURCHASE_RETURN', 'JOURNAL') THEN
      RAISE EXCEPTION 'PURCHASE bill cannot be settled by % voucher', v_set.voucher_type;
    END IF;
  ELSE
    RAISE EXCEPTION 'invoice_voucher_id must reference a SALES or PURCHASE voucher (got %)', v_inv.voucher_type;
  END IF;

  IF p_allocation_date < GREATEST(v_inv.voucher_date, v_set.voucher_date) THEN
    RAISE EXCEPTION 'Allocation date (%) cannot precede invoice (%) or settlement (%) voucher date',
      p_allocation_date, v_inv.voucher_date, v_set.voucher_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vouchers rv
    WHERE rv.business_id = p_business_id
      AND rv.reversed_voucher_id IN (v_inv.id, v_set.id)
      AND rv.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Cannot allocate against a reversed voucher';
  END IF;

  -- Resolve exact party_subledger_bills rows (source bill & settlement entry) and lock in deterministic id order
  SELECT * INTO v_src_bill
  FROM public.party_subledger_bills
  WHERE business_id = p_business_id
    AND voucher_id = v_inv.id
    AND bill_role IN ('RECEIVABLE_BILL', 'PAYABLE_BILL')
    AND status <> 'reversed'
  LIMIT 1;

  SELECT * INTO v_set_bill
  FROM public.party_subledger_bills
  WHERE business_id = p_business_id
    AND voucher_id = v_set.id
    AND bill_role IN ('RECEIVABLE_SETTLEMENT', 'PAYABLE_SETTLEMENT', 'ADVANCE_RECEIVED', 'ADVANCE_PAID')
    AND status <> 'reversed'
  LIMIT 1;

  IF v_src_bill.id IS NULL THEN
    RAISE EXCEPTION 'Invoice voucher "%" has no party subledger bill entry and cannot be allocated', v_inv.voucher_no;
  END IF;

  IF v_set_bill.id IS NULL THEN
    RAISE EXCEPTION 'Settlement voucher "%" has no party subledger settlement entry and cannot be allocated', v_set.voucher_no;
  END IF;

  PERFORM 1
  FROM public.party_subledger_bills psb
  WHERE psb.business_id = p_business_id
    AND psb.id IN (v_src_bill.id, v_set_bill.id)
  ORDER BY psb.id ASC
  FOR UPDATE;

  SELECT * INTO v_src_bill FROM public.party_subledger_bills WHERE id = v_src_bill.id;
  SELECT * INTO v_set_bill FROM public.party_subledger_bills WHERE id = v_set_bill.id;

  IF v_src_bill.party_id <> v_set_bill.party_id THEN
    RAISE EXCEPTION 'Cross-party allocation rejected: bill "%" belongs to party %, while settlement "%" belongs to party %',
      v_inv.voucher_no, v_src_bill.party_id, v_set.voucher_no, v_set_bill.party_id;
  END IF;

  IF v_src_bill.account_id <> v_set_bill.account_id THEN
    RAISE EXCEPTION 'Control account mismatch: source bill uses account %, settlement uses account %',
      v_src_bill.account_id, v_set_bill.account_id;
  END IF;

  -- Strictly enforce party control-account entry capacity (C1: NEVER vouchers.base_total_amount!)
  IF v_src_bill.allocated_base_amount + p_allocated_amount > v_src_bill.original_base_amount THEN
    RAISE EXCEPTION 'Over-settlement rejected: bill "%" remaining party balance is %, requested %',
      v_inv.voucher_no, v_src_bill.remaining_base_amount, p_allocated_amount;
  END IF;

  IF v_set_bill.allocated_base_amount + p_allocated_amount > v_set_bill.original_base_amount THEN
    RAISE EXCEPTION 'Settlement double-spend rejected: settlement "%" unallocated party balance is %, requested %',
      v_set.voucher_no, v_set_bill.remaining_base_amount, p_allocated_amount;
  END IF;

  INSERT INTO public.bill_allocations (
    business_id, party_id, invoice_voucher_id, settlement_voucher_id,
    source_bill_id, settlement_bill_id, allocated_amount, currency_code,
    allocation_date, idempotency_key, created_by
  ) VALUES (
    p_business_id, v_src_bill.party_id, v_inv.id, v_set.id,
    v_src_bill.id, v_set_bill.id, p_allocated_amount, 'INR',
    p_allocation_date, p_idempotency_key, v_uid
  )
  RETURNING id INTO v_alloc_id;

  -- Maintain cached aggregates transactionally (reconciled against bill_allocations in verify_subledger_control_tieout)
  v_new_src_alloc := v_src_bill.allocated_base_amount + p_allocated_amount;
  v_new_set_alloc := v_set_bill.allocated_base_amount + p_allocated_amount;

  UPDATE public.party_subledger_bills
  SET allocated_base_amount = v_new_src_alloc,
      allocated_txn_amount = CASE WHEN currency_code = 'INR' THEN v_new_src_alloc ELSE allocated_txn_amount END,
      status = CASE WHEN v_new_src_alloc >= original_base_amount THEN 'settled' ELSE 'partially_settled' END,
      updated_at = NOW()
  WHERE id = v_src_bill.id;

  UPDATE public.party_subledger_bills
  SET allocated_base_amount = v_new_set_alloc,
      allocated_txn_amount = CASE WHEN currency_code = 'INR' THEN v_new_set_alloc ELSE allocated_txn_amount END,
      status = CASE WHEN v_new_set_alloc >= original_base_amount THEN 'settled' ELSE 'partially_settled' END,
      updated_at = NOW()
  WHERE id = v_set_bill.id;

  PERFORM public.record_audit_event(
    p_business_id, 'bill_allocation', v_alloc_id::TEXT, 'CREATE',
    NULL, jsonb_build_object(
      'party_id', v_src_bill.party_id,
      'source_bill_id', v_src_bill.id,
      'settlement_bill_id', v_set_bill.id,
      'allocated_amount', p_allocated_amount,
      'currency_code', 'INR'
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'allocation_id', v_alloc_id,
    'party_id', v_src_bill.party_id,
    'source_bill_id', v_src_bill.id,
    'settlement_bill_id', v_set_bill.id,
    'invoice_voucher_id', v_inv.id,
    'settlement_voucher_id', v_set.id,
    'allocated_amount', p_allocated_amount,
    'currency_code', 'INR',
    'invoice_remaining', v_src_bill.original_base_amount - v_new_src_alloc,
    'settlement_remaining', v_set_bill.original_base_amount - v_new_set_alloc
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 7: Signed Subledger-to-GL Control Reconciliation RPC (STABLE)
-- Verifies:
--   1. Every party_subledger_bills.allocated_base_amount = SUM(bill_allocations)
--   2. Signed party subledger movements = Signed GL control account movements
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_subledger_control_tieout(
  p_business_id BIGINT,
  p_fy_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_biz BIGINT;
  v_alloc_mismatches INT;
  v_control_mismatches INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  -- 1. Verify cached allocated_base_amount on party_subledger_bills matches authoritative bill_allocations
  WITH alloc_sums AS (
    SELECT bill_id, SUM(amt) AS sum_alloc
    FROM (
      SELECT source_bill_id AS bill_id, allocated_amount AS amt
      FROM public.bill_allocations
      WHERE business_id = p_business_id AND source_bill_id IS NOT NULL
      UNION ALL
      SELECT settlement_bill_id AS bill_id, allocated_amount AS amt
      FROM public.bill_allocations
      WHERE business_id = p_business_id AND settlement_bill_id IS NOT NULL
    ) t
    GROUP BY bill_id
  )
  SELECT COUNT(*) INTO v_alloc_mismatches
  FROM public.party_subledger_bills psb
  LEFT JOIN alloc_sums a ON a.bill_id = psb.id
  WHERE psb.business_id = p_business_id
    AND psb.allocated_base_amount <> COALESCE(a.sum_alloc, 0);

  -- 2. Verify signed subledger movements equal signed GL control-account movements for PARTY accounts in p_fy_id
  WITH gl_ctrl AS (
    SELECT
      e.account_id,
      COALESCE(SUM(e.base_debit - e.base_credit), 0) AS gl_signed_period
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
    JOIN public.accounts a ON a.id = e.account_id AND a.business_id = e.business_id
    WHERE v.business_id = p_business_id
      AND v.fy_id = p_fy_id
      AND v.status = 'posted'
      AND a.account_sub_ledger_type = 'PARTY'
      AND e.party_id IS NOT NULL
    GROUP BY e.account_id
  ),
  sub_ctrl AS (
    SELECT
      psb.account_id,
      COALESCE(SUM(CASE WHEN psb.normal_side = 'DR' THEN psb.original_base_amount ELSE -psb.original_base_amount END), 0) AS sub_signed_period
    FROM public.party_subledger_bills psb
    WHERE psb.business_id = p_business_id
      AND psb.origin_fy_id = p_fy_id
    GROUP BY psb.account_id
  )
  SELECT COUNT(*) INTO v_control_mismatches
  FROM gl_ctrl g
  FULL OUTER JOIN sub_ctrl s ON s.account_id = g.account_id
  WHERE COALESCE(g.gl_signed_period, 0) <> COALESCE(s.sub_signed_period, 0);

  RETURN jsonb_build_object(
    'balanced', (v_alloc_mismatches = 0 AND v_control_mismatches = 0),
    'fy_id', p_fy_id,
    'allocation_cache_mismatches', v_alloc_mismatches,
    'control_account_mismatches', v_control_mismatches
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 8: Upgrade verify_opening_balances(), verify_trial_balance()
--            & close_financial_year_tx() for Per-FY Carry-Forward (C2)
-- --------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.verify_opening_balances(BIGINT);

CREATE OR REPLACE FUNCTION public.verify_opening_balances(
  p_business_id BIGINT,
  p_fy_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_biz BIGINT;
  v_fy_id BIGINT;
  v_aob_count INT := 0;
  v_total_dr NUMERIC(14, 2);
  v_total_cr NUMERIC(14, 2);
  v_diff NUMERIC(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  v_fy_id := COALESCE(
    p_fy_id,
    (SELECT id FROM public.financial_years WHERE business_id = p_business_id AND is_active IS TRUE LIMIT 1)
  );

  IF v_fy_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_aob_count
    FROM public.account_opening_balances
    WHERE business_id = p_business_id AND fy_id = v_fy_id;
  END IF;

  IF v_aob_count > 0 THEN
    SELECT COALESCE(SUM(opening_base_debit), 0), COALESCE(SUM(opening_base_credit), 0)
    INTO v_total_dr, v_total_cr
    FROM public.account_opening_balances
    WHERE business_id = p_business_id AND fy_id = v_fy_id;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN opening_balance_type = 'DR' THEN opening_balance ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN opening_balance_type = 'CR' THEN opening_balance ELSE 0 END), 0)
    INTO v_total_dr, v_total_cr
    FROM public.accounts
    WHERE business_id = p_business_id AND is_active IS TRUE;
  END IF;

  v_diff := ABS(v_total_dr - v_total_cr);

  RETURN jsonb_build_object(
    'balanced', (v_diff = 0),
    'fy_id', v_fy_id,
    'total_debit', v_total_dr,
    'total_credit', v_total_cr,
    'diff', v_diff
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_trial_balance(
  p_business_id BIGINT,
  p_fy_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_biz BIGINT;
  v_ob JSONB;
  v_open_dr NUMERIC(14, 2);
  v_open_cr NUMERIC(14, 2);
  v_period_dr NUMERIC(14, 2);
  v_period_cr NUMERIC(14, 2);
  v_voucher_count INT;
  v_close_dr NUMERIC(14, 2);
  v_close_cr NUMERIC(14, 2);
  v_diff NUMERIC(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_years fy WHERE fy.id = p_fy_id AND fy.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Financial year % not found in business %', p_fy_id, p_business_id;
  END IF;

  v_ob := public.verify_opening_balances(p_business_id, p_fy_id);
  v_open_dr := (v_ob->>'total_debit')::NUMERIC(14, 2);
  v_open_cr := (v_ob->>'total_credit')::NUMERIC(14, 2);

  SELECT
    COALESCE(SUM(e.base_debit), 0),
    COALESCE(SUM(e.base_credit), 0),
    COUNT(DISTINCT v.id)
  INTO v_period_dr, v_period_cr, v_voucher_count
  FROM public.vouchers v
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
  WHERE v.business_id = p_business_id
    AND v.fy_id = p_fy_id
    AND v.status = 'posted';

  v_close_dr := v_open_dr + v_period_dr;
  v_close_cr := v_open_cr + v_period_cr;
  v_diff := ABS(v_close_dr - v_close_cr);

  RETURN jsonb_build_object(
    'balanced', (v_diff = 0),
    'fy_id', p_fy_id,
    'voucher_count', v_voucher_count,
    'opening_debit', v_open_dr,
    'opening_credit', v_open_cr,
    'period_debit', v_period_dr,
    'period_credit', v_period_cr,
    'total_debit', v_close_dr,
    'total_credit', v_close_cr,
    'diff', v_diff
  );
END;
$$;

DROP FUNCTION IF EXISTS public.close_financial_year_tx(BIGINT, BIGINT, UUID);

CREATE OR REPLACE FUNCTION public.close_financial_year_tx(
  p_business_id BIGINT,
  p_fy_id BIGINT,
  p_idempotency_key UUID DEFAULT NULL,
  p_next_fy_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy public.financial_years%ROWTYPE;
  v_next_fy_id BIGINT;
  v_draft_vouchers INT;
  v_ob JSONB;
  v_tb JSONB;
  v_sub JSONB;
  v_inv JSONB;
  v_next_ob JSONB;
  v_income_net NUMERIC(14, 2) := 0;
  v_expense_net NUMERIC(14, 2) := 0;
  v_net_profit NUMERIC(14, 2) := 0;
  v_branch_id BIGINT;
  v_reserves_id BIGINT;
  v_closing_voucher_id BIGINT := NULL;
  v_closing_no TEXT := NULL;
  v_acc RECORD;
  v_entries JSONB := '[]'::jsonb;
  v_aob_exists BOOLEAN;
  v_carried_accounts INT := 0;
  v_carried_bills INT := 0;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT (public.is_business_owner(p_business_id) OR public.has_permission(p_business_id, 'finance.fy_close')) THEN
    RAISE EXCEPTION 'Unauthorized: missing finance.fy_close permission for business %', p_business_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(p_fy_id::TEXT || ':' || COALESCE(p_next_fy_id::TEXT, ''));
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'CLOSE_FY', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE id = p_fy_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial year % not found in business %', p_fy_id, p_business_id;
  END IF;
  IF v_fy.is_locked IS TRUE THEN
    RAISE EXCEPTION 'Financial year "%" is already locked', v_fy.label;
  END IF;

  -- Pre-checks
  SELECT COUNT(*) INTO v_draft_vouchers
  FROM public.vouchers
  WHERE business_id = p_business_id AND fy_id = p_fy_id AND status = 'draft';
  IF v_draft_vouchers > 0 THEN
    RAISE EXCEPTION 'Cannot close financial year "%": % unposted draft voucher(s) remain.', v_fy.label, v_draft_vouchers;
  END IF;

  v_ob := public.verify_opening_balances(p_business_id, p_fy_id);
  IF (v_ob->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": opening balances are unbalanced (diff: %)', v_fy.label, v_ob->>'diff';
  END IF;

  v_tb := public.verify_trial_balance(p_business_id, p_fy_id);
  IF (v_tb->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": trial balance is unbalanced (diff: %)', v_fy.label, v_tb->>'diff';
  END IF;

  v_sub := public.verify_subledger_control_tieout(p_business_id, p_fy_id);
  IF (v_sub->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": subledger control tie-out failed (%)', v_fy.label, v_sub;
  END IF;

  v_inv := public.verify_inventory_integrity(p_business_id);
  IF (v_inv->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": inventory reconciliation failed (%)', v_fy.label, v_inv;
  END IF;

  -- Compute Net Profit/Loss across posted nominal (income/expense) accounts in p_fy_id
  SELECT
    COALESCE(SUM(CASE WHEN a.account_group = 'income' THEN (e.base_credit - e.base_debit) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.account_group = 'expense' THEN (e.base_debit - e.base_credit) ELSE 0 END), 0)
  INTO v_income_net, v_expense_net
  FROM public.vouchers v
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
  JOIN public.accounts a ON a.id = e.account_id AND a.business_id = v.business_id
  WHERE v.business_id = p_business_id
    AND v.fy_id = p_fy_id
    AND v.status = 'posted'
    AND a.account_group IN ('income', 'expense');

  v_net_profit := v_income_net - v_expense_net;

  SELECT id INTO v_branch_id FROM public.branches WHERE business_id = p_business_id AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_reserves_id FROM public.accounts WHERE business_id = p_business_id AND code = '3100' LIMIT 1;

  FOR v_acc IN (
    SELECT a.id AS account_id, SUM(e.base_debit - e.base_credit) AS net_dr
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
    JOIN public.accounts a ON a.id = e.account_id AND a.business_id = v.business_id
    WHERE v.business_id = p_business_id
      AND v.fy_id = p_fy_id
      AND v.status = 'posted'
      AND a.account_group IN ('income', 'expense')
    GROUP BY a.id
    HAVING SUM(e.base_debit - e.base_credit) <> 0
    ORDER BY a.id ASC
  ) LOOP
    IF v_acc.net_dr > 0 THEN
      v_entries := v_entries || jsonb_build_array(jsonb_build_object('account_id', v_acc.account_id, 'debit', 0, 'credit', v_acc.net_dr, 'narration', 'FY Close transfer'));
    ELSE
      v_entries := v_entries || jsonb_build_array(jsonb_build_object('account_id', v_acc.account_id, 'debit', ABS(v_acc.net_dr), 'credit', 0, 'narration', 'FY Close transfer'));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_entries) > 0 THEN
    IF v_reserves_id IS NULL THEN
      RAISE EXCEPTION 'System account 3100 (Retained Earnings / Reserves) is missing for business %', p_business_id;
    END IF;

    IF v_net_profit > 0 THEN
      v_entries := v_entries || jsonb_build_array(jsonb_build_object('account_id', v_reserves_id, 'debit', 0, 'credit', v_net_profit, 'narration', 'Net Profit transferred to Reserves'));
    ELSIF v_net_profit < 0 THEN
      v_entries := v_entries || jsonb_build_array(jsonb_build_object('account_id', v_reserves_id, 'debit', ABS(v_net_profit), 'credit', 0, 'narration', 'Net Loss transferred to Reserves'));
    END IF;

    v_closing_no := public.next_document_no(p_business_id, v_branch_id, p_fy_id, 'VCH_FY_CLOSE', 'CLS');

    INSERT INTO public.vouchers (
      business_id, branch_id, fy_id, voucher_no, voucher_type, voucher_date,
      currency_code, exchange_rate, ref_doc_type, ref_doc_id, narration,
      total_amount, base_total_amount, status, created_by
    ) VALUES (
      p_business_id, v_branch_id, p_fy_id, v_closing_no, 'JOURNAL', v_fy.end_date,
      'INR', 1.0, 'FY_CLOSE', p_fy_id, 'Financial Year Close: ' || v_fy.label,
      (SELECT COALESCE(SUM((elem->>'debit')::NUMERIC), 0) FROM jsonb_array_elements(v_entries) elem),
      (SELECT COALESCE(SUM((elem->>'debit')::NUMERIC), 0) FROM jsonb_array_elements(v_entries) elem),
      'draft', v_uid
    )
    RETURNING id INTO v_closing_voucher_id;

    INSERT INTO public.voucher_entries (
      business_id, voucher_id, account_id, debit, credit, base_debit, base_credit, line_narration
    )
    SELECT
      p_business_id, v_closing_voucher_id,
      (elem->>'account_id')::BIGINT,
      (elem->>'debit')::NUMERIC(14, 2), (elem->>'credit')::NUMERIC(14, 2),
      (elem->>'debit')::NUMERIC(14, 2), (elem->>'credit')::NUMERIC(14, 2),
      elem->>'narration'
    FROM jsonb_array_elements(v_entries) elem;

    UPDATE public.vouchers SET status = 'posted', posted_at = NOW() WHERE id = v_closing_voucher_id;
  END IF;

  -- Resolve optional next FY for permanent-account carry-forward (C2)
  v_next_fy_id := COALESCE(
    p_next_fy_id,
    (SELECT id FROM public.financial_years WHERE business_id = p_business_id AND start_date = v_fy.end_date + 1 AND is_locked IS FALSE LIMIT 1)
  );

  IF v_next_fy_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.financial_years
      WHERE id = v_next_fy_id AND business_id = p_business_id AND is_locked IS FALSE AND id <> p_fy_id
    ) THEN
      RAISE EXCEPTION 'Target next financial year % is invalid or locked', v_next_fy_id;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.account_opening_balances WHERE business_id = p_business_id AND fy_id = p_fy_id
    ) INTO v_aob_exists;

    -- Carry forward PERMANENT accounts ONLY (asset, liability, equity — nominal accounts are closed to 0!)
    WITH opening_src AS (
      SELECT account_id, SUM(opening_base_debit - opening_base_credit) AS open_signed
      FROM public.account_opening_balances
      WHERE business_id = p_business_id AND fy_id = p_fy_id AND v_aob_exists
      GROUP BY account_id
      UNION ALL
      SELECT id AS account_id,
             CASE WHEN opening_balance_type = 'DR' THEN opening_balance ELSE -opening_balance END AS open_signed
      FROM public.accounts
      WHERE business_id = p_business_id AND is_active IS TRUE AND NOT v_aob_exists AND opening_balance > 0
    ),
    period_src AS (
      SELECT e.account_id, SUM(e.base_debit - e.base_credit) AS period_signed
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
      WHERE v.business_id = p_business_id AND v.fy_id = p_fy_id AND v.status = 'posted'
      GROUP BY e.account_id
    ),
    closing_perm AS (
      SELECT
        a.id AS account_id,
        COALESCE(o.open_signed, 0) + COALESCE(p.period_signed, 0) AS close_signed
      FROM public.accounts a
      LEFT JOIN opening_src o ON o.account_id = a.id
      LEFT JOIN period_src p ON p.account_id = a.id
      WHERE a.business_id = p_business_id
        AND a.account_group IN ('asset', 'liability', 'equity')
    )
    INSERT INTO public.account_opening_balances (
      business_id, fy_id, account_id, currency_code,
      opening_txn_debit, opening_txn_credit, opening_base_debit, opening_base_credit,
      source_type, source_fy_id, source_ref, created_by
    )
    SELECT
      p_business_id, v_next_fy_id, c.account_id, 'INR',
      CASE WHEN c.close_signed > 0 THEN c.close_signed ELSE 0 END,
      CASE WHEN c.close_signed < 0 THEN ABS(c.close_signed) ELSE 0 END,
      CASE WHEN c.close_signed > 0 THEN c.close_signed ELSE 0 END,
      CASE WHEN c.close_signed < 0 THEN ABS(c.close_signed) ELSE 0 END,
      'FY_CARRY_FORWARD', p_fy_id, 'Carry-forward from ' || v_fy.label, v_uid
    FROM closing_perm c
    WHERE c.close_signed <> 0
    ON CONFLICT (business_id, fy_id, account_id, COALESCE(branch_id, 0), COALESCE(party_id, 0), currency_code)
    DO UPDATE SET
      opening_txn_debit = EXCLUDED.opening_txn_debit,
      opening_txn_credit = EXCLUDED.opening_txn_credit,
      opening_base_debit = EXCLUDED.opening_base_debit,
      opening_base_credit = EXCLUDED.opening_base_credit,
      source_type = EXCLUDED.source_type,
      source_fy_id = EXCLUDED.source_fy_id,
      source_ref = EXCLUDED.source_ref;

    GET DIAGNOSTICS v_carried_accounts = ROW_COUNT;

    -- Snapshot open party subledger bills into fy_open_bill_snapshots (composition only, zero extra GL posting!)
    INSERT INTO public.fy_open_bill_snapshots (
      business_id, fy_id, bill_id, account_id, party_id, currency_code,
      carried_txn_amount, carried_base_amount, normal_side
    )
    SELECT
      p_business_id, v_next_fy_id, psb.id, psb.account_id, psb.party_id, psb.currency_code,
      psb.remaining_txn_amount, psb.remaining_base_amount, psb.normal_side
    FROM public.party_subledger_bills psb
    WHERE psb.business_id = p_business_id
      AND psb.status IN ('open', 'partially_settled')
      AND psb.remaining_base_amount > 0
      AND psb.document_date <= v_fy.end_date
    ON CONFLICT (business_id, fy_id, bill_id) DO NOTHING;

    GET DIAGNOSTICS v_carried_bills = ROW_COUNT;

    -- Verify carried-forward opening balances for next FY are strictly balanced!
    v_next_ob := public.verify_opening_balances(p_business_id, v_next_fy_id);
    IF (v_next_ob->>'balanced')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'Carry-forward opening balances for next FY % are unbalanced (%)', v_next_fy_id, v_next_ob;
    END IF;
  END IF;

  UPDATE public.financial_years SET is_locked = TRUE WHERE id = p_fy_id;

  PERFORM public.record_audit_event(
    p_business_id, 'financial_year', p_fy_id::TEXT, 'CLOSE',
    jsonb_build_object('label', v_fy.label, 'is_locked', false),
    jsonb_build_object(
      'label', v_fy.label,
      'is_locked', true,
      'net_profit', v_net_profit,
      'closing_voucher_id', v_closing_voucher_id,
      'next_fy_id', v_next_fy_id,
      'carried_accounts', v_carried_accounts,
      'carried_open_bills', v_carried_bills
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'fy_id', p_fy_id,
    'label', v_fy.label,
    'is_locked', true,
    'net_profit', v_net_profit,
    'closing_voucher_id', v_closing_voucher_id,
    'closing_voucher_no', v_closing_no,
    'next_fy_id', v_next_fy_id,
    'carried_accounts', v_carried_accounts,
    'carried_open_bills', v_carried_bills
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 9: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_opening_balance_tx(BIGINT, BIGINT, BIGINT, NUMERIC, NUMERIC, BIGINT, BIGINT, CHAR(3), TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_subledger_control_tieout(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_opening_balances(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_trial_balance(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_financial_year_tx(BIGINT, BIGINT, UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_opening_balance_tx(BIGINT, BIGINT, BIGINT, NUMERIC, NUMERIC, BIGINT, BIGINT, CHAR(3), TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_subledger_control_tieout(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_opening_balances(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_trial_balance(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_financial_year_tx(BIGINT, BIGINT, UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
