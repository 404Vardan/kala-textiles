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
  v_fy_2 BIGINT;
  v_fy_3 BIGINT;
  v_fy_end DATE;
  v_fy_b BIGINT;
  v_party_a BIGINT;
  v_party_b BIGINT;

  v_acc_cash BIGINT;
  v_acc_bank BIGINT;
  v_acc_debtors BIGINT;
  v_acc_inv BIGINT;
  v_acc_cgst BIGINT;
  v_acc_sgst BIGINT;
  v_acc_capital BIGINT;
  v_acc_reserves BIGINT;
  v_acc_sales BIGINT;
  v_acc_freight_inc BIGINT;
  v_acc_cogs BIGINT;
  v_acc_expense BIGINT;
  v_acc_b_cash BIGINT;
  v_acc_b_sales BIGINT;

  v_res JSONB;
  v_sales_vch_id BIGINT;
  v_compound_inv_id BIGINT;
  v_compound_rcpt_id BIGINT;
  v_fy1_profit NUMERIC;
  v_fy3_reserves NUMERIC;
  v_exp_vch_id BIGINT;
  v_rev_target_id BIGINT;
  v_rev_vch_id BIGINT;
  v_rcpt_1_id BIGINT;
  v_rcpt_2_id BIGINT;
  v_rcpt_party_b_id BIGINT;
  v_rcpt_noparty_id BIGINT;
  v_cnt INT;
  v_failed BOOLEAN;
  v_fn TEXT;
  v_stage3_fns TEXT[] := ARRAY[
    'public.post_voucher_tx(bigint, bigint, text, date, jsonb, text, text, bigint, character, numeric, uuid, bigint)',
    'public.reverse_voucher_tx(bigint, bigint, date, text, uuid)',
    'public.allocate_bill_payment_tx(bigint, bigint, bigint, numeric, date, uuid)',
    'public.set_opening_balance_tx(bigint, bigint, bigint, numeric, numeric, bigint, bigint, character, text, text)',
    'public.verify_subledger_control_tieout(bigint, bigint)',
    'public.verify_opening_balances(bigint, bigint)',
    'public.verify_trial_balance(bigint, bigint)',
    'public.close_financial_year_tx(bigint, bigint, uuid, bigint)'
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

  INSERT INTO public.parties (business_id, name, station)
  VALUES (v_biz_a, 'Customer A Sarees', 'Surat')
  RETURNING id INTO v_party_a;

  INSERT INTO public.parties (business_id, name, station)
  VALUES (v_biz_a, 'Customer B Fabrics', 'Mumbai')
  RETURNING id INTO v_party_b;

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
  SELECT id INTO v_acc_inv FROM public.accounts WHERE business_id = v_biz_a AND code = '1200';
  SELECT id INTO v_acc_cgst FROM public.accounts WHERE business_id = v_biz_a AND code = '2100';
  SELECT id INTO v_acc_sgst FROM public.accounts WHERE business_id = v_biz_a AND code = '2110';
  SELECT id INTO v_acc_capital FROM public.accounts WHERE business_id = v_biz_a AND code = '3000';
  SELECT id INTO v_acc_reserves FROM public.accounts WHERE business_id = v_biz_a AND code = '3100';
  SELECT id INTO v_acc_sales FROM public.accounts WHERE business_id = v_biz_a AND code = '4000';
  SELECT id INTO v_acc_freight_inc FROM public.accounts WHERE business_id = v_biz_a AND code = '4410';
  SELECT id INTO v_acc_cogs FROM public.accounts WHERE business_id = v_biz_a AND code = '5100';
  SELECT id INTO v_acc_expense FROM public.accounts WHERE business_id = v_biz_a AND code = '5300';

  -- C3: Confirm 4410 Freight & Packing Recovery is classified as 'income' and 5310 as 'expense'
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_acc_freight_inc AND account_group = 'income') THEN
    RAISE EXCEPTION 'FAIL: 4410 Freight & Packing Recovery must be classified as income';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE business_id = v_biz_a AND code = '5310' AND account_group = 'expense') THEN
    RAISE EXCEPTION 'FAIL: 5310 Bardana & Packing Expense must be classified as expense';
  END IF;

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

  -- Valid balanced SALES voucher for Customer A: DR Debtors 10,000 / CR Sales 10,000
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 10000, 'credit', 0, 'narration', 'Buyer A'),
      jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 10000, 'narration', 'Wholesale dispatch')
    ),
    'Invoice S3-001', 'SALES_INVOICE', 101, 'INR', 1.0,
    '33333333-1111-4111-8111-333333333333'::UUID, v_party_a
  );
  v_sales_vch_id := (v_res->>'voucher_id')::BIGINT;
  IF (v_res->>'status') <> 'posted' OR (v_res->>'base_total_amount')::NUMERIC <> 10000 OR (v_res->>'party_id')::BIGINT <> v_party_a THEN
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
    '33333333-1111-4111-8111-333333333333'::UUID, v_party_a
  );
  IF (v_res->>'voucher_id')::BIGINT <> v_sales_vch_id THEN
    RAISE EXCEPTION 'FAIL: Idempotent voucher replay created duplicate voucher';
  END IF;

  -- Idempotency payload-hash conflict (same key, different amount) MUST fail with zero partial rows
  SELECT COUNT(*) INTO v_cnt FROM public.vouchers WHERE business_id = v_biz_a;
  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_debtors, 'debit', 9999, 'credit', 0),
        jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 9999)
      ),
      'Conflicting payload', 'SALES_INVOICE', 101, 'INR', 1.0,
      '33333333-1111-4111-8111-333333333333'::UUID
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Conflicting idempotency payload was accepted'; END IF;
  IF (SELECT COUNT(*) FROM public.vouchers WHERE business_id = v_biz_a) <> v_cnt THEN
    RAISE EXCEPTION 'FAIL: Failed idempotency conflict left partial voucher rows';
  END IF;

  -- Multi-currency unbalanced transaction-currency voucher MUST fail even if base rounds equal
  v_failed := FALSE;
  BEGIN
    PERFORM public.post_voucher_tx(
      v_biz_a, v_branch_a, 'JOURNAL', CURRENT_DATE,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_cash, 'debit', 100.01, 'credit', 0),
        jsonb_build_object('account_id', v_acc_bank, 'debit', 0, 'credit', 100.00)
      ),
      'Unbalanced FX test', NULL, NULL, 'USD', 0.001, NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Unbalanced transaction-currency voucher was accepted'; END IF;

  -- Valid multi-currency contra voucher: USD 100 @ 83.50 -> base INR 8,350 (no P&L impact)
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'CONTRA', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 100, 'credit', 0),
      jsonb_build_object('account_id', v_acc_cash, 'debit', 0, 'credit', 100)
    ),
    'FX USD transfer', NULL, NULL, 'USD', 83.50, NULL
  );
  IF (v_res->>'base_total_amount')::NUMERIC <> 8350 THEN
    RAISE EXCEPTION 'FAIL: Expected base_total_amount 8350 for USD 100 @ 83.50, got %', v_res->>'base_total_amount';
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
  -- Receipt 1 (Customer A): ₹6,000
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 6000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 6000)
    ),
    'Part payment 1', NULL, NULL, 'INR', 1.0, NULL, v_party_a
  );
  v_rcpt_1_id := (v_res->>'voucher_id')::BIGINT;

  -- Receipt from Customer B: ₹2,000 -> MUST be rejected against Customer A's invoice!
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 2000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 2000)
    ),
    'Customer B payment', NULL, NULL, 'INR', 1.0, NULL, v_party_b
  );
  v_rcpt_party_b_id := (v_res->>'voucher_id')::BIGINT;

  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_party_b_id, 1000, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Cross-party allocation (Customer B receipt -> Customer A invoice) was allowed'; END IF;

  -- Party-less receipt (party_id NULL) -> MUST be rejected for bill allocation!
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 1000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 1000)
    ),
    'Unidentified receipt'
  );
  v_rcpt_noparty_id := (v_res->>'voucher_id')::BIGINT;

  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_noparty_id, 500, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Party-less receipt allocation was allowed'; END IF;

  -- Allocate ₹4,000 of Customer A Receipt 1 to Customer A Sales Voucher (₹10,000) in INR
  v_res := public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 4000, CURRENT_DATE);
  IF (v_res->>'invoice_remaining')::NUMERIC <> 6000
     OR (v_res->>'settlement_remaining')::NUMERIC <> 2000
     OR (v_res->>'party_id')::BIGINT <> v_party_a
     OR (v_res->>'currency_code') <> 'INR' THEN
    RAISE EXCEPTION 'FAIL: Unexpected allocation result: %', v_res;
  END IF;

  -- Double-spend check: allocating ₹3,000 from Receipt 1 (> ₹2,000 remaining) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 3000, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Receipt double-spend was allowed'; END IF;

  -- Allocate remaining ₹2,000 of Receipt 1 -> invoice remaining = ₹4,000
  PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_1_id, 2000, CURRENT_DATE);

  -- Receipt 2 (Customer A): ₹5,000 -> trying to allocate ₹5,000 against ₹4,000 invoice remaining MUST fail
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 5000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 5000)
    ),
    'Part payment 2', NULL, NULL, 'INR', 1.0, NULL, v_party_a
  );
  v_rcpt_2_id := (v_res->>'voucher_id')::BIGINT;

  SELECT COUNT(*) INTO v_cnt FROM public.bill_allocations WHERE business_id = v_biz_a;
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_2_id, 5000, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Invoice over-settlement was allowed'; END IF;
  IF (SELECT COUNT(*) FROM public.bill_allocations WHERE business_id = v_biz_a) <> v_cnt THEN
    RAISE EXCEPTION 'FAIL: Failed allocation left partial rows';
  END IF;

  -- Wrong-side settlement (SALES invoice settled by PAYMENT voucher) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_exp_vch_id, 100, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: SALES invoice settled by PAYMENT voucher was allowed'; END IF;

  -- Backdated allocation (allocation_date < voucher_date) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_sales_vch_id, v_rcpt_2_id, 100, CURRENT_DATE - 1);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Backdated bill allocation was allowed'; END IF;

  -- Reversing a voucher that already has active bill_allocations MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.reverse_voucher_tx(v_biz_a, v_sales_vch_id, CURRENT_DATE, 'Try reversing allocated invoice');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Reversing an allocated invoice was allowed'; END IF;

  -- ==================================================================
  -- TEST 5B (C1): Compound Sales Voucher Party Control-Account Cap
  -- Voucher total = ₹19,025 (DR Debtors ₹11,025 + DR COGS ₹8,000),
  -- but Customer A owes ONLY ₹11,025. Allocating ₹11,026 MUST fail!
  -- ==================================================================
  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'SALES', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 11025, 'credit', 0),
      jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 10000),
      jsonb_build_object('account_id', v_acc_freight_inc, 'debit', 0, 'credit', 500),
      jsonb_build_object('account_id', v_acc_cgst, 'debit', 0, 'credit', 262.50),
      jsonb_build_object('account_id', v_acc_sgst, 'debit', 0, 'credit', 262.50),
      jsonb_build_object('account_id', v_acc_cogs, 'debit', 8000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inv, 'debit', 0, 'credit', 8000)
    ),
    'Compound Invoice + COGS (C1)', 'SALES_INVOICE', 102, 'INR', 1.0, NULL, v_party_a
  );
  v_compound_inv_id := (v_res->>'voucher_id')::BIGINT;

  v_res := public.post_voucher_tx(
    v_biz_a, v_branch_a, 'RECEIPT', CURRENT_DATE,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 12000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_debtors, 'debit', 0, 'credit', 12000)
    ),
    'Customer A large receipt', NULL, NULL, 'INR', 1.0, NULL, v_party_a
  );
  v_compound_rcpt_id := (v_res->>'voucher_id')::BIGINT;

  -- Allocating ₹11,026 (> ₹11,025 party control line, even though voucher total is ₹19,025) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.allocate_bill_payment_tx(v_biz_a, v_compound_inv_id, v_compound_rcpt_id, 11026, CURRENT_DATE);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: C1 violation — compound voucher allowed allocation above party receivable ₹11,025'; END IF;

  -- Allocating exact ₹11,025 succeeds (invoice_remaining = 0, settlement_remaining = 975)
  v_res := public.allocate_bill_payment_tx(v_biz_a, v_compound_inv_id, v_compound_rcpt_id, 11025, CURRENT_DATE);
  IF (v_res->>'invoice_remaining')::NUMERIC <> 0 OR (v_res->>'settlement_remaining')::NUMERIC <> 975 THEN
    RAISE EXCEPTION 'FAIL: C1 compound allocation remainder mismatch: %', v_res;
  END IF;

  -- Signed Subledger-to-GL Control Tie-Out MUST pass
  v_res := public.verify_subledger_control_tieout(v_biz_a, v_fy_a);
  IF (v_res->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: Subledger control tie-out failed: %', v_res;
  END IF;

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
  -- TEST 8 (C2): Two Consecutive FY Closures (FY 1 -> FY 2 -> FY 3),
  --              Permanent vs. Nominal Carry-Forward & Post-Lock Guards
  -- ==================================================================
  SELECT end_date INTO v_fy_end FROM public.financial_years WHERE id = v_fy_a;

  -- Create FY 2 and FY 3 sequentially
  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked)
  VALUES (v_biz_a, 'FY Next-1', v_fy_end + 1, (v_fy_end + INTERVAL '1 year')::DATE, FALSE, FALSE)
  RETURNING id INTO v_fy_2;

  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked)
  VALUES (v_biz_a, 'FY Next-2', (v_fy_end + INTERVAL '1 year')::DATE + 1, (v_fy_end + INTERVAL '2 years')::DATE, FALSE, FALSE)
  RETURNING id INTO v_fy_3;

  -- Close FY 1 -> carries forward permanent accounts + open-bill snapshots into FY 2
  -- FY 1 Net Profit: (10,000 + 10,000 Sales + 500 Freight Inc) - (3,000 Expense + 8,000 COGS) = 9,500
  v_res := public.close_financial_year_tx(v_biz_a, v_fy_a, NULL, v_fy_2);
  v_fy1_profit := (v_res->>'net_profit')::NUMERIC;
  IF (v_res->>'is_locked')::BOOLEAN IS NOT TRUE OR v_fy1_profit <> 9500 THEN
    RAISE EXCEPTION 'FAIL: FY 1 close did not lock or wrong net profit (expected 9500): %', v_res;
  END IF;

  -- Verify FY 2 opening balances are balanced and contain ZERO nominal (income/expense) accounts
  v_res := public.verify_opening_balances(v_biz_a, v_fy_2);
  IF (v_res->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: FY 2 carried-forward opening balances unbalanced: %', v_res;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_opening_balances aob
    JOIN public.accounts a ON a.id = aob.account_id
    WHERE aob.business_id = v_biz_a AND aob.fy_id = v_fy_2 AND a.account_group IN ('income', 'expense')
  ) THEN
    RAISE EXCEPTION 'FAIL: Nominal (income/expense) account leaked into FY 2 opening balances';
  END IF;

  -- Post a FY 2 profit voucher (DR Bank ₹4,000 / CR Sales ₹4,000) and close FY 2 -> FY 3
  PERFORM public.post_voucher_tx(
    v_biz_a, v_branch_a, 'SALES', v_fy_end + 10,
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_bank, 'debit', 4000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_sales, 'debit', 0, 'credit', 4000)
    ),
    'FY 2 Cash Sale'
  );

  v_res := public.close_financial_year_tx(v_biz_a, v_fy_2, NULL, v_fy_3);
  IF (v_res->>'is_locked')::BOOLEAN IS NOT TRUE OR (v_res->>'net_profit')::NUMERIC <> 4000 THEN
    RAISE EXCEPTION 'FAIL: FY 2 close failed or wrong profit (expected 4000): %', v_res;
  END IF;

  -- Verify FY 3 Retained Earnings = FY 1 Profit (9,500) + FY 2 Profit (4,000) = 13,500
  SELECT opening_base_credit INTO v_fy3_reserves
  FROM public.account_opening_balances
  WHERE business_id = v_biz_a AND fy_id = v_fy_3 AND account_id = v_acc_reserves;

  IF COALESCE(v_fy3_reserves, 0) <> 13500 THEN
    RAISE EXCEPTION 'FAIL: Expected FY 3 Retained Earnings 13500, got %', v_fy3_reserves;
  END IF;

  v_res := public.verify_opening_balances(v_biz_a, v_fy_3);
  IF (v_res->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: FY 3 carried-forward opening balances unbalanced: %', v_res;
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

  -- Modifying opening_balance after an FY is locked MUST fail
  v_failed := FALSE;
  BEGIN
    UPDATE public.accounts SET opening_balance = 99999 WHERE id = v_acc_cash;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Modifying opening_balance after FY lock was allowed'; END IF;

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

