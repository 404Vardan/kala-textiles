-- ====================================================================
-- Migration 019: Stage 2 Security & Valuation Hardening
-- Prerequisite:  018_confirm_order_stock_ledger.sql
--
-- Fixes Stage 2 audit findings without rewriting migrations 015–018:
--   1. Revoke direct INSERT/UPDATE/DELETE on inventory_stock (SELECT only)
--   2. Enforce p_business_id = current_business_id() on all Stage 2 RPCs
--      including verify_inventory_integrity() (fail closed)
--   3. Add composite FKs & explicit validation for branch, variant,
--      supplier_party_id, and mill_party_id on inventory_lots
--   4. Add internal assert_chronological_taka_date() for taka transfers
--      and splits (checks lot received_date + taka ledger history)
--   5. Preserve existing MWAC in legacy intake_stock_tx, enforce
--      inventory.write RBAC on product_variants, and deduct only
--      unreserved stock (sets - reserved_sets) in order confirmation
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Lock Down Direct Client Writes on inventory_stock
-- Stock projections must only be mutated by trusted SECURITY DEFINER RPCs
-- that simultaneously write to stock_ledger.
-- --------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_stock FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_stock TO authenticated;

DROP POLICY IF EXISTS "members_manage_stock" ON public.inventory_stock;
DROP POLICY IF EXISTS "members_select_inventory_stock" ON public.inventory_stock;

CREATE POLICY "members_select_inventory_stock" ON public.inventory_stock
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 2: Composite Foreign Keys for inventory_lots Party References
-- --------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.parties'::regclass
      AND conname = 'parties_business_id_id_key'
  ) THEN
    ALTER TABLE public.parties
      ADD CONSTRAINT parties_business_id_id_key UNIQUE (business_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_lots'::regclass
      AND conname = 'inventory_lots_business_supplier_fkey'
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD CONSTRAINT inventory_lots_business_supplier_fkey
      FOREIGN KEY (business_id, supplier_party_id)
      REFERENCES public.parties (business_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_lots'::regclass
      AND conname = 'inventory_lots_business_mill_fkey'
  ) THEN
    ALTER TABLE public.inventory_lots
      ADD CONSTRAINT inventory_lots_business_mill_fkey
      FOREIGN KEY (business_id, mill_party_id)
      REFERENCES public.parties (business_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- SECTION 3: Enforce inventory.write RBAC on product_variants Mutations
-- --------------------------------------------------------------------

DROP POLICY IF EXISTS "members_write_product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "members_update_product_variants" ON public.product_variants;

CREATE POLICY "members_write_product_variants" ON public.product_variants
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.has_permission(business_id, 'inventory.write')
  );

CREATE POLICY "members_update_product_variants" ON public.product_variants
  FOR UPDATE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.has_permission(business_id, 'inventory.write')
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.has_permission(business_id, 'inventory.write')
  );

