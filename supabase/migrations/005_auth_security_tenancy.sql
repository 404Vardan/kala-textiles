-- ====================================================================
-- Migration 005: Multi-Tenancy, Supabase Auth Integration & Role Security
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION A: Business and Membership Entities
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.businesses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.memberships (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_business ON public.memberships(business_id);

-- Seed primary business for Rangoli Textiles
INSERT INTO public.businesses (name, slug, settings)
VALUES (
  'Rangoli Textiles',
  'rangoli',
  '{"order_prefix": "RNG", "invoice_prefix": "INV"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------
-- SECTION B: Add business_id to All 13 Domain Tables & Backfill
-- --------------------------------------------------------------------

DO $$
DECLARE
  v_business_id BIGINT;
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'products',
    'product_media',
    'inquiries',
    'invoices',
    'invoice_items',
    'orders',
    'order_items',
    'parties',
    'agents',
    'inventory_locations',
    'inventory_stock',
    'stock_movements',
    'admin_settings'
  ];
  v_fk_name TEXT;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = 'rangoli'
  LIMIT 1;

  -- First add business_id column to all tables
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS business_id BIGINT',
      v_table
    );
  END LOOP;

  -- Backfill root tables first
  FOREACH v_table IN ARRAY ARRAY[
    'products',
    'inquiries',
    'invoices',
    'orders',
    'parties',
    'agents',
    'inventory_locations',
    'admin_settings'
  ] LOOP
    EXECUTE format(
      'UPDATE public.%I SET business_id = $1 WHERE business_id IS NULL',
      v_table
    ) USING v_business_id;
  END LOOP;

  -- Backfill child tables from their parent records to guarantee tenant alignment
  UPDATE public.product_media pm
  SET business_id = p.business_id
  FROM public.products p
  WHERE pm.product_id = p.id
    AND (pm.business_id IS NULL OR pm.business_id <> p.business_id);

  UPDATE public.invoice_items ii
  SET business_id = i.business_id
  FROM public.invoices i
  WHERE ii.invoice_id = i.id
    AND (ii.business_id IS NULL OR ii.business_id <> i.business_id);

  UPDATE public.order_items oi
  SET business_id = o.business_id
  FROM public.orders o
  WHERE oi.order_id = o.id
    AND (oi.business_id IS NULL OR oi.business_id <> o.business_id);

  UPDATE public.inventory_stock s
  SET business_id = p.business_id
  FROM public.products p
  WHERE s.product_id = p.id
    AND (s.business_id IS NULL OR s.business_id <> p.business_id);

  UPDATE public.stock_movements sm
  SET business_id = p.business_id
  FROM public.products p
  WHERE sm.product_id = p.id
    AND (sm.business_id IS NULL OR sm.business_id <> p.business_id);

  -- Fallback for any remaining null rows in child tables
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'UPDATE public.%I SET business_id = $1 WHERE business_id IS NULL',
      v_table
    ) USING v_business_id;

    -- Set NOT NULL
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN business_id SET NOT NULL',
      v_table
    );

    -- Idempotently add Foreign Key Constraint to businesses(id)
    v_fk_name := v_table || '_business_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = v_fk_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE',
        v_table,
        v_fk_name
      );
    END IF;

    -- Add Index on business_id
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(business_id)',
      'idx_' || v_table || '_business_id',
      v_table
    );
  END LOOP;
END $$;

-- --------------------------------------------------------------------
-- SECTION C: Business-Scoped Uniqueness & Composite Tenant Foreign Keys
-- --------------------------------------------------------------------

-- 1. Business-Scoped Uniqueness Constraints
-- Products design_no
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_design_no_key;
DROP INDEX IF EXISTS public.uq_products_business_design;
CREATE UNIQUE INDEX uq_products_business_design ON public.products (business_id, design_no);

-- Parties name
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_name_key;
DROP INDEX IF EXISTS public.uq_parties_business_name;
CREATE UNIQUE INDEX uq_parties_business_name ON public.parties (business_id, name);

-- Agents name
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_name_key;
DROP INDEX IF EXISTS public.uq_agents_business_name;
CREATE UNIQUE INDEX uq_agents_business_name ON public.agents (business_id, name);

-- Inventory Locations name
ALTER TABLE public.inventory_locations DROP CONSTRAINT IF EXISTS inventory_locations_name_key;
DROP INDEX IF EXISTS public.uq_locations_business_name;
CREATE UNIQUE INDEX uq_locations_business_name ON public.inventory_locations (business_id, name);

