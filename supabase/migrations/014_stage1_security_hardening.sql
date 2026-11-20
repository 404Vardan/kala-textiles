-- ====================================================================
-- Migration 014: Stage 1 Security Hardening
-- Corrective migration addressing Stage 1 audit findings without
-- silently mutating migrations 011-013.
-- Prerequisite:  011, 012, and 013 must be applied first.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Lock Down Internal Helper RPCs
-- Revoke direct execution of claim_idempotency_key,
-- complete_idempotency_key, and record_audit_event from PUBLIC, anon,
-- and authenticated. Privileged SECURITY DEFINER RPCs owned by the same
-- database owner continue to invoke them seamlessly.
-- --------------------------------------------------------------------

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  UPDATE public.idempotency_keys
  SET response_json = p_response_json
  WHERE business_id = p_business_id
    AND idempotency_key = p_idempotency_key
    AND response_json IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_idempotency_key(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_idempotency_key(BIGINT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_audit_event(BIGINT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- SECTION 2: Locked Financial Year Immutability & Counter Guard
-- Locked financial years can never be unlocked, deleted, or have
-- their dates modified via ordinary operations.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_locked_financial_year()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_locked IS TRUE THEN
      -- Allow CASCADE deletion only if the parent business itself is being removed
      IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Locked financial year "%" cannot be deleted.', OLD.label;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_locked IS TRUE THEN
      RAISE EXCEPTION 'Locked financial year "%" is immutable and cannot be unlocked or modified.', OLD.label;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_financial_year ON public.financial_years;
CREATE TRIGGER trg_guard_locked_financial_year
  BEFORE UPDATE OR DELETE ON public.financial_years
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_financial_year();

-- Update next_document_no() to explicitly reject locked FYs and validate branch ownership
CREATE OR REPLACE FUNCTION public.next_document_no(
  p_business_id BIGINT,
  p_branch_id BIGINT,
  p_fy_id BIGINT,
  p_doc_type TEXT,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc_type TEXT;
  v_prefix TEXT;
  v_branch_code TEXT;
  v_fy_label TEXT;
  v_fy_locked BOOLEAN;
  v_fy_short TEXT;
  v_val BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to business %', p_business_id;
  END IF;

  v_doc_type := UPPER(TRIM(COALESCE(p_doc_type, '')));
  IF v_doc_type = '' OR CHAR_LENGTH(v_doc_type) > 30 THEN
    RAISE EXCEPTION 'Valid doc_type is required';
  END IF;

  SELECT UPPER(TRIM(code)) INTO v_branch_code
  FROM public.branches
  WHERE id = p_branch_id AND business_id = p_business_id;

  IF v_branch_code IS NULL THEN
    RAISE EXCEPTION 'Branch % not found for business %', p_branch_id, p_business_id;
  END IF;

  SELECT label, is_locked INTO v_fy_label, v_fy_locked
  FROM public.financial_years
  WHERE id = p_fy_id AND business_id = p_business_id;

  IF v_fy_label IS NULL THEN
    RAISE EXCEPTION 'Financial year % not found for business %', p_fy_id, p_business_id;
  END IF;

  IF v_fy_locked IS TRUE THEN
    RAISE EXCEPTION 'Financial year "%" is locked and cannot issue new document numbers.', v_fy_label;
  END IF;

  v_fy_short := REGEXP_REPLACE(v_fy_label, '^FY\s*', '', 'i');

  v_prefix := NULLIF(UPPER(TRIM(COALESCE(p_prefix, ''))), '');
  IF v_prefix IS NULL THEN
    v_prefix := v_branch_code || '-' || LEFT(v_doc_type, 3);
  END IF;

  INSERT INTO public.business_document_counters (business_id, branch_id, fy_id, doc_type, last_value)
  VALUES (p_business_id, p_branch_id, p_fy_id, v_doc_type, 1)
  ON CONFLICT (business_id, branch_id, fy_id, doc_type)
  DO UPDATE SET last_value = business_document_counters.last_value + 1
  RETURNING last_value INTO v_val;

  RETURN v_prefix || '/' || v_fy_short || '/' || LPAD(v_val::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_no(BIGINT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_document_no(BIGINT, BIGINT, BIGINT, TEXT, TEXT) TO authenticated;

-- --------------------------------------------------------------------
-- SECTION 3: System Role Protection & Trigger search_path Hygiene
-- System roles cannot be deleted or renamed (role_permissions remain
-- manageable by owners).
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_system_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system IS TRUE THEN
      IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD.business_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'System role "%" cannot be deleted.', OLD.name;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_system IS TRUE THEN
      IF NEW.name IS DISTINCT FROM OLD.name OR NEW.is_system IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'System role "%" cannot be renamed or downgraded from a system role.', OLD.name;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_roles ON public.roles;
CREATE TRIGGER trg_guard_system_roles
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_system_roles();

-- Pin safe search_path on trigger functions from 012 & 013
CREATE OR REPLACE FUNCTION public.bump_row_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_audit_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events records are strictly immutable and cannot be updated or deleted.';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
