-- ====================================================================
-- Migration 006: QR Buyer Order Requests, Atomic Draft Conversion &
--                Public-Safe Business WhatsApp Settings
-- Prerequisite:  005_auth_security_tenancy.sql must be applied first.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 0: Verify Prerequisite Migration 005 Objects Exist
-- --------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.businesses') IS NULL
     OR to_regclass('public.memberships') IS NULL
     OR to_regprocedure('public.is_business_member(bigint)') IS NULL
     OR to_regprocedure('public.is_business_owner(bigint)') IS NULL
     OR to_regprocedure('public.current_business_id()') IS NULL
     OR to_regprocedure('public.generate_order_no()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite migration 005_auth_security_tenancy.sql must be applied before running 006_order_requests.sql';
  END IF;
END $$;

-- --------------------------------------------------------------------
-- SECTION 1: Create order_requests and order_request_items Tables
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  party_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_requests_status_check CHECK (status IN ('requested', 'converted', 'rejected')),
  CONSTRAINT order_requests_party_name_check CHECK (CHAR_LENGTH(TRIM(party_name)) BETWEEN 1 AND 120),
  CONSTRAINT order_requests_phone_check CHECK (CHAR_LENGTH(TRIM(phone)) BETWEEN 7 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_order_requests_business_id
  ON public.order_requests(business_id);

CREATE INDEX IF NOT EXISTS idx_order_requests_business_status_created
  ON public.order_requests(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_requests_created_at
  ON public.order_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_request_items (
  request_id BIGINT NOT NULL REFERENCES public.order_requests(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sets INTEGER NOT NULL,
  PRIMARY KEY (request_id, product_id),
  CONSTRAINT order_request_items_sets_check CHECK (sets BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_order_request_items_request_id
  ON public.order_request_items(request_id);

CREATE INDEX IF NOT EXISTS idx_order_request_items_product_id
  ON public.order_request_items(product_id);

-- --------------------------------------------------------------------
-- SECTION 2: Tenant & Lifecycle Integrity Triggers on Order Requests
-- --------------------------------------------------------------------

-- Ensure order_request_items always reference a product from the same business
-- as the parent order_request, and can only be modified while status = 'requested'.
CREATE OR REPLACE FUNCTION public.guard_order_request_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_business_id BIGINT;
  v_req_status TEXT;
  v_prod_business_id BIGINT;
BEGIN
  SELECT business_id, status
  INTO v_req_business_id, v_req_status
  FROM public.order_requests
  WHERE id = NEW.request_id;

  IF v_req_business_id IS NULL THEN
    RAISE EXCEPTION 'Parent order request % not found', NEW.request_id;
  END IF;

  IF v_req_status <> 'requested' THEN
    RAISE EXCEPTION 'Cannot add or modify items on a processed order request (status: %)', v_req_status;
  END IF;

  SELECT business_id
  INTO v_prod_business_id
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_prod_business_id IS NULL OR v_prod_business_id <> v_req_business_id THEN
    RAISE EXCEPTION 'Product % does not belong to the order request business', NEW.product_id;
  END IF;

  IF NEW.sets IS NULL OR NEW.sets < 1 OR NEW.sets > 500 THEN
    RAISE EXCEPTION 'Requested sets must be between 1 and 500';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_request_items ON public.order_request_items;
CREATE TRIGGER trg_guard_order_request_items
  BEFORE INSERT OR UPDATE ON public.order_request_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_request_items();

-- Prevent mutating immutable columns or reverting converted/rejected requests
CREATE OR REPLACE FUNCTION public.guard_order_requests_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Cannot modify immutable order_requests identifiers or timestamps';
  END IF;

  IF OLD.status <> 'requested' THEN
    RAISE EXCEPTION 'Order request % has already been % and cannot be modified', OLD.id, OLD.status;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF COALESCE(current_setting('app.order_request_rpc', true), '') <> 'true' THEN
      RAISE EXCEPTION 'Order request status can only be changed through convert_order_request or reject_order_request';
    END IF;
  END IF;

  NEW.party_name := TRIM(COALESCE(NEW.party_name, ''));
  NEW.phone := TRIM(COALESCE(NEW.phone, ''));
  NEW.note := NULLIF(TRIM(COALESCE(NEW.note, '')), '');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_requests_update ON public.order_requests;
CREATE TRIGGER trg_guard_order_requests_update
  BEFORE UPDATE ON public.order_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_requests_update();

-- --------------------------------------------------------------------
-- SECTION 3: Row Level Security (RLS) & Column-Level Table Grants
-- --------------------------------------------------------------------

ALTER TABLE public.order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_request_items ENABLE ROW LEVEL SECURITY;

-- Revoke all direct table access from PUBLIC, anon, and authenticated first
REVOKE ALL ON TABLE public.order_requests, public.order_request_items FROM PUBLIC, anon, authenticated;

-- Grant strictly scoped read and column-level update permissions to authenticated members
-- Note: Direct INSERT and DELETE are NOT granted; creation and status transitions go through RPCs.
GRANT SELECT ON TABLE public.order_requests TO authenticated;
GRANT UPDATE (party_name, phone, note) ON TABLE public.order_requests TO authenticated;

GRANT SELECT ON TABLE public.order_request_items TO authenticated;
GRANT UPDATE (sets) ON TABLE public.order_request_items TO authenticated;

-- Drop any existing policies for idempotency
DROP POLICY IF EXISTS "members_select_order_requests" ON public.order_requests;
DROP POLICY IF EXISTS "members_update_order_requests" ON public.order_requests;
DROP POLICY IF EXISTS "members_select_order_request_items" ON public.order_request_items;
DROP POLICY IF EXISTS "members_update_order_request_items" ON public.order_request_items;

-- Policies for order_requests
CREATE POLICY "members_select_order_requests" ON public.order_requests
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "members_update_order_requests" ON public.order_requests
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id) AND status = 'requested')
  WITH CHECK (public.is_business_member(business_id) AND status = 'requested');

-- Policies for order_request_items (enforced via parent request membership)
CREATE POLICY "members_select_order_request_items" ON public.order_request_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND public.is_business_member(r.business_id)
    )
  );

CREATE POLICY "members_update_order_request_items" ON public.order_request_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND public.is_business_member(r.business_id)
        AND r.status = 'requested'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.order_requests r
      WHERE r.id = order_request_items.request_id
        AND public.is_business_member(r.business_id)
        AND r.status = 'requested'
    )
  );