-- Orders order_no
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_no_key;
DROP INDEX IF EXISTS public.uq_orders_business_order_no;
CREATE UNIQUE INDEX uq_orders_business_order_no ON public.orders (business_id, order_no);

-- Invoices invoice_no
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_no_key;
DROP INDEX IF EXISTS public.uq_invoices_business_invoice_no;
CREATE UNIQUE INDEX uq_invoices_business_invoice_no ON public.invoices (business_id, invoice_no);

-- Inventory Stock (business_id, product_id, location_id)
DROP INDEX IF EXISTS public.uq_inventory_stock_business_prod_loc;
CREATE UNIQUE INDEX uq_inventory_stock_business_prod_loc ON public.inventory_stock (business_id, product_id, location_id);

-- 2. Composite Unique Constraints on Parent Tables (Required for Composite FKs)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_business_id_id_key') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_business_id_id_key UNIQUE (business_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_business_id_id_key') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_business_id_id_key UNIQUE (business_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_business_id_id_key') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_business_id_id_key UNIQUE (business_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_business_id_id_key') THEN
    ALTER TABLE public.inventory_locations ADD CONSTRAINT inventory_locations_business_id_id_key UNIQUE (business_id, id);
  END IF;
END $$;

-- 3. Replace Legacy Single-Column Child FKs with Composite Tenant-Aware FKs
DO $$
BEGIN
  -- product_media -> products (business_id, product_id)
  ALTER TABLE public.product_media DROP CONSTRAINT IF EXISTS product_media_product_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_media_business_product_fkey') THEN
    ALTER TABLE public.product_media
      ADD CONSTRAINT product_media_business_product_fkey
      FOREIGN KEY (business_id, product_id)
      REFERENCES public.products (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- invoice_items -> invoices (business_id, invoice_id)
  ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_invoice_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_business_invoice_fkey') THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_business_invoice_fkey
      FOREIGN KEY (business_id, invoice_id)
      REFERENCES public.invoices (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- order_items -> orders (business_id, order_id)
  ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_business_order_fkey') THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_business_order_fkey
      FOREIGN KEY (business_id, order_id)
      REFERENCES public.orders (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- order_items -> products (business_id, product_id)
  ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_business_product_fkey') THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_business_product_fkey
      FOREIGN KEY (business_id, product_id)
      REFERENCES public.products (business_id, id)
      ON DELETE RESTRICT;
  END IF;

  -- inventory_stock -> products (business_id, product_id)
  ALTER TABLE public.inventory_stock DROP CONSTRAINT IF EXISTS inventory_stock_product_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_business_product_fkey') THEN
    ALTER TABLE public.inventory_stock
      ADD CONSTRAINT inventory_stock_business_product_fkey
      FOREIGN KEY (business_id, product_id)
      REFERENCES public.products (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- inventory_stock -> inventory_locations (business_id, location_id)
  ALTER TABLE public.inventory_stock DROP CONSTRAINT IF EXISTS inventory_stock_location_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_business_location_fkey') THEN
    ALTER TABLE public.inventory_stock
      ADD CONSTRAINT inventory_stock_business_location_fkey
      FOREIGN KEY (business_id, location_id)
      REFERENCES public.inventory_locations (business_id, id)
      ON DELETE RESTRICT;
  END IF;

  -- stock_movements -> products (business_id, product_id)
  ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_product_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_business_product_fkey') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_business_product_fkey
      FOREIGN KEY (business_id, product_id)
      REFERENCES public.products (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- stock_movements -> inventory_locations (business_id, from_location_id)
  ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_from_location_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_business_from_location_fkey') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_business_from_location_fkey
      FOREIGN KEY (business_id, from_location_id)
      REFERENCES public.inventory_locations (business_id, id)
      ON DELETE RESTRICT;
  END IF;

  -- stock_movements -> inventory_locations (business_id, to_location_id)
  ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_to_location_id_fkey;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_business_to_location_fkey') THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_business_to_location_fkey
      FOREIGN KEY (business_id, to_location_id)
      REFERENCES public.inventory_locations (business_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- SECTION D: Membership Helper Functions
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND business_id = p_business_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND business_id = p_business_id
      AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COUNT(*) = 1 THEN MIN(business_id)
    ELSE NULL
  END
  FROM public.memberships
  WHERE user_id = auth.uid();
$$;

-- Set default business_id to current_business_id() on all 13 domain tables
ALTER TABLE public.products ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.product_media ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.orders ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.order_items ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.parties ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.agents ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.inventory_locations ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.inventory_stock ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.stock_movements ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.invoices ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.invoice_items ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.inquiries ALTER COLUMN business_id SET DEFAULT public.current_business_id();
ALTER TABLE public.admin_settings ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- --------------------------------------------------------------------
-- SECTION E: Row Level Security (RLS) Policy Overhaul
-- --------------------------------------------------------------------

-- 1. Explicitly drop all legacy permissive policies from Migrations 001, 002, and 004
-- admin_settings
DROP POLICY IF EXISTS "allow_select_admin_settings" ON public.admin_settings;
DROP POLICY IF EXISTS "allow_insert_admin_settings" ON public.admin_settings;
DROP POLICY IF EXISTS "allow_update_admin_settings" ON public.admin_settings;
DROP POLICY IF EXISTS "allow_delete_admin_settings" ON public.admin_settings;

-- products
DROP POLICY IF EXISTS "allow_select_products" ON public.products;
DROP POLICY IF EXISTS "allow_insert_products" ON public.products;
DROP POLICY IF EXISTS "allow_update_products" ON public.products;
DROP POLICY IF EXISTS "allow_delete_products" ON public.products;

-- product_media
DROP POLICY IF EXISTS "allow_select_product_media" ON public.product_media;
DROP POLICY IF EXISTS "allow_insert_product_media" ON public.product_media;
DROP POLICY IF EXISTS "allow_update_product_media" ON public.product_media;
DROP POLICY IF EXISTS "allow_delete_product_media" ON public.product_media;

-- inquiries
DROP POLICY IF EXISTS "allow_select_inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "allow_insert_inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "allow_update_inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "allow_delete_inquiries" ON public.inquiries;

-- invoices
DROP POLICY IF EXISTS "allow_select_invoices" ON public.invoices;
DROP POLICY IF EXISTS "allow_insert_invoices" ON public.invoices;
DROP POLICY IF EXISTS "allow_update_invoices" ON public.invoices;
DROP POLICY IF EXISTS "allow_delete_invoices" ON public.invoices;

-- invoice_items
DROP POLICY IF EXISTS "allow_select_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "allow_insert_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "allow_update_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "allow_delete_invoice_items" ON public.invoice_items;

-- orders
DROP POLICY IF EXISTS "allow_select_orders" ON public.orders;
DROP POLICY IF EXISTS "allow_insert_orders" ON public.orders;
DROP POLICY IF EXISTS "allow_update_orders" ON public.orders;
DROP POLICY IF EXISTS "allow_delete_orders" ON public.orders;

-- order_items
DROP POLICY IF EXISTS "allow_select_order_items" ON public.order_items;
DROP POLICY IF EXISTS "allow_insert_order_items" ON public.order_items;
DROP POLICY IF EXISTS "allow_update_order_items" ON public.order_items;
DROP POLICY IF EXISTS "allow_delete_order_items" ON public.order_items;

-- inventory_locations
DROP POLICY IF EXISTS "allow_select_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "allow_insert_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "allow_update_inventory_locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "allow_delete_inventory_locations" ON public.inventory_locations;

-- inventory_stock
DROP POLICY IF EXISTS "allow_select_inventory_stock" ON public.inventory_stock;
DROP POLICY IF EXISTS "allow_insert_inventory_stock" ON public.inventory_stock;
DROP POLICY IF EXISTS "allow_update_inventory_stock" ON public.inventory_stock;
DROP POLICY IF EXISTS "allow_delete_inventory_stock" ON public.inventory_stock;

-- stock_movements
DROP POLICY IF EXISTS "allow_select_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "allow_insert_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "allow_update_stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "allow_delete_stock_movements" ON public.stock_movements;

-- parties
DROP POLICY IF EXISTS "allow_select_parties" ON public.parties;
DROP POLICY IF EXISTS "allow_insert_parties" ON public.parties;
DROP POLICY IF EXISTS "allow_update_parties" ON public.parties;
DROP POLICY IF EXISTS "allow_delete_parties" ON public.parties;

-- agents
DROP POLICY IF EXISTS "allow_select_agents" ON public.agents;
DROP POLICY IF EXISTS "allow_insert_agents" ON public.agents;
DROP POLICY IF EXISTS "allow_update_agents" ON public.agents;
DROP POLICY IF EXISTS "allow_delete_agents" ON public.agents;

-- Also sweep any remaining or prior policies on all tenant tables for idempotency
DO $$
DECLARE
  v_pol RECORD;
BEGIN
  FOR v_pol IN (
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'businesses',
        'memberships',
        'products',
        'product_media',
        'orders',
        'order_items',
        'parties',
        'agents',
        'inventory_locations',
        'inventory_stock',
        'stock_movements',
        'invoices',
        'invoice_items',
        'inquiries',
        'admin_settings'
      )
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_pol.policyname, v_pol.schemaname, v_pol.tablename);
  END LOOP;
END $$;

-- 2. Enable RLS on all tables
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- 3. Revoke direct table access from PUBLIC and anon on all business tables
REVOKE ALL ON TABLE
  public.businesses,
  public.memberships,
  public.products,
  public.product_media,
  public.orders,
  public.order_items,
  public.parties,
  public.agents,
  public.inventory_locations,
  public.inventory_stock,
  public.stock_movements,
  public.invoices,
  public.invoice_items,
  public.inquiries,
  public.admin_settings
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.businesses,
  public.memberships,
  public.products,
  public.product_media,
  public.orders,
  public.order_items,
  public.parties,
  public.agents,
  public.inventory_locations,
  public.inventory_stock,
  public.stock_movements,
  public.invoices,
  public.invoice_items,
  public.inquiries,
  public.admin_settings
TO authenticated;

-- 4. Create strict tenant-scoped RLS policies (authenticated only)
-- Businesses Policies
CREATE POLICY "members_view_business" ON public.businesses
  FOR SELECT TO authenticated
  USING (public.is_business_member(id));

-- Memberships Policies
CREATE POLICY "users_view_own_memberships" ON public.memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "owners_manage_memberships" ON public.memberships
  FOR ALL TO authenticated
  USING (public.is_business_owner(business_id))
  WITH CHECK (public.is_business_owner(business_id));

-- Products Policies
CREATE POLICY "members_select_products" ON public.products
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "members_insert_products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "members_update_products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "owners_delete_products" ON public.products
  FOR DELETE TO authenticated
  USING (public.is_business_owner(business_id));

-- Product Media Policies
CREATE POLICY "members_manage_product_media" ON public.product_media
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Orders Policies
CREATE POLICY "members_select_orders" ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "members_insert_orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "members_update_orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "owners_delete_orders" ON public.orders
  FOR DELETE TO authenticated
  USING (public.is_business_owner(business_id));

-- Order Items Policies
CREATE POLICY "members_manage_order_items" ON public.order_items
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Parties Policies
CREATE POLICY "members_manage_parties" ON public.parties
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Agents Policies
CREATE POLICY "members_manage_agents" ON public.agents
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Inventory Locations Policies
CREATE POLICY "members_manage_locations" ON public.inventory_locations
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Inventory Stock Policies
CREATE POLICY "members_manage_stock" ON public.inventory_stock
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Stock Movements Policies
CREATE POLICY "members_select_movements" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "members_insert_movements" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id));

-- Invoices & Items Policies
CREATE POLICY "members_manage_invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "members_manage_invoice_items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Inquiries Policies
CREATE POLICY "members_manage_inquiries" ON public.inquiries
  FOR ALL TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Admin Settings Policies (Owner Only)
CREATE POLICY "owners_manage_settings" ON public.admin_settings
  FOR ALL TO authenticated
  USING (public.is_business_owner(business_id))
  WITH CHECK (public.is_business_owner(business_id));

-- --------------------------------------------------------------------
-- SECTION F: Remove Legacy Password Authentication
-- --------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.verify_admin_password(TEXT);
DROP FUNCTION IF EXISTS public.verify_staff_password(TEXT);

ALTER TABLE public.admin_settings DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.admin_settings DROP COLUMN IF EXISTS staff_password;

-- --------------------------------------------------------------------
-- SECTION G: Atomic Business-Scoped Order Counter
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_order_counters (
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_year INTEGER NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, order_year)
);

ALTER TABLE public.business_order_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_order_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_order_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_prefix TEXT;
  v_year INT;
  v_val BIGINT;
BEGIN
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to a single active business';
  END IF;

  SELECT COALESCE(settings->>'order_prefix', 'RNG')
  INTO v_prefix
  FROM public.businesses
  WHERE id = v_business_id;

  v_year := EXTRACT(YEAR FROM NOW())::INT;

  INSERT INTO public.business_order_counters (business_id, order_year, last_value)
  VALUES (v_business_id, v_year, 1)
  ON CONFLICT (business_id, order_year)
  DO UPDATE SET last_value = business_order_counters.last_value + 1
  RETURNING last_value INTO v_val;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || LPAD(v_val::TEXT, 4, '0');
END;
$$;

-- --------------------------------------------------------------------
-- SECTION H: Secured Transactional RPCs (Server-Derived Stock Integrity)
-- --------------------------------------------------------------------

-- Drop any legacy signatures before recreating
DROP FUNCTION IF EXISTS public.intake_stock_tx(BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.intake_stock_tx(BIGINT, BIGINT, INT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, TEXT, TEXT, TEXT);

-- 1. Stock Intake RPC (pcs_per_set is strictly derived from the product record)
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
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_loc_biz BIGINT;
  v_pcs_per_set INT;
  v_total_pcs INT;
  v_new_sets INT;
  v_new_pcs INT;
  v_ref TEXT;
BEGIN
  IF p_sets IS NULL OR p_sets <= 0 THEN
    RAISE EXCEPTION 'Sets must be greater than zero';
  END IF;

  -- 1. Resolve product & derive authoritative pcs_per_set from product record
  SELECT business_id, GREATEST(COALESCE(pcs_per_set, 1), 1)
  INTO v_business_id, v_pcs_per_set
  FROM public.products
  WHERE id = p_product_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- 2. Validate membership
  IF NOT public.is_business_member(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user is not a member of this business';
  END IF;

  -- 3. Validate location belongs to same business
  SELECT business_id INTO v_loc_biz
  FROM public.inventory_locations
  WHERE id = p_location_id;

  IF v_loc_biz IS NULL OR v_loc_biz <> v_business_id THEN
    RAISE EXCEPTION 'Invalid destination location for this business';
  END IF;

  -- Always calculate pieces from authoritative product pcs_per_set
  v_total_pcs := p_sets * v_pcs_per_set;
  v_ref := COALESCE(NULLIF(TRIM(p_ref_no), ''), 'IN-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- 4. Upsert stock
  INSERT INTO public.inventory_stock (business_id, product_id, location_id, sets, total_pcs, updated_at)
  VALUES (v_business_id, p_product_id, p_location_id, p_sets, v_total_pcs, NOW())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    updated_at = NOW()
  RETURNING sets, total_pcs INTO v_new_sets, v_new_pcs;

  -- 5. Insert movement log
  INSERT INTO public.stock_movements (
    business_id,
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
    v_business_id,
    p_product_id,
    NULL,
    p_location_id,
    p_sets,
    v_total_pcs,
    p_notes,
    v_ref,
    COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'),
    'INTAKE',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'pcs_per_set', v_pcs_per_set,
    'sets', v_new_sets,
    'total_pcs', v_new_pcs,
    'reference_no', v_ref
  );
END;
$$;

-- Compatibility overload that ignores client-supplied p_pcs_per_set and delegates to server-derived intake_stock_tx
CREATE OR REPLACE FUNCTION public.intake_stock_tx(
  p_product_id BIGINT,
  p_location_id BIGINT,
  p_sets INT,
  p_pcs_per_set INT,
  p_staff_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_ref_no TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.intake_stock_tx(
    p_product_id => p_product_id,
    p_location_id => p_location_id,
    p_sets => p_sets,
    p_staff_name => p_staff_name,
    p_notes => p_notes,
    p_ref_no => p_ref_no
  );
END;
$$;

-- 2. Stock Transfer RPC (pcs_per_set is strictly derived from the product record)
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
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_from_biz BIGINT;
  v_to_biz BIGINT;
  v_pcs_per_set INT;
  v_total_pcs INT;
  v_current_sets INT;
  v_current_pcs INT;
  v_ref TEXT;
BEGIN
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations cannot be identical';
  END IF;

  IF p_sets IS NULL OR p_sets <= 0 THEN
    RAISE EXCEPTION 'Transfer sets must be greater than zero';
  END IF;

  -- Resolve product & authoritative pcs_per_set from product record
  SELECT business_id, GREATEST(COALESCE(pcs_per_set, 1), 1)
  INTO v_business_id, v_pcs_per_set
  FROM public.products
  WHERE id = p_product_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF NOT public.is_business_member(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user is not a member of this business';
  END IF;

  -- Verify both locations belong to this business
  SELECT business_id INTO v_from_biz FROM public.inventory_locations WHERE id = p_from_location_id;
  SELECT business_id INTO v_to_biz FROM public.inventory_locations WHERE id = p_to_location_id;

  IF v_from_biz IS NULL OR v_to_biz IS NULL OR v_from_biz <> v_business_id OR v_to_biz <> v_business_id THEN
    RAISE EXCEPTION 'Locations must belong to the same business as the product';
  END IF;

  -- Always calculate pieces from authoritative product pcs_per_set
  v_total_pcs := p_sets * v_pcs_per_set;
  v_ref := COALESCE(NULLIF(TRIM(p_ref_no), ''), 'TR-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'));

  -- Lock source row in deterministic location order
  SELECT sets, total_pcs INTO v_current_sets, v_current_pcs
  FROM public.inventory_stock
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_from_location_id
  FOR UPDATE;

  IF v_current_sets IS NULL OR v_current_sets < p_sets OR COALESCE(v_current_pcs, 0) < v_total_pcs THEN
    RAISE EXCEPTION 'Insufficient stock. Available: % sets (% pcs), Requested: % sets (% pcs)',
      COALESCE(v_current_sets, 0),
      COALESCE(v_current_pcs, 0),
      p_sets,
      v_total_pcs;
  END IF;

  -- Update source
  UPDATE public.inventory_stock
  SET sets = sets - p_sets,
      total_pcs = total_pcs - v_total_pcs,
      updated_at = NOW()
  WHERE business_id = v_business_id
    AND product_id = p_product_id
    AND location_id = p_from_location_id;

  -- Update destination
  INSERT INTO public.inventory_stock (business_id, product_id, location_id, sets, total_pcs, updated_at)
  VALUES (v_business_id, p_product_id, p_to_location_id, p_sets, v_total_pcs, NOW())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    sets = inventory_stock.sets + EXCLUDED.sets,
    total_pcs = inventory_stock.total_pcs + EXCLUDED.total_pcs,
    updated_at = NOW();

  -- Movement log
  INSERT INTO public.stock_movements (
    business_id,
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
    v_business_id,
    p_product_id,
    p_from_location_id,
    p_to_location_id,
    p_sets,
    v_total_pcs,
    p_notes,
    v_ref,
    COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'),
    'TRANSFER',
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reference_no', v_ref,
    'pcs_per_set', v_pcs_per_set,
    'transferred_sets', p_sets,
    'transferred_pcs', v_total_pcs
  );
END;
$$;

-- Compatibility overload that ignores client-supplied p_pcs_per_set and delegates to server-derived transfer_stock_tx
CREATE OR REPLACE FUNCTION public.transfer_stock_tx(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.transfer_stock_tx(
    p_product_id => p_product_id,
    p_from_location_id => p_from_location_id,
    p_to_location_id => p_to_location_id,
    p_sets => p_sets,
    p_staff_name => p_staff_name,
    p_notes => p_notes,
    p_ref_no => p_ref_no
  );
END;
$$;

-- 3. Order Confirmation & Stock Deduction RPC
CREATE OR REPLACE FUNCTION public.confirm_order_and_deduct_stock_tx(
  p_order_id BIGINT,
  p_location_id BIGINT,
  p_staff_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_business_id BIGINT;
  v_loc_biz BIGINT;
  v_agg RECORD;
  v_item RECORD;
  v_avail_sets INT;
  v_avail_pcs INT;
  v_item_pcs INT;
  v_loc_name TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_business_id := v_order.business_id;

  IF NOT public.is_business_member(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user is not a member of this business';
  END IF;

  IF COALESCE(v_order.status, 'draft') <> 'draft' THEN
    RAISE EXCEPTION 'Order % cannot be confirmed (current status: %)', v_order.order_no, v_order.status;
  END IF;

  SELECT name, business_id INTO v_loc_name, v_loc_biz
  FROM public.inventory_locations
  WHERE id = p_location_id;

  IF v_loc_biz IS NULL OR v_loc_biz <> v_business_id THEN
    RAISE EXCEPTION 'Selected inventory location is not valid for this business';
  END IF;

  -- Validate order items exist and have valid positive quantities and product links
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Order % has no items to confirm', v_order.order_no;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id
      AND (product_id IS NULL OR sets IS NULL OR sets <= 0)
  ) THEN
    RAISE EXCEPTION 'Order % contains invalid items (every item must reference a valid product and have sets > 0)', v_order.order_no;
  END IF;

  -- Aggregate total sets & server-derived pieces required per product (prevents duplicate row bypass)
  FOR v_agg IN (
    SELECT
      oi.product_id,
      p.business_id AS prod_business_id,
      GREATEST(COALESCE(p.pcs_per_set, 1), 1) AS prod_pcs_per_set,
      SUM(oi.sets)::INT AS total_sets_needed,
      SUM(oi.sets * GREATEST(COALESCE(p.pcs_per_set, 1), 1))::INT AS total_pcs_needed,
      MIN(COALESCE(oi.design_no, p.design_no)) AS sample_design
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id, p.business_id, p.pcs_per_set
    ORDER BY oi.product_id ASC
  ) LOOP
    IF v_agg.prod_business_id <> v_business_id THEN
      RAISE EXCEPTION 'Product % does not belong to order business', v_agg.product_id;
    END IF;

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

  -- Deduct inventory using authoritative product pcs_per_set and log movements
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

    UPDATE public.inventory_stock
    SET sets = sets - v_item.sets,
        total_pcs = total_pcs - v_item_pcs,
        updated_at = NOW()
    WHERE business_id = v_business_id
      AND product_id = v_item.product_id
      AND location_id = p_location_id;

    -- Keep order_items pcs_per_set and total_pcs synchronized with authoritative product record
    UPDATE public.order_items
    SET pcs_per_set = v_item.prod_pcs_per_set,
        total_pcs = v_item_pcs
    WHERE id = v_item.id;

    INSERT INTO public.stock_movements (
      business_id,
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
      v_business_id,
      v_item.product_id,
      p_location_id,
      NULL,
      v_item.sets,
      v_item_pcs,
      'Deducted on order confirmation',
      v_order.order_no,
      COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'),
      'DISPATCH',
      NOW()
    );
  END LOOP;

  -- Confirm order
  UPDATE public.orders
  SET status = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = COALESCE(NULLIF(TRIM(p_staff_name), ''), 'Staff'),
      updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_no', v_order.order_no,
    'status', 'confirmed'
  );
END;
$$;

-- 4. Dashboard Summary RPC
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
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
  v_business_id := public.current_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to a single active business';
  END IF;

  SELECT id INTO v_godown_id
  FROM public.inventory_locations
  WHERE business_id = v_business_id AND LOWER(name) = 'godown'
  LIMIT 1;

  SELECT id INTO v_shop_id
  FROM public.inventory_locations
  WHERE business_id = v_business_id AND LOWER(name) = 'shop'
  LIMIT 1;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active IS TRUE)
  INTO v_total_products, v_active_products
  FROM public.products
  WHERE business_id = v_business_id;

  SELECT COALESCE(SUM(sets), 0), COALESCE(SUM(total_pcs), 0)
  INTO v_godown_sets, v_godown_pcs
  FROM public.inventory_stock
  WHERE business_id = v_business_id AND location_id = v_godown_id;

  SELECT COALESCE(SUM(sets), 0), COALESCE(SUM(total_pcs), 0)
  INTO v_shop_sets, v_shop_pcs
  FROM public.inventory_stock
  WHERE business_id = v_business_id AND location_id = v_shop_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'confirmed'),
    COUNT(*) FILTER (WHERE status = 'draft' OR status IS NULL)
  INTO v_total_orders, v_confirmed_orders, v_draft_orders
  FROM public.orders
  WHERE business_id = v_business_id;

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

-- --------------------------------------------------------------------
-- SECTION I: Public Scoped RPCs (Safe for Anonymous and Authenticated)
-- --------------------------------------------------------------------

-- 1. Public Product Catalog Endpoint
CREATE OR REPLACE FUNCTION public.get_public_product(
  p_slug TEXT,
  p_design_no TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_prod public.products%ROWTYPE;
  v_media JSONB;
BEGIN
  SELECT * INTO v_biz FROM public.businesses WHERE slug = LOWER(TRIM(p_slug));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prod
  FROM public.products
  WHERE business_id = v_biz.id
    AND UPPER(TRIM(design_no)) = UPPER(TRIM(p_design_no))
    AND COALESCE(is_active, TRUE) IS TRUE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'media_url', media_url,
      'media_type', media_type,
      'sort_order', sort_order
    ) ORDER BY sort_order ASC
  ), '[]'::jsonb)
  INTO v_media
  FROM public.product_media
  WHERE business_id = v_biz.id AND product_id = v_prod.id;

  RETURN jsonb_build_object(
    'design_no', v_prod.design_no,
    'brand', v_prod.brand,
    'collection_name', v_prod.collection_name,
    'fabric', v_prod.fabric,
    'rate', v_prod.rate,
    'pcs_per_set', v_prod.pcs_per_set,
    'description', v_prod.description,
    'image_url', v_prod.image_url,
    'business_name', v_biz.name,
    'business_slug', v_biz.slug,
    'media', v_media
  );
END;
$$;

-- 2. Public Order Endpoint
CREATE OR REPLACE FUNCTION public.get_public_order(
  p_slug TEXT,
  p_order_no TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_items JSONB;
BEGIN
  SELECT * INTO v_biz FROM public.businesses WHERE slug = LOWER(TRIM(p_slug));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE business_id = v_biz.id AND UPPER(TRIM(order_no)) = UPPER(TRIM(p_order_no));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'design_no', oi.design_no,
      'rate', oi.rate,
      'sets', oi.sets,
      'pcs_per_set', oi.pcs_per_set,
      'total_pcs', oi.total_pcs,
      'line_total', oi.line_total,
      'thumbnail', p.image_url,
      'brand', p.brand,
      'fabric', p.fabric
    ) ORDER BY oi.id ASC
  ), '[]'::jsonb)
  INTO v_items
  FROM public.order_items oi
  LEFT JOIN public.products p ON oi.product_id = p.id AND p.business_id = v_biz.id
  WHERE oi.business_id = v_biz.id AND oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_no', v_order.order_no,
    'party_name', v_order.party_name,
    'station', v_order.station,
    'agent', v_order.agent,
    'gst_number', v_order.gst_number,
    'order_date', v_order.order_date,
    'export_date', v_order.export_date,
    'brand', v_order.brand,
    'product_name', v_order.product_name,
    'notes', v_order.notes,
    'status', v_order.status,
    'total_amount', v_order.total_amount,
    'created_at', v_order.created_at,
    'confirmed_at', v_order.confirmed_at,
    'business_name', v_biz.name,
    'business_slug', v_biz.slug,
    'items', v_items
  );
