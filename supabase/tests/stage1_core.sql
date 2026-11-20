-- ====================================================================
-- Stage 1 Kala Core — Automated Verification & Exit Gate Test Suite
-- File: supabase/tests/stage1_core.sql
--
-- Prerequisites:
--   Migrations 001 through 013 must be applied before running.
--
-- Behavior:
--   Runs inside BEGIN ... ROLLBACK so zero test data is persisted.
--   Any failed assertion raises an exception and aborts the run.
-- ====================================================================

BEGIN;

DO $$
DECLARE
  v_owner_ab UUID := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_staff_a UUID := 'bbbbbbbb-2222-4222-8222-222222222222';
  v_acct_a UUID := 'cccccccc-3333-4333-8333-333333333333';

  v_biz_a BIGINT;
  v_biz_b BIGINT;
  v_branch_a BIGINT;
  v_fy_a BIGINT;
  v_fy_locked BIGINT;
  v_acct_role_id BIGINT;
  v_sales_role_id BIGINT;

  v_prod_a BIGINT;
  v_prod_b BIGINT;
  v_cnt INT;
  v_failed BOOLEAN;
  v_doc1 TEXT;
  v_doc2 TEXT;
  v_idem_key UUID := '99999999-9999-4999-8999-999999999999';
  v_claim JSONB;
  v_audit_id BIGINT;
  v_actor UUID;
  v_pub_prod JSONB;
  v_req_id BIGINT;
  v_fn TEXT;
  v_auth_only_fns TEXT[] := ARRAY[
    'public.assert_financial_year_open(bigint, date)',
    'public.next_document_no(bigint, bigint, bigint, text, text)',
    'public.has_permission(bigint, text)',
    'public.claim_idempotency_key(bigint, uuid, text, text)',
    'public.complete_idempotency_key(bigint, uuid, jsonb)',
    'public.record_audit_event(bigint, text, text, text, jsonb, jsonb)'
  ];
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Seed Test Users & Multi-Company Setup via create_business()
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_owner_ab, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-ab@stage1.test', 'hash', NOW(), NOW(), NOW()),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff-a@stage1.test', 'hash', NOW(), NOW(), NOW()),
    (v_acct_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acct-a@stage1.test', 'hash', NOW(), NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- Owner AB creates two separate companies via create_business()
  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);

  v_biz_a := (public.create_business('Stage1 Mills A', 'stage1-mills-a', '{"gstin":"24AABCS1111F1Z5"}'::jsonb)->>'id')::BIGINT;
  v_biz_b := (public.create_business('Stage1 Traders B', 'stage1-traders-b', '{"gstin":"24AABCS2222F1Z9"}'::jsonb)->>'id')::BIGINT;

  SELECT id INTO v_branch_a FROM public.branches WHERE business_id = v_biz_a AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_fy_a FROM public.financial_years WHERE business_id = v_biz_a AND is_active IS TRUE LIMIT 1;

  IF v_branch_a IS NULL OR v_fy_a IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_business did not seed default branch and active financial year';
  END IF;

  -- Attach Sales Staff & Accountant to Business A
  SELECT id INTO v_sales_role_id FROM public.roles WHERE business_id = v_biz_a AND name = 'Sales Staff';
  SELECT id INTO v_acct_role_id FROM public.roles WHERE business_id = v_biz_a AND name = 'Accountant';

  INSERT INTO public.memberships (user_id, business_id, role, role_id) VALUES
    (v_staff_a, v_biz_a, 'staff', v_sales_role_id),
    (v_acct_a, v_biz_a, 'staff', v_acct_role_id);

  -- Seed products in Business A and Business B (as superuser/postgres)
  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_a, 'S1-A-100', 'BrandA', 600, 4, TRUE) RETURNING id INTO v_prod_a;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_b, 'S1-B-200', 'BrandB', 900, 6, TRUE) RETURNING id INTO v_prod_b;

  -- Seed a locked historical financial year for Business A (FY 2024-25)
  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked, locked_at, locked_by)
  VALUES (v_biz_a, 'FY 2024-25', DATE '2024-04-01', DATE '2025-03-31', FALSE, TRUE, NOW(), v_owner_ab)
  RETURNING id INTO v_fy_locked;

  -- ==================================================================
  -- TEST 1: Multi-Company Header Isolation & Fail-Closed Behavior
  -- ==================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);

  -- 1A. Missing x-business-id header for multi-company user MUST fail closed
  PERFORM set_config('request.headers', '{}', true);
  IF public.current_business_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Multi-company user without x-business-id did not fail closed';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id IN (v_prod_a, v_prod_b);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: Multi-company user without header read % products', v_cnt;
  END IF;

  -- 1B. Invalid x-business-id header MUST fail closed
  PERFORM set_config('request.headers', '{"x-business-id":"99999999"}', true);
  IF public.current_business_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Unauthorized x-business-id did not fail closed';
  END IF;

  -- 1C. Scoped to Business A -> sees ONLY Business A, cannot read/write Business B
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);
  IF public.current_business_id() <> v_biz_a THEN
    RAISE EXCEPTION 'FAIL: current_business_id() did not resolve Business A';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_a;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Owner AB could not read Business A product'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: Owner AB scoped to A leaked Business B product'; END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.products (business_id, design_no) VALUES (v_biz_b, 'CROSS-TAB-LEAK');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Owner AB scoped to A inserted into Business B'; END IF;

  -- 1D. Scoped to Business B -> sees ONLY Business B
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_b::TEXT)::TEXT, true);
  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_b;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Owner AB could not read Business B product'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_a;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: Owner AB scoped to B leaked Business A product'; END IF;

  -- ==================================================================
  -- TEST 2: Single-Company Fallback (No Header Required)
  -- ==================================================================
  PERFORM set_config('request.jwt.claim.sub', v_staff_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', '{}', true);

  IF public.current_business_id() <> v_biz_a THEN
    RAISE EXCEPTION 'FAIL: Single-company user fallback failed';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_a;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Single-company staff could not read own product'; END IF;

  -- ==================================================================
  -- TEST 3: Granular RBAC (has_permission)
  -- ==================================================================
  -- Sales Staff (v_staff_a)
  IF NOT public.has_permission(v_biz_a, 'orders.write') THEN
    RAISE EXCEPTION 'FAIL: Sales Staff missing orders.write permission';
  END IF;
  IF public.has_permission(v_biz_a, 'vouchers.post') THEN
    RAISE EXCEPTION 'FAIL: Sales Staff unexpectedly granted vouchers.post';
  END IF;

  -- Accountant (v_acct_a)
  PERFORM set_config('request.jwt.claim.sub', v_acct_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_acct_a, 'role', 'authenticated')::TEXT, true);
  IF NOT public.has_permission(v_biz_a, 'vouchers.post') THEN
    RAISE EXCEPTION 'FAIL: Accountant missing vouchers.post permission';
  END IF;
  IF public.has_permission(v_biz_a, 'inventory.transfer') THEN
    RAISE EXCEPTION 'FAIL: Accountant unexpectedly granted inventory.transfer';
  END IF;

  -- Owner (v_owner_ab)
  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);
  IF NOT public.has_permission(v_biz_a, 'any.future.permission') THEN
    RAISE EXCEPTION 'FAIL: Owner wildcard permission failed';
  END IF;

  -- ==================================================================
  -- TEST 4: Financial Year Locking & Non-Overlap Guard
  -- ==================================================================
  -- Open date succeeds
  IF public.assert_financial_year_open(v_biz_a, CURRENT_DATE) <> v_fy_a THEN
    RAISE EXCEPTION 'FAIL: assert_financial_year_open did not return active FY';
  END IF;

  -- Locked FY date fails
  v_failed := FALSE;
  BEGIN
    PERFORM public.assert_financial_year_open(v_biz_a, DATE '2024-08-15');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Locked financial year accepted a date'; END IF;

  -- Out-of-range date fails
  v_failed := FALSE;
  BEGIN
    PERFORM public.assert_financial_year_open(v_biz_a, DATE '2018-05-01');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Unconfigured financial year date was accepted'; END IF;

  -- Overlapping FY insert fails
  v_failed := FALSE;
  BEGIN
    INSERT INTO public.financial_years (business_id, label, start_date, end_date)
    VALUES (v_biz_a, 'FY 2024-OVERLAP', DATE '2024-10-01', DATE '2025-09-30');
  EXCEPTION WHEN exclusion_violation THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Overlapping financial year was allowed'; END IF;

  -- ==================================================================
  -- TEST 5: Document Counters (Strictly Ordered Unique Sequences)
  -- ==================================================================
  v_doc1 := public.next_document_no(v_biz_a, v_branch_a, v_fy_a, 'SALES_INVOICE', 'INV');
  v_doc2 := public.next_document_no(v_biz_a, v_branch_a, v_fy_a, 'SALES_INVOICE', 'INV');
  IF v_doc1 = v_doc2 OR v_doc1 NOT LIKE 'INV/%/0001' OR v_doc2 NOT LIKE 'INV/%/0002' THEN
    RAISE EXCEPTION 'FAIL: Document counter sequence invalid: %, %', v_doc1, v_doc2;
  END IF;

  -- ==================================================================
  -- TEST 6: Payload-Hashed Idempotency Keys
  -- ==================================================================
  v_claim := public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-payload-1');
  IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
    RAISE EXCEPTION 'FAIL: First idempotency claim marked as replay';
  END IF;

  PERFORM public.complete_idempotency_key(v_biz_a, v_idem_key, '{"ok":true,"doc":"INV-1"}'::jsonb);

  -- Replay with identical hash returns cached response
  v_claim := public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-payload-1');
  IF (v_claim->>'is_replay')::BOOLEAN IS NOT TRUE OR (v_claim->'response'->>'doc') <> 'INV-1' THEN
    RAISE EXCEPTION 'FAIL: Idempotency replay did not return cached response';
  END IF;

  -- Reuse with DIFFERENT payload hash MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-DIFFERENT-PAYLOAD');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Idempotency key accepted different payload hash'; END IF;

  -- ==================================================================
  -- TEST 7: Immutable Audit Log (Server-Derived Actor)
  -- ==================================================================
  v_audit_id := public.record_audit_event(v_biz_a, 'product', v_prod_a::TEXT, 'UPDATE', NULL, '{"rate":650}'::jsonb);
  SELECT actor_user_id INTO v_actor FROM public.audit_events WHERE id = v_audit_id;
  IF v_actor <> v_owner_ab THEN
    RAISE EXCEPTION 'FAIL: audit_events did not record auth.uid() as actor';
  END IF;

  v_failed := FALSE;
  BEGIN
    DELETE FROM public.audit_events WHERE id = v_audit_id;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: audit_events allowed DELETE'; END IF;

  -- ==================================================================
  -- TEST 8: Regression (Public QR Product + Buyer Order Request + Anon Guards)
  -- ==================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '{}', true);

  v_pub_prod := public.get_public_product('stage1-mills-a', 'S1-A-100');
  IF v_pub_prod IS NULL OR (v_pub_prod->>'design_no') <> 'S1-A-100' THEN
    RAISE EXCEPTION 'FAIL: Public QR product lookup regressed';
  END IF;

  v_req_id := public.submit_order_request(
    'stage1-mills-a',
    'Stage1 Buyer',
    '+91 98765 43210',
    '[{"design_no":"S1-A-100","sets":2}]'::jsonb,
    'Stage 1 regression check'
  );
  IF v_req_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: Public buyer order request submission regressed';
  END IF;

  FOREACH v_fn IN ARRAY v_auth_only_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on Stage 1 auth-only function %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All Stage 1 Kala Core isolation, RBAC, FY locking, counter, idempotency, audit, and regression tests succeeded.';
END $$;

ROLLBACK;
