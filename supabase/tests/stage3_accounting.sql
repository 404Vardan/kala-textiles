-- ====================================================================
-- Stage 3 Kala Finance — Automated Accounting Core Exit Gate Suite
-- File: supabase/tests/stage3_accounting.sql
--
-- Prerequisites:
--   Migrations 001 through 024 must be applied before running.
--
-- Behavior:
--   Runs inside BEGIN ... ROLLBACK so zero test data is persisted.
-- ====================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID := 'eeeeeeee-1111-4111-8111-111111111111';
  v_inv_staff UUID := 'eeeeeeee-2222-4222-8222-222222222222';

  v_biz_a BIGINT;
  v_biz_b BIGINT;
  v_branch_a BIGINT;
  v_branch_b BIGINT;
  v_fy_a BIGINT;
  v_fy_b BIGINT;

  v_acc_cash BIGINT;
  v_acc_bank BIGINT;
  v_acc_debtors BIGINT;
  v_acc_capital BIGINT;
  v_acc_reserves BIGINT;
  v_acc_sales BIGINT;
  v_acc_expense BIGINT;
  v_acc_b_cash BIGINT;
  v_acc_b_sales BIGINT;

  v_res JSONB;
  v_sales_vch_id BIGINT;
  v_exp_vch_id BIGINT;
  v_rev_target_id BIGINT;
  v_rev_vch_id BIGINT;
  v_rcpt_1_id BIGINT;
  v_rcpt_2_id BIGINT;
  v_cnt INT;
  v_failed BOOLEAN;
  v_fn TEXT;
  v_stage3_fns TEXT[] := ARRAY[
    'public.post_voucher_tx(bigint, bigint, text, date, jsonb, text, text, bigint, character, numeric, uuid)',
    'public.reverse_voucher_tx(bigint, bigint, date, text, uuid)',
    'public.allocate_bill_payment_tx(bigint, bigint, bigint, numeric, date, uuid)',
    'public.verify_opening_balances(bigint)',
    'public.verify_trial_balance(bigint, bigint)',
    'public.close_financial_year_tx(bigint, bigint, uuid)'
  ];
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Seed Owner (Multi-Company), Inventory Staff, Company A & B
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@stage3.test', 'hash', NOW(), NOW(), NOW()),
    (v_inv_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inv@stage3.test', 'hash', NOW(), NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);

  v_biz_a := (public.create_business('Stage3 Textiles A', 'stage3-textiles-a', '{}'::jsonb)->>'id')::BIGINT;
  v_biz_b := (public.create_business('Stage3 Textiles B', 'stage3-textiles-b', '{}'::jsonb)->>'id')::BIGINT;

  -- Add Inventory Staff (no vouchers.post permission) to Company A
  RESET ROLE;
  INSERT INTO public.memberships (user_id, business_id, role, role_id)
  SELECT v_inv_staff, v_biz_a, 'staff', r.id
  FROM public.roles r
  WHERE r.business_id = v_biz_a AND r.name = 'Inventory Staff'
  LIMIT 1;

  -- Activate Company A context
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  SELECT id INTO v_branch_a FROM public.branches WHERE business_id = v_biz_a AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_fy_a FROM public.financial_years WHERE business_id = v_biz_a AND is_active IS TRUE LIMIT 1;

  -- ==================================================================
  -- TEST 1: Default Textile COA Seeding & System Account Protection
  -- ==================================================================
  SELECT COUNT(*) INTO v_cnt FROM public.accounts WHERE business_id = v_biz_a AND is_system IS TRUE;
  IF v_cnt < 20 THEN
    RAISE EXCEPTION 'FAIL: Expected default textile COA seeded (>=20 accounts), found %', v_cnt;
  END IF;

  SELECT id INTO v_acc_cash FROM public.accounts WHERE business_id = v_biz_a AND code = '1000';
  SELECT id INTO v_acc_bank FROM public.accounts WHERE business_id = v_biz_a AND code = '1010';
  SELECT id INTO v_acc_debtors FROM public.accounts WHERE business_id = v_biz_a AND code = '1100';
  SELECT id INTO v_acc_capital FROM public.accounts WHERE business_id = v_biz_a AND code = '3000';
  SELECT id INTO v_acc_reserves FROM public.accounts WHERE business_id = v_biz_a AND code = '3100';
  SELECT id INTO v_acc_sales FROM public.accounts WHERE business_id = v_biz_a AND code = '4000';
  SELECT id INTO v_acc_expense FROM public.accounts WHERE business_id = v_biz_a AND code = '5300';

  -- System account cannot be deleted
  v_failed := FALSE;
  BEGIN
    DELETE FROM public.accounts WHERE id = v_acc_cash;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: System account was deleted'; END IF;

  -- System account code/group cannot be modified
  v_failed := FALSE;
  BEGIN
    UPDATE public.accounts SET code = '9999' WHERE id = v_acc_cash;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: System account code was modified'; END IF;

  -- ==================================================================
  -- TEST 2: Balanced Voucher Posting, Unbalanced Rejection & Idempotency
  -- ==================================================================
  -- Unbalanced voucher MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_debtors, 'debit', 1000, 'credit', 0),
        jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 800)
      ),
      'Unbalanced test'
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Unbalanced voucher was accepted'; END IF;

  -- Valid balanced SALES voucher: DR Debtors 10,000 / CR Sales 10,000
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 10000, 'credit', 0, 'narration', 'Buyer A'),
      jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 10000, 'narration', 'Wholesale dispatch')
    ),
    'Invoice S3-001', 'SALES_INVOICE', 101, 'INR', 1.0,
    '33333333-1111-4111-8111-333333333333'::UUID
  );
  v_sales_vch_id := (v_res->>'voucher_id')::BIGINT;
  IF (v_res->>'status') <> 'posted' OR (v_res->>'base_total_amount')::NUMERIC <> 10000 THEN
    RAISE EXCEPTION 'FAIL: Balanced sales voucher posting failed: %', v_res;
  END IF;

  -- Idempotency replay returns same voucher_id without duplicating
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 10000, 'credit', 0, 'narration', 'Buyer A'),
      jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 10000, 'narration', 'Wholesale dispatch')
    ),
    'Invoice S3-001', 'SALES_INVOICE', 101, 'INR', 1.0,
    '33333333-1111-4111-8111-333333333333'::UUID
  );
  IF (v_res->>'voucher_id')::BIGINT <> v_sales_vch_id THEN
    RAISE EXCEPTION 'FAIL: Idempotent voucher replay created duplicate voucher';
  END IF;

  -- Expense voucher: DR Freight 3,000 / CR Cash 3,000 (Net Profit will be 10,000 - 3,000 = 7,000)
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'PAYMENT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_expense, 'debit', 3000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_cash, 'debit', 0, 'credit', 3000)
    ),
    'Transport freight paid'
  );
  v_exp_vch_id := (v_res->>'voucher_id')::BIGINT;

  -- ==================================================================
  -- TEST 3: Absolute Post-Immutability & Direct Write Blocks
  -- ==================================================================
  -- Direct authenticated UPDATE on vouchers blocked
  v_failed := FALSE;
  BEGIN
    UPDATE public.vouchers SET narration = 'Tampered' WHERE id = v_sales_vch_id;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Authenticated UPDATE on vouchers was allowed'; END IF;

  -- Even as table owner (bypassing grants), immutability trigger blocks UPDATE/DELETE on posted vouchers & entries
  RESET ROLE;
  v_failed := FALSE;
  BEGIN
    UPDATE public.vouchers SET narration = 'Owner Tamper' WHERE id = v_sales_vch_id;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Posted voucher immutability trigger did not block UPDATE'; END IF;

  v_failed := FALSE;
  BEGIN
    DELETE FROM public.voucher_entries WHERE voucher_id = v_sales_vch_id;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Posted voucher_entries immutability trigger did not block DELETE'; END IF;

  -- Restore authenticated owner context
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  -- ==================================================================
  -- TEST 4: Separate Reversal Voucher & Single-Reversal Guard
  -- ==================================================================
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'JOURNAL', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_cash, 'debit', 500, 'credit', 0),
      jsonb_build_object('account_id', v_acc_bank, 'debit', 0, 'credit', 500)
    ),
    'Wrong contra entry to reverse'
  );
  v_rev_target_id := (v_res->>'voucher_id')::BIGINT;

  -- Backdated reversal MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.reverse_voucher_tx(v_biz_a, v_rev_target_id, CURRENT_DATE - 1, 'Backdated reversal');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Backdated reversal was accepted'; END IF;

  -- Valid reversal creates separate REVERSAL voucher while original stays 'posted'
  v_res := public.reverse_voucher_tx(v_biz_a, v_rev_target_id, CURRENT_DATE, 'Entered in error');
  v_rev_vch_id := (v_res->>'reversal_voucher_id')::BIGINT;
  IF (v_res->>'status') <> 'posted' OR v_rev_vch_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: Reversal voucher failed: %', v_res;
  END IF;

  -- Second reversal of the same voucher MUST fail (single-reversal guard)
  v_failed := FALSE;
  BEGIN
    PERFORM public.reverse_voucher_tx(v_biz_a, v_rev_target_id, CURRENT_DATE, 'Duplicate reversal attempt');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Double reversal was allowed'; END IF;

  -- Reversing a REVERSAL voucher MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.reverse_voucher_tx(v_biz_a, v_rev_vch_id, CURRENT_DATE, 'Reverse reversal');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Reversing a REVERSAL voucher was allowed'; END IF;

  -- ==================================================================
  -- TEST 5: Dual-Locked Bill Allocations (Over-Settlement & Double-Spend)
  -- ==================================================================
  -- Receipt 1: ₹6,000
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 6000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 6000)
    ),
    'Part payment 1'
  );
  v_rcpt_1_id := (v_res->>'voucher_id')::BIGINT;

  -- Allocate ₹4,000 of Receipt 1 to Sales Voucher (₹10,000)
  v_res := public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 4000, CURRENT_DATE);
  IF (v_res->>'invoice_remaining')::NUMERIC <> 6000 OR (v_res->>'settlement_remaining')::NUMERIC <> 2000 THEN
    RAISE EXCEPTION 'FAIL: Unexpected allocation remainder: %', v_res;
  END IF;

  -- Double-spend check: allocating ₹3,000 from Receipt 1 (> ₹2,000 remaining) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 3000, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Receipt double-spend was allowed'; END IF;

  -- Allocate remaining ₹2,000 of Receipt 1 -> invoice remaining = ₹4,000
  PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 2000, CURRENT_DATE);

  -- Receipt 2: ₹5,000 -> trying to allocate ₹5,000 against ₹4,000 invoice remaining MUST fail
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 5000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 5000)
    ),
    'Part payment 2'
  );
  v_rcpt_2_id := (v_res->>'voucher_id')::BIGINT;

  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_2_id, 5000, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Invoice over-settlement was allowed'; END IF;

  -- ==================================================================
  -- TEST 6: Opening Balance Verification & FY Close Guards
  -- ==================================================================
  -- Unbalanced opening balance MUST block FY close
  UPDATE public.accounts SET opening_balance = 50000, opening_balance_type = 'DR' WHERE id = v_acc_cash;
  v_res := public.verify_opening_balances(v_biz_a);
  IF (v_res->>'balanced')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: Unbalanced opening balances reported as balanced';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.close_financial_year_tx(v_biz_a, v_fy_a);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: FY close succeeded with unbalanced opening balances'; END IF;

  -- Balance opening balances: CR Owner Capital ₹50,000
  UPDATE public.accounts SET opening_balance = 50000, opening_balance_type = 'CR' WHERE id = v_acc_capital;
  v_res := public.verify_opening_balances(v_biz_a);
  IF (v_res->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: Balanced opening balances failed verification: %', v_res;
  END IF;

  -- Verify Trial Balance
  v_res := public.verify_trial_balance(v_biz_a, v_fy_a);
  IF (v_res->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: Trial balance failed verification: %', v_res;
  END IF;

  -- ==================================================================
  -- TEST 7: RBAC & Multi-Company Fail-Closed Isolation
  -- ==================================================================
  -- Inventory Staff (no vouchers.post) cannot post vouchers
  PERFORM set_config('request.jwt.claim.sub', v_inv_staff::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inv_staff, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_a, v_branch_a, 'JOURNAL', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_acc_bank, 'debit', 0, 'credit', 100)
      ),
      'Unauthorized staff voucher'
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Inventory Staff was allowed to post voucher'; END IF;

  -- Multi-company owner with MISSING x-business-id fails closed
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', '{}'::TEXT, true);

  v_failed := FALSE;
  BEGIN
    PERFORM public.verify_trial_balance(v_biz_a, v_fy_a);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Multi-company owner did not fail closed on verify_trial_balance'; END IF;

  -- Owner with x-business-id = Company A cannot touch Company B
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_b::TEXT)::TEXT, true);
  SELECT id INTO v_branch_b FROM public.branches WHERE business_id = v_biz_b AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_fy_b FROM public.financial_years WHERE business_id = v_biz_b AND is_active IS TRUE LIMIT 1;
  SELECT id INTO v_acc_b_cash FROM public.accounts WHERE business_id = v_biz_b AND code = '1000';
  SELECT id INTO v_acc_b_sales FROM public.accounts WHERE business_id = v_biz_b AND code = '4000';

  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);
  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_b, v_branch_b, 'SALES', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_b_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_acc_b_sales, 'debit', 0, 'credit', 100)
      ),
      'Cross-company attack'
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Cross-company voucher post succeeded'; END IF;

  -- ==================================================================
  -- TEST 8: Financial Year Close & Post-Lock Rejection
  -- ==================================================================
  v_res := public.close_financial_year_tx(v_biz_a, v_fy_a);
  IF (v_res->>'is_locked')::BOOLEAN IS NOT TRUE OR (v_res->>'net_profit')::NUMERIC <> 7000 THEN
    RAISE EXCEPTION 'FAIL: FY close did not lock or wrong net profit (expected 7000): %', v_res;
  END IF;

  -- Posting into closed FY MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_a, v_branch_a, 'JOURNAL', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_acc_bank, 'debit', 0, 'credit', 100)
      ),
      'Post into closed FY'
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Voucher posting into locked FY succeeded'; END IF;

  -- ==================================================================
  -- TEST 9: Anon & Internal Helper Privilege Guards
  -- ==================================================================
  IF has_function_privilege('authenticated', 'public.seed_default_chart_of_accounts(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated should not have EXECUTE on internal seed_default_chart_of_accounts';
  END IF;

  SET LOCAL ROLE anon;
  FOREACH v_fn IN ARRAY v_stage3_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on Stage 3 function %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All Stage 3 Accounting Core (COA, Immutable Vouchers, Reversals, Dual-Locked Allocations, FY Close) tests succeeded.';
END $$;

ROLLBACK;

