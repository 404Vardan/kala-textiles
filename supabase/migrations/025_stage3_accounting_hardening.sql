-- ====================================================================
-- Migration 025: Stage 3 Accounting Security & Integrity Hardening
-- Prerequisite:  024_accounting_opening_balances_and_fy_close.sql
--
-- Fixes Stage 3 audit findings without rewriting migrations 020–024:
--   1. Block reversing a voucher that already has active bill_allocations
--   2. Enforce directional settlement compatibility (SALES <- RECEIPT/SALES_RETURN/JOURNAL;
--      PURCHASE <- PAYMENT/PURCHASE_RETURN/JOURNAL) and allocation_date >= voucher_date
--   3. Lock accounts.opening_balance & opening_balance_type once any FY is locked
--   4. Acquire FOR SHARE lock on financial_years inside transactional accounting RPCs
--      so concurrent voucher postings serialize cleanly against close_financial_year_tx()
--   5. Enforce both transaction-currency (v_total_debit = v_total_credit) and
--      base-currency balance in post_voucher_tx()
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Lock Opening Balances Once Any Financial Year Is Locked
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_accounts_opening_balance_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
     OR NEW.opening_balance_type IS DISTINCT FROM OLD.opening_balance_type THEN
    IF EXISTS (
      SELECT 1
      FROM public.financial_years fy
      WHERE fy.business_id = OLD.business_id
        AND fy.is_locked IS TRUE
    ) THEN
      RAISE EXCEPTION 'Cannot modify opening balance for account "%" (%) after a financial year has been locked.',
        OLD.name, OLD.code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_accounts_opening_balance_locked ON public.accounts;
CREATE TRIGGER trg_guard_accounts_opening_balance_locked
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_accounts_opening_balance_locked();

