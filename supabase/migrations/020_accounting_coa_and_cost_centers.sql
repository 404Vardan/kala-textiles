-- ====================================================================
-- Migration 020: Stage 3 Kala Finance — Chart of Accounts, Cost Centres,
--                Default Textile COA Seeding & System Account Guards
-- Prerequisite:  019_stage2_inventory_hardening.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Chart of Accounts (public.accounts)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_group TEXT NOT NULL,
  sub_group TEXT,
  party_id BIGINT,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  opening_balance_type TEXT NOT NULL DEFAULT 'DR',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_code_check CHECK (CHAR_LENGTH(TRIM(code)) BETWEEN 1 AND 32),
  CONSTRAINT accounts_name_check CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 120),
  CONSTRAINT accounts_group_check CHECK (account_group IN ('asset', 'liability', 'equity', 'income', 'expense')),
  CONSTRAINT accounts_opening_nonneg_check CHECK (opening_balance >= 0),
  CONSTRAINT accounts_opening_type_check CHECK (opening_balance_type IN ('DR', 'CR')),
  CONSTRAINT accounts_business_id_id_key UNIQUE (business_id, id),
  CONSTRAINT accounts_business_party_fkey FOREIGN KEY (business_id, party_id)
    REFERENCES public.parties (business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_business_code
  ON public.accounts (business_id, UPPER(TRIM(code)));

CREATE INDEX IF NOT EXISTS idx_accounts_business_group
  ON public.accounts (business_id, account_group, is_active);

DROP TRIGGER IF EXISTS trg_bump_row_version_accounts ON public.accounts;
CREATE TRIGGER trg_bump_row_version_accounts
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

-- Protect system accounts from deletion or code/group mutation
CREATE OR REPLACE FUNCTION public.guard_system_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system IS TRUE THEN
    RAISE EXCEPTION 'System account "%" (%) cannot be deleted.', OLD.name, OLD.code;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_system IS TRUE THEN
    IF NEW.code <> OLD.code OR NEW.account_group <> OLD.account_group OR NEW.is_system IS NOT TRUE THEN
      RAISE EXCEPTION 'System account "%" (%) code, group, and system flag cannot be modified.', OLD.name, OLD.code;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_accounts ON public.accounts;
CREATE TRIGGER trg_guard_system_accounts
  BEFORE UPDATE OR DELETE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_system_accounts();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.accounts TO authenticated;

DROP POLICY IF EXISTS "members_select_accounts" ON public.accounts;
DROP POLICY IF EXISTS "accountants_insert_accounts" ON public.accounts;
DROP POLICY IF EXISTS "accountants_update_accounts" ON public.accounts;
DROP POLICY IF EXISTS "owners_delete_accounts" ON public.accounts;

CREATE POLICY "members_select_accounts" ON public.accounts
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "accountants_insert_accounts" ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  );

CREATE POLICY "accountants_update_accounts" ON public.accounts
  FOR UPDATE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  );

CREATE POLICY "owners_delete_accounts" ON public.accounts
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- --------------------------------------------------------------------
-- SECTION 2: Cost Centres (public.cost_centers)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_centers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL DEFAULT public.current_business_id() REFERENCES public.businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_centers_code_check CHECK (CHAR_LENGTH(TRIM(code)) BETWEEN 1 AND 32),
  CONSTRAINT cost_centers_name_check CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 120),
  CONSTRAINT cost_centers_business_id_id_key UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_centers_business_code
  ON public.cost_centers (business_id, UPPER(TRIM(code)));

DROP TRIGGER IF EXISTS trg_bump_row_version_cost_centers ON public.cost_centers;
CREATE TRIGGER trg_bump_row_version_cost_centers
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_row_version();

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cost_centers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cost_centers TO authenticated;

DROP POLICY IF EXISTS "members_select_cost_centers" ON public.cost_centers;
DROP POLICY IF EXISTS "accountants_insert_cost_centers" ON public.cost_centers;
DROP POLICY IF EXISTS "accountants_update_cost_centers" ON public.cost_centers;
DROP POLICY IF EXISTS "owners_delete_cost_centers" ON public.cost_centers;

