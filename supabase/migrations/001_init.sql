-- Admin Settings Table
CREATE TABLE IF NOT EXISTS admin_settings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  password_hash TEXT NOT NULL,
  whatsapp_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on admin_settings
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Allow SELECT on admin_settings (for password verification)
CREATE POLICY "allow_select_admin_settings" ON admin_settings
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_admin_settings" ON admin_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_admin_settings" ON admin_settings
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_admin_settings" ON admin_settings
  FOR DELETE USING (true);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  design_no TEXT UNIQUE NOT NULL,
  brand TEXT,
  collection_name TEXT,
  fabric TEXT,
  rate DECIMAL(10, 2),
  total_set INT,
  total_pcs INT,
  description TEXT,
  image_url TEXT,
  qr_code_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on products
CREATE INDEX IF NOT EXISTS idx_products_design_no ON products(design_no);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection_name);

-- Enable RLS on products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow all operations on products
CREATE POLICY "allow_select_products" ON products
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_products" ON products
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_products" ON products
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_products" ON products
  FOR DELETE USING (true);

-- Product Media Table
CREATE TABLE IF NOT EXISTS product_media (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type VARCHAR(10),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on product_media
CREATE INDEX IF NOT EXISTS idx_product_media_product_id ON product_media(product_id);
CREATE INDEX IF NOT EXISTS idx_product_media_sort_order ON product_media(product_id, sort_order);

-- Enable RLS on product_media
ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;

-- Allow all operations on product_media
CREATE POLICY "allow_select_product_media" ON product_media
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_product_media" ON product_media
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_product_media" ON product_media
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_product_media" ON product_media
  FOR DELETE USING (true);

-- Inquiries Table
CREATE TABLE IF NOT EXISTS inquiries (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  design_no TEXT,
  message TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  admin_response TEXT,
  quoted_price DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on inquiries
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_design_no ON inquiries(design_no);

-- Enable RLS on inquiries
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- Allow all operations on inquiries
CREATE POLICY "allow_select_inquiries" ON inquiries
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_inquiries" ON inquiries
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_inquiries" ON inquiries
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_inquiries" ON inquiries
  FOR DELETE USING (true);

-- Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  invoice_no TEXT UNIQUE NOT NULL,
  party_name TEXT NOT NULL,
  export_date DATE,
  qr_code_url TEXT,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on invoices
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_no ON invoices(invoice_no);

-- Enable RLS on invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Allow all operations on invoices
CREATE POLICY "allow_select_invoices" ON invoices
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_invoices" ON invoices
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_invoices" ON invoices
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_invoices" ON invoices
  FOR DELETE USING (true);

-- Invoice Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  design_no TEXT,
  rate DECIMAL(10, 2),
  sets INT,
  total_pcs INT,
  line_total DECIMAL(12, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Enable RLS on invoice_items
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- Allow all operations on invoice_items
CREATE POLICY "allow_select_invoice_items" ON invoice_items
  FOR SELECT USING (true);

CREATE POLICY "allow_insert_invoice_items" ON invoice_items
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_invoice_items" ON invoice_items
  FOR UPDATE USING (true);

CREATE POLICY "allow_delete_invoice_items" ON invoice_items
  FOR DELETE USING (true);

-- Seed default admin settings (optional - modify password before production)
INSERT INTO admin_settings (password_hash, whatsapp_number)
VALUES ('admin123', '+91XXXXXXXXXX')
ON CONFLICT DO NOTHING;