-- --------------------------------------------------------------------
-- SECTION 4: Public Order Request Submission RPC
-- --------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.submit_order_request(TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.submit_order_request(TEXT, TEXT, TEXT, JSONB, TEXT);

-- Canonical 5-argument implementation (with optional customer note)
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
  IF v_slug = '' THEN
    RAISE EXCEPTION 'Business slug is required';
  END IF;

  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = v_slug;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Business "%" not found', p_slug;
  END IF;

  -- 2. Validate customer / party name
  v_party_name := TRIM(COALESCE(p_party_name, ''));
  IF CHAR_LENGTH(v_party_name) < 1 OR CHAR_LENGTH(v_party_name) > 120 THEN
    RAISE EXCEPTION 'Customer name is required and must be between 1 and 120 characters';
  END IF;

  -- 3. Validate phone number
  v_phone := TRIM(COALESCE(p_phone, ''));
  IF CHAR_LENGTH(v_phone) < 7 OR CHAR_LENGTH(v_phone) > 20 THEN
    RAISE EXCEPTION 'Phone number must be between 7 and 20 characters';
  END IF;

  IF v_phone !~ '^[0-9+() .-]+$' THEN
    RAISE EXCEPTION 'Phone number contains invalid characters';
  END IF;

  v_digits_only := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
  IF CHAR_LENGTH(v_digits_only) < 7 OR CHAR_LENGTH(v_digits_only) > 15 THEN
    RAISE EXCEPTION 'Phone number must contain between 7 and 15 digits';
  END IF;

  -- 4. Validate optional note
  v_note := NULLIF(TRIM(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND CHAR_LENGTH(v_note) > 1000 THEN
    RAISE EXCEPTION 'Note cannot exceed 1000 characters';
  END IF;

  -- 5. Validate items JSON array
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a non-empty JSON array';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'Order request must contain at least one item';
  END IF;

  IF v_item_count > 100 THEN
    RAISE EXCEPTION 'Order request cannot exceed 100 items';
  END IF;

  -- Validate each item element structure before resolution
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'Each item in p_items must be a JSON object';
    END IF;

    IF jsonb_typeof(v_elem->'design_no') <> 'string' THEN
      RAISE EXCEPTION 'Each item must include a valid design_no string';
    END IF;

    v_design_no := TRIM(COALESCE(v_elem->>'design_no', ''));
    IF v_design_no = '' OR CHAR_LENGTH(v_design_no) > 100 THEN
      RAISE EXCEPTION 'Invalid design_no in order request items';
    END IF;

    IF jsonb_typeof(v_elem->'sets') <> 'number' THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be a number', v_design_no;
    END IF;

    v_sets_text := TRIM(COALESCE(v_elem->>'sets', ''));
    IF v_sets_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be a positive integer', v_design_no;
    END IF;

    v_sets := v_sets_text::INT;
    IF v_sets < 1 OR v_sets > 500 THEN
      RAISE EXCEPTION 'Set quantity for design "%" must be between 1 and 500', v_design_no;
    END IF;
  END LOOP;

  -- 6. Insert parent order_request row
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

  -- 7. Aggregate duplicate design numbers deterministically, resolve active products in this business, and insert items
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
      RAISE EXCEPTION 'Combined set quantity for design "%" must be between 1 and 500', v_rec.raw_design_no;
    END IF;

    SELECT id INTO v_product_id
    FROM public.products
    WHERE business_id = v_business_id
      AND UPPER(TRIM(design_no)) = v_rec.norm_design_no
      AND COALESCE(is_active, TRUE) IS TRUE;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Design "%" is not available or is no longer active', v_rec.raw_design_no;
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

-- 4-argument overload (required interface: p_slug, p_party_name, p_phone, p_items)
CREATE OR REPLACE FUNCTION public.submit_order_request(
  p_slug TEXT,
  p_party_name TEXT,
  p_phone TEXT,
  p_items JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.submit_order_request(
    p_slug => p_slug,
    p_party_name => p_party_name,
    p_phone => p_phone,
    p_items => p_items,
    p_note => NULL
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 5: Request Rejection & Atomic Draft Order Conversion RPCs
-- --------------------------------------------------------------------

-- 1. Reject Order Request RPC
CREATE OR REPLACE FUNCTION public.reject_order_request(
  p_request_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.order_requests%ROWTYPE;
  v_active_biz BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_req
  FROM public.order_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order request % not found', p_request_id;
  END IF;

  v_active_biz := public.current_business_id();
  IF v_active_biz IS NULL OR v_active_biz <> v_req.business_id OR NOT public.is_business_member(v_req.business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to the request business';
  END IF;

  IF v_req.status <> 'requested' THEN
    RAISE EXCEPTION 'Order request #% has already been %', p_request_id, v_req.status;
  END IF;

  -- Allow controlled status transition inside this RPC transaction
  PERFORM set_config('app.order_request_rpc', 'true', true);

  UPDATE public.order_requests
  SET status = 'rejected'
  WHERE id = p_request_id;

  PERFORM set_config('app.order_request_rpc', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'status', 'rejected'
  );
END;
$$;

-- 2. Atomic Convert Order Request to Draft Order RPC
CREATE OR REPLACE FUNCTION public.convert_order_request(
  p_request_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.order_requests%ROWTYPE;
  v_active_biz BIGINT;
  v_item_count INT;
  v_unavailable_design TEXT;
  v_party public.parties%ROWTYPE;
  v_party_name TEXT;
  v_station TEXT;
  v_gst_number TEXT;
  v_order_no TEXT;
  v_total_amount NUMERIC(12, 2) := 0;
  v_order_id BIGINT;
  v_order_notes TEXT;
  v_item RECORD;
  v_pcs_per_set INT;
  v_rate NUMERIC(10, 2);
  v_total_pcs INT;
  v_line_total NUMERIC(12, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 1. Lock the order_request row FOR UPDATE
  SELECT * INTO v_req
  FROM public.order_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order request % not found', p_request_id;
  END IF;

  -- 2. Verify authenticated user's single active business matches the request business
  v_active_biz := public.current_business_id();
  IF v_active_biz IS NULL OR v_active_biz <> v_req.business_id OR NOT public.is_business_member(v_req.business_id) THEN
    RAISE EXCEPTION 'Unauthorized: user does not belong to the request business';
  END IF;

  -- 3. Verify request status is still 'requested'
  IF v_req.status <> 'requested' THEN
    RAISE EXCEPTION 'Order request #% has already been %', p_request_id, v_req.status;
  END IF;

  -- 4. Lock request items and referenced products to ensure consistency
  PERFORM 1
  FROM public.order_request_items ori
  WHERE ori.request_id = p_request_id
  ORDER BY ori.product_id ASC
  FOR UPDATE;

  SELECT COUNT(*) INTO v_item_count
  FROM public.order_request_items
  WHERE request_id = p_request_id;

  IF COALESCE(v_item_count, 0) = 0 THEN
    RAISE EXCEPTION 'Order request #% has no items to convert', p_request_id;
  END IF;

  PERFORM 1
  FROM public.products p
  WHERE p.id IN (
    SELECT ori.product_id
    FROM public.order_request_items ori
    WHERE ori.request_id = p_request_id
  )
  ORDER BY p.id ASC
  FOR SHARE;

  -- Verify all requested products still belong to the business and are active
  SELECT COALESCE(p.design_no, ori.product_id::TEXT)
  INTO v_unavailable_design
  FROM public.order_request_items ori
  LEFT JOIN public.products p
    ON p.id = ori.product_id
   AND p.business_id = v_req.business_id
  WHERE ori.request_id = p_request_id
    AND (p.id IS NULL OR COALESCE(p.is_active, TRUE) IS FALSE)
  LIMIT 1;

  IF v_unavailable_design IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot convert request: product design "%" is archived or unavailable', v_unavailable_design;
  END IF;

  -- 5. Resolve or create party in the same business (case-insensitive)
  SELECT * INTO v_party
  FROM public.parties
  WHERE business_id = v_req.business_id
    AND LOWER(TRIM(name)) = LOWER(TRIM(v_req.party_name))
  ORDER BY id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_party_name := v_party.name;
    v_station := v_party.station;
    v_gst_number := v_party.gst_number;

    -- Populate phone only if missing on existing party record
    IF NULLIF(TRIM(COALESCE(v_party.phone, '')), '') IS NULL
       AND NULLIF(TRIM(COALESCE(v_req.phone, '')), '') IS NOT NULL THEN
      UPDATE public.parties
      SET phone = TRIM(v_req.phone),
          updated_at = NOW()
      WHERE id = v_party.id;
    END IF;
  ELSE
    v_party_name := TRIM(v_req.party_name);
    v_station := NULL;
    v_gst_number := NULL;

    INSERT INTO public.parties (
      business_id,
      name,
      phone,
      created_at,
      updated_at
    ) VALUES (
      v_req.business_id,
      v_party_name,
      TRIM(v_req.phone),
      NOW(),
      NOW()
    )
    ON CONFLICT (business_id, name) DO UPDATE
      SET phone = COALESCE(NULLIF(TRIM(public.parties.phone), ''), EXCLUDED.phone),
          updated_at = NOW()
    RETURNING name, station, gst_number INTO v_party_name, v_station, v_gst_number;
  END IF;

  -- 6. Calculate total order amount from authoritative product rates & pcs_per_set
  SELECT COALESCE(
    SUM(
      ROUND(
        (
          ori.sets
          * GREATEST(COALESCE(p.pcs_per_set, 1), 1)
          * GREATEST(COALESCE(p.rate, 0), 0)
        )::NUMERIC,
        2
      )
    ),
    0
  )
  INTO v_total_amount
  FROM public.order_request_items ori
  JOIN public.products p ON p.id = ori.product_id
  WHERE ori.request_id = p_request_id;

  -- 7. Generate atomic business-scoped order number
  v_order_no := public.generate_order_no();

  v_order_notes := CASE
    WHEN NULLIF(TRIM(COALESCE(v_req.note, '')), '') IS NOT NULL
      THEN 'Buyer Request #' || v_req.id::TEXT || ' (' || TRIM(v_req.phone) || '): ' || TRIM(v_req.note)
    ELSE 'Buyer Request #' || v_req.id::TEXT || ' (Phone: ' || TRIM(v_req.phone) || ')'
  END;

  -- 8. Create the new order in 'draft' status BEFORE inserting order_items
  INSERT INTO public.orders (
    business_id,
    order_no,
    party_name,
    station,
    gst_number,
    order_date,
    notes,
    status,
    total_amount,
    created_at,
    updated_at
  ) VALUES (
    v_req.business_id,
    v_order_no,
    v_party_name,
    v_station,
    v_gst_number,
    CURRENT_DATE,
    v_order_notes,
    'draft',
    v_total_amount,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_order_id;

  -- 9. Copy all requested products into order_items (validated by trg_guard_and_sync_order_items)
  FOR v_item IN (
    SELECT
      ori.product_id,
      ori.sets,
      p.design_no,
      GREATEST(COALESCE(p.rate, 0), 0) AS prod_rate,
      GREATEST(COALESCE(p.pcs_per_set, 1), 1) AS prod_pcs_per_set
    FROM public.order_request_items ori
    JOIN public.products p ON p.id = ori.product_id
    WHERE ori.request_id = p_request_id
    ORDER BY ori.product_id ASC
  ) LOOP
    v_pcs_per_set := v_item.prod_pcs_per_set;
    v_rate := v_item.prod_rate;
    v_total_pcs := v_item.sets * v_pcs_per_set;
    v_line_total := ROUND((v_total_pcs * v_rate)::NUMERIC, 2);

    INSERT INTO public.order_items (
      business_id,
      order_id,
      product_id,
      design_no,
      rate,
      sets,
      pcs_per_set,
      total_pcs,
      line_total,
      created_at
    ) VALUES (
      v_req.business_id,
      v_order_id,
      v_item.product_id,
      v_item.design_no,
      v_rate,
      v_item.sets,
      v_pcs_per_set,
      v_total_pcs,
      v_line_total,
      NOW()
    );
  END LOOP;

  -- 10. Mark the order request as 'converted'
  PERFORM set_config('app.order_request_rpc', 'true', true);

  UPDATE public.order_requests
  SET status = 'converted'
  WHERE id = p_request_id;

  PERFORM set_config('app.order_request_rpc', 'false', true);

  -- 11. Return generated draft order identifiers
  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'status', 'draft'
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 6: Business WhatsApp Settings Migration & RPCs
-- --------------------------------------------------------------------

-- Safely migrate non-placeholder WhatsApp numbers from admin_settings into businesses.settings
-- without overwriting existing keys (such as order_prefix, invoice_prefix, or an already set whatsapp_number)
UPDATE public.businesses b
SET settings = COALESCE(b.settings, '{}'::jsonb) || jsonb_build_object('whatsapp_number', TRIM(a.whatsapp_number)),
    updated_at = NOW()
FROM public.admin_settings a
WHERE a.business_id = b.id
  AND NULLIF(TRIM(COALESCE(a.whatsapp_number, '')), '') IS NOT NULL
  AND UPPER(TRIM(a.whatsapp_number)) NOT LIKE '%XXXX%'
  AND LENGTH(REGEXP_REPLACE(a.whatsapp_number, '[^0-9]', '', 'g')) >= 7
  AND NULLIF(TRIM(COALESCE(b.settings->>'whatsapp_number', '')), '') IS NULL;

-- 1. Public-safe RPC to retrieve only the customer-facing business WhatsApp contact
CREATE OR REPLACE FUNCTION public.get_public_business_settings(
  p_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz public.businesses%ROWTYPE;
  v_whatsapp TEXT;
  v_digits TEXT;
BEGIN
  SELECT * INTO v_biz
  FROM public.businesses
  WHERE slug = LOWER(TRIM(COALESCE(p_slug, '')));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_whatsapp := NULLIF(TRIM(COALESCE(v_biz.settings->>'whatsapp_number', '')), '');

  -- Filter out placeholder values such as +91XXXXXXXXXX
  IF v_whatsapp IS NOT NULL THEN
    v_digits := REGEXP_REPLACE(v_whatsapp, '[^0-9]', '', 'g');
    IF UPPER(v_whatsapp) LIKE '%XXXX%' OR CHAR_LENGTH(v_digits) < 7 OR CHAR_LENGTH(v_digits) > 15 THEN
      v_whatsapp := NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'business_name', v_biz.name,
    'business_slug', v_biz.slug,
    'whatsapp_number', v_whatsapp
  );
END;
$$;

-- 2. Authenticated Owner-Only RPC to update only the whatsapp_number key in businesses.settings
CREATE OR REPLACE FUNCTION public.update_business_whatsapp_number(
  p_whatsapp_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id BIGINT;
  v_clean TEXT;
  v_digits TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_business_id := public.current_business_id();
  IF v_business_id IS NULL OR NOT public.is_business_owner(v_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: only a business owner can update WhatsApp settings';
  END IF;

  v_clean := TRIM(COALESCE(p_whatsapp_number, ''));

  IF v_clean <> '' THEN
    IF CHAR_LENGTH(v_clean) < 7 OR CHAR_LENGTH(v_clean) > 20 THEN
      RAISE EXCEPTION 'WhatsApp number must be between 7 and 20 characters';
    END IF;

    IF v_clean !~ '^[0-9+() .-]+$' OR UPPER(v_clean) LIKE '%XXXX%' THEN
      RAISE EXCEPTION 'Please enter a valid WhatsApp phone number';
    END IF;

    v_digits := REGEXP_REPLACE(v_clean, '[^0-9]', '', 'g');
    IF CHAR_LENGTH(v_digits) < 7 OR CHAR_LENGTH(v_digits) > 15 THEN
      RAISE EXCEPTION 'WhatsApp number must contain between 7 and 15 digits';
    END IF;
  END IF;

  -- Merge whatsapp_number into businesses.settings while preserving all other keys
  UPDATE public.businesses
  SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
        'whatsapp_number',
        CASE WHEN v_clean = '' THEN NULL ELSE v_clean END
      ),
      updated_at = NOW()
  WHERE id = v_business_id;

  -- Keep admin_settings.whatsapp_number synchronized for owner settings queries
  INSERT INTO public.admin_settings (business_id, whatsapp_number, updated_at)
  VALUES (v_business_id, v_clean, NOW())
  ON CONFLICT (business_id)
  DO UPDATE SET
    whatsapp_number = EXCLUDED.whatsapp_number,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'whatsapp_number', CASE WHEN v_clean = '' THEN NULL ELSE v_clean END
  );
END;
$$;

-- --------------------------------------------------------------------
-- SECTION 7: Explicit Function Permission Revocations & Grants
-- --------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.guard_order_request_items() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_order_requests_update() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_order_request(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_order_request(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_business_whatsapp_number(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.guard_order_request_items() TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_order_requests_update() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_order_request(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_order_request(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_business_whatsapp_number(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_business_settings(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_request(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings(TEXT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
