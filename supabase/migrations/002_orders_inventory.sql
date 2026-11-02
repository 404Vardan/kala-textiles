-- ============================================
-- Migration 002: Orders & Inventory System
-- ============================================

-- Add pcs_per_set to products (how many pieces make one set)
ALTER TABLE products ADD COLUMN IF NOT EXISTS pcs_per_set INT DEFAULT 1;

-- ============================================
-- Orders
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  order_no TEXT UNIQUE NOT NULL,
  party_name TEXT NOT NULL,
  station TEXT,
  agent TEXT,
  gst_number TEXT,
  order_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party_name);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_orders" ON orders FOR SELECT USING (true);
CREATE POLICY "allow_insert_orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_orders" ON orders FOR UPDATE USING (true);
CREATE POLICY "allow_delete_orders" ON orders FOR DELETE USING (true);

-- ============================================
-- Order Items
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  design_no TEXT,
  rate DECIMAL(10, 2),
  sets INT DEFAULT 0,
  pcs_per_set INT DEFAULT 1,
  total_pcs INT DEFAULT 0,
  line_total DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_order_items" ON order_items FOR SELECT USING (true);
CREATE POLICY "allow_insert_order_items" ON order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_order_items" ON order_items FOR UPDATE USING (true);
CREATE POLICY "allow_delete_order_items" ON order_items FOR DELETE USING (true);

-- ============================================
-- Inventory Locations (pre-seeded)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_locations (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_inventory_locations" ON inventory_locations FOR SELECT USING (true);
CREATE POLICY "allow_insert_inventory_locations" ON inventory_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_inventory_locations" ON inventory_locations FOR UPDATE USING (true);

-- Seed Godown and Shop
INSERT INTO inventory_locations (name, description)
VALUES ('Godown', 'Main warehouse / godown'), ('Shop', 'Retail shop floor')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Inventory Stock
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_stock (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id),
  sets INT DEFAULT 0,
  total_pcs INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_product ON inventory_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_location ON inventory_stock(location_id);

ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_inventory_stock" ON inventory_stock FOR SELECT USING (true);
CREATE POLICY "allow_insert_inventory_stock" ON inventory_stock FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_inventory_stock" ON inventory_stock FOR UPDATE USING (true);
CREATE POLICY "allow_delete_inventory_stock" ON inventory_stock FOR DELETE USING (true);

-- ============================================
-- Stock Movements (transfer log)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  from_location_id BIGINT REFERENCES inventory_locations(id),
  to_location_id BIGINT REFERENCES inventory_locations(id),
  sets INT DEFAULT 0,
  total_pcs INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select_stock_movements" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "allow_insert_stock_movements" ON stock_movements FOR INSERT WITH CHECK (true);

-- ============================================
-- Auto-generate order numbers: RNG-YYYY-NNNN
-- ============================================
CREATE OR REPLACE FUNCTION generate_order_no()
RETURNS TEXT AS $$
DECLARE
  current_year TEXT;
  next_seq INT;
  result TEXT;
BEGIN
  current_year := TO_CHAR(NOW(), 'YYYY');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_no FROM 10 FOR 4) AS INT)
  ), 0) + 1
  INTO next_seq
  FROM orders
  WHERE order_no LIKE 'RNG-' || current_year || '-%';

  result := 'RNG-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');
  RETURN result;
END;
$$ LANGUAGE plpgsql;
