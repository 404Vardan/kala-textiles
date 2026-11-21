-- ====================================================================
-- Migration 013: Stage 1 Kala Core — Granular RBAC, Payload-Hashed
--                Idempotency Keys, Immutable Audit Log & Updated
--                create_business Onboarding
-- Prerequisite:  012_core_branches_fy_counters.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Granular RBAC (roles & role_permissions)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roles_name_check CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 2 AND 60),
  CONSTRAINT roles_business_id_id_key UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_business_name
  ON public.roles (business_id, LOWER(TRIM(name)));

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id BIGINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  CONSTRAINT role_permissions_key_check CHECK (CHAR_LENGTH(TRIM(permission_key)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_roles_business_id ON public.roles(business_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON public.role_permissions(role_id);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.roles, public.role_permissions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.roles, public.role_permissions TO authenticated;

DROP POLICY IF EXISTS "members_select_roles" ON public.roles;
DROP POLICY IF EXISTS "owners_manage_roles" ON public.roles;
DROP POLICY IF EXISTS "members_select_role_permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "owners_manage_role_permissions" ON public.role_permissions;

CREATE POLICY "members_select_roles" ON public.roles
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "owners_manage_roles" ON public.roles
  FOR ALL TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

CREATE POLICY "members_select_role_permissions" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.business_id = public.current_business_id()
    )
  );

CREATE POLICY "owners_manage_role_permissions" ON public.role_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.business_id = public.current_business_id()
        AND public.is_business_owner(r.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.business_id = public.current_business_id()
        AND public.is_business_owner(r.business_id)
    )
  );

