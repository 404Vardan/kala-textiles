-- ====================================================================
-- Stage 2 Kala Inventory — Automated Verification & Exit Gate Suite
-- File: supabase/tests/stage2_inventory.sql
--
-- Prerequisites:
--   Migrations 001 through 018 must be applied before running.
--
-- Behavior:
--   Runs inside BEGIN ... ROLLBACK so zero test data is persisted.
-- ====================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID := 'dddddddd-1111-4111-8111-111111111111';
  v_biz BIGINT;
  v_branch BIGINT;
  v_godown BIGINT;
  v_shop BIGINT;

  v_set_prod BIGINT;
  v_taka_prod BIGINT;
  v_order_id BIGINT;

  v_res JSONB;
  v_tx_group UUID;
  v_taka_1 BIGINT;
  v_taka_2 BIGINT;
  v_child_1 BIGINT;
  v_child_2 BIGINT;
  v_avg_cost NUMERIC;
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
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Seed Owner, Business, Locations & Products
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@stage2.test', 'hash', NOW(), NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::TEXT, true);

  v_biz := (public.create_business('Stage2 Looms', 'stage2-looms', '{}'::jsonb)->>'id')::BIGINT;
  PERFORM set_config('request.headers', json_build_object('x-business-id', v_biz::TEXT)::TEXT, true);

  SELECT id INTO v_branch FROM public.branches WHERE business_id = v_biz AND is_default IS TRUE LIMIT 1;
  SELECT id INTO v_godown FROM public.inventory_locations WHERE business_id = v_biz AND LOWER(name) = 'godown' LIMIT 1;
  SELECT id INTO v_shop FROM public.inventory_locations WHERE business_id = v_biz AND LOWER(name) = 'shop' LIMIT 1;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, tracking_mode, uom, is_active)
  VALUES (v_biz, 'S2-SET-01', 'Kala', 500, 4, 'SET', 'SET', TRUE)
  RETURNING id INTO v_set_prod;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, tracking_mode, uom, is_active)
  VALUES (v_biz, 'S2-TAKA-01', 'Kala', 120, 1, 'TAKA', 'MTR', TRUE)
  RETURNING id INTO v_taka_prod;

  -- ==================================================================
  -- TEST 1: MWAC Valuation & Chronological Backdated Posting Guard
  -- ==================================================================
  v_res := public.intake_set_stock_v2(
    v_biz, v_branch, v_set_prod, v_godown, 10, 100.00, CURRENT_DATE - 2, 'Owner', 'Batch 1', 'IN-1',
    '11111111-aaaa-4aaa-8aaa-111111111111'::UUID
  );
  IF (v_res->>'avg_unit_cost')::NUMERIC <> 100 THEN
    RAISE EXCEPTION 'FAIL: Expected MWAC 100, got %', v_res->>'avg_unit_cost';
  END IF;

  -- Idempotency replay returns same result without duplicating stock
  v_res := public.intake_set_stock_v2(
    v_biz, v_branch, v_set_prod, v_godown, 10, 100.00, CURRENT_DATE - 2, 'Owner', 'Batch 1', 'IN-1',
    '11111111-aaaa-4aaa-8aaa-111111111111'::UUID
  );
  IF (v_res->>'sets')::INT <> 10 THEN
    RAISE EXCEPTION 'FAIL: Idempotent intake replay duplicated sets: %', v_res->>'sets';
  END IF;

  -- Second intake at ₹200 -> MWAC = (10*100 + 10*200) / 20 = 150
  v_res := public.intake_set_stock_v2(
    v_biz, v_branch, v_set_prod, v_godown, 10, 200.00, CURRENT_DATE, 'Owner', 'Batch 2', 'IN-2', NULL
  );
  IF (v_res->>'avg_unit_cost')::NUMERIC <> 150 THEN
    RAISE EXCEPTION 'FAIL: Expected MWAC 150, got %', v_res->>'avg_unit_cost';
  END IF;

  -- Backdated intake (CURRENT_DATE - 1) MUST be rejected
  v_failed := FALSE;
  BEGIN
    PERFORM public.intake_set_stock_v2(
      v_biz, v_branch, v_set_prod, v_godown, 5, 300.00, CURRENT_DATE - 1, 'Owner', 'Backdated', 'IN-BACK', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Backdated stock intake was not blocked';
  END IF;

  -- ==================================================================
  -- TEST 2: Atomic 2-Row Transfer Preserving Source Cost & Negative Guard
  -- ==================================================================
  v_res := public.transfer_stock_tx(v_set_prod, v_godown, v_shop, 5, 'Owner', 'Move to shop', 'TR-S2-1');
  v_tx_group := (v_res->>'transaction_group_id')::UUID;

  SELECT COUNT(*) INTO v_cnt
  FROM public.stock_ledger
  WHERE business_id = v_biz AND transaction_group_id = v_tx_group;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: Expected 2 linked stock_ledger rows for transfer, got %', v_cnt;
  END IF;

  SELECT avg_unit_cost INTO v_avg_cost
  FROM public.inventory_stock
  WHERE business_id = v_biz AND product_id = v_set_prod AND location_id = v_shop;
  IF v_avg_cost <> 150 THEN
    RAISE EXCEPTION 'FAIL: Transfer did not preserve source MWAC (expected 150, got %)', v_avg_cost;
  END IF;

  -- Negative stock guard: transferring 999 sets fails
  v_failed := FALSE;
  BEGIN
    PERFORM public.transfer_stock_tx(v_set_prod, v_godown, v_shop, 999, 'Owner', 'Over-transfer', 'TR-BAD');
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Over-transfer did not fail';
  END IF;

  -- ==================================================================
  -- TEST 3: Order Confirmation Writes Frozen-Cost DISPATCH to stock_ledger
  -- ==================================================================
  INSERT INTO public.orders (business_id, branch_id, order_no, party_name, status, total_amount)
  VALUES (v_biz, v_branch, 'S2-2026-0001', 'Stage2 Buyer', 'draft', 6000)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (business_id, order_id, product_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
  VALUES (v_biz, v_order_id, v_set_prod, 'S2-SET-01', 500, 3, 4, 12, 6000);

  v_res := public.confirm_order_and_deduct_stock_tx(v_order_id, v_shop, 'Owner');
  IF (v_res->>'status') <> 'confirmed' THEN
    RAISE EXCEPTION 'FAIL: Order confirmation failed';
  END IF;

  -- ==================================================================
  -- TEST 4: Serialized Taka Receiving, Transfer & Split Lineage
  -- ==================================================================
  v_res := public.receive_taka_lot_tx(
    v_biz, v_branch, v_taka_prod, v_godown, 'LOT-2026-01', 85.00,
    '[{"taka_no":"TK-001","meters":48,"weight_kg":6.4},{"taka_no":"TK-002","meters":42,"weight_kg":5.6}]'::jsonb,
    CURRENT_DATE, NULL, NULL, 'INDIGO-01', 'Mill lot receipt', NULL
  );
  IF (v_res->>'taka_count')::INT <> 2 OR (v_res->>'total_meters')::NUMERIC <> 90 THEN
    RAISE EXCEPTION 'FAIL: Taka lot receipt count/meters mismatch: %', v_res;
  END IF;

  v_taka_1 := (v_res->'taka_ids'->>0)::BIGINT;
  v_taka_2 := (v_res->'taka_ids'->>1)::BIGINT;

  -- Transfer TK-002 (42m) from GODOWN -> SHOP
  v_res := public.transfer_taka_tx(v_biz, v_taka_2, v_shop, CURRENT_DATE, 'Move roll to shop', NULL);
  v_tx_group := (v_res->>'transaction_group_id')::UUID;

  SELECT COUNT(*) INTO v_cnt
  FROM public.stock_ledger
  WHERE business_id = v_biz AND transaction_group_id = v_tx_group;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: Taka transfer did not create 2 linked stock_ledger rows';
  END IF;

  -- Split mismatch (15 + 30 != 48) MUST fail
  v_failed := FALSE;
  BEGIN
    PERFORM public.split_taka_tx(
      v_biz, v_taka_1,
      '[{"taka_no":"TK-BAD-A","meters":15},{"taka_no":"TK-BAD-B","meters":30}]'::jsonb,
      CURRENT_DATE, 'Bad split', NULL
    );
  EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Mismatched taka split was accepted';
  END IF;

  -- Valid split: 48m -> 15m + 33m
  v_res := public.split_taka_tx(
    v_biz, v_taka_1,
    '[{"taka_no":"TK-001-A","meters":15},{"taka_no":"TK-001-B","meters":33}]'::jsonb,
    CURRENT_DATE, 'Cut 15m for sample', NULL
  );
  v_child_1 := (v_res->'child_taka_ids'->>0)::BIGINT;
  v_child_2 := (v_res->'child_taka_ids'->>1)::BIGINT;

  SELECT COUNT(*) INTO v_cnt
  FROM public.taka_splits
  WHERE business_id = v_biz AND parent_taka_id = v_taka_1 AND child_taka_id IN (v_child_1, v_child_2);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: taka_splits lineage rows missing (found %)', v_cnt;
  END IF;

  -- ==================================================================
  -- TEST 5: Immutability & Direct Write Guards
  -- ==================================================================
  v_failed := FALSE;
  BEGIN
    DELETE FROM public.stock_ledger WHERE business_id = v_biz;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: stock_ledger allowed DELETE'; END IF;

  v_failed := FALSE;
  BEGIN
    INSERT INTO public.inventory_takas (business_id, branch_id, lot_id, product_id, location_id, taka_no, initial_meters, current_meters)
    VALUES (v_biz, v_branch, 1, v_taka_prod, v_godown, 'DIRECT-BYPASS', 10, 10);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Direct INSERT into inventory_takas was allowed'; END IF;

  -- ==================================================================
  -- TEST 6: 3-Way Inventory Reconciliation (SET Qty, TAKA Meters, Valuation)
  -- ==================================================================
  v_recon := public.verify_inventory_integrity(v_biz);
  IF (v_recon->>'balanced')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 3-way inventory reconciliation failed: %', v_recon;
  END IF;

  -- ==================================================================
  -- TEST 7: Anon Privilege Guards
  -- ==================================================================
  SET LOCAL ROLE anon;
  FOREACH v_fn IN ARRAY v_stage2_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on Stage 2 function %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: All Stage 2 Unified Inventory, MWAC, Taka Lineage, and 3-Way Reconciliation tests succeeded. Summary: %', v_recon;
END $$;

ROLLBACK;
