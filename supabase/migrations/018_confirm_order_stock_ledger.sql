-- ====================================================================
-- Migration 018: Stage 2 Kala Inventory — Sync Order Confirmation
--                with Unified stock_ledger & Active Company Scope
-- Prerequisite:  017_inventory_rpcs_and_reconciliation.sql
-- ====================================================================

BEGIN;

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
  v_unit_cost NUMERIC(12, 4);
  v_item_pcs INT;
  v_loc_name TEXT;
  v_tx_group UUID := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 1. Lock the parent order row
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

  -- Validate open financial year for dispatch date
  v_fy_id := public.assert_financial_year_open(v_business_id, CURRENT_DATE);

  -- 2. Validate location belongs to the same business & resolve branch_id
  SELECT l.name, l.business_id, COALESCE(l.branch_id, b.id)
  INTO v_loc_name, v_loc_biz, v_branch_id
  FROM public.inventory_locations l
  JOIN public.branches b ON b.business_id = l.business_id AND b.is_default IS TRUE
  WHERE l.id = p_location_id;

  IF v_loc_biz IS NULL OR v_loc_biz <> v_business_id THEN
    RAISE EXCEPTION 'Selected inventory location is not valid for this business';
  END IF;

  -- 3. Lock order_items in deterministic order
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

  -- 4. Lock referenced products in deterministic id order
  PERFORM 1
  FROM public.products p
  WHERE p.id IN (
    SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id = p_order_id
  )
  ORDER BY p.id ASC
  FOR SHARE;

  -- 5. Aggregate required sets per product and lock inventory_stock rows in product_id order
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
    SELECT sets, total_pcs INTO v_avail_sets, v_avail_pcs
    FROM public.inventory_stock
    WHERE business_id = v_business_id
      AND product_id = v_agg.product_id
      AND location_id = p_location_id
    FOR UPDATE;

    IF v_avail_sets IS NULL OR v_avail_sets < v_agg.total_sets_needed OR COALESCE(v_avail_pcs, 0) < v_agg.total_pcs_needed THEN
      RAISE EXCEPTION 'Insufficient stock in % for Design %. Available: % sets (% pcs), Required: % sets (% pcs)',
        COALESCE(v_loc_name, 'location'),
        COALESCE(v_agg.sample_design, v_agg.product_id::TEXT),
        COALESCE(v_avail_sets, 0),
        COALESCE(v_avail_pcs, 0),
        v_agg.total_sets_needed,
        v_agg.total_pcs_needed;
    END IF;
  END LOOP;

  -- 6. Deduct stock, append frozen-cost DISPATCH to stock_ledger, and mirror stock_movements
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

  -- 7. Mark order confirmed & record audit event
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

REVOKE ALL ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
