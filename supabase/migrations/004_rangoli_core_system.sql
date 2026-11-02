-- ====================================================================
-- Migration 004: Rangoli Core System Enhancements
-- Parties, Agents, Order Status Lifecycle, Transactional Inventory RPCs
-- ====================================================================

-- 1. Parties Directory
CREATE TABLE IF NOT EXISTS parties (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT UNIQUE NOT NULL,
  station TEXT,
  gst_number TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);
CREATE INDEX IF NOT EXISTS idx_parties_station ON parties(station);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_parties" ON parties FOR SELECT USING (true);
CREATE POLICY "allow_insert_parties" ON parties FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_parties" ON parties FOR UPDATE USING (true);
CREATE POLICY "allow_delete_parties" ON parties FOR DELETE USING (true);

-- 2. Agents Directory
CREATE TABLE IF NOT EXISTS agents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT UNIQUE NOT NULL,
  phone TEXT,
  station TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_agents" ON agents FOR SELECT USING (true);
CREATE POLICY "allow_insert_agents" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_agents" ON agents FOR UPDATE USING (true);
CREATE POLICY "allow_delete_agents" ON agents FOR DELETE USING (true);

-- 3. Extend Products: Active / Archived status
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- 4. Extend Orders: Status, Export Date, Brand snapshot, Confirmed metadata
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS export_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);

-- 5. Extend Stock Movements: Reference number, Staff name, Movement type
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS staff_name TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS movement_type TEXT DEFAULT 'TRANSFER';

CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(reference_no);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);

-- 6. Ensure non-negative stock constraint on inventory_stock
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_non_negative_stock'
  ) THEN
    ALTER TABLE inventory_stock ADD CONSTRAINT check_non_negative_stock CHECK (sets >= 0 AND total_pcs >= 0);
  END IF;
END $$;