CREATE POLICY "members_select_cost_centers" ON public.cost_centers
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY "accountants_insert_cost_centers" ON public.cost_centers
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  );

CREATE POLICY "accountants_update_cost_centers" ON public.cost_centers
  FOR UPDATE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  )
  WITH CHECK (
    business_id = public.current_business_id()
    AND (public.has_permission(business_id, 'vouchers.post') OR public.is_business_owner(business_id))
  );

CREATE POLICY "owners_delete_cost_centers" ON public.cost_centers
  FOR DELETE TO authenticated
  USING (
    business_id = public.current_business_id()
    AND public.is_business_owner(business_id)
  );

-- --------------------------------------------------------------------
-- SECTION 3: Internal Default Textile Chart of Accounts Seeder
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_business_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.accounts (business_id, code, name, account_group, sub_group, opening_balance, opening_balance_type, is_system)
  VALUES
    (p_business_id, '1000', 'Cash in Hand', 'asset', 'Current Assets', 0, 'DR', TRUE),
    (p_business_id, '1010', 'Bank Account', 'asset', 'Current Assets', 0, 'DR', TRUE),
    (p_business_id, '1100', 'Sundry Debtors', 'asset', 'Accounts Receivable', 0, 'DR', TRUE),
    (p_business_id, '1200', 'Inventory Asset', 'asset', 'Current Assets', 0, 'DR', TRUE),
    (p_business_id, '1300', 'Input CGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE),
    (p_business_id, '1310', 'Input SGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE),
    (p_business_id, '1320', 'Input IGST', 'asset', 'Duties & Taxes', 0, 'DR', TRUE),
    (p_business_id, '2000', 'Sundry Creditors', 'liability', 'Accounts Payable', 0, 'CR', TRUE),
    (p_business_id, '2100', 'Output CGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE),
    (p_business_id, '2110', 'Output SGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE),
    (p_business_id, '2120', 'Output IGST', 'liability', 'Duties & Taxes', 0, 'CR', TRUE),
    (p_business_id, '3000', 'Owner Capital', 'equity', 'Capital Account', 0, 'CR', TRUE),
    (p_business_id, '3100', 'Retained Earnings / Reserves', 'equity', 'Reserves & Surplus', 0, 'CR', TRUE),
    (p_business_id, '4000', 'Sales Revenue', 'income', 'Direct Income', 0, 'CR', TRUE),
    (p_business_id, '4100', 'Sales Returns', 'income', 'Direct Income', 0, 'DR', TRUE),
    (p_business_id, '5000', 'Purchases', 'expense', 'Direct Expenses', 0, 'DR', TRUE),
    (p_business_id, '5100', 'Cost of Goods Sold', 'expense', 'Direct Expenses', 0, 'DR', TRUE),
    (p_business_id, '5200', 'Job Work & Mill Charges', 'expense', 'Direct Expenses', 0, 'DR', TRUE),
    (p_business_id, '5300', 'Freight & Forwarding', 'expense', 'Indirect Expenses', 0, 'DR', TRUE),
    (p_business_id, '5400', 'Discount Allowed', 'expense', 'Indirect Expenses', 0, 'DR', TRUE),
    (p_business_id, '5500', 'Round Off', 'expense', 'Indirect Expenses', 0, 'DR', TRUE)
  ON CONFLICT (business_id, UPPER(TRIM(code))) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_chart_of_accounts(BIGINT) FROM PUBLIC, anon, authenticated;

-- Backfill COA for all existing businesses
DO $$
DECLARE
  v_biz RECORD;
BEGIN
  FOR v_biz IN SELECT id FROM public.businesses LOOP
    PERFORM public.seed_default_chart_of_accounts(v_biz.id);
  END LOOP;
END $$;

-- --------------------------------------------------------------------
-- SECTION 4: Hook Default COA Seeding into create_business()
-- Preserves exact Stage 1 create_business() behavior + seeds COA.
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
  FROM public.roles AS r
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

  -- Seed default Indian Textile Chart of Accounts
  PERFORM public.seed_default_chart_of_accounts(v_biz.id);

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

COMMIT;

NOTIFY pgrst, 'reload schema';

