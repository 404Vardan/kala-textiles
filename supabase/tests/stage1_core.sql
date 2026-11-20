-- ====================================================================
-- Stage 1 Kala Core — Automated Verification & Exit Gate Test Suite
-- File: supabase/tests/stage1_core.sql
--
-- Prerequisites:
--   Migrations 001 through 014 must be applied before running.
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
  v_godown_a BIGINT;
  v_shop_a BIGINT;
  v_acct_role_id BIGINT;
  v_sales_role_id BIGINT;

  v_prod_a BIGINT;
  v_prod_b BIGINT;
  v_cnt INT;
  v_rows INT;
  v_ver_before INT;
  v_ver_after INT;
  v_failed BOOLEAN;
  v_doc1 TEXT;
  v_doc2 TEXT;
  v_idem_key UUID := '99999999-9999-4999-8999-999999999999';
  v_claim JSONB;
  v_audit_id BIGINT;
  v_actor UUID;
  v_pub_prod JSONB;
  v_req_id BIGINT;
  v_intake_res JSONB;
  v_transfer_res JSONB;
  v_fn TEXT;
  v_auth_only_fns TEXT[] := ARRAY[
    'public.assert_financial_year_open(bigint, date)',
    'public.next_document_no(bigint, bigint, bigint, text, text)',
    'public.has_permission(bigint, text)'
  ];
  v_internal_only_fns TEXT[] := ARRAY[
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

  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);

  v_biz_a := (public.create_business('Stage1 Mills A', 'stage1-mills-a', '{"gstin":"24AABCS1111F1Z5"}'::jsonb)->>'id')::BIGINT;
  v_biz_b := (public.create_business('Stage1 Traders B', 'stage1-traders-b', '{"gstin":"24AABCS2222F1Z9"}'::jsonb)->>'id')::BIGINT;

  SELECT id INTO v_branch_a FROM public.branches WHERE business_id = v_biz_a AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_fy_a FROM public.financial_years WHERE business_id = v_biz_a AND is_active IS TRUE LIMIT 1;
  SELECT id INTO v_godown_a FROM public.inventory_locations WHERE business_id = v_biz_a AND LOWER(name) = 'godown' LIMIT 1;
  SELECT id INTO v_shop_a FROM public.inventory_locations WHERE business_id = v_biz_a AND LOWER(name) = 'shop' LIMIT 1;

  IF v_branch_a IS NULL OR v_fy_a IS NULL OR v_godown_a IS NULL OR v_shop_a IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_business did not seed default branch, FY, and GODOWN/SHOP locations';
  END IF;

  SELECT id INTO v_sales_role_id FROM public.roles WHERE business_id = v_biz_a AND name = 'Sales Staff';
  SELECT id INTO v_acct_role_id FROM public.roles WHERE business_id = v_biz_a AND name = 'Accountant';

  INSERT INTO public.memberships (user_id, business_id, role, role_id) VALUES
    (v_staff_a, v_biz_a, 'staff', v_sales_role_id),
    (v_acct_a, v_biz_a, 'staff', v_acct_role_id);

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_a, 'S1-A-100', 'BrandA', 600, 4, TRUE) RETURNING id INTO v_prod_a;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_b, 'S1-B-200', 'BrandB', 900, 6, TRUE) RETURNING id INTO v_prod_b;

  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked, locked_at, locked_by)
  VALUES (v_biz_a, 'FY 2024-25', DATE '2024-04-01', DATE '2025-03-31', FALSE, TRUE, NOW(), v_owner_ab)
  RETURNING id INTO v_fy_locked;

  -- ==================================================================
  -- TEST 0: Internal Helper Behavior Under Definer Context (Before Role Switch)
  -- Verifies payload-hashed idempotency & server-derived audit_events
  -- ==================================================================
  v_claim := public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-payload-1');
  IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
    RAISE EXCEPTION 'FAIL: First idempotency claim marked as replay';
  END IF;

  PERFORM public.complete_idempotency_key(v_biz_a, v_idem_key, '{"ok":true,"doc":"INV-1"}'::jsonb);

  v_claim := public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-payload-1');
  IF (v_claim->>'is_replay')::BOOLEAN IS NOT TRUE OR (v_claim->'response'->>'doc') <> 'INV-1' THEN
    RAISE EXCEPTION 'FAIL: Idempotency replay did not return cached response';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.claim_idempotency_key(v_biz_a, v_idem_key, 'TEST_OP', 'sha256-DIFFERENT-PAYLOAD');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Idempotency key accepted different payload hash'; END IF;

  v_audit_id := public.record_audit_event(v_biz_a, 'product', v_prod_a::TEXT, 'UPDATE', NULL, '{"rate":650}'::jsonb);
  SELECT actor_user_id INTO v_actor FROM public.audit_events WHERE id = v_audit_id;
  IF v_actor <> v_owner_ab THEN
    RAISE EXCEPTION 'FAIL: audit_events did not record auth.uid() as actor';
  END IF;

  -- ==================================================================
  -- TEST 1: Multi-Company Header Isolation (SELECT, INSERT, UPDATE, DELETE)
  -- ==================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);

  -- 1A. Missing header for multi-company user MUST fail closed
  PERFORM set_config('request.headers', '{}', true);
  IF public.current_business_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Multi-company user without x-business-id did not fail closed';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id IN (v_prod_a, v_prod_b);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: Multi-company user without header read % products', v_cnt;
  END IF;

  -- 1B. Invalid header MUST fail closed
  PERFORM set_config('request.headers', '{"x-business-id":"99999999"}', true);
  IF public.current_business_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Unauthorized x-business-id did not fail closed';
  END IF;

  -- 1C. Scoped to Business A -> cannot SELECT, INSERT, UPDATE, or DELETE Business B
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

  UPDATE public.products SET brand = 'CrossTabHack' WHERE id = v_prod_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: Owner AB scoped to A updated Business B product'; END IF;

  DELETE FROM public.products WHERE id = v_prod_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: Owner AB scoped to A deleted Business B product'; END IF;

  -- 1D. Verify row_version auto-increments on valid UPDATE
  SELECT row_version INTO v_ver_before FROM public.products WHERE id = v_prod_a;
  UPDATE public.products SET rate = 625 WHERE id = v_prod_a;
  SELECT row_version INTO v_ver_after FROM public.products WHERE id = v_prod_a;
  IF v_ver_after <> v_ver_before + 1 THEN
    RAISE EXCEPTION 'FAIL: row_version did not increment on UPDATE (% -> %)', v_ver_before, v_ver_after;
  END IF;

  -- 1E. Scoped to Business B -> sees ONLY Business B
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
  -- TEST 3: Granular RBAC & System Role Protection
  -- ==================================================================
  IF NOT public.has_permission(v_biz_a, 'orders.write') THEN
    RAISE EXCEPTION 'FAIL: Sales Staff missing orders.write permission';
  END IF;
  IF public.has_permission(v_biz_a, 'vouchers.post') THEN
    RAISE EXCEPTION 'FAIL: Sales Staff unexpectedly granted vouchers.post';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_acct_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_acct_a, 'role', 'authenticated')::TEXT, true);
  IF NOT public.has_permission(v_biz_a, 'vouchers.post') THEN
    RAISE EXCEPTION 'FAIL: Accountant missing vouchers.post permission';
  END IF;
  IF public.has_permission(v_biz_a, 'inventory.transfer') THEN
    RAISE EXCEPTION 'FAIL: Accountant unexpectedly granted inventory.transfer';
  END IF;

  -- Switch back to Owner AB on Business A
  PERFORM set_config('request.jwt.claim.sub', v_owner_ab::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_ab, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  IF NOT public.has_permission(v_biz_a, 'any.future.permission') THEN
    RAISE EXCEPTION 'FAIL: Owner wildcard permission failed';
  END IF;

  -- System role cannot be deleted or renamed
  v_failed := FALSE;
  BEGIN
    DELETE FROM public.roles WHERE id = v_acct_role_id;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: System role Accountant was deleted'; END IF;

  v_failed := FALSE;
  BEGIN
    UPDATE public.roles SET name = 'RenamedAccountant' WHERE id = v_acct_role_id;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: System role Accountant was renamed'; END IF;

  -- Legitimate permission management on system role still works
  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_acct_role_id, 'custom.audit.view');
  DELETE FROM public.role_permissions
  WHERE role_id = v_acct_role_id AND permission_key = 'custom.audit.view';

  -- ==================================================================
  -- TEST 4: Financial Year Locking, Immutability & Non-Overlap Guard
  -- ==================================================================
  IF public.assert_financial_year_open(v_biz_a, CURRENT_DATE) <> v_fy_a THEN
    RAISE EXCEPTION 'FAIL: assert_financial_year_open did not return active FY';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.assert_financial_year_open(v_biz_a, DATE '2024-08-15');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Locked financial year accepted a date'; END IF;

  -- Locked FY cannot be unlocked or modified directly
  v_failed := FALSE;
  BEGIN
    UPDATE public.financial_years SET is_locked = FALSE WHERE id = v_fy_locked;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Locked financial year was unlocked via UPDATE'; END IF;

  v_failed := FALSE;
  BEGIN
    UPDATE public.financial_years SET end_date = DATE '2025-04-05' WHERE id = v_fy_locked;
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Locked financial year dates were modified'; END IF;

  -- next_document_no() MUST reject locked FY
  v_failed := FALSE;
  BEGIN
    PERFORM public.next_document_no(v_biz_a, v_branch_a, v_fy_locked, 'SALES_INVOICE', 'INV');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: next_document_no() issued number for locked FY'; END IF;

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
  -- TEST 6: Internal RPC Abuse Prevention (authenticated MUST be denied)
  -- ==================================================================
  FOREACH v_fn IN ARRAY v_internal_only_fns LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated has direct EXECUTE on internal helper %', v_fn;
    END IF;
  END LOOP;

  v_failed := FALSE;
  BEGIN
    PERFORM public.complete_idempotency_key(v_biz_b, v_idem_key, '{"forged":true}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: authenticated directly invoked complete_idempotency_key'; END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.record_audit_event(v_biz_a, 'product', '1', 'FORGED', NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: authenticated directly forged audit_events via record_audit_event'; END IF;

  -- audit_events DELETE blocked
  v_failed := FALSE;
  BEGIN
    DELETE FROM public.audit_events WHERE id = v_audit_id;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: audit_events allowed DELETE'; END IF;

  -- ==================================================================
  -- TEST 7: Existing Inventory RPC Regression (intake + transfer)
  -- ==================================================================
  v_intake_res := public.intake_stock_tx(v_prod_a, v_godown_a, 10, 'Stage1 Test', 'Initial bale', 'IN-S1-001');
  IF (v_intake_res->>'success')::BOOLEAN IS NOT TRUE OR (v_intake_res->>'sets')::INT <> 10 THEN
    RAISE EXCEPTION 'FAIL: intake_stock_tx regression failed: %', v_intake_res;
  END IF;

  v_transfer_res := public.transfer_stock_tx(v_prod_a, v_godown_a, v_shop_a, 4, 'Stage1 Test', 'Move to shop', 'TR-S1-001');
  IF (v_transfer_res->>'success')::BOOLEAN IS NOT TRUE OR (v_transfer_res->>'transferred_sets')::INT <> 4 THEN
    RAISE EXCEPTION 'FAIL: transfer_stock_tx regression failed: %', v_transfer_res;
  END IF;

  -- ==================================================================
  -- TEST 8: Public QR + Buyer Order Request + Anon Privilege Guards
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

  FOREACH v_fn IN ARRAY v_internal_only_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on internal helper %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All Stage 1 Kala Core security, isolation, RBAC, FY locking, counter, idempotency, audit, inventory, and QR regression tests succeeded.';
END $$;

ROLLBACK;