-- --------------------------------------------------------------------
-- SECTION 4: Internal Taka Chronology Guard
-- Blocks transferring or splitting a taka on a date earlier than its
-- lot received_date or its latest posted stock_ledger movement.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_chronological_taka_date(
  p_business_id BIGINT,
  p_taka_id BIGINT,
  p_movement_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_received_date DATE;
  v_latest_taka_date DATE;
BEGIN
  SELECT l.received_date
  INTO v_received_date
  FROM public.inventory_takas t
  JOIN public.inventory_lots l ON l.id = t.lot_id AND l.business_id = t.business_id
  WHERE t.id = p_taka_id
    AND t.business_id = p_business_id;

  IF v_received_date IS NOT NULL AND p_movement_date < v_received_date THEN
    RAISE EXCEPTION 'Backdated taka operation rejected: movement date % precedes lot received date (%).',
      p_movement_date, v_received_date;
  END IF;

  SELECT MAX(sl.movement_date)
  INTO v_latest_taka_date
  FROM public.stock_ledger sl
  WHERE sl.business_id = p_business_id
    AND sl.taka_id = p_taka_id;

  IF v_latest_taka_date IS NOT NULL AND p_movement_date < v_latest_taka_date THEN
    RAISE EXCEPTION 'Backdated taka operation rejected: movement date % precedes latest posted movement (%) for taka %.',
      p_movement_date, v_latest_taka_date, p_taka_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_chronological_taka_date(BIGINT, BIGINT, DATE) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- SECTION 5: Harden intake_set_stock_v2 (Fail-Closed Active Company)
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
  v_active_biz BIGINT;
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

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
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

  v_fy_id := public.assert_financial_year_open(p_business_id, p_movement_date);

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Branch % is not active for business %', p_branch_id, p_business_id;
  END IF;

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

  PERFORM public.assert_chronological_stock_date(p_business_id, p_product_id, p_location_id, p_movement_date);

  SELECT sets, avg_unit_cost
  INTO v_old_sets, v_old_cost
  FROM public.inventory_stock
  WHERE business_id = p_business_id
    AND product_id = p_product_id
    AND location_id = p_location_id
  FOR UPDATE;

  v_old_sets := COALESCE(v_old_sets, 0);
  v_old_cost := COALESCE(v_old_cost, 0);

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
-- SECTION 6: Harden receive_taka_lot_tx (Active Company + Reference Checks)
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
  v_active_biz BIGINT;
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

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.business_id = p_business_id AND b.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Branch % is not active for business %', p_branch_id, p_business_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.business_id = p_business_id) THEN
    RAISE EXCEPTION 'Product % not found in business %', p_product_id, p_business_id;
  END IF;

  IF p_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.id = p_variant_id AND v.business_id = p_business_id AND v.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Variant % not found for product % in business %', p_variant_id, p_product_id, p_business_id;
  END IF;

  IF p_supplier_party_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.parties pt
    WHERE pt.id = p_supplier_party_id AND pt.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Supplier party % not found in business %', p_supplier_party_id, p_business_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = p_location_id AND l.business_id = p_business_id) THEN
    RAISE EXCEPTION 'Location % not found in business %', p_location_id, p_business_id;
  END IF;

  PERFORM public.assert_chronological_stock_date(p_business_id, p_product_id, p_location_id, p_movement_date);

  INSERT INTO public.inventory_lots (
    business_id, branch_id, product_id, variant_id, lot_no,
    supplier_party_id, shade_no, landed_cost_per_unit, received_date, notes
  ) VALUES (
    p_business_id, p_branch_id, p_product_id, p_variant_id, v_lot_no,
    p_supplier_party_id, NULLIF(TRIM(COALESCE(p_shade_no, '')), ''),
    p_landed_cost_per_unit, p_movement_date, p_notes
  )
  RETURNING id INTO v_lot_id;

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
-- SECTION 7: Harden transfer_taka_tx & split_taka_tx
-- Enforces active company isolation and per-taka chronological history.
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
  v_active_biz BIGINT;
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

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
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

  PERFORM public.assert_chronological_taka_date(p_business_id, p_taka_id, p_movement_date);

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
  v_active_biz BIGINT;
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

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
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

  PERFORM public.assert_chronological_taka_date(p_business_id, p_parent_taka_id, p_movement_date);

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
-- SECTION 8: Preserve Existing MWAC in Legacy intake_stock_tx
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
  v_existing_cost NUMERIC(12, 4) := 0;
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

  -- Carry forward existing MWAC when legacy intake omits unit cost
  SELECT COALESCE(avg_unit_cost, 0)
  INTO v_existing_cost
  FROM public.inventory_stock
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_location_id;

  v_existing_cost := COALESCE(v_existing_cost, 0);

  RETURN public.intake_set_stock_v2(
    p_business_id => v_business_id,
    p_branch_id => v_branch_id,
    p_product_id => p_product_id,
    p_location_id => p_location_id,
    p_sets => p_sets,
    p_unit_cost => v_existing_cost,
    p_movement_date => CURRENT_DATE,
    p_staff_name => p_staff_name,
    p_notes => p_notes,
    p_ref_no => p_ref_no,
    p_idempotency_key => NULL
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 9: Enforce Unreserved Stock Only in confirm_order_and_deduct_stock_tx
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_order_and_deduct_stock_tx(
  p_order_id BIGINT,
  p_location_id BIGINT,
  p_staff_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order public.orders%ROWTYPE;
  v_business_id BIGINT;
  v_loc_biz BIGINT;
  v_branch_id BIGINT;
  v_fy_id BIGINT;
  v_item_count INT;
  v_agg RECORD;
  v_item RECORD;
  v_avail_sets INT;
  v_avail_pcs INT;
  v_reserved_sets INT;
  v_unreserved_sets INT;
  v_unreserved_pcs INT;
  v_unit_cost NUMERIC(12, 4);
  v_item_pcs INT;
  v_loc_name TEXT;
  v_tx_group UUID := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_business_id := v_order.business_id;

  IF v_business_id <> public.current_business_id() OR NOT public.has_permission(v_business_id, 'orders.confirm') THEN
    RAISE EXCEPTION 'Unauthorized: missing orders.confirm permission for active business';
  END IF;

  IF COALESCE(v_order.status, 'draft') <> 'draft' THEN
    RAISE EXCEPTION 'Order % cannot be confirmed (current status: %)', v_order.order_no, v_order.status;
  END IF;

  v_fy_id := public.assert_financial_year_open(v_business_id, CURRENT_DATE);

  SELECT l.name, l.business_id, COALESCE(l.branch_id, b.id)
  INTO v_loc_name, v_loc_biz, v_branch_id
  FROM public.inventory_locations l
  JOIN public.branches b ON b.business_id = l.business_id AND b.is_default IS TRUE
  WHERE l.id = p_location_id;

  IF v_loc_biz IS NULL OR v_loc_biz <> v_business_id THEN
    RAISE EXCEPTION 'Selected inventory location is not valid for this business';
  END IF;

  PERFORM 1
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  ORDER BY oi.id ASC
  FOR UPDATE;

  SELECT COUNT(*) INTO v_item_count
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF COALESCE(v_item_count, 0) = 0 THEN
    RAISE EXCEPTION 'Order % has no items to confirm', v_order.order_no;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id
      AND (
        business_id <> v_business_id
        OR product_id IS NULL
        OR sets IS NULL
        OR sets <= 0
      )
  ) THEN
    RAISE EXCEPTION 'Order % contains invalid items', v_order.order_no;
  END IF;

  PERFORM 1
  FROM public.products p
  WHERE p.id IN (
    SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id = p_order_id
  )
  ORDER BY p.id ASC
  FOR SHARE;

  FOR v_agg IN (
    SELECT
      oi.product_id,
      GREATEST(COALESCE(p.pcs_per_set, 1), 1) AS prod_pcs_per_set,
      SUM(oi.sets)::INT AS total_sets_needed,
      SUM(oi.sets * GREATEST(COALESCE(p.pcs_per_set, 1), 1))::INT AS total_pcs_needed,
      MIN(COALESCE(oi.design_no, p.design_no)) AS sample_design
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id, p.pcs_per_set
    ORDER BY oi.product_id ASC
  ) LOOP
    PERFORM public.assert_chronological_stock_date(v_business_id, v_agg.product_id, p_location_id, CURRENT_DATE);

    SELECT sets, total_pcs, COALESCE(reserved_sets, 0)
    INTO v_avail_sets, v_avail_pcs, v_reserved_sets
    FROM public.inventory_stock
    WHERE business_id = v_business_id
      AND product_id = v_agg.product_id
      AND location_id = p_location_id
    FOR UPDATE;

    v_unreserved_sets := COALESCE(v_avail_sets, 0) - COALESCE(v_reserved_sets, 0);
    v_unreserved_pcs := COALESCE(v_avail_pcs, 0) - (COALESCE(v_reserved_sets, 0) * v_agg.prod_pcs_per_set);

    IF v_avail_sets IS NULL OR v_unreserved_sets < v_agg.total_sets_needed OR v_unreserved_pcs < v_agg.total_pcs_needed THEN
      RAISE EXCEPTION 'Insufficient unreserved stock in % for Design %. Available unreserved: % sets (% pcs), Required: % sets (% pcs)',
        COALESCE(v_loc_name, 'location'),
        COALESCE(v_agg.sample_design, v_agg.product_id::TEXT),
        GREATEST(v_unreserved_sets, 0),
        GREATEST(v_unreserved_pcs, 0),
        v_agg.total_sets_needed,
        v_agg.total_pcs_needed;
    END IF;
  END LOOP;

  FOR v_item IN (
    SELECT
      oi.id,
      oi.product_id,
      oi.sets,
      GREATEST(COALESCE(p.pcs_per_set, 1), 1) AS prod_pcs_per_set
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.id ASC
  ) LOOP
    v_item_pcs := v_item.sets * v_item.prod_pcs_per_set;

    SELECT COALESCE(avg_unit_cost, 0) INTO v_unit_cost
    FROM public.inventory_stock
    WHERE business_id = v_business_id
      AND product_id = v_item.product_id
      AND location_id = p_location_id;

    UPDATE public.inventory_stock
    SET sets = sets - v_item.sets,
        total_pcs = total_pcs - v_item_pcs,
        updated_at = NOW()
    WHERE business_id = v_business_id
      AND product_id = v_item.product_id
      AND location_id = p_location_id;

    INSERT INTO public.stock_ledger (
      business_id, branch_id, fy_id, transaction_group_id,
      product_id, location_id, movement_type, movement_date,
      qty_delta, pcs_delta, uom, unit_cost, value_delta,
      ref_doc_type, ref_doc_id, source_document_line_id,
      created_by, posted_at, notes
    ) VALUES (
      v_business_id, v_branch_id, v_fy_id, v_tx_group,
      v_item.product_id, p_location_id, 'DISPATCH', CURRENT_DATE,
      -(v_item.sets::NUMERIC(12, 3)), -v_item_pcs, 'SET', v_unit_cost,
      -ROUND((v_item.sets * v_unit_cost)::NUMERIC, 2),
      'ORDER_CONFIRM', p_order_id, v_item.id,
      v_uid, NOW(), 'Deducted on order confirmation ' || v_order.order_no
    );

    INSERT INTO public.stock_movements (
      business_id, product_id, from_location_id, to_location_id,
      sets, total_pcs, notes, reference_no, staff_name, movement_type, created_at
    ) VALUES (
      v_business_id, v_item.product_id, p_location_id, NULL,
      v_item.sets, v_item_pcs, 'Deducted on order confirmation', v_order.order_no,
      COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'), 'DISPATCH', NOW()
    );
  END LOOP;

  UPDATE public.orders
  SET status = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'),
      updated_at = NOW()
  WHERE id = p_order_id;

  PERFORM public.record_audit_event(
    v_business_id, 'order', p_order_id::TEXT, 'CONFIRM',
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'confirmed', 'order_no', v_order.order_no, 'transaction_group_id', v_tx_group)
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_group_id', v_tx_group,
    'order_no', v_order.order_no,
    'status', 'confirmed'
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 10: Harden verify_inventory_integrity (Fail-Closed Active Company)
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
  v_active_biz BIGINT;
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

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

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
-- SECTION 10B: Fix Ambiguous Column Reference "name" in create_business()
-- (Parameter "name" collided with roles.name in 013_core_rbac_idempotency_audit.sql)
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_business(
  name TEXT,
  slug TEXT,
  settings JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_name TEXT;
  v_slug TEXT;
  v_settings_in JSONB;
  v_gstin TEXT;
  v_state_code CHAR(2);
  v_address TEXT;
  v_whatsapp TEXT;
  v_order_prefix TEXT;
  v_merged_settings JSONB;
  v_biz public.businesses%ROWTYPE;
  v_branch_id BIGINT;
  v_owner_role_id BIGINT;
  v_today DATE := CURRENT_DATE;
  v_start_year INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_name := TRIM(COALESCE(name, ''));
  IF CHAR_LENGTH(v_name) < 2 OR CHAR_LENGTH(v_name) > 120 THEN
    RAISE EXCEPTION 'Business name must be between 2 and 120 characters.';
  END IF;

  v_slug := LOWER(TRIM(COALESCE(slug, '')));
  IF CHAR_LENGTH(v_slug) < 2 OR CHAR_LENGTH(v_slug) > 48 THEN
    RAISE EXCEPTION 'Shop URL slug must be between 2 and 48 characters.';
  END IF;

  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Shop URL slug may only contain lowercase letters, numbers, and single hyphens.';
  END IF;

  IF public.is_reserved_business_slug(v_slug) THEN
    RAISE EXCEPTION 'The slug "%" is reserved and cannot be used.', v_slug;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE LOWER(b.slug) = v_slug
  ) THEN
    RAISE EXCEPTION 'The slug "%" is already in use. Please choose another.', v_slug;
  END IF;

  v_settings_in := COALESCE(settings, '{}'::jsonb);
  IF jsonb_typeof(v_settings_in) <> 'object' THEN
    RAISE EXCEPTION 'Settings must be a JSON object.';
  END IF;

  v_gstin := NULLIF(UPPER(TRIM(COALESCE(v_settings_in->>'gstin', ''))), '');
  IF v_gstin IS NOT NULL THEN
    IF CHAR_LENGTH(v_gstin) > 20 OR v_gstin !~ '^[0-9A-Z-]+$' THEN
      RAISE EXCEPTION 'GSTIN must contain only letters and numbers (max 20 characters).';
    END IF;
    IF v_gstin ~ '^[0-9]{2}' THEN
      v_state_code := SUBSTRING(v_gstin FROM 1 FOR 2);
    END IF;
  END IF;

  v_address := NULLIF(TRIM(COALESCE(v_settings_in->>'address', '')), '');
  IF v_address IS NOT NULL AND CHAR_LENGTH(v_address) > 500 THEN
    RAISE EXCEPTION 'Address cannot exceed 500 characters.';
  END IF;

  v_whatsapp := NULLIF(TRIM(COALESCE(v_settings_in->>'whatsapp_number', '')), '');
  IF v_whatsapp IS NOT NULL THEN
    IF CHAR_LENGTH(v_whatsapp) < 7 OR CHAR_LENGTH(v_whatsapp) > 20 OR v_whatsapp !~ '^[0-9+() .-]+$' THEN
      RAISE EXCEPTION 'WhatsApp number is invalid.';
    END IF;
  END IF;

  v_order_prefix := UPPER(REGEXP_REPLACE(LEFT(v_slug, 3), '[^a-z0-9]', '', 'g'));
  IF CHAR_LENGTH(v_order_prefix) < 2 THEN
    v_order_prefix := 'ORD';
  END IF;

  v_merged_settings := jsonb_strip_nulls(
    jsonb_build_object(
      'order_prefix', v_order_prefix,
      'invoice_prefix', 'INV',
      'gstin', v_gstin,
      'address', v_address,
      'whatsapp_number', v_whatsapp
    )
  );

  INSERT INTO public.businesses (name, slug, settings, created_at, updated_at)
  VALUES (v_name, v_slug, v_merged_settings, NOW(), NOW())
  RETURNING * INTO v_biz;

  PERFORM public.seed_default_business_roles(v_biz.id);
  SELECT r.id INTO v_owner_role_id
  FROM public.roles r
  WHERE r.business_id = v_biz.id AND r.name = 'Owner'
  LIMIT 1;

  INSERT INTO public.memberships (user_id, business_id, role, role_id, created_at)
  VALUES (v_user_id, v_biz.id, 'owner', v_owner_role_id, NOW());

  INSERT INTO public.branches (business_id, code, name, gstin, state_code, address, is_default, is_active)
  VALUES (v_biz.id, 'MAIN', v_name || ' - Main Branch', v_gstin, v_state_code, v_address, TRUE, TRUE)
  RETURNING id INTO v_branch_id;

  v_start_year := CASE
    WHEN EXTRACT(MONTH FROM v_today) >= 4 THEN EXTRACT(YEAR FROM v_today)::INT
    ELSE EXTRACT(YEAR FROM v_today)::INT - 1
  END;

  INSERT INTO public.financial_years (business_id, label, start_date, end_date, is_active, is_locked)
  VALUES (
    v_biz.id,
    'FY ' || v_start_year::TEXT || '-' || RIGHT((v_start_year + 1)::TEXT, 2),
    make_date(v_start_year, 4, 1),
    make_date(v_start_year + 1, 3, 31),
    TRUE,
    FALSE
  );

  INSERT INTO public.inventory_locations (business_id, branch_id, name, description, created_at)
  VALUES
    (v_biz.id, v_branch_id, 'GODOWN', 'Main warehouse / godown', NOW()),
    (v_biz.id, v_branch_id, 'SHOP', 'Retail shop floor', NOW());

  INSERT INTO public.admin_settings (business_id, whatsapp_number, created_at, updated_at)
  VALUES (v_biz.id, COALESCE(v_whatsapp, ''), NOW(), NOW());

  INSERT INTO public.audit_events (business_id, actor_user_id, entity_type, entity_id, action, after_json)
  VALUES (v_biz.id, v_user_id, 'business', v_biz.id::TEXT, 'CREATE', jsonb_build_object('name', v_biz.name, 'slug', v_biz.slug));

  RETURN jsonb_build_object(
    'id', v_biz.id,
    'name', v_biz.name,
    'slug', v_biz.slug,
    'settings', v_biz.settings,
    'created_at', v_biz.created_at,
    'updated_at', v_biz.updated_at
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'The slug "%" is already in use. Please choose another.', v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.create_business(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business(TEXT, TEXT, JSONB) TO authenticated;

-- --------------------------------------------------------------------
-- SECTION 11: Explicit Function Permissions Re-Assertion
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.intake_set_stock_v2(BIGINT, BIGINT, BIGINT, BIGINT, INT, NUMERIC, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_taka_lot_tx(BIGINT, BIGINT, BIGINT, BIGINT, TEXT, NUMERIC, JSONB, DATE, BIGINT, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_taka_tx(BIGINT, BIGINT, BIGINT, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.split_taka_tx(BIGINT, BIGINT, JSONB, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_inventory_integrity(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.intake_set_stock_v2(BIGINT, BIGINT, BIGINT, BIGINT, INT, NUMERIC, DATE, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_taka_lot_tx(BIGINT, BIGINT, BIGINT, BIGINT, TEXT, NUMERIC, JSONB, DATE, BIGINT, BIGINT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_taka_tx(BIGINT, BIGINT, BIGINT, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_taka_tx(BIGINT, BIGINT, JSONB, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_inventory_integrity(BIGINT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