-- --------------------------------------------------------------------
-- SECTION 2: Harden post_voucher_tx()
-- Adds FOR SHARE lock on financial_years and transaction-currency balance check.
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
  v_voucher_type TEXT;
  v_currency CHAR(3);
  v_voucher_no TEXT;
  v_voucher_id BIGINT;
  v_elem JSONB;
  v_account_id BIGINT;
  v_cc_id BIGINT;
  v_debit NUMERIC(14, 2);
  v_credit NUMERIC(14, 2);
  v_base_debit NUMERIC(14, 2);
  v_base_credit NUMERIC(14, 2);
  v_line_narration TEXT;
  v_total_debit NUMERIC(14, 2) := 0;
  v_total_credit NUMERIC(14, 2) := 0;
  v_total_base_debit NUMERIC(14, 2) := 0;
  v_total_base_credit NUMERIC(14, 2) := 0;
  v_line_count INT := 0;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      p_branch_id::TEXT || ':' || v_voucher_type || ':' || p_voucher_date::TEXT || ':' ||
      v_currency || ':' || p_exchange_rate::TEXT || ':' || p_entries::TEXT
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'POST_VOUCHER', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  -- Validate open financial year and acquire FOR SHARE lock to serialize against close_financial_year_tx()
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
    currency_code, exchange_rate, ref_doc_type, ref_doc_id, narration,
    total_amount, base_total_amount, status, idempotency_key, created_by
  ) VALUES (
    p_business_id, p_branch_id, v_fy_id, v_voucher_no, v_voucher_type, p_voucher_date,
    v_currency, p_exchange_rate, p_ref_doc_type, p_ref_doc_id, p_narration,
    v_total_debit, v_total_base_debit, 'draft', p_idempotency_key, v_uid
  )
  RETURNING id INTO v_voucher_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_account_id := (v_elem->>'account_id')::BIGINT;
    v_cc_id := NULLIF(TRIM(COALESCE(v_elem->>'cost_center_id', '')), '')::BIGINT;
    v_debit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'debit', '')), '')::NUMERIC(14, 2), 0);
    v_credit := COALESCE(NULLIF(TRIM(COALESCE(v_elem->>'credit', '')), '')::NUMERIC(14, 2), 0);
    v_base_debit := ROUND((v_debit * p_exchange_rate)::NUMERIC, 2);
    v_base_credit := ROUND((v_credit * p_exchange_rate)::NUMERIC, 2);
    v_line_narration := NULLIF(TRIM(COALESCE(v_elem->>'narration', '')), '');

    INSERT INTO public.voucher_entries (
      business_id, voucher_id, account_id, cost_center_id,
      debit, credit, base_debit, base_credit, line_narration
    ) VALUES (
      p_business_id, v_voucher_id, v_account_id, v_cc_id,
      v_debit, v_credit, v_base_debit, v_base_credit, v_line_narration
    );
  END LOOP;

  UPDATE public.vouchers
  SET status = 'posted',
      posted_at = NOW()
  WHERE id = v_voucher_id;

  PERFORM public.record_audit_event(
    p_business_id, 'voucher', v_voucher_id::TEXT, 'POST',
    NULL, jsonb_build_object(
      'voucher_no', v_voucher_no,
      'voucher_type', v_voucher_type,
      'voucher_date', p_voucher_date,
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

-- --------------------------------------------------------------------
-- SECTION 3: Harden reverse_voucher_tx()
-- Blocks reversing vouchers that already have active bill_allocations,
-- and acquires FOR SHARE lock on financial_years.
-- --------------------------------------------------------------------

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
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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

  -- Block reversing any voucher already referenced by bill_allocations
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
    currency_code, exchange_rate, ref_doc_type, ref_doc_id, reversed_voucher_id,
    narration, total_amount, base_total_amount, status, idempotency_key, created_by
  ) VALUES (
    p_business_id, v_orig.branch_id, v_fy_id, v_rev_no, 'REVERSAL', p_reversal_date,
    v_orig.currency_code, v_orig.exchange_rate, 'VOUCHER_REVERSAL', v_orig.id, v_orig.id,
    'Reversal of ' || v_orig.voucher_no || ': ' || v_reason,
    v_orig.total_amount, v_orig.base_total_amount, 'draft', p_idempotency_key, v_uid
  )
  RETURNING id INTO v_rev_id;

  INSERT INTO public.voucher_entries (
    business_id, voucher_id, account_id, cost_center_id,
    debit, credit, base_debit, base_credit, line_narration
  )
  SELECT
    p_business_id, v_rev_id, e.account_id, e.cost_center_id,
    e.credit, e.debit, e.base_credit, e.base_debit,
    'Reversal: ' || COALESCE(e.line_narration, v_orig.voucher_no)
  FROM public.voucher_entries e
  WHERE e.business_id = p_business_id
    AND e.voucher_id = v_orig.id
  ORDER BY e.id ASC;

  UPDATE public.vouchers
  SET status = 'posted',
      posted_at = NOW()
  WHERE id = v_rev_id;

  PERFORM public.record_audit_event(
    p_business_id, 'voucher', v_rev_id::TEXT, 'REVERSE',
    jsonb_build_object('original_voucher_id', v_orig.id, 'original_voucher_no', v_orig.voucher_no),
    jsonb_build_object('reversal_voucher_no', v_rev_no, 'reason', v_reason)
  );

  v_result := jsonb_build_object(
    'success', true,
    'reversal_voucher_id', v_rev_id,
    'reversal_voucher_no', v_rev_no,
    'reversed_voucher_id', v_orig.id,
    'status', 'posted'
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 4: Harden allocate_bill_payment_tx()
-- Enforces directional settlement side, allocation_date >= voucher_date,
-- and FOR SHARE lock on financial_years.
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
  v_inv_allocated NUMERIC(14, 2);
  v_set_allocated NUMERIC(14, 2);
  v_alloc_id BIGINT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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
    RAISE EXCEPTION 'allocated_amount must be greater than zero';
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

  PERFORM 1
  FROM public.vouchers v
  WHERE v.business_id = p_business_id
    AND v.id IN (p_invoice_voucher_id, p_settlement_voucher_id)
  ORDER BY v.id ASC
  FOR UPDATE;

  SELECT * INTO v_inv
  FROM public.vouchers
  WHERE id = p_invoice_voucher_id AND business_id = p_business_id;

  SELECT * INTO v_set
  FROM public.vouchers
  WHERE id = p_settlement_voucher_id AND business_id = p_business_id;

  IF v_inv.id IS NULL OR v_set.id IS NULL THEN
    RAISE EXCEPTION 'Invoice or settlement voucher not found in business %', p_business_id;
  END IF;

  IF v_inv.status <> 'posted' OR v_set.status <> 'posted' THEN
    RAISE EXCEPTION 'Both invoice and settlement vouchers must be posted before allocation';
  END IF;

  -- Directional side compatibility check
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

  -- Chronological allocation date check
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

  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO v_inv_allocated
  FROM public.bill_allocations
  WHERE business_id = p_business_id
    AND invoice_voucher_id = v_inv.id;

  IF v_inv_allocated + p_allocated_amount > v_inv.base_total_amount THEN
    RAISE EXCEPTION 'Over-settlement rejected: invoice % remaining balance is %, requested %',
      v_inv.voucher_no, (v_inv.base_total_amount - v_inv_allocated), p_allocated_amount;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO v_set_allocated
  FROM public.bill_allocations
  WHERE business_id = p_business_id
    AND settlement_voucher_id = v_set.id;

  IF v_set_allocated + p_allocated_amount > v_set.base_total_amount THEN
    RAISE EXCEPTION 'Settlement double-spend rejected: settlement % unallocated balance is %, requested %',
      v_set.voucher_no, (v_set.base_total_amount - v_set_allocated), p_allocated_amount;
  END IF;

  INSERT INTO public.bill_allocations (
    business_id, invoice_voucher_id, settlement_voucher_id,
    allocated_amount, allocation_date, idempotency_key, created_by
  ) VALUES (
    p_business_id, v_inv.id, v_set.id,
    p_allocated_amount, p_allocation_date, p_idempotency_key, v_uid
  )
  RETURNING id INTO v_alloc_id;

  PERFORM public.record_audit_event(
    p_business_id, 'bill_allocation', v_alloc_id::TEXT, 'CREATE',
    NULL, jsonb_build_object(
      'invoice_voucher_id', v_inv.id,
      'settlement_voucher_id', v_set.id,
      'allocated_amount', p_allocated_amount
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'allocation_id', v_alloc_id,
    'invoice_voucher_id', v_inv.id,
    'settlement_voucher_id', v_set.id,
    'allocated_amount', p_allocated_amount,
    'invoice_remaining', v_inv.base_total_amount - (v_inv_allocated + p_allocated_amount),
    'settlement_remaining', v_set.base_total_amount - (v_set_allocated + p_allocated_amount)
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_voucher_tx(BIGINT, BIGINT, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_voucher_tx(BIGINT, BIGINT, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

