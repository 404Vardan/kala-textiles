-- ====================================================================
-- Migration 008: Owner-Only Team Management & Last-Owner Protection
-- Prerequisite:  005_auth_security_tenancy.sql must be applied first.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Database-Level Last-Owner Invariant Trigger
-- Prevents removing or demoting the last owner of a business,
-- while still allowing cascading deletes when the business is deleted.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_last_business_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_owners INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      -- Allow CASCADE deletion if the parent business itself is being deleted
      IF NOT EXISTS (
        SELECT 1
        FROM public.businesses b
        WHERE b.id = OLD.business_id
      ) THEN
        RETURN OLD;
      END IF;

      -- Lock all owner memberships for this business to prevent race conditions
      PERFORM 1
      FROM public.memberships m
      WHERE m.business_id = OLD.business_id
        AND m.role = 'owner'
      FOR UPDATE;

      SELECT COUNT(*) INTO v_other_owners
      FROM public.memberships m
      WHERE m.business_id = OLD.business_id
        AND m.role = 'owner'
        AND m.user_id <> OLD.user_id;

      IF COALESCE(v_other_owners, 0) = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last owner of a business.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      PERFORM 1
      FROM public.memberships m
      WHERE m.business_id = OLD.business_id
        AND m.role = 'owner'
      FOR UPDATE;

      SELECT COUNT(*) INTO v_other_owners
      FROM public.memberships m
      WHERE m.business_id = OLD.business_id
        AND m.role = 'owner'
        AND m.user_id <> OLD.user_id;

      IF COALESCE(v_other_owners, 0) = 0 THEN
        RAISE EXCEPTION 'Cannot demote the last owner of a business.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_last_business_owner ON public.memberships;
CREATE TRIGGER trg_guard_last_business_owner
  BEFORE UPDATE OR DELETE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_business_owner();

-- --------------------------------------------------------------------
-- SECTION 2: Owner-Only Team Management RPCs
-- --------------------------------------------------------------------

-- 1. List all members of the caller's business (Owner only)
CREATE OR REPLACE FUNCTION public.list_business_members()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_members JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_business_id := public.current_business_id();
  IF v_business_id IS NULL OR NOT public.is_business_owner(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: only a business owner can view team members';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'user_id', m.user_id,
        'business_id', m.business_id,
        'email', COALESCE(u.email, ''),
        'role', m.role,
        'created_at', m.created_at,
        'email_confirmed_at', u.email_confirmed_at
      )
      ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_members
  FROM public.memberships m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.business_id = v_business_id;

  RETURN v_members;
END;
$$;

-- 2. Change a team member's role (Owner only; cannot demote last owner)
CREATE OR REPLACE FUNCTION public.update_member_role(
  p_user_id UUID,
  p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_clean_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_business_id := public.current_business_id();
  IF v_business_id IS NULL OR NOT public.is_business_owner(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: only a business owner can change team roles';
  END IF;

  v_clean_role := LOWER(TRIM(COALESCE(p_new_role, '')));
  IF v_clean_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Invalid role "%". Must be "owner" or "staff".', p_new_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = p_user_id
      AND m.business_id = v_business_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Team member not found in your business.';
  END IF;

  UPDATE public.memberships
  SET role = v_clean_role
  WHERE user_id = p_user_id
    AND business_id = v_business_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', v_clean_role
  );
END;
$$;

-- 3. Remove a team member from the business (Owner only; cannot remove last owner)
CREATE OR REPLACE FUNCTION public.remove_business_member(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_business_id := public.current_business_id();
  IF v_business_id IS NULL OR NOT public.is_business_owner(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: only a business owner can remove team members';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = p_user_id
      AND m.business_id = v_business_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Team member not found in your business.';
  END IF;

  DELETE FROM public.memberships
  WHERE user_id = p_user_id
    AND business_id = v_business_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 3: Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.guard_last_business_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_business_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_member_role(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_business_member(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.guard_last_business_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_business_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_business_member(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