END;
$$;

-- 3. Public Invoice Endpoint
CREATE OR REPLACE FUNCTION public.get_public_invoice(
  p_slug TEXT,
  p_invoice_no TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_inv public.invoices%ROWTYPE;
  v_items JSONB;
BEGIN
  SELECT * INTO v_biz FROM public.businesses WHERE slug = LOWER(TRIM(p_slug));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_inv
  FROM public.invoices
  WHERE business_id = v_biz.id AND UPPER(TRIM(invoice_no)) = UPPER(TRIM(p_invoice_no));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'design_no', design_no,
      'rate', rate,
      'sets', sets,
      'pcs_per_set', pcs_per_set,
      'total_pcs', total_pcs,
      'line_total', line_total
    ) ORDER BY id ASC
  ), '[]'::jsonb)
  INTO v_items
  FROM public.invoice_items
  WHERE business_id = v_biz.id AND invoice_id = v_inv.id;

  RETURN jsonb_build_object(
    'invoice_no', v_inv.invoice_no,
    'party_name', v_inv.party_name,
    'export_date', v_inv.export_date,
    'total_amount', v_inv.total_amount,
    'created_at', v_inv.created_at,
    'business_name', v_biz.name,
    'business_slug', v_biz.slug,
    'items', v_items
  );