-- 7. Password Verification RPCs (Prevents leaking hashes to client)
CREATE OR REPLACE FUNCTION verify_admin_password(p_password TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash FROM admin_settings LIMIT 1;
  IF v_hash IS NULL THEN
    RETURN p_password = 'admin123';
  END IF;
  RETURN p_password = v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION verify_staff_password(p_password TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_pass TEXT;
BEGIN
  SELECT staff_password INTO v_pass FROM admin_settings LIMIT 1;
  IF v_pass IS NULL THEN
    RETURN p_password = 'staff123';
  END IF;
  RETURN p_password = v_pass;
END;
$$;

-- 8. Transactional Stock Intake RPC
CREATE OR REPLACE FUNCTION intake_stock_tx(
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_sets INT,
  p_pcs_per_set INT,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_total_pcs INT;
  v_new_sets INT;
  v_new_pcs INT;
  v_ref TEXT;
BEGIN
  IF p_sets <= 0 THEN
    RAISE EXCEPTION 'Sets must be greater than zero';
  END IF;

  v_total_pcs := p_sets * COALESCE(p_pcs_per_set, 1);
  v_ref := COALESCE(p_ref_no, 'IN-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- Upsert inventory stock atomically
  INSERT INTO inventory_stock (product_id, location_id, sets, total_pcs, updated_at)
  VALUES (p_product_id, p_location_id, p_sets, v_total_pcs, NOW())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    updated_at = NOW()
  RETURNING sets, total_pcs INTO v_new_sets, v_new_pcs;

  -- Insert audit movement log
  INSERT INTO stock_movements (
    product_id,
    from_location_id,
    to_location_id,
    sets,
    total_pcs,
    notes,
    reference_no,
    staff_name,
    movement_type,
    created_at
  ) VALUES (
    p_product_id,
    NULL,
    p_location_id,
    p_sets,
    v_total_pcs,
    p_notes,
    v_ref,
    p_staff_name,
    'INTAKE',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'sets', v_new_sets,
    'total_pcs', v_new_pcs,
    'reference_no', v_ref
  );
END;
$$;

-- 9. Transactional Stock Transfer RPC (Atomic, no negative stock)
CREATE OR REPLACE FUNCTION transfer_stock_tx(
  p_product_id BIGINT,
  p_from_location_id BIGINT,
  p_to_location_id BIGINT,
  p_sets INT,
  p_pcs_per_set INT,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_total_pcs INT;
  v_current_sets INT;
  v_ref TEXT;
BEGIN
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations cannot be identical';
  END IF;

  IF p_sets <= 0 THEN
    RAISE EXCEPTION 'Transfer sets must be greater than zero';
  END IF;

  v_total_pcs := p_sets * COALESCE(p_pcs_per_set, 1);
  v_ref := COALESCE(p_ref_no, 'TR-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- Lock and check source stock
  SELECT sets INTO v_current_sets
  FROM inventory_stock
  WHERE product_id = p_product_id AND location_id = p_from_location_id
  FOR UPDATE;

  IF v_current_sets IS NULL OR v_current_sets < p_sets THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', COALESCE(v_current_sets, 0), p_sets;
  END IF;

  -- Subtract from source
  UPDATE inventory_stock
  SET sets = sets - p_sets,
      total_pcs = total_pcs - v_total_pcs,
      updated_at = NOW()
  WHERE product_id = p_product_id AND location_id = p_from_location_id;

  -- Add to destination
  INSERT INTO inventory_stock (product_id, location_id, sets, total_pcs, updated_at)
  VALUES (p_product_id, p_to_location_id, p_sets, v_total_pcs, NOW())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    updated_at = NOW();

  -- Log movement
  INSERT INTO stock_movements (
    product_id,
    from_location_id,
    to_location_id,
    sets,
    total_pcs,
    notes,
    reference_no,
    staff_name,
    movement_type,
    created_at
  ) VALUES (
    p_product_id,
    p_from_location_id,
    p_to_location_id,
    p_sets,
    v_total_pcs,
    p_notes,
    v_ref,
    p_staff_name,
    'TRANSFER',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reference_no', v_ref,
    'transferred_sets', p_sets,
    'transferred_pcs', v_total_pcs
  );
END;
$$;

-- 10. Transactional Order Confirmation & Stock Deduction RPC
CREATE OR REPLACE FUNCTION confirm_order_and_deduct_stock_tx(
  p_order_id BIGINT,
  p_location_id BIGINT,
  p_staff_name TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_item RECORD;
  v_avail_sets INT;
  v_loc_name TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'confirmed' THEN
    RAISE EXCEPTION 'Order % is already confirmed', v_order.order_no;
  END IF;

  SELECT name INTO v_loc_name FROM inventory_locations WHERE id = p_location_id;

  -- Check inventory for all items before any deduction
  FOR v_item IN (SELECT * FROM order_items WHERE order_id = p_order_id) LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT sets INTO v_avail_sets
      FROM inventory_stock
      WHERE product_id = v_item.product_id AND location_id = p_location_id
      FOR UPDATE;

      IF v_avail_sets IS NULL OR v_avail_sets < v_item.sets THEN
        RAISE EXCEPTION 'Insufficient stock in % for Design %. Available: %, Required: %',
          COALESCE(v_loc_name, 'location'),
          COALESCE(v_item.design_no, v_item.product_id::TEXT),
          COALESCE(v_avail_sets, 0),
          v_item.sets;
      END IF;
    END IF;
  END LOOP;

  -- Perform deductions and movement logs
  FOR v_item IN (SELECT * FROM order_items WHERE order_id = p_order_id) LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE inventory_stock
      SET sets = sets - v_item.sets,
          total_pcs = total_pcs - v_item.total_pcs,
          updated_at = NOW()
      WHERE product_id = v_item.product_id AND location_id = p_location_id;

      INSERT INTO stock_movements (
        product_id,
        from_location_id,
        to_location_id,
        sets,
        total_pcs,
        notes,
        reference_no,
        staff_name,
        movement_type,
        created_at
      ) VALUES (
        v_item.product_id,
        p_location_id,
        NULL,
        v_item.sets,
        v_item.total_pcs,
        'Deducted on order confirmation',
        v_order.order_no,
        p_staff_name,
        'DISPATCH',
        NOW()
      );
    END IF;
  END LOOP;

  -- Update order status
  UPDATE orders
  SET status = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = p_staff_name,
      updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_no', v_order.order_no,
    'status', 'confirmed'
  );
END;
$$;

-- 11. Operational Dashboard Stats RPC
CREATE OR REPLACE FUNCTION get_dashboard_summary()
RETURNS JSONB
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_total_products INT;
  v_active_products INT;
  v_godown_sets INT;
  v_godown_pcs INT;
  v_shop_sets INT;
  v_shop_pcs INT;
  v_total_orders INT;
  v_confirmed_orders INT;
  v_draft_orders INT;
  v_godown_id BIGINT;
  v_shop_id BIGINT;
BEGIN
  SELECT id INTO v_godown_id FROM inventory_locations WHERE LOWER(name) = 'godown' LIMIT 1;
  SELECT id INTO v_shop_id FROM inventory_locations WHERE LOWER(name) = 'shop' LIMIT 1;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active IS TRUE)
  INTO v_total_products, v_active_products
  FROM products;

  SELECT COALESCE(SUM(sets), 0), COALESCE(SUM(total_pcs), 0)
  INTO v_godown_sets, v_godown_pcs
  FROM inventory_stock
  WHERE location_id = v_godown_id;

  SELECT COALESCE(SUM(sets), 0), COALESCE(SUM(total_pcs), 0)
  INTO v_shop_sets, v_shop_pcs
  FROM inventory_stock
  WHERE location_id = v_shop_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'confirmed'),
    COUNT(*) FILTER (WHERE status = 'draft' OR status IS NULL)
  INTO v_total_orders, v_confirmed_orders, v_draft_orders
  FROM orders;

  RETURN jsonb_build_object(
    'total_products', COALESCE(v_total_products, 0),
    'active_products', COALESCE(v_active_products, 0),
    'godown_sets', COALESCE(v_godown_sets, 0),
    'godown_pcs', COALESCE(v_godown_pcs, 0),
    'shop_sets', COALESCE(v_shop_sets, 0),
    'shop_pcs', COALESCE(v_shop_pcs, 0),
    'total_orders', COALESCE(v_total_orders, 0),
    'confirmed_orders', COALESCE(v_confirmed_orders, 0),
    'draft_orders', COALESCE(v_draft_orders, 0)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
