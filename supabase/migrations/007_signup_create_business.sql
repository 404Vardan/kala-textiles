-- ====================================================================
-- Migration 007: Self-Service Signup & Atomic Business Onboarding
-- Prerequisite:  005_auth_security_tenancy.sql must be applied first.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Case-Insensitive Unique Business Slug Index
-- --------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_businesses_slug_lower
  ON public.businesses (LOWER(slug));

-- --------------------------------------------------------------------
-- SECTION 2: Reserved Slug Guard & Availability Check RPC
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_reserved_business_slug(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(COALESCE(p_slug, ''))) = ANY (
    ARRAY[
      'admin',
      'login',
      'signup',
      'api',
      'p',
      'order',
      'invoice',
      'staff',
      'reset-password',
      'order-request',
      'auth',
      'settings',
      'www',
      'app'
    ]
  );
$$;

CREATE OR REPLACE FUNCTION public.check_slug_available(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug TEXT;
BEGIN
  v_slug := LOWER(TRIM(COALESCE(p_slug, '')));

  IF CHAR_LENGTH(v_slug) < 2 OR CHAR_LENGTH(v_slug) > 48 THEN
    RETURN jsonb_build_object(
      'available', false,
      'slug', v_slug,
      'reason', 'Slug must be between 2 and 48 characters.'
    );
  END IF;

  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RETURN jsonb_build_object(
      'available', false,
      'slug', v_slug,
      'reason', 'Slug may only contain lowercase letters, numbers, and single hyphens.'
    );
  END IF;

  IF public.is_reserved_business_slug(v_slug) THEN
    RETURN jsonb_build_object(
      'available', false,
      'slug', v_slug,
      'reason', 'This URL slug is reserved.'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE LOWER(b.slug) = v_slug
  ) THEN
    RETURN jsonb_build_object(
      'available', false,
      'slug', v_slug,
      'reason', 'This URL slug is already taken.'
    );
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'slug', v_slug,
    'reason', NULL
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: Atomic Business Creation RPC
-- Creates business, owner membership for auth.uid(), default locations
-- (GODOWN, SHOP), and default settings in a single transaction.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_business(
  name TEXT,
  slug TEXT,
  settings JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_name TEXT;
  v_slug TEXT;
  v_settings_in JSONB;
  v_gstin TEXT;
  v_address TEXT;
  v_whatsapp TEXT;
  v_order_prefix TEXT;
  v_merged_settings JSONB;
  v_biz public.businesses%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Enforce single-business membership invariant
  IF EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Your account already belongs to a business.';
  END IF;

  -- Validate shop name
  v_name := TRIM(COALESCE(name, ''));
  IF CHAR_LENGTH(v_name) < 2 OR CHAR_LENGTH(v_name) > 120 THEN
    RAISE EXCEPTION 'Business name must be between 2 and 120 characters.';
  END IF;

  -- Validate slug format and reserved words
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

  -- Validate optional settings object
  v_settings_in := COALESCE(settings, '{}'::jsonb);
  IF jsonb_typeof(v_settings_in) <> 'object' THEN
    RAISE EXCEPTION 'Settings must be a JSON object.';
  END IF;

  v_gstin := NULLIF(UPPER(TRIM(COALESCE(v_settings_in->>'gstin', ''))), '');
  IF v_gstin IS NOT NULL THEN
    IF CHAR_LENGTH(v_gstin) > 20 OR v_gstin !~ '^[0-9A-Z-]+$' THEN
      RAISE EXCEPTION 'GSTIN must contain only letters and numbers (max 20 characters).';
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

  -- Derive default order prefix from slug (alphanumeric uppercase, 2-3 chars)
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

  -- 2. Create owner membership for auth.uid()
  INSERT INTO public.memberships (user_id, business_id, role, created_at)
  VALUES (v_user_id, v_biz.id, 'owner', NOW());

  -- 3. Create default inventory locations (GODOWN, SHOP)
  INSERT INTO public.inventory_locations (business_id, name, description, created_at)
  VALUES
    (v_biz.id, 'GODOWN', 'Main warehouse / godown', NOW()),
    (v_biz.id, 'SHOP', 'Retail shop floor', NOW());

  -- 4. Create default admin_settings row
  INSERT INTO public.admin_settings (business_id, whatsapp_number, created_at, updated_at)
  VALUES (v_biz.id, COALESCE(v_whatsapp, ''), NOW(), NOW());

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
-- SECTION 4: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_reserved_business_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_reserved_business_slug(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.check_slug_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_slug_available(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_business(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business(TEXT, TEXT, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
