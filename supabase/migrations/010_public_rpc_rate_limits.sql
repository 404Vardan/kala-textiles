-- ====================================================================
-- Migration 010: Public RPC Rate Limiting & Input Validation
-- Prerequisite:  005_auth_security_tenancy.sql and 006_order_requests.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Create public_request_log Table (Internal Only)
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.public_request_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('order_request', 'inquiry')),
  phone_digits TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_request_log_biz_action_time
  ON public.public_request_log (business_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_request_log_phone_action_time
  ON public.public_request_log (phone_digits, action_type, created_at DESC);

ALTER TABLE public.public_request_log ENABLE ROW LEVEL SECURITY;

-- No direct access from anon or authenticated roles; accessed only via SECURITY DEFINER RPCs
REVOKE ALL ON TABLE public.public_request_log FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- SECTION 2: Internal Rate-Limit Enforcement Helper
-- Caps public submissions to N per business/hour and M per phone/hour.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_public_rate_limit(
  p_business_id BIGINT,
  p_action_type TEXT,
  p_phone_digits TEXT,
  p_max_per_business_hour INT DEFAULT 60,
  p_max_per_phone_hour INT DEFAULT 10
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz_count INT;
  v_phone_count INT;
  v_window_start TIMESTAMPTZ := NOW() - INTERVAL '1 hour';
BEGIN
  -- Serialize rate checks per business + action within transaction
  PERFORM pg_advisory_xact_lock(hashtext('pub_rl:' || p_business_id::TEXT || ':' || p_action_type));

  SELECT COUNT(*) INTO v_biz_count
  FROM public.public_request_log
  WHERE business_id = p_business_id
    AND action_type = p_action_type
    AND created_at >= v_window_start;

  IF COALESCE(v_biz_count, 0) >= p_max_per_business_hour THEN
    RAISE EXCEPTION 'This shop is receiving a high volume of requests right now. Please try again later or contact the shop directly.';
  END IF;

  SELECT COUNT(*) INTO v_phone_count
  FROM public.public_request_log
  WHERE phone_digits = p_phone_digits
    AND action_type = p_action_type
    AND created_at >= v_window_start;

  IF COALESCE(v_phone_count, 0) >= p_max_per_phone_hour THEN
    RAISE EXCEPTION 'Too many requests from this phone number. Please wait an hour before submitting another request or contact the shop directly.';
  END IF;

  INSERT INTO public.public_request_log (business_id, action_type, phone_digits, created_at)
  VALUES (p_business_id, p_action_type, p_phone_digits, NOW());
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_public_rate_limit(BIGINT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- SECTION 3: Hardened submit_order_request with Rate Caps & Validation
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_order_request(
  p_slug TEXT,
  p_party_name TEXT,
  p_phone TEXT,
  p_items JSONB,
  p_note TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug TEXT;
  v_business_id BIGINT;
  v_party_name TEXT;
  v_phone TEXT;
  v_digits_only TEXT;
  v_note TEXT;
  v_item_count INT;
  v_elem JSONB;
  v_design_no TEXT;
  v_sets_text TEXT;
  v_sets INT;
  v_rec RECORD;
  v_product_id BIGINT;
  v_request_id BIGINT;
BEGIN
  -- 1. Validate and resolve business slug
  v_slug := LOWER(TRIM(COALESCE(p_slug, '')));
  IF CHAR_LENGTH(v_slug) < 2 OR CHAR_LENGTH(v_slug) > 48 OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid business identifier.';
  END IF;

  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = v_slug;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Business "%" not found.', p_slug;
  END IF;

  -- 2. Validate customer / party name
  v_party_name := TRIM(COALESCE(p_party_name, ''));
  IF CHAR_LENGTH(v_party_name) < 2 OR CHAR_LENGTH(v_party_name) > 120 THEN
    RAISE EXCEPTION 'Customer name must be between 2 and 120 characters.';
  END IF;

  IF v_party_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Customer name contains invalid characters.';
  END IF;

  -- 3. Validate phone number
  v_phone := TRIM(COALESCE(p_phone, ''));
  IF CHAR_LENGTH(v_phone) < 7 OR CHAR_LENGTH(v_phone) > 20 THEN
    RAISE EXCEPTION 'Phone number must be between 7 and 20 characters.';
  END IF;

  IF v_phone !~ '^[0-9+() .-]+$' THEN
    RAISE EXCEPTION 'Phone number contains invalid characters.';
  END IF;

  v_digits_only := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
  IF CHAR_LENGTH(v_digits_only) < 7 OR CHAR_LENGTH(v_digits_only) > 15 THEN
    RAISE EXCEPTION 'Phone number must contain between 7 and 15 digits.';
  END IF;

  -- 4. Validate optional note
  v_note := NULLIF(TRIM(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    IF CHAR_LENGTH(v_note) > 1000 THEN
      RAISE EXCEPTION 'Note cannot exceed 1000 characters.';
    END IF;
    IF v_note ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' THEN
      RAISE EXCEPTION 'Note contains invalid characters.';
    END IF;
  END IF;

  -- 5. Validate items JSON array
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a non-empty JSON array.';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'Order request must contain at least one item.';
  END IF;

  IF v_item_count > 100 THEN
    RAISE EXCEPTION 'Order request cannot exceed 100 items.';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'Each item in p_items must be a JSON object.';
    END IF;

    IF jsonb_typeof(v_elem->'design_no') <> 'string' THEN
      RAISE EXCEPTION 'Each item must include a valid design_no string.';
    END IF;

    v_design_no := TRIM(COALESCE(v_elem->>'design_no', ''));
    IF CHAR_LENGTH(v_design_no) < 1 OR CHAR_LENGTH(v_design_no) > 60 OR v_design_no !~ '^[A-Za-z0-9 _./#-]+$' THEN
      RAISE EXCEPTION 'Invalid design_no in order request items.';
    END IF;

    IF jsonb_typeof(v_elem->'sets') <> 'number' THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be a number.', v_design_no;
    END IF;

    v_sets_text := TRIM(COALESCE(v_elem->>'sets', ''));
    IF v_sets_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be a positive integer.', v_design_no;
    END IF;

    v_sets := v_sets_text::INT;
    IF v_sets < 1 OR v_sets > 500 THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be between 1 and 500.', v_design_no;
    END IF;
  END LOOP;

  -- 6. Enforce hourly rate caps (60/hour per business, 10/hour per phone)
  PERFORM public.enforce_public_rate_limit(v_business_id, 'order_request', v_digits_only, 60, 10);

  -- 7. Insert parent order_request row
  INSERT INTO public.order_requests (
    business_id,
    party_name,
    phone,
    status,
    note,
    created_at
  ) VALUES (
    v_business_id,
    v_party_name,
    v_phone,
    'requested',
    v_note,
    NOW()
  )
  RETURNING id INTO v_request_id;

  -- 8. Aggregate duplicate design numbers deterministically, resolve active products, and insert items
  FOR v_rec IN (
    SELECT
      UPPER(TRIM(elem->>'design_no')) AS norm_design_no,
      MIN(TRIM(elem->>'design_no')) AS raw_design_no,
      SUM((elem->>'sets')::INT)::INT AS total_sets
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY UPPER(TRIM(elem->>'design_no'))
    ORDER BY UPPER(TRIM(elem->>'design_no')) ASC
  ) LOOP
    IF v_rec.total_sets < 1 OR v_rec.total_sets > 500 THEN
      RAISE EXCEPTION 'Combined set quantity for design "%" must be between 1 and 500.', v_rec.raw_design_no;
    END IF;

    SELECT id INTO v_product_id
    FROM public.products
    WHERE business_id = v_business_id
      AND UPPER(TRIM(design_no)) = v_rec.norm_design_no
      AND COALESCE(is_active, TRUE) IS TRUE;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Design "%" is not available or is no longer active.', v_rec.raw_design_no;
    END IF;

    INSERT INTO public.order_request_items (
      request_id,
      product_id,
      sets
    ) VALUES (
      v_request_id,
      v_product_id,
      v_rec.total_sets
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 4: Hardened create_public_inquiry with Rate Caps & Validation
-- --------------------------------------------------------------------

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
  v_slug TEXT;
  v_biz public.businesses%ROWTYPE;
  v_customer_name TEXT;
  v_phone TEXT;
  v_digits_only TEXT;
  v_design_no TEXT;
  v_message TEXT;
  v_inquiry_id BIGINT;
BEGIN
  -- 1. Validate slug
  v_slug := LOWER(TRIM(COALESCE(p_slug, '')));
  IF CHAR_LENGTH(v_slug) < 2 OR CHAR_LENGTH(v_slug) > 48 OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid business identifier.';
  END IF;

  SELECT * INTO v_biz
  FROM public.businesses
  WHERE slug = v_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business "%" not found.', p_slug;
  END IF;

  -- 2. Validate customer name
  v_customer_name := TRIM(COALESCE(p_customer_name, ''));
  IF CHAR_LENGTH(v_customer_name) < 2 OR CHAR_LENGTH(v_customer_name) > 120 THEN
    RAISE EXCEPTION 'Customer name must be between 2 and 120 characters.';
  END IF;

  IF v_customer_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Customer name contains invalid characters.';
  END IF;

  -- 3. Validate phone number
  v_phone := TRIM(COALESCE(p_phone, ''));
  IF CHAR_LENGTH(v_phone) < 7 OR CHAR_LENGTH(v_phone) > 20 THEN
    RAISE EXCEPTION 'Phone number must be between 7 and 20 characters.';
  END IF;

  IF v_phone !~ '^[0-9+() .-]+$' THEN
    RAISE EXCEPTION 'Phone number contains invalid characters.';
  END IF;

  v_digits_only := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
  IF CHAR_LENGTH(v_digits_only) < 7 OR CHAR_LENGTH(v_digits_only) > 15 THEN
    RAISE EXCEPTION 'Phone number must contain between 7 and 15 digits.';
  END IF;

  -- 4. Validate optional design_no
  v_design_no := NULLIF(TRIM(COALESCE(p_design_no, '')), '');
  IF v_design_no IS NOT NULL THEN
    IF CHAR_LENGTH(v_design_no) > 60 OR v_design_no !~ '^[A-Za-z0-9 _./#-]+$' THEN
      RAISE EXCEPTION 'Design number format is invalid (max 60 characters).';
    END IF;
  END IF;

  -- 5. Validate optional message
  v_message := NULLIF(TRIM(COALESCE(p_message, '')), '');
  IF v_message IS NOT NULL THEN
    IF CHAR_LENGTH(v_message) > 1000 THEN
      RAISE EXCEPTION 'Inquiry message cannot exceed 1000 characters.';
    END IF;
    IF v_message ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' THEN
      RAISE EXCEPTION 'Inquiry message contains invalid characters.';
    END IF;
  END IF;

  -- 6. Enforce hourly rate caps (60/hour per business, 10/hour per phone)
  PERFORM public.enforce_public_rate_limit(v_biz.id, 'inquiry', v_digits_only, 60, 10);

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
    v_customer_name,
    v_phone,
    v_design_no,
    v_message,
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
-- SECTION 5: Re-assert Explicit Function Permissions
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_public_inquiry(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_inquiry(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