END;
$$;

-- 4. Public Customer Inquiry Endpoint
CREATE OR REPLACE FUNCTION public.create_public_inquiry(
  p_slug TEXT,
  p_customer_name TEXT,
  p_phone TEXT,
  p_design_no TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_inquiry_id BIGINT;
BEGIN
  IF NULLIF(TRIM(COALESCE(p_customer_name, '')), '') IS NULL OR NULLIF(TRIM(COALESCE(p_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Customer name and phone number are required';
  END IF;

  SELECT * INTO v_biz FROM public.businesses WHERE slug = LOWER(TRIM(p_slug));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business % not found', p_slug;
  END IF;

  INSERT INTO public.inquiries (
    business_id,
    customer_name,
    phone,
    design_no,
    message,
    status,
    created_at
  ) VALUES (
    v_biz.id,
    TRIM(p_customer_name),
    TRIM(p_phone),
    NULLIF(TRIM(COALESCE(p_design_no, '')), ''),
    NULLIF(TRIM(COALESCE(p_message, '')), ''),
    'pending',
    NOW()
  )
  RETURNING id INTO v_inquiry_id;

  RETURN jsonb_build_object(
    'success', true,
    'inquiry_id', v_inquiry_id
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION J: Explicit Function Permission Revocations & Grants
-- --------------------------------------------------------------------

-- Revoke default PUBLIC and anon execution from all private/helper functions
REVOKE ALL ON FUNCTION public.is_business_member(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_owner(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_order_no() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC, anon;

-- Grant execution on private/helper functions strictly to authenticated users
GRANT EXECUTE ON FUNCTION public.is_business_member(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_owner(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_no() TO authenticated;
GRANT EXECUTE ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intake_stock_tx(BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock_tx(BIGINT, BIGINT, BIGINT, INT, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_and_deduct_stock_tx(BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;

-- Revoke default PUBLIC execution from public gateway RPCs, then grant to anon and authenticated
REVOKE ALL ON FUNCTION public.get_public_product(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_order(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_invoice(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_public_inquiry(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_product(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_order(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_inquiry(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
