-- ====================================================================
-- Migration 017: Stage 2 Kala Inventory — Transactional Inventory RPCs,
--                Taka Receiving/Transfer/Splitting & 3-Way Reconciliation
-- Prerequisite:  016_unified_stock_ledger.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Stage 2 Set Stock Intake with MWAC Valuation
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.intake_set_stock_v2(
  p_business_id BIGINT,
  p_branch_id BIGINT,
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_sets INT,
  p_unit_cost NUMERIC DEFAULT 0,
  p_movement_date DATE DEFAULT CURRENT_DATE,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_prod_biz BIGINT;
  v_pcs_per_set INT;
  v_loc_biz BIGINT;
  v_old_sets INT := 0;
  v_old_cost NUMERIC(12, 4) := 0;
  v_new_sets INT;
  v_new_pcs INT;
  v_new_avg_cost NUMERIC(12, 4);
  v_total_pcs INT;
  v_value_delta NUMERIC(14, 2);
  v_tx_group UUID := gen_random_uuid();
  v_ref TEXT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_permission(p_business_id, 'inventory.write') THEN
    RAISE EXCEPTION 'Unauthorized: missing inventory.write permission for business %', p_business_id;
  END IF;

  IF p_sets IS NULL OR p_sets <= 0 THEN
    RAISE EXCEPTION 'Sets must be greater than zero';
  END IF;

  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Unit cost cannot be negative';
  END IF;

  -- Idempotency check (payload-hashed)
  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      COALESCE(p_branch_id::TEXT, '') || ':' || p_product_id::TEXT || ':' ||
      p_location_id::TEXT || ':' || p_sets::TEXT || ':' || p_unit_cost::TEXT || ':' ||
      p_movement_date::TEXT || ':' || COALESCE(p_ref_no, '')
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'INTAKE_SET_V2', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  -- Validate open financial year & branch
  v_fy_id := public.assert_financial_year_open(p_business_id, p_movement_date);

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Branch % is not active for business %', p_branch_id, p_business_id;
  END IF;

  -- Lock product & validate location
  SELECT business_id, GREATEST(COALESCE(pcs_per_set, 1), 1)
  INTO v_prod_biz, v_pcs_per_set
  FROM public.products
  WHERE id = p_product_id
  FOR SHARE;

  IF v_prod_biz IS NULL OR v_prod_biz <> p_business_id THEN
    RAISE EXCEPTION 'Product % not found in business %', p_product_id, p_business_id;
  END IF;

  SELECT business_id INTO v_loc_biz
  FROM public.inventory_locations
  WHERE id = p_location_id;

  IF v_loc_biz IS NULL OR v_loc_biz <> p_business_id THEN
    RAISE EXCEPTION 'Location % not found in business %', p_location_id, p_business_id;
  END IF;

  -- Chronological MWAC posting guard
  PERFORM public.assert_chronological_stock_date(p_business_id, p_product_id, p_location_id, p_movement_date);

  -- Lock existing stock projection row if present
  SELECT sets, avg_unit_cost
  INTO v_old_sets, v_old_cost
  FROM public.inventory_stock
  WHERE business_id = p_business_id
    AND product_id = p_product_id
    AND location_id = p_location_id
  FOR UPDATE;

  v_old_sets := COALESCE(v_old_sets, 0);
  v_old_cost := COALESCE(v_old_cost, 0);

  -- Compute Moving Weighted Average Cost (MWAC)
  v_new_sets := v_old_sets + p_sets;
  IF v_new_sets > 0 THEN
    v_new_avg_cost := ROUND(
      ((v_old_sets * v_old_cost) + (p_sets * p_unit_cost)) / v_new_sets,
      4
    );
  ELSE
    v_new_avg_cost := p_unit_cost;
  END IF;

  v_total_pcs := p_sets * v_pcs_per_set;
  v_value_delta := ROUND((p_sets * p_unit_cost)::NUMERIC, 2);
  v_ref := COALESCE(NULLIF(TRIM(p_ref_no), ''), 'IN-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- Upsert inventory_stock projection
  INSERT INTO public.inventory_stock (
    business_id, product_id, location_id, sets, total_pcs, avg_unit_cost, updated_at
  ) VALUES (
    p_business_id, p_product_id, p_location_id, p_sets, v_total_pcs, v_new_avg_cost, NOW()
  )
  ON CONFLICT (business_id, product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    avg_unit_cost = v_new_avg_cost,
    updated_at = NOW()
  RETURNING sets, total_pcs INTO v_new_sets, v_new_pcs;

  -- Append to unified stock_ledger
  INSERT INTO public.stock_ledger (
    business_id, branch_id, fy_id, transaction_group_id,
    product_id, location_id, movement_type, movement_date,
    qty_delta, pcs_delta, uom, unit_cost, value_delta,
    ref_doc_type, ref_doc_id, idempotency_key, created_by, posted_at, notes
  ) VALUES (
    p_business_id, p_branch_id, v_fy_id, v_tx_group,
    p_product_id, p_location_id, 'INTAKE', p_movement_date,
    p_sets::NUMERIC(12, 3), v_total_pcs, 'SET', p_unit_cost, v_value_delta,
    'STOCK_INTAKE', p_product_id, p_idempotency_key, v_uid, NOW(), p_notes
  );

  -- Mirror to legacy stock_movements for existing dashboard & audit views
  INSERT INTO public.stock_movements (
    business_id, product_id, from_location_id, to_location_id,
    sets, total_pcs, notes, reference_no, staff_name, movement_type, created_at
  ) VALUES (
    p_business_id, p_product_id, NULL, p_location_id,
    p_sets, v_total_pcs, p_notes, v_ref,
    COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'), 'INTAKE', NOW()
  );

  v_result := jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'pcs_per_set', v_pcs_per_set,
    'sets', v_new_sets,
    'total_pcs', v_new_pcs,
    'avg_unit_cost', v_new_avg_cost,
    'reference_no', v_ref
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 2: Receive Serialized Taka Lot RPC
-- Creates inventory_lots + N inventory_takas + stock_ledger entries
-- atomically under one transaction_group_id.
-- p_takas format: [{"taka_no": "TK-001", "meters": 48.5, "weight_kg": 6.2}]
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.receive_taka_lot_tx(
  p_business_id BIGINT,
  p_branch_id BIGINT,
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_lot_no TEXT,
  p_landed_cost_per_unit NUMERIC,
  p_takas JSONB,
  p_movement_date DATE DEFAULT CURRENT_DATE,
  p_variant_id BIGINT DEFAULT NULL,
  p_supplier_party_id BIGINT DEFAULT NULL,
  p_shade_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_lot_no TEXT;
  v_lot_id BIGINT;
  v_tx_group UUID := gen_random_uuid();
  v_elem JSONB;
  v_taka_no TEXT;
  v_meters NUMERIC(10, 2);
  v_weight NUMERIC(10, 3);
  v_taka_id BIGINT;
  v_total_meters NUMERIC(12, 2) := 0;
  v_taka_count INT := 0;
  v_taka_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_permission(p_business_id, 'inventory.write') THEN
    RAISE EXCEPTION 'Unauthorized: missing inventory.write permission for business %', p_business_id;
  END IF;

  v_lot_no := TRIM(COALESCE(p_lot_no, ''));
  IF CHAR_LENGTH(v_lot_no) < 1 OR CHAR_LENGTH(v_lot_no) > 60 THEN
    RAISE EXCEPTION 'Valid lot_no (1-60 chars) is required';
  END IF;

  IF p_landed_cost_per_unit IS NULL OR p_landed_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'landed_cost_per_unit must be >= 0';
  END IF;

  IF p_takas IS NULL OR jsonb_typeof(p_takas) <> 'array' OR jsonb_array_length(p_takas) < 1 THEN
    RAISE EXCEPTION 'p_takas must be a non-empty JSON array';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      p_branch_id::TEXT || ':' || p_product_id::TEXT || ':' || p_location_id::TEXT || ':' ||
      UPPER(v_lot_no) || ':' || p_landed_cost_per_unit::TEXT || ':' || p_takas::TEXT
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'RECEIVE_TAKA_LOT', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_movement_date);

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.business_id = p_business_id) THEN
    RAISE EXCEPTION 'Product % not found in business %', p_product_id, p_business_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = p_location_id AND l.business_id = p_business_id) THEN
    RAISE EXCEPTION 'Location % not found in business %', p_location_id, p_business_id;
  END IF;

  PERFORM public.assert_chronological_stock_date(p_business_id, p_product_id, p_location_id, p_movement_date);

  -- Create lot record
  INSERT INTO public.inventory_lots (
    business_id, branch_id, product_id, variant_id, lot_no,
    supplier_party_id, shade_no, landed_cost_per_unit, received_date, notes
  ) VALUES (
    p_business_id, p_branch_id, p_product_id, p_variant_id, v_lot_no,
    p_supplier_party_id, NULLIF(TRIM(COALESCE(p_shade_no, '')), ''),
    p_landed_cost_per_unit, p_movement_date, p_notes
  )
  RETURNING id INTO v_lot_id;

  -- Insert each serialized taka + ledger row
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_takas) LOOP
    v_taka_no := TRIM(COALESCE(v_elem->>'taka_no', ''));
    v_meters := (v_elem->>'meters')::NUMERIC(10, 2);
    v_weight := NULLIF(TRIM(COALESCE(v_elem->>'weight_kg', '')), '')::NUMERIC(10, 3);

    IF v_taka_no = '' OR v_meters IS NULL OR v_meters <= 0 THEN
      RAISE EXCEPTION 'Each taka must include a valid taka_no and meters > 0';
    END IF;

    INSERT INTO public.inventory_takas (
      business_id, branch_id, lot_id, product_id, variant_id, location_id,
      taka_no, barcode_value, initial_meters, current_meters, weight_kg, status
    ) VALUES (
      p_business_id, p_branch_id, v_lot_id, p_product_id, p_variant_id, p_location_id,
      v_taka_no, v_taka_no, v_meters, v_meters, v_weight, 'in_stock'
    )
    RETURNING id INTO v_taka_id;

    INSERT INTO public.stock_ledger (
      business_id, branch_id, fy_id, transaction_group_id,
      product_id, variant_id, lot_id, taka_id, location_id,
      movement_type, movement_date, qty_delta, pcs_delta, uom,
      unit_cost, value_delta, ref_doc_type, ref_doc_id,
      idempotency_key, created_by, posted_at, notes
    ) VALUES (
      p_business_id, p_branch_id, v_fy_id, v_tx_group,
      p_product_id, p_variant_id, v_lot_id, v_taka_id, p_location_id,
      'INTAKE', p_movement_date, v_meters::NUMERIC(12, 3), 0, 'MTR',
      p_landed_cost_per_unit, ROUND((v_meters * p_landed_cost_per_unit)::NUMERIC, 2),
      'LOT_RECEIPT', v_lot_id, p_idempotency_key, v_uid, NOW(), p_notes
    );

    v_total_meters := v_total_meters + v_meters;
    v_taka_count := v_taka_count + 1;
    v_taka_ids := array_append(v_taka_ids, v_taka_id);
  END LOOP;

  PERFORM public.record_audit_event(
    p_business_id, 'inventory_lot', v_lot_id::TEXT, 'CREATE',
    NULL, jsonb_build_object('lot_no', v_lot_no, 'taka_count', v_taka_count, 'total_meters', v_total_meters)
  );

  v_result := jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'lot_id', v_lot_id,
    'lot_no', v_lot_no,
    'taka_count', v_taka_count,
    'total_meters', v_total_meters,
    'taka_ids', to_jsonb(v_taka_ids)
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: Atomic Taka Transfer (Two Linked Ledger Entries)
-- Emits TRANSFER_OUT (-meters) + TRANSFER_IN (+meters) under one
-- transaction_group_id, preserving exact lot landed_cost_per_unit.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_taka_tx(
  p_business_id BIGINT,
  p_taka_id BIGINT,
  p_to_location_id BIGINT,
  p_movement_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_taka public.inventory_takas%ROWTYPE;
  v_unit_cost NUMERIC(12, 4);
  v_to_branch_id BIGINT;
  v_tx_group UUID := gen_random_uuid();
  v_value_delta NUMERIC(14, 2);
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_permission(p_business_id, 'inventory.transfer') THEN
    RAISE EXCEPTION 'Unauthorized: missing inventory.transfer permission for business %', p_business_id;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(p_taka_id::TEXT || ':' || p_to_location_id::TEXT || ':' || p_movement_date::TEXT);
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'TRANSFER_TAKA', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_movement_date);

  SELECT * INTO v_taka
  FROM public.inventory_takas
  WHERE id = p_taka_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Taka % not found in business %', p_taka_id, p_business_id;
  END IF;

  IF v_taka.status <> 'in_stock' OR v_taka.current_meters <= 0 THEN
    RAISE EXCEPTION 'Taka "%" cannot be transferred (status: %, meters: %)', v_taka.taka_no, v_taka.status, v_taka.current_meters;
  END IF;

  IF v_taka.location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Destination location matches current taka location';
  END IF;

  SELECT COALESCE(l.branch_id, v_taka.branch_id) INTO v_to_branch_id
  FROM public.inventory_locations l
  WHERE l.id = p_to_location_id AND l.business_id = p_business_id;

  IF v_to_branch_id IS NULL THEN
    RAISE EXCEPTION 'Destination location % not found in business %', p_to_location_id, p_business_id;
  END IF;

  SELECT landed_cost_per_unit INTO v_unit_cost
  FROM public.inventory_lots
  WHERE id = v_taka.lot_id;

  v_unit_cost := COALESCE(v_unit_cost, 0);
  v_value_delta := ROUND((v_taka.current_meters * v_unit_cost)::NUMERIC, 2);

  -- Two linked entries sharing one transaction_group_id
  INSERT INTO public.stock_ledger (
    business_id, branch_id, fy_id, transaction_group_id,
    product_id, variant_id, lot_id, taka_id, location_id,
    movement_type, movement_date, qty_delta, pcs_delta, uom,
    unit_cost, value_delta, ref_doc_type, ref_doc_id,
    idempotency_key, created_by, posted_at, notes
  ) VALUES (
    p_business_id, v_taka.branch_id, v_fy_id, v_tx_group,
    v_taka.product_id, v_taka.variant_id, v_taka.lot_id, v_taka.id, v_taka.location_id,
    'TRANSFER_OUT', p_movement_date, -(v_taka.current_meters::NUMERIC(12, 3)), 0, 'MTR',
    v_unit_cost, -v_value_delta, 'TAKA_TRANSFER', v_taka.id,
    p_idempotency_key, v_uid, NOW(), p_notes
  );

  INSERT INTO public.stock_ledger (
    business_id, branch_id, fy_id, transaction_group_id,
    product_id, variant_id, lot_id, taka_id, location_id,
    movement_type, movement_date, qty_delta, pcs_delta, uom,
    unit_cost, value_delta, ref_doc_type, ref_doc_id,
    idempotency_key, created_by, posted_at, notes
  ) VALUES (
    p_business_id, v_to_branch_id, v_fy_id, v_tx_group,
    v_taka.product_id, v_taka.variant_id, v_taka.lot_id, v_taka.id, p_to_location_id,
    'TRANSFER_IN', p_movement_date, v_taka.current_meters::NUMERIC(12, 3), 0, 'MTR',
    v_unit_cost, v_value_delta, 'TAKA_TRANSFER', v_taka.id,
    p_idempotency_key, v_uid, NOW(), p_notes
  );

  UPDATE public.inventory_takas
  SET location_id = p_to_location_id,
      branch_id = v_to_branch_id,
      updated_at = NOW()
  WHERE id = v_taka.id;

  v_result := jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'taka_id', v_taka.id,
    'from_location_id', v_taka.location_id,
    'to_location_id', p_to_location_id,
    'meters', v_taka.current_meters,
    'unit_cost', v_unit_cost
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 4: Taka Splitting with Explicit Parent-Child Lineage
-- Splits a roll (e.g. 48m -> 15m + 33m), preserves full lineage in
-- inventory_takas.parent_taka_id and taka_splits, and writes balanced
-- SPLIT_OUT / SPLIT_IN entries in stock_ledger at exact lot cost.
-- p_splits format: [{"taka_no": "TK-001-A", "meters": 15}, {"taka_no": "TK-001-B", "meters": 33}]
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.split_taka_tx(
  p_business_id BIGINT,
  p_parent_taka_id BIGINT,
  p_splits JSONB,
  p_movement_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_parent public.inventory_takas%ROWTYPE;
  v_unit_cost NUMERIC(12, 4);
  v_tx_group UUID := gen_random_uuid();
  v_elem JSONB;
  v_sum_meters NUMERIC(10, 2) := 0;
  v_child_no TEXT;
  v_child_meters NUMERIC(10, 2);
  v_child_id BIGINT;
  v_child_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_permission(p_business_id, 'inventory.write') THEN
    RAISE EXCEPTION 'Unauthorized: missing inventory.write permission for business %', p_business_id;
  END IF;

  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) < 2 THEN
    RAISE EXCEPTION 'Splitting a taka requires at least 2 child rolls in p_splits';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(p_parent_taka_id::TEXT || ':' || p_splits::TEXT || ':' || p_movement_date::TEXT);
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'SPLIT_TAKA', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_movement_date);

  SELECT * INTO v_parent
  FROM public.inventory_takas
  WHERE id = p_parent_taka_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent taka % not found in business %', p_parent_taka_id, p_business_id;
  END IF;

  IF v_parent.status <> 'in_stock' OR v_parent.current_meters <= 0 THEN
    RAISE EXCEPTION 'Parent taka "%" cannot be split (status: %, meters: %)', v_parent.taka_no, v_parent.status, v_parent.current_meters;
  END IF;

  -- Validate sum of split meters equals parent current_meters exactly
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_splits) LOOP
    v_child_no := TRIM(COALESCE(v_elem->>'taka_no', ''));
    v_child_meters := (v_elem->>'meters')::NUMERIC(10, 2);
    IF v_child_no = '' OR v_child_meters IS NULL OR v_child_meters <= 0 THEN
      RAISE EXCEPTION 'Each split entry must specify a valid taka_no and meters > 0';
    END IF;
    v_sum_meters := v_sum_meters + v_child_meters;
  END LOOP;

  IF v_sum_meters <> v_parent.current_meters THEN
    RAISE EXCEPTION 'Split total (% m) must exactly equal parent taka current meters (% m)', v_sum_meters, v_parent.current_meters;
  END IF;

  SELECT landed_cost_per_unit INTO v_unit_cost
  FROM public.inventory_lots
  WHERE id = v_parent.lot_id;
  v_unit_cost := COALESCE(v_unit_cost, 0);

  -- 1. Consume parent taka in ledger & mark status = 'split'
  INSERT INTO public.stock_ledger (
    business_id, branch_id, fy_id, transaction_group_id,
    product_id, variant_id, lot_id, taka_id, location_id,
    movement_type, movement_date, qty_delta, pcs_delta, uom,
    unit_cost, value_delta, ref_doc_type, ref_doc_id,
    idempotency_key, created_by, posted_at, notes
  ) VALUES (
    p_business_id, v_parent.branch_id, v_fy_id, v_tx_group,
    v_parent.product_id, v_parent.variant_id, v_parent.lot_id, v_parent.id, v_parent.location_id,
    'SPLIT_OUT', p_movement_date, -(v_parent.current_meters::NUMERIC(12, 3)), 0, 'MTR',
    v_unit_cost, -ROUND((v_parent.current_meters * v_unit_cost)::NUMERIC, 2),
    'TAKA_SPLIT', v_parent.id, p_idempotency_key, v_uid, NOW(), p_notes
  );

  UPDATE public.inventory_takas
  SET current_meters = 0,
      status = 'split',
      updated_at = NOW()
  WHERE id = v_parent.id;

  -- 2. Create child takas, lineage rows, and SPLIT_IN ledger entries
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_splits) LOOP
    v_child_no := TRIM(v_elem->>'taka_no');
    v_child_meters := (v_elem->>'meters')::NUMERIC(10, 2);

    INSERT INTO public.inventory_takas (
      business_id, branch_id, lot_id, parent_taka_id, product_id, variant_id, location_id,
      taka_no, barcode_value, initial_meters, current_meters, status
    ) VALUES (
      p_business_id, v_parent.branch_id, v_parent.lot_id, v_parent.id,
      v_parent.product_id, v_parent.variant_id, v_parent.location_id,
      v_child_no, v_child_no, v_child_meters, v_child_meters, 'in_stock'
    )
    RETURNING id INTO v_child_id;

    INSERT INTO public.taka_splits (
      business_id, parent_taka_id, child_taka_id, meters_allocated, transaction_group_id, created_by
    ) VALUES (
      p_business_id, v_parent.id, v_child_id, v_child_meters, v_tx_group, v_uid
    );

    INSERT INTO public.stock_ledger (
      business_id, branch_id, fy_id, transaction_group_id,
      product_id, variant_id, lot_id, taka_id, location_id,
      movement_type, movement_date, qty_delta, pcs_delta, uom,
      unit_cost, value_delta, ref_doc_type, ref_doc_id,
      idempotency_key, created_by, posted_at, notes
    ) VALUES (
      p_business_id, v_parent.branch_id, v_fy_id, v_tx_group,
      v_parent.product_id, v_parent.variant_id, v_parent.lot_id, v_child_id, v_parent.location_id,
      'SPLIT_IN', p_movement_date, v_child_meters::NUMERIC(12, 3), 0, 'MTR',
      v_unit_cost, ROUND((v_child_meters * v_unit_cost)::NUMERIC, 2),
      'TAKA_SPLIT', v_parent.id, p_idempotency_key, v_uid, NOW(), p_notes
    );

    v_child_ids := array_append(v_child_ids, v_child_id);
  END LOOP;

  PERFORM public.record_audit_event(
    p_business_id, 'inventory_taka', v_parent.id::TEXT, 'SPLIT',
    jsonb_build_object('taka_no', v_parent.taka_no, 'meters', v_parent.current_meters),
    jsonb_build_object('child_taka_ids', to_jsonb(v_child_ids))
  );

  v_result := jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'parent_taka_id', v_parent.id,
    'child_taka_ids', to_jsonb(v_child_ids)
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 5: Upgrade Legacy intake_stock_tx, transfer_stock_tx &
--            confirm_order_and_deduct_stock_tx to Write to stock_ledger
--            and Enforce Active Company Scope (current_business_id())
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.intake_stock_tx(
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_sets INT,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id BIGINT;
  v_branch_id BIGINT;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.products
  WHERE id = p_product_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_business_id <> public.current_business_id() THEN
    RAISE EXCEPTION 'Unauthorized: product does not belong to the active business';
  END IF;

  SELECT COALESCE(l.branch_id, b.id) INTO v_branch_id
  FROM public.inventory_locations l
  JOIN public.branches b ON b.business_id = l.business_id AND b.is_default IS TRUE
  WHERE l.id = p_location_id AND l.business_id = v_business_id
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Invalid destination location for this business';
  END IF;

  RETURN public.intake_set_stock_v2(
    p_business_id => v_business_id,
    p_branch_id => v_branch_id,
    p_product_id => p_product_id,
    p_location_id => p_location_id,
    p_sets => p_sets,
    p_unit_cost => 0,
    p_movement_date => CURRENT_DATE,
    p_staff_name => p_staff_name,
    p_notes => p_notes,
    p_ref_no => p_ref_no,
    p_idempotency_key => NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_stock_tx(
  p_product_id BIGINT,
  p_from_location_id BIGINT,
  p_to_location_id BIGINT,
  p_sets INT,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_business_id BIGINT;
  v_from_biz BIGINT;
  v_to_biz BIGINT;
  v_from_branch BIGINT;
  v_to_branch BIGINT;
  v_fy_id BIGINT;
  v_pcs_per_set INT;
  v_total_pcs INT;
  v_current_sets INT;
  v_current_pcs INT;
  v_source_cost NUMERIC(12, 4);
  v_dest_old_sets INT := 0;
  v_dest_old_cost NUMERIC(12, 4) := 0;
  v_dest_new_cost NUMERIC(12, 4);
  v_value_delta NUMERIC(14, 2);
  v_tx_group UUID := gen_random_uuid();
  v_ref TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations cannot be identical';
  END IF;

  IF p_sets IS NULL OR p_sets <= 0 THEN
    RAISE EXCEPTION 'Transfer sets must be greater than zero';
  END IF;

  SELECT business_id, GREATEST(COALESCE(pcs_per_set, 1), 1)
  INTO v_business_id, v_pcs_per_set
  FROM public.products
  WHERE id = p_product_id
  FOR SHARE;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_business_id <> public.current_business_id() OR NOT public.has_permission(v_business_id, 'inventory.transfer') THEN
    RAISE EXCEPTION 'Unauthorized: missing transfer permission for active business';
  END IF;

  v_fy_id := public.assert_financial_year_open(v_business_id, CURRENT_DATE);

  SELECT l.business_id, COALESCE(l.branch_id, b.id)
  INTO v_from_biz, v_from_branch
  FROM public.inventory_locations l
  JOIN public.branches b ON b.business_id = l.business_id AND b.is_default IS TRUE
  WHERE l.id = p_from_location_id;

  SELECT l.business_id, COALESCE(l.branch_id, b.id)
  INTO v_to_biz, v_to_branch
  FROM public.inventory_locations l
  JOIN public.branches b ON b.business_id = l.business_id AND b.is_default IS TRUE
  WHERE l.id = p_to_location_id;

  IF v_from_biz IS NULL OR v_to_biz IS NULL OR v_from_biz <> v_business_id OR v_to_biz <> v_business_id THEN
    RAISE EXCEPTION 'Locations must belong to the same business as the product';
  END IF;

  v_total_pcs := p_sets * v_pcs_per_set;
  v_ref := COALESCE(NULLIF(TRIM(p_ref_no), ''), 'TR-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- Lock source & destination rows in deterministic location_id order (deadlock-free)
  PERFORM 1
  FROM public.inventory_stock
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id IN (p_from_location_id, p_to_location_id)
  ORDER BY location_id ASC
  FOR UPDATE;

  SELECT sets, total_pcs, avg_unit_cost
  INTO v_current_sets, v_current_pcs, v_source_cost
  FROM public.inventory_stock
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_from_location_id;

  IF v_current_sets IS NULL OR v_current_sets < p_sets OR COALESCE(v_current_pcs, 0) < v_total_pcs THEN
    RAISE EXCEPTION 'Insufficient stock. Available: % sets (% pcs), Requested: % sets (% pcs)',
      COALESCE(v_current_sets, 0), COALESCE(v_current_pcs, 0), p_sets, v_total_pcs;
  END IF;

  v_source_cost := COALESCE(v_source_cost, 0);
  v_value_delta := ROUND((p_sets * v_source_cost)::NUMERIC, 2);

  -- Compute destination MWAC preserving source inventory cost
  SELECT sets, avg_unit_cost
  INTO v_dest_old_sets, v_dest_old_cost
  FROM public.inventory_stock
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_to_location_id;

  v_dest_old_sets := COALESCE(v_dest_old_sets, 0);
  v_dest_old_cost := COALESCE(v_dest_old_cost, 0);
  v_dest_new_cost := ROUND(
    ((v_dest_old_sets * v_dest_old_cost) + (p_sets * v_source_cost)) / (v_dest_old_sets + p_sets),
    4
  );

  -- Subtract from source
  UPDATE public.inventory_stock
  SET sets = sets - p_sets,
      total_pcs = total_pcs - v_total_pcs,
      updated_at = NOW()
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_from_location_id;

  -- Add to destination preserving cost
  INSERT INTO public.inventory_stock (
    business_id, product_id, location_id, sets, total_pcs, avg_unit_cost, updated_at
  ) VALUES (
    v_business_id, p_product_id, p_to_location_id, p_sets, v_total_pcs, v_dest_new_cost, NOW()
  )
  ON CONFLICT (business_id, product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    avg_unit_cost = v_dest_new_cost,
    updated_at = NOW();

  -- Two linked stock_ledger entries under one transaction_group_id
  INSERT INTO public.stock_ledger (
    business_id, branch_id, fy_id, transaction_group_id,
    product_id, location_id, movement_type, movement_date,
    qty_delta, pcs_delta, uom, unit_cost, value_delta,
    ref_doc_type, ref_doc_id, created_by, posted_at, notes
  ) VALUES
    (
      v_business_id, v_from_branch, v_fy_id, v_tx_group,
      p_product_id, p_from_location_id, 'TRANSFER_OUT', CURRENT_DATE,
      -(p_sets::NUMERIC(12, 3)), -v_total_pcs, 'SET', v_source_cost, -v_value_delta,
      'STOCK_TRANSFER', p_product_id, v_uid, NOW(), p_notes
    ),
    (
      v_business_id, v_to_branch, v_fy_id, v_tx_group,
      p_product_id, p_to_location_id, 'TRANSFER_IN', CURRENT_DATE,
      p_sets::NUMERIC(12, 3), v_total_pcs, 'SET', v_source_cost, v_value_delta,
      'STOCK_TRANSFER', p_product_id, v_uid, NOW(), p_notes
    );

  -- Mirror to legacy stock_movements
  INSERT INTO public.stock_movements (
    business_id, product_id, from_location_id, to_location_id,
    sets, total_pcs, notes, reference_no, staff_name, movement_type, created_at
  ) VALUES (
    v_business_id, p_product_id, p_from_location_id, p_to_location_id,
    p_sets, v_total_pcs, p_notes, v_ref,
    COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'), 'TRANSFER', NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'reference_no', v_ref,
    'pcs_per_set', v_pcs_per_set,
    'transferred_sets', p_sets,
    'transferred_pcs', v_total_pcs,
    'unit_cost', v_source_cost
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 6: 3-Way Inventory Reconciliation RPC
-- Separately verifies:
--   1. SET quantity projection vs stock_ledger
--   2. Physical TAKA meter projection vs stock_ledger
--   3. Total inventory valuation vs stock_ledger.value_delta
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_inventory_integrity(
  p_business_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set_mismatches INT;
  v_taka_mismatches INT;
  v_ledger_value NUMERIC(14, 2);
  v_set_proj_value NUMERIC(14, 2);
  v_taka_proj_value NUMERIC(14, 2);
  v_proj_value NUMERIC(14, 2);
  v_value_diff NUMERIC(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  -- 1. Reconcile SET quantities per (product_id, location_id)
  WITH ledger_sets AS (
    SELECT product_id, location_id, COALESCE(SUM(qty_delta), 0) AS ledger_qty
    FROM public.stock_ledger
    WHERE business_id = p_business_id
      AND uom = 'SET'
      AND taka_id IS NULL
    GROUP BY product_id, location_id
  ),
  proj_sets AS (
    SELECT product_id, location_id, sets::NUMERIC(12, 3) AS proj_qty
    FROM public.inventory_stock
    WHERE business_id = p_business_id
  )
  SELECT COUNT(*) INTO v_set_mismatches
  FROM ledger_sets l
  FULL OUTER JOIN proj_sets p
    ON l.product_id = p.product_id AND l.location_id = p.location_id
  WHERE COALESCE(l.ledger_qty, 0) <> COALESCE(p.proj_qty, 0);

  -- 2. Reconcile physical TAKA meters per taka_id
  WITH ledger_takas AS (
    SELECT taka_id, COALESCE(SUM(qty_delta), 0) AS ledger_meters
    FROM public.stock_ledger
    WHERE business_id = p_business_id
      AND taka_id IS NOT NULL
    GROUP BY taka_id
  ),
  proj_takas AS (
    SELECT id AS taka_id, current_meters::NUMERIC(12, 3) AS proj_meters
    FROM public.inventory_takas
    WHERE business_id = p_business_id
  )
  SELECT COUNT(*) INTO v_taka_mismatches
  FROM ledger_takas l
  FULL OUTER JOIN proj_takas p ON l.taka_id = p.taka_id
  WHERE COALESCE(l.ledger_meters, 0) <> COALESCE(p.proj_meters, 0);

  -- 3. Reconcile total valuation
  SELECT COALESCE(SUM(value_delta), 0)
  INTO v_ledger_value
  FROM public.stock_ledger
  WHERE business_id = p_business_id;

  SELECT COALESCE(SUM(ROUND((sets * avg_unit_cost)::NUMERIC, 2)), 0)
  INTO v_set_proj_value
  FROM public.inventory_stock
  WHERE business_id = p_business_id;

  SELECT COALESCE(SUM(ROUND((t.current_meters * l.landed_cost_per_unit)::NUMERIC, 2)), 0)
  INTO v_taka_proj_value
  FROM public.inventory_takas t
  JOIN public.inventory_lots l ON l.id = t.lot_id
  WHERE t.business_id = p_business_id
    AND t.current_meters > 0;

  v_proj_value := v_set_proj_value + v_taka_proj_value;
  v_value_diff := ABS(v_ledger_value - v_proj_value);

  RETURN jsonb_build_object(
    'balanced', (v_set_mismatches = 0 AND v_taka_mismatches = 0 AND v_value_diff <= 1.00),
    'set_mismatches', v_set_mismatches,
    'taka_mismatches', v_taka_mismatches,
    'ledger_value', v_ledger_value,
    'projection_value', v_proj_value,
    'value_diff', v_value_diff
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 7: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.intake_set_stock_v2(BIGINT, BIGINT, BIGINT, BIGINT, INT, NUMERIC, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_taka_lot_tx(BIGINT, BIGINT, BIGINT, BIGINT, TEXT, NUMERIC, JSONB, DATE, BIGINT, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_taka_tx(BIGINT, BIGINT, BIGINT, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.split_taka_tx(BIGINT, BIGINT, JSONB, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_inventory_integrity(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.intake_set_stock_v2(BIGINT, BIGINT, BIGINT, BIGINT, INT, NUMERIC, DATE, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_taka_lot_tx(BIGINT, BIGINT, BIGINT, BIGINT, TEXT, NUMERIC, JSONB, DATE, BIGINT, BIGINT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_taka_tx(BIGINT, BIGINT, BIGINT, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_taka_tx(BIGINT, BIGINT, JSONB, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_inventory_integrity(BIGINT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