-- Link memberships to granular role_id (preserving existing role 'owner'|'staff')
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS role_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_business_role_fkey') THEN
    ALTER TABLE public.memberships
      ADD CONSTRAINT memberships_business_role_fkey
      FOREIGN KEY (business_id, role_id)
      REFERENCES public.roles (business_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Helper to seed default system roles for a business
CREATE OR REPLACE FUNCTION public.seed_default_business_roles(p_business_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_role_id BIGINT;
  v_manager_role_id BIGINT;
  v_accountant_role_id BIGINT;
  v_inventory_role_id BIGINT;
  v_sales_role_id BIGINT;
BEGIN
  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (p_business_id, 'Owner', TRUE)
  ON CONFLICT (business_id, LOWER(TRIM(name))) DO UPDATE SET is_system = TRUE
  RETURNING id INTO v_owner_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_owner_role_id, '*')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (p_business_id, 'Manager', TRUE)
  ON CONFLICT (business_id, LOWER(TRIM(name))) DO UPDATE SET is_system = TRUE
  RETURNING id INTO v_manager_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_manager_role_id, perm
  FROM unnest(ARRAY[
    'products.read', 'products.write',
    'inventory.read', 'inventory.write', 'inventory.transfer',
    'orders.read', 'orders.write', 'orders.confirm',
    'requests.read', 'requests.manage',
    'parties.read', 'parties.write',
    'reports.operational'
  ]) AS perm
  ON CONFLICT DO NOTHING;

  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (p_business_id, 'Accountant', TRUE)
  ON CONFLICT (business_id, LOWER(TRIM(name))) DO UPDATE SET is_system = TRUE
  RETURNING id INTO v_accountant_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_accountant_role_id, perm
  FROM unnest(ARRAY[
    'orders.read', 'invoices.read', 'invoices.write', 'invoices.confirm',
    'purchases.read', 'purchases.write', 'purchases.confirm',
    'vouchers.read', 'vouchers.post', 'vouchers.reverse',
    'parties.read', 'parties.write',
    'reports.financial', 'reports.gst'
  ]) AS perm
  ON CONFLICT DO NOTHING;

  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (p_business_id, 'Inventory Staff', TRUE)
  ON CONFLICT (business_id, LOWER(TRIM(name))) DO UPDATE SET is_system = TRUE
  RETURNING id INTO v_inventory_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_inventory_role_id, perm
  FROM unnest(ARRAY[
    'products.read',
    'inventory.read', 'inventory.write', 'inventory.transfer'
  ]) AS perm
  ON CONFLICT DO NOTHING;

  INSERT INTO public.roles (business_id, name, is_system)
  VALUES (p_business_id, 'Sales Staff', TRUE)
  ON CONFLICT (business_id, LOWER(TRIM(name))) DO UPDATE SET is_system = TRUE
  RETURNING id INTO v_sales_role_id;

  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_sales_role_id, perm
  FROM unnest(ARRAY[
    'products.read',
    'inventory.read',
    'orders.read', 'orders.write',
    'parties.read', 'parties.write'
  ]) AS perm
  ON CONFLICT DO NOTHING;
END;
$$;

-- Backfill roles for all existing businesses & attach role_id to memberships
DO $$
DECLARE
  v_biz RECORD;
BEGIN
  FOR v_biz IN SELECT id FROM public.businesses LOOP
    PERFORM public.seed_default_business_roles(v_biz.id);
  END LOOP;

  UPDATE public.memberships m
  SET role_id = r.id
  FROM public.roles r
  WHERE r.business_id = m.business_id
    AND m.role_id IS NULL
    AND (
      (m.role = 'owner' AND r.name = 'Owner')
      OR (m.role = 'staff' AND r.name = 'Sales Staff')
    );
END $$;

-- Server-side permission enforcement helper for privileged RPCs
CREATE OR REPLACE FUNCTION public.has_permission(
  p_business_id BIGINT,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mem public.memberships%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_mem
  FROM public.memberships m
  WHERE m.user_id = v_uid
    AND m.business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Legacy owner role always has full business permissions
  IF v_mem.role = 'owner' THEN
    RETURN TRUE;
  END IF;

  IF v_mem.role_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role_id = v_mem.role_id
      AND rp.permission_key IN ('*', p_permission_key)
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 2: Payload-Hashed Idempotency Keys
-- Rejects key reuse with a different request_hash.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  action_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
  ON public.idempotency_keys (created_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.idempotency_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_idempotency_key(
  p_business_id BIGINT,
  p_idempotency_key UUID,
  p_action_type TEXT,
  p_request_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.idempotency_keys%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  IF p_idempotency_key IS NULL OR NULLIF(TRIM(COALESCE(p_request_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Idempotency key and request hash are required.';
  END IF;

  SELECT * INTO v_existing
  FROM public.idempotency_keys ik
  WHERE ik.business_id = p_business_id
    AND ik.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.action_type <> p_action_type THEN
      RAISE EXCEPTION 'Idempotency key conflict: key % was already used with a different request payload.', p_idempotency_key;
    END IF;
    RETURN jsonb_build_object(
      'is_replay', true,
      'response', COALESCE(v_existing.response_json, '{}'::jsonb)
    );
  END IF;

  INSERT INTO public.idempotency_keys (
    business_id,
    idempotency_key,
    action_type,
    request_hash,
    created_by,
    created_at
  ) VALUES (
    p_business_id,
    p_idempotency_key,
    p_action_type,
    p_request_hash,
    auth.uid(),
    NOW()
  );

  RETURN jsonb_build_object('is_replay', false, 'response', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_idempotency_key(
  p_business_id BIGINT,
  p_idempotency_key UUID,
  p_response_json JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.idempotency_keys
  SET response_json = p_response_json
  WHERE business_id = p_business_id
    AND idempotency_key = p_idempotency_key;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: Immutable Audit Log (Server-Derived Actor Identity)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL DEFAULT auth.uid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_biz_created
  ON public.audit_events (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON public.audit_events (business_id, entity_type, entity_id);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Append-only: no direct INSERT/UPDATE/DELETE for anon or authenticated; SELECT for owners in active company
REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_events TO authenticated;

DROP POLICY IF EXISTS "owners_select_audit_events" ON public.audit_events;
CREATE POLICY "owners_select_audit_events" ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

CREATE OR REPLACE FUNCTION public.guard_audit_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events records are strictly immutable and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_audit_events_immutable ON public.audit_events;
CREATE TRIGGER trg_guard_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_audit_events_immutable();

CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_business_id BIGINT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_action TEXT,
  p_before_json JSONB DEFAULT NULL,
  p_after_json JSONB DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to record audit event';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  INSERT INTO public.audit_events (
    business_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    before_json,
    after_json,
    created_at
  ) VALUES (
    p_business_id,
    v_uid,
    TRIM(p_entity_type),
    TRIM(p_entity_id),
    UPPER(TRIM(p_action)),
    p_before_json,
    p_after_json,
    NOW()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 4: Update create_business for Multi-Company Onboarding
-- Seeds default Branch (MAIN), active Indian FY, default locations
-- (GODOWN, SHOP), default admin_settings, and system roles atomically.
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

  -- 1. Create business
  INSERT INTO public.businesses (name, slug, settings, created_at, updated_at)
  VALUES (v_name, v_slug, v_merged_settings, NOW(), NOW())
  RETURNING * INTO v_biz;

  -- 2. Seed default system roles & resolve Owner role_id
  PERFORM public.seed_default_business_roles(v_biz.id);
  SELECT r.id INTO v_owner_role_id
  FROM public.roles AS r
  WHERE r.business_id = v_biz.id AND r.name = 'Owner'
  LIMIT 1;

  -- 3. Create owner membership for auth.uid()
  INSERT INTO public.memberships (user_id, business_id, role, role_id, created_at)
  VALUES (v_user_id, v_biz.id, 'owner', v_owner_role_id, NOW());

  -- 4. Create default MAIN branch
  INSERT INTO public.branches (business_id, code, name, gstin, state_code, address, is_default, is_active)
  VALUES (v_biz.id, 'MAIN', v_name || ' - Main Branch', v_gstin, v_state_code, v_address, TRUE, TRUE)
  RETURNING id INTO v_branch_id;

  -- 5. Create current Indian financial year (Apr 1 - Mar 31)
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

  -- 6. Create default inventory locations (GODOWN, SHOP) linked to default branch
  INSERT INTO public.inventory_locations (business_id, branch_id, name, description, created_at)
  VALUES
    (v_biz.id, v_branch_id, 'GODOWN', 'Main warehouse / godown', NOW()),
    (v_biz.id, v_branch_id, 'SHOP', 'Retail shop floor', NOW());

  -- 7. Create default admin_settings row
  INSERT INTO public.admin_settings (business_id, whatsapp_number, created_at, updated_at)
  VALUES (v_biz.id, COALESCE(v_whatsapp, ''), NOW(), NOW());

  -- 8. Record audit event
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

-- --------------------------------------------------------------------
-- SECTION 5: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.seed_default_business_roles(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_permission(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_idempotency_key(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_idempotency_key(BIGINT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_audit_event(BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_business(TEXT, TEXT, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_permission(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idempotency_key(BIGINT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_idempotency_key(BIGINT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_audit_event(BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_business(TEXT, TEXT, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
