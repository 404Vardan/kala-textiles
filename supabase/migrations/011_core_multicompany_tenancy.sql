-- ====================================================================
-- Migration 011: Stage 1 Kala Core — Request-Scoped Multi-Company Tenancy
-- Prerequisite:  005_auth_security_tenancy.sql and 006_order_requests.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Request-Scoped Active Company Resolution
-- Reads `x-business-id` HTTP header (when present), validates membership
-- against public.memberships, and fails closed if missing/invalid for
-- multi-company users. Preserves single-company fallback (COUNT(*) = 1).
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_headers_raw TEXT;
  v_header_biz_text TEXT;
  v_header_biz_id BIGINT;
  v_single_biz_id BIGINT;
  v_membership_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. Check explicit per-request header `x-business-id`
  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NOT NULL AND v_headers_raw <> '' THEN
    BEGIN
      v_header_biz_text := TRIM(COALESCE((v_headers_raw::jsonb)->>'x-business-id', ''));
    EXCEPTION WHEN OTHERS THEN
      v_header_biz_text := '';
    END;

    IF v_header_biz_text <> '' THEN
      IF v_header_biz_text !~ '^[0-9]+$' THEN
        RETURN NULL;
      END IF;

      v_header_biz_id := v_header_biz_text::BIGINT;

      IF EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.user_id = v_uid
          AND m.business_id = v_header_biz_id
      ) THEN
        RETURN v_header_biz_id;
      END IF;

      -- Header specified an unauthorized or non-existent business -> fail closed
      RETURN NULL;
    END IF;
  END IF;

  -- 2. Single-company fallback for backward compatibility (COUNT(*) = 1)
  SELECT COUNT(*), MIN(m.business_id)
  INTO v_membership_count, v_single_biz_id
  FROM public.memberships m
  WHERE m.user_id = v_uid;

  IF v_membership_count = 1 THEN
    RETURN v_single_biz_id;
  END IF;

  -- Multi-company user without x-business-id header (or 0 memberships) -> fail closed
  RETURN NULL;
END;
$$;

-- Hardened search_path on existing membership helper functions
CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND business_id = p_business_id
      AND role = 'owner'
  );
$$;

-- --------------------------------------------------------------------
-- SECTION 2: Tighten Operational RLS Policies to Active Company Scope
-- Enforces `business_id = public.current_business_id()` on every
-- operational table so multi-company users cannot cross-read or
-- cross-write between companies across open tabs.
-- Note: `businesses` and `memberships` retain membership-wide SELECT
-- so the company switcher can list all companies a user belongs to.
-- --------------------------------------------------------------------

-- Products
DROP POLICY IF EXISTS "members_select_products" ON public.products;
DROP POLICY IF EXISTS "members_insert_products" ON public.products;
DROP POLICY IF EXISTS "members_update_products" ON public.products;
DROP POLICY IF EXISTS "owners_delete_products" ON public.products;

CREATE POLICY "members_select_products" ON public.products
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_insert_products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "members_update_products" ON public.products
  FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "owners_delete_products" ON public.products
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- Product Media
DROP POLICY IF EXISTS "members_manage_product_media" ON public.product_media;
CREATE POLICY "members_manage_product_media" ON public.product_media
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Orders
DROP POLICY IF EXISTS "members_select_orders" ON public.orders;
DROP POLICY IF EXISTS "members_insert_orders" ON public.orders;
DROP POLICY IF EXISTS "members_update_orders" ON public.orders;
DROP POLICY IF EXISTS "owners_delete_orders" ON public.orders;

CREATE POLICY "members_select_orders" ON public.orders
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_insert_orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "members_update_orders" ON public.orders
  FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "owners_delete_orders" ON public.orders
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- Order Items
DROP POLICY IF EXISTS "members_select_order_items" ON public.order_items;
DROP POLICY IF EXISTS "members_insert_order_items" ON public.order_items;
DROP POLICY IF EXISTS "members_update_order_items" ON public.order_items;
DROP POLICY IF EXISTS "members_delete_order_items" ON public.order_items;

CREATE POLICY "members_select_order_items" ON public.order_items
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_insert_order_items" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.business_id = order_items.business_id
        AND COALESCE(o.status, 'draft') = 'draft'
    )
  );

CREATE POLICY "members_update_order_items" ON public.order_items
  FOR UPDATE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.business_id = order_items.business_id
        AND COALESCE(o.status, 'draft') = 'draft'
    )
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.business_id = order_items.business_id
        AND COALESCE(o.status, 'draft') = 'draft'
    )
  );

CREATE POLICY "members_delete_order_items" ON public.order_items
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.business_id = order_items.business_id
        AND COALESCE(o.status, 'draft') = 'draft'
    )
  );

-- Order Requests & Order Request Items
DROP POLICY IF EXISTS "members_select_order_requests" ON public.order_requests;
DROP POLICY IF EXISTS "members_update_order_requests" ON public.order_requests;
DROP POLICY IF EXISTS "members_select_order_request_items" ON public.order_request_items;
DROP POLICY IF EXISTS "members_update_order_request_items" ON public.order_request_items;

CREATE POLICY "members_select_order_requests" ON public.order_requests
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_update_order_requests" ON public.order_requests
  FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id() AND status = 'requested')
  WITH CHECK (business_id = public.current_business_id() AND status = 'requested');

CREATE POLICY "members_select_order_request_items" ON public.order_request_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND r.business_id = public.current_business_id()
    )
  );

CREATE POLICY "members_update_order_request_items" ON public.order_request_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND r.business_id = public.current_business_id()
        AND r.status = 'requested'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND r.business_id = public.current_business_id()
        AND r.status = 'requested'
    )
  );

-- Parties
DROP POLICY IF EXISTS "members_manage_parties" ON public.parties;
CREATE POLICY "members_manage_parties" ON public.parties
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Agents
DROP POLICY IF EXISTS "members_manage_agents" ON public.agents;
CREATE POLICY "members_manage_agents" ON public.agents
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Inventory Locations
DROP POLICY IF EXISTS "members_manage_locations" ON public.inventory_locations;
CREATE POLICY "members_manage_locations" ON public.inventory_locations
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Inventory Stock
DROP POLICY IF EXISTS "members_manage_stock" ON public.inventory_stock;
CREATE POLICY "members_manage_stock" ON public.inventory_stock
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Stock Movements
DROP POLICY IF EXISTS "members_select_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "members_insert_movements" ON public.stock_movements;

CREATE POLICY "members_select_movements" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "members_insert_movements" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.current_business_id());

-- Invoices & Invoice Items
DROP POLICY IF EXISTS "members_manage_invoices" ON public.invoices;
DROP POLICY IF EXISTS "members_manage_invoice_items" ON public.invoice_items;

CREATE POLICY "members_manage_invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY "members_manage_invoice_items" ON public.invoice_items
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Inquiries
DROP POLICY IF EXISTS "members_manage_inquiries" ON public.inquiries;
CREATE POLICY "members_manage_inquiries" ON public.inquiries
  FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

-- Admin Settings (Owner Only in Active Company)
DROP POLICY IF EXISTS "owners_manage_settings" ON public.admin_settings;
CREATE POLICY "owners_manage_settings" ON public.admin_settings
  FOR ALL TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- --------------------------------------------------------------------
-- SECTION 3: Re-assert Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_member(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_owner(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_member(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_owner(BIGINT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
