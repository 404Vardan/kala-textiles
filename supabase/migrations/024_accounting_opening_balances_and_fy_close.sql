-- ====================================================================
-- Migration 024: Stage 3 Kala Finance — Opening Balance Verification,
--                Trial Balance Verification & Financial Year Close
-- Prerequisite:  023_accounting_bill_allocations.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: verify_opening_balances() (Read-Only STABLE)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_opening_balances(
  p_business_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_biz BIGINT;
  v_total_dr NUMERIC(14, 2);
  v_total_cr NUMERIC(14, 2);
  v_diff NUMERIC(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN opening_balance_type = 'DR' THEN opening_balance ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN opening_balance_type = 'CR' THEN opening_balance ELSE 0 END), 0)
  INTO v_total_dr, v_total_cr
  FROM public.accounts
  WHERE business_id = p_business_id
    AND is_active IS TRUE;

  v_diff := ABS(v_total_dr - v_total_cr);

  RETURN jsonb_build_object(
    'balanced', (v_diff = 0),
    'total_debit', v_total_dr,
    'total_credit', v_total_cr,
    'diff', v_diff
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 2: verify_trial_balance() (Read-Only STABLE)
-- --------------------------------------------------------------------

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
  v_total_dr NUMERIC(14, 2);
  v_total_cr NUMERIC(14, 2);
  v_voucher_count INT;
  v_diff NUMERIC(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_years fy
    WHERE fy.id = p_fy_id AND fy.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Financial year % not found in business %', p_fy_id, p_business_id;
  END IF;

  SELECT
    COALESCE(SUM(e.base_debit), 0),
    COALESCE(SUM(e.base_credit), 0),
    COUNT(DISTINCT v.id)
  INTO v_total_dr, v_total_cr, v_voucher_count
  FROM public.vouchers v
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.business_id = v.business_id
  WHERE v.business_id = p_business_id
    AND v.fy_id = p_fy_id
    AND v.status = 'posted';

  v_diff := ABS(v_total_dr - v_total_cr);

  RETURN jsonb_build_object(
    'balanced', (v_diff = 0),
    'fy_id', p_fy_id,
    'voucher_count', v_voucher_count,
    'total_debit', v_total_dr,
    'total_credit', v_total_cr,
    'diff', v_diff
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: close_financial_year_tx()
-- Pre-checks:
--   1. Caller is owner or has 'finance.fy_close' permission
--   2. FY exists and is not already locked
--   3. Zero draft vouchers exist in that FY
--   4. Opening balances & Trial Balance reconcile (SUM(DR) = SUM(CR))
--   5. 3-way inventory reconciliation (verify_inventory_integrity) passes
-- Computes Net Profit/Loss, posts closing entry to 3100 Retained Earnings
-- if non-zero, locks the FY permanently, and writes an audit event.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_financial_year_tx(
  p_business_id BIGINT,
  p_fy_id BIGINT,
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
  v_fy public.financial_years%ROWTYPE;
  v_draft_vouchers INT;
  v_ob JSONB;
  v_tb JSONB;
  v_inv JSONB;
  v_income_net NUMERIC(14, 2) := 0;
  v_expense_net NUMERIC(14, 2) := 0;
  v_net_profit NUMERIC(14, 2) := 0;
  v_branch_id BIGINT;
  v_reserves_id BIGINT;
  v_closing_voucher_id BIGINT := NULL;
  v_closing_no TEXT := NULL;
  v_acc RECORD;
  v_entries JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT (public.is_business_owner(p_business_id) OR public.has_permission(p_business_id, 'finance.fy_close')) THEN
    RAISE EXCEPTION 'Unauthorized: missing finance.fy_close permission for business %', p_business_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(p_fy_id::TEXT);
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

  -- Pre-check 1: Zero unposted draft vouchers in this FY
  SELECT COUNT(*) INTO v_draft_vouchers
  FROM public.vouchers
  WHERE business_id = p_business_id
    AND fy_id = p_fy_id
    AND status = 'draft';

  IF v_draft_vouchers > 0 THEN
    RAISE EXCEPTION 'Cannot close financial year "%": % unposted draft voucher(s) remain.', v_fy.label, v_draft_vouchers;
  END IF;

  -- Pre-check 2: Opening balances balanced
  v_ob := public.verify_opening_balances(p_business_id);
  IF (v_ob->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": opening balances are unbalanced (diff: %)', v_fy.label, v_ob->>'diff';
  END IF;

  -- Pre-check 3: Trial balance balanced
  v_tb := public.verify_trial_balance(p_business_id, p_fy_id);
  IF (v_tb->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": trial balance is unbalanced (diff: %)', v_fy.label, v_tb->>'diff';
  END IF;

  -- Pre-check 4: 3-way inventory reconciliation balanced
  v_inv := public.verify_inventory_integrity(p_business_id);
  IF (v_inv->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Cannot close financial year "%": inventory reconciliation failed (%)', v_fy.label, v_inv;
  END IF;

  -- Compute Net Profit/Loss across posted income & expense accounts in this FY
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

  -- Post closing journal entry zeroing income/expense accounts into 3100 Retained Earnings
  SELECT id INTO v_branch_id
  FROM public.branches
  WHERE business_id = p_business_id AND is_default IS TRUE
  LIMIT 1;

  SELECT id INTO v_reserves_id
  FROM public.accounts
  WHERE business_id = p_business_id AND code = '3100'
  LIMIT 1;

  FOR v_acc IN (
    SELECT
      a.id AS account_id,
      SUM(e.base_debit - e.base_credit) AS net_dr
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
      -- Account has net debit -> credit it to zero out
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'account_id', v_acc.account_id,
        'debit', 0,
        'credit', v_acc.net_dr,
        'narration', 'FY Close transfer'
      ));
    ELSE
      -- Account has net credit -> debit it to zero out
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'account_id', v_acc.account_id,
        'debit', ABS(v_acc.net_dr),
        'credit', 0,
        'narration', 'FY Close transfer'
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_entries) > 0 THEN
    IF v_reserves_id IS NULL THEN
      RAISE EXCEPTION 'System account 3100 (Retained Earnings / Reserves) is missing for business %', p_business_id;
    END IF;

    IF v_net_profit > 0 THEN
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'account_id', v_reserves_id,
        'debit', 0,
        'credit', v_net_profit,
        'narration', 'Net Profit transferred to Reserves'
      ));
    ELSIF v_net_profit < 0 THEN
      v_entries := v_entries || jsonb_build_array(jsonb_build_object(
        'account_id', v_reserves_id,
        'debit', ABS(v_net_profit),
        'credit', 0,
        'narration', 'Net Loss transferred to Reserves'
      ));
    END IF;

    -- Insert closing voucher directly (still inside open FY before locking)
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
      p_business_id,
      v_closing_voucher_id,
      (elem->>'account_id')::BIGINT,
      (elem->>'debit')::NUMERIC(14, 2),
      (elem->>'credit')::NUMERIC(14, 2),
      (elem->>'debit')::NUMERIC(14, 2),
      (elem->>'credit')::NUMERIC(14, 2),
      elem->>'narration'
    FROM jsonb_array_elements(v_entries) elem;

    UPDATE public.vouchers
    SET status = 'posted',
        posted_at = NOW()
    WHERE id = v_closing_voucher_id;
  END IF;

  -- Lock the financial year permanently
  UPDATE public.financial_years
  SET is_locked = TRUE
  WHERE id = p_fy_id;

  PERFORM public.record_audit_event(
    p_business_id, 'financial_year', p_fy_id::TEXT, 'CLOSE',
    jsonb_build_object('label', v_fy.label, 'is_locked', false),
    jsonb_build_object('label', v_fy.label, 'is_locked', true, 'net_profit', v_net_profit, 'closing_voucher_id', v_closing_voucher_id)
  );

  v_result := jsonb_build_object(
    'success', true,
    'fy_id', p_fy_id,
    'label', v_fy.label,
    'is_locked', true,
    'net_profit', v_net_profit,
    'closing_voucher_id', v_closing_voucher_id,
    'closing_voucher_no', v_closing_no
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_opening_balances(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_trial_balance(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_financial_year_tx(BIGINT, BIGINT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.verify_opening_balances(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_trial_balance(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_financial_year_tx(BIGINT, BIGINT, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

