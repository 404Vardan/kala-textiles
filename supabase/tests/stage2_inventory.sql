-- ====================================================================
-- Stage 2 Kala Inventory — Automated Verification & Exit Gate Suite
-- File: supabase/tests/stage2_inventory.sql
--
-- Prerequisites:
--   Migrations 001 through 019 must be applied before running.
--
-- Behavior:
--   Runs inside BEGIN ... ROLLBACK so zero test data is persisted.
-- ====================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID := 'dddddddd-1111-4111-8111-111111111111';
  v_user_a UUID := 'dddddddd-2222-4222-8222-222222222222';
  v_readonly_user UUID := 'dddddddd-3333-4333-8333-333333333333';

  v_biz_a BIGINT;
  v_biz_b BIGINT;
  v_branch_a BIGINT;
  v_branch_b BIGINT;
  v_godown_a BIGINT;
  v_shop_a BIGINT;
  v_godown_b BIGINT;

  v_party_a BIGINT;
  v_party_b BIGINT;
  v_ro_role_id BIGINT;

  v_set_prod_a BIGINT;
  v_taka_prod_a BIGINT;
  v_set_prod_b BIGINT;
  v_order_id BIGINT;
  v_reserved_order_id BIGINT;

  v_res JSONB;
  v_tx_group UUID;
  v_taka_1 BIGINT;
  v_taka_2 BIGINT;
  v_child_1 BIGINT;
  v_child_2 BIGINT;
  v_avg_cost NUMERIC;
  v_sets_before INT;
  v_sets_after INT;
  v_ledger_before INT;
  v_ledger_after INT;
  v_cnt INT;
  v_failed BOOLEAN;
  v_recon JSONB;
  v_fn TEXT;
  v_stage2_fns TEXT[] := ARRAY[
    'public.intake_set_stock_v2(bigint, bigint, bigint, bigint, integer, numeric, date, text, text, text, uuid)',
    'public.receive_taka_lot_tx(bigint, bigint, bigint, bigint, text, numeric, jsonb, date, bigint, bigint, text, text, uuid)',
    'public.transfer_taka_tx(bigint, bigint, bigint, date, text, uuid)',
    'public.split_taka_tx(bigint, bigint, jsonb, date, text, uuid)',
    'public.verify_inventory_integrity(bigint)'
  ];
  v_internal_fns TEXT[] := ARRAY[
    'public.assert_chronological_stock_date(bigint, bigint, bigint, date)',
    'public.assert_chronological_taka_date(bigint, bigint, date)'
  ];
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Seed Users, Company A, Company B, Locations, Parties & Products
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@stage2.test', 'hash', NOW(), NOW(), NOW()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staffa@stage2.test', 'hash', NOW(), NOW(), NOW()),
    (v_readonly_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'readonly@stage2.test', 'hash', NOW(), NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);

  -- Multi-company owner creates both Company A and Company B
  v_biz_a := (public.create_business('Stage2 Looms A', 'stage2-looms-a', '{}'::jsonb)->>'id')::BIGINT;
  v_biz_b := (public.create_business('Stage2 Looms B', 'stage2-looms-b', '{}'::jsonb)->>'id')::BIGINT;

  -- Activate Company A context
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  SELECT id INTO v_branch_a FROM public.branches WHERE business_id = v_biz_a AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_godown_a FROM public.inventory_locations WHERE business_id = v_biz_a AND LOWER(name) = 'godown' LIMIT 1;
  SELECT id INTO v_shop_a FROM public.inventory_locations WHERE business_id = v_biz_a AND LOWER(name) = 'shop' LIMIT 1;

  INSERT INTO public.parties (business_id, name, station)
  VALUES (v_biz_a, 'Surat Grey Mill A', 'Surat')
  RETURNING id INTO v_party_a;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, tracking_mode, uom, is_active)
  VALUES (v_biz_a, 'S2-SET-01', 'Kala', 500, 4, 'SET', 'SET', TRUE)
  RETURNING id INTO v_set_prod_a;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, tracking_mode, uom, is_active)
  VALUES (v_biz_a, 'S2-TAKA-01', 'Kala', 120, 1, 'TAKA', 'MTR', TRUE)
  RETURNING id INTO v_taka_prod_a;

  -- Create a custom Read-Only role in Company A (no inventory.write)
  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (v_biz_a, 'Read Only Auditor', FALSE)
  RETURNING id INTO v_ro_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_ro_role_id, 'products.read'), (v_ro_role_id, 'inventory.read');

  -- Add Company A staff & read-only memberships (as superuser/table owner via RESET ROLE)
  RESET ROLE;
  INSERT INTO public.memberships (user_id, business_id, role, role_id)
  SELECT v_user_a, v_biz_a, 'staff', r.id
  FROM public.roles r
  WHERE r.business_id = v_biz_a AND r.name = 'Manager'
  LIMIT 1;

  INSERT INTO public.memberships (user_id, business_id, role, role_id)
  VALUES (v_readonly_user, v_biz_a, 'staff', v_ro_role_id);

  -- Seed Company B entities
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_b::TEXT)::TEXT, true);
  SELECT id INTO v_branch_b FROM public.branches WHERE business_id = v_biz_b AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_godown_b FROM public.inventory_locations WHERE business_id = v_biz_b AND LOWER(name) = 'godown' LIMIT 1;

  INSERT INTO public.parties (business_id, name, station)
  VALUES (v_biz_b, 'Company B Mill', 'Ahmedabad')
  RETURNING id INTO v_party_b;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, tracking_mode, uom, is_active)
  VALUES (v_biz_b, 'S2B-SET-01', 'KalaB', 600, 4, 'SET', 'SET', TRUE)
  RETURNING id INTO v_set_prod_b;

  -- Switch back to Company A for functional tests
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  -- ==================================================================
  -- TEST 1: MWAC Valuation, Idempotency Replay & Backdated Guard
  -- ==================================================================
  v_res := public.intake_set_stock_v2(
    v_biz_a, v_branch_a, v_set_prod_a, v_godown_a, 10, 100.00, CURRENT_DATE - 2, 'Owner', 'Batch 1', 'IN-1',
    '11111111-aaaa-4aaa-8aaa-111111111111'::UUID
  );
  IF (v_res->>'avg_unit_cost')::NUMERIC <> 100 THEN
    RAISE EXCEPTION 'FAIL: Expected MWAC 100, got %', v_res->>'avg_unit_cost';
  END IF;

  -- Idempotency replay returns same result without duplicating stock
  v_res := public.intake_set_stock_v2(
    v_biz_a, v_branch_a, v_set_prod_a, v_godown_a, 10, 100.00, CURRENT_DATE - 2, 'Owner', 'Batch 1', 'IN-1',
    '11111111-aaaa-4aaa-8aaa-111111111111'::UUID
  );
  IF (v_res->>'sets')::INT <> 10 THEN
    RAISE EXCEPTION 'FAIL: Idempotent intake replay duplicated sets: %', v_res->>'sets';
  END IF;

  -- Second intake at ₹200 -> MWAC = (10*100 + 10*200) / 20 = 150
  v_res := public.intake_set_stock_v2(
    v_biz_a, v_branch_a, v_set_prod_a, v_godown_a, 10, 200.00, CURRENT_DATE, 'Owner', 'Batch 2', 'IN-2', NULL
  );
  IF (v_res->>'avg_unit_cost')::NUMERIC <> 150 THEN
    RAISE EXCEPTION 'FAIL: Expected MWAC 150, got %', v_res->>'avg_unit_cost';
  END IF;

  -- Backdated intake (CURRENT_DATE - 1) MUST be rejected
  v_failed := FALSE;
  BEGIN
    PERFORM public.intake_set_stock_v2(
      v_biz_a, v_branch_a, v_set_prod_a, v_godown_a, 5, 300.00, CURRENT_DATE - 1, 'Owner', 'Backdated', 'IN-BACK', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Backdated stock intake was not blocked';
  END IF;

  -- ==================================================================
  -- TEST 2: Legacy intake_stock_tx Preserves Existing MWAC (150)
  -- ==================================================================
  v_res := public.intake_stock_tx(v_set_prod_a, v_godown_a, 4, 'Owner', 'Legacy UI intake', 'IN-LEG-1');
  IF (v_res->>'avg_unit_cost')::NUMERIC <> 150 OR (v_res->>'sets')::INT <> 24 THEN
    RAISE EXCEPTION 'FAIL: Legacy intake diluted MWAC or wrong sets (got %)', v_res;
  END IF;

  -- ==================================================================
  -- TEST 3: Atomic 2-Row Transfer & Zero Partial Changes on Failure
  -- ==================================================================
  v_res := public.transfer_stock_tx(v_set_prod_a, v_godown_a, v_shop_a, 8, 'Owner', 'Move to shop', 'TR-S2-1');
  v_tx_group := (v_res->>'transaction_group_id')::UUID;

  SELECT COUNT(*) INTO v_cnt
  FROM public.stock_ledger
  WHERE business_id = v_biz_a AND transaction_group_id = v_tx_group;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: Expected 2 linked stock_ledger rows for transfer, got %', v_cnt;
  END IF;

  SELECT avg_unit_cost INTO v_avg_cost
  FROM public.inventory_stock
  WHERE business_id = v_biz_a AND product_id = v_set_prod_a AND location_id = v_shop_a;
  IF v_avg_cost <> 150 THEN
    RAISE EXCEPTION 'FAIL: Transfer did not preserve source MWAC (expected 150, got %)', v_avg_cost;
  END IF;

  -- Capture counts before failed over-transfer to confirm zero partial mutations
  SELECT sets INTO v_sets_before
  FROM public.inventory_stock
  WHERE business_id = v_biz_a AND product_id = v_set_prod_a AND location_id = v_godown_a;

  SELECT COUNT(*) INTO v_ledger_before
  FROM public.stock_ledger WHERE business_id = v_biz_a;

  v_failed := FALSE;
  BEGIN
    PERFORM public.transfer_stock_tx(v_set_prod_a, v_godown_a, v_shop_a, 999, 'Owner', 'Over-transfer', 'TR-BAD');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Over-transfer did not fail';
  END IF;

  SELECT sets INTO v_sets_after
  FROM public.inventory_stock
  WHERE business_id = v_biz_a AND product_id = v_set_prod_a AND location_id = v_godown_a;

  SELECT COUNT(*) INTO v_ledger_after
  FROM public.stock_ledger WHERE business_id = v_biz_a;

  IF v_sets_before <> v_sets_after OR v_ledger_before <> v_ledger_after THEN
    RAISE EXCEPTION 'FAIL: Failed transfer left partial stock or ledger mutations';
  END IF;

  -- ==================================================================
  -- TEST 4: Order Confirmation & Reserved Stock Protection
  -- Shop currently has 8 sets. Reserve 5 sets -> only 3 unreserved sets.
  -- ==================================================================
  RESET ROLE;
  UPDATE public.inventory_stock
  SET reserved_sets = 5
  WHERE business_id = v_biz_a AND product_id = v_set_prod_a AND location_id = v_shop_a;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  -- Order for 4 sets (> 3 unreserved) MUST fail
  INSERT INTO public.orders (business_id, branch_id, order_no, party_name, status, total_amount)
  VALUES (v_biz_a, v_branch_a, 'S2-2026-RESV', 'Reserved Check Buyer', 'draft', 8000)
  RETURNING id INTO v_reserved_order_id;

  INSERT INTO public.order_items (business_id, order_id, product_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
  VALUES (v_biz_a, v_reserved_order_id, v_set_prod_a, 'S2-SET-01', 500, 4, 4, 16, 8000);

  v_failed := FALSE;
  BEGIN
    PERFORM public.confirm_order_and_deduct_stock_tx(v_reserved_order_id, v_shop_a, 'Owner');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Order confirmation allowed dispatching reserved stock';
  END IF;

  -- Order for 3 sets (<= 3 unreserved) MUST succeed
  INSERT INTO public.orders (business_id, branch_id, order_no, party_name, status, total_amount)
  VALUES (v_biz_a, v_branch_a, 'S2-2026-0001', 'Stage2 Buyer', 'draft', 6000)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (business_id, order_id, product_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
  VALUES (v_biz_a, v_order_id, v_set_prod_a, 'S2-SET-01', 500, 3, 4, 12, 6000);

  v_res := public.confirm_order_and_deduct_stock_tx(v_order_id, v_shop_a, 'Owner');
  IF (v_res->>'status') <> 'confirmed' THEN
    RAISE EXCEPTION 'FAIL: Order confirmation failed for unreserved stock';
  END IF;

  -- ==================================================================
  -- TEST 5: Taka Receiving, Cross-Tenant Ref Rejection, Chronology & Split
  -- ==================================================================
  -- Cross-tenant supplier_party_id (Company B's party) MUST be rejected
  v_failed := FALSE;
  BEGIN
    PERFORM public.receive_taka_lot_tx(
      v_biz_a, v_branch_a, v_taka_prod_a, v_godown_a, 'LOT-BAD-SUP', 85.00,
      '[{"taka_no":"TK-BAD-1","meters":40}]'::jsonb,
      CURRENT_DATE, NULL, v_party_b, 'INDIGO', 'Cross-tenant supplier', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Cross-tenant supplier_party_id was accepted in receive_taka_lot_tx';
  END IF;

  -- Cross-tenant branch_id (Company B's branch) MUST be rejected
  v_failed := FALSE;
  BEGIN
    PERFORM public.receive_taka_lot_tx(
      v_biz_a, v_branch_b, v_taka_prod_a, v_godown_a, 'LOT-BAD-BR', 85.00,
      '[{"taka_no":"TK-BAD-2","meters":40}]'::jsonb,
      CURRENT_DATE, NULL, v_party_a, 'INDIGO', 'Cross-tenant branch', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Cross-tenant branch_id was accepted in receive_taka_lot_tx';
  END IF;

  -- Valid taka lot receipt dated CURRENT_DATE - 1
  v_res := public.receive_taka_lot_tx(
    v_biz_a, v_branch_a, v_taka_prod_a, v_godown_a, 'LOT-2026-01', 85.00,
    '[{"taka_no":"TK-001","meters":48,"weight_kg":6.4},{"taka_no":"TK-002","meters":42,"weight_kg":5.6}]'::jsonb,
    CURRENT_DATE - 1, NULL, v_party_a, 'INDIGO-01', 'Mill lot receipt', NULL
  );
  IF (v_res->>'taka_count')::INT <> 2 OR (v_res->>'total_meters')::NUMERIC <> 90 THEN
    RAISE EXCEPTION 'FAIL: Taka lot receipt count/meters mismatch: %', v_res;
  END IF;

  v_taka_1 := (v_res->'taka_ids'->>0)::BIGINT;
  v_taka_2 := (v_res->'taka_ids'->>1)::BIGINT;

  -- Backdated taka transfer (CURRENT_DATE - 2 < received_date CURRENT_DATE - 1) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.transfer_taka_tx(v_biz_a, v_taka_2, v_shop_a, CURRENT_DATE - 2, 'Backdated transfer', NULL);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Backdated taka transfer was not blocked';
  END IF;

  -- Valid transfer TK-002 (42m) from GODOWN -> SHOP on CURRENT_DATE
  v_res := public.transfer_taka_tx(v_biz_a, v_taka_2, v_shop_a, CURRENT_DATE, 'Move roll to shop', NULL);
  v_tx_group := (v_res->>'transaction_group_id')::UUID;

  SELECT COUNT(*) INTO v_cnt
  FROM public.stock_ledger
  WHERE business_id = v_biz_a AND transaction_group_id = v_tx_group;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: Taka transfer did not create 2 linked stock_ledger rows';
  END IF;

  -- Backdated taka split (CURRENT_DATE - 2 < received_date) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.split_taka_tx(
      v_biz_a, v_taka_1,
      '[{"taka_no":"TK-001-X","meters":15},{"taka_no":"TK-001-Y","meters":33}]'::jsonb,
      CURRENT_DATE - 2, 'Backdated split', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Backdated taka split was not blocked';
  END IF;

  -- Mismatched split (15 + 30 != 48) MUST fail with zero partial ledger/taka changes
  SELECT COUNT(*) INTO v_ledger_before FROM public.stock_ledger WHERE business_id = v_biz_a;
  v_failed := FALSE;
  BEGIN
    PERFORM public.split_taka_tx(
      v_biz_a, v_taka_1,
      '[{"taka_no":"TK-BAD-A","meters":15},{"taka_no":"TK-BAD-B","meters":30}]'::jsonb,
      CURRENT_DATE, 'Bad split', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Mismatched taka split was accepted';
  END IF;

  SELECT COUNT(*) INTO v_ledger_after FROM public.stock_ledger WHERE business_id = v_biz_a;
  IF v_ledger_before <> v_ledger_after THEN
    RAISE EXCEPTION 'FAIL: Failed split left partial ledger rows';
  END IF;

  -- Valid split: 48m -> 15m + 33m
  v_res := public.split_taka_tx(
    v_biz_a, v_taka_1,
    '[{"taka_no":"TK-001-A","meters":15},{"taka_no":"TK-001-B","meters":33}]'::jsonb,
    CURRENT_DATE, 'Cut 15m for sample', NULL
  );
  v_child_1 := (v_res->'child_taka_ids'->>0)::BIGINT;
  v_child_2 := (v_res->'child_taka_ids'->>1)::BIGINT;

  SELECT COUNT(*) INTO v_cnt
  FROM public.taka_splits
  WHERE business_id = v_biz_a AND parent_taka_id = v_taka_1 AND child_taka_id IN (v_child_1, v_child_2);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: taka_splits lineage rows missing (found %)', v_cnt;
  END IF;

  -- ==================================================================
  -- TEST 6: Direct Write Blocks (stock_ledger, inventory_takas, inventory_stock)
  -- ==================================================================
  v_failed := FALSE;
  BEGIN
    DELETE FROM public.stock_ledger WHERE business_id = v_biz_a;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: stock_ledger allowed DELETE'; END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.inventory_takas (business_id, branch_id, lot_id, product_id, location_id, taka_no, initial_meters, current_meters)
    VALUES (v_biz_a, v_branch_a, 1, v_taka_prod_a, v_godown_a, 'DIRECT-BYPASS', 10, 10);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Direct INSERT into inventory_takas was allowed'; END IF;

  v_failed := FALSE;
  BEGIN
    UPDATE public.inventory_stock SET sets = 9999 WHERE business_id = v_biz_a;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Direct UPDATE on inventory_stock was allowed'; END IF;

  v_failed := FALSE;
  BEGIN
    DELETE FROM public.inventory_stock WHERE business_id = v_biz_a;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Direct DELETE on inventory_stock was allowed'; END IF;

  -- ==================================================================
  -- TEST 7: Read-Only User Cannot Modify product_variants
  -- ==================================================================
  PERFORM set_config('request.jwt.claim.sub', v_readonly_user::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_readonly_user, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.product_variants (business_id, product_id, sku, color_name)
    VALUES (v_biz_a, v_set_prod_a, 'RO-VARIANT-01', 'Red');
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Read-only user was able to insert into product_variants';
  END IF;

  -- ==================================================================
  -- TEST 8: Cross-Tenant Isolation & Multi-Company Fail-Closed
  -- ==================================================================
  -- 8a. Company A-only user supplying Company B's p_business_id MUST fail
  PERFORM set_config('request.jwt.claim.sub', v_user_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  v_failed := FALSE;
  BEGIN
    PERFORM public.intake_set_stock_v2(v_biz_b, v_branch_b, v_set_prod_b, v_godown_b, 5, 100, CURRENT_DATE, 'StaffA', 'Attack', NULL, NULL);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Company A user mutated Company B inventory';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.verify_inventory_integrity(v_biz_b);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Company A user reconciled Company B inventory';
  END IF;

  -- 8b. Multi-company owner with MISSING x-business-id MUST fail closed
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);
  PERFORM set_config('request.headers', '{}'::TEXT, true);

  v_failed := FALSE;
  BEGIN
    PERFORM public.verify_inventory_integrity(v_biz_a);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Multi-company owner did not fail closed with missing x-business-id';
  END IF;

  -- 8c. Multi-company owner with x-business-id = Company A supplying Company B ID MUST fail
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz_a::TEXT)::TEXT, true);

  v_failed := FALSE;
  BEGIN
    PERFORM public.intake_set_stock_v2(v_biz_b, v_branch_b, v_set_prod_b, v_godown_b, 5, 100, CURRENT_DATE, 'Owner', 'Wrong header', NULL, NULL);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Multi-company owner mutated Company B while x-business-id was Company A';
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM public.verify_inventory_integrity(v_biz_b);
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Multi-company owner reconciled Company B while x-business-id was Company A';
  END IF;

  -- ==================================================================
  -- TEST 9: 3-Way Inventory Reconciliation (SET Qty, TAKA Meters, Valuation)
  -- ==================================================================
  v_recon := public.verify_inventory_integrity(v_biz_a);
  IF (v_recon->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 3-way inventory reconciliation failed: %', v_recon;
  END IF;

  -- ==================================================================
  -- TEST 10: Anon & Internal Helper Privilege Guards
  -- ==================================================================
  FOREACH v_fn IN ARRAY v_internal_fns LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: Internal helper % should not be executable by anon/authenticated', v_fn;
    END IF;
  END LOOP;

  SET LOCAL ROLE anon;
  FOREACH v_fn IN ARRAY v_stage2_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on Stage 2 function %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All Stage 2 Hardened Inventory, MWAC, Taka Lineage, Multi-Company Isolation, and 3-Way Reconciliation tests succeeded. Summary: %', v_recon;
END $$;

ROLLBACK;
