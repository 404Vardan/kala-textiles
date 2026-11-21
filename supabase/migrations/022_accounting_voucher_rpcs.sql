-- ====================================================================
-- Migration 022: Stage 3 Kala Finance — Transactional Voucher Posting
--                & Immutable Separate Reversal Voucher RPCs
-- Prerequisite:  021_accounting_vouchers_and_entries.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: post_voucher_tx()
-- Atomically validates open FY, active branch, accounts/cost centres,
-- double-entry balance, posts voucher & entries, and records audit.
-- p_entries format:
--   [{"account_id": 1, "debit": 1000, "credit": 0, "cost_center_id": null, "narration": "..."}]
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

  -- Validate open financial year & active branch
  v_fy_id := public.assert_financial_year_open(p_business_id, p_voucher_date);

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Branch % is not active for business %', p_branch_id, p_business_id;
  END IF;

  -- Pre-validate all entry lines and compute balanced totals
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

  IF v_total_base_debit <= 0 OR v_total_base_debit <> v_total_base_credit THEN
    RAISE EXCEPTION 'Voucher is unbalanced: total_base_debit (%) <> total_base_credit (%)',
      v_total_base_debit, v_total_base_credit;
  END IF;

  -- Generate strictly ordered voucher number within (business, branch, fy, voucher_type)
  v_voucher_no := public.next_document_no(p_business_id, p_branch_id, v_fy_id, 'VCH_' || v_voucher_type, LEFT(v_voucher_type, 3));

  -- 1. Insert header as draft
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

  -- 2. Insert all entries while voucher is draft
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

  -- 3. Post voucher (locks immutability forever; deferred trigger re-verifies balance)
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
-- SECTION 2: reverse_voucher_tx()
-- Keeps original voucher permanently 'posted' and creates a separate
-- posted REVERSAL voucher with swapped debits/credits.
-- Enforces single-reversal uniqueness via uq_vouchers_single_reversal.
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

  -- Lock original voucher
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

  v_fy_id := public.assert_financial_year_open(p_business_id, p_reversal_date);
  v_rev_no := public.next_document_no(p_business_id, v_orig.branch_id, v_fy_id, 'VCH_REVERSAL', 'REV');

  -- 1. Create reversal header as draft
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

  -- 2. Insert swapped debit/credit lines
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

  -- 3. Post reversal voucher (enforces uq_vouchers_single_reversal & balance trigger)
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

REVOKE ALL ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_voucher_tx(BIGINT, BIGINT, DATE, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_voucher_tx(BIGINT, BIGINT, TEXT, DATE, JSONB, TEXT, TEXT, BIGINT, CHAR(3), NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_voucher_tx(BIGINT, BIGINT, DATE, TEXT, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

