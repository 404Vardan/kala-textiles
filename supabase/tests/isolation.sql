-- ====================================================================
-- Multi-Tenant Isolation, RBAC & Anonymous Security Test Suite
-- File: supabase/tests/isolation.sql
--
-- Prerequisites:
--   Migrations 001 through 010 must be applied before running this test.
--
-- Behavior:
--   Runs inside a single transaction that ends with ROLLBACK so zero
--   test users, businesses, or rows are persisted after completion.
--   Any failed assertion raises an exception and aborts the run.
-- ====================================================================

BEGIN;

DO $$
DECLARE
  v_owner_a UUID := '11111111-1111-4111-8111-111111111111';
  v_staff_a UUID := '22222222-2222-4222-8222-222222222222';
  v_owner_b UUID := '33333333-3333-4333-8333-333333333333';

  v_biz_a BIGINT;
  v_biz_b BIGINT;

  v_loc_a_godown BIGINT;
  v_loc_a_shop BIGINT;
  v_loc_b_godown BIGINT;
  v_loc_b_shop BIGINT;

  v_prod_a BIGINT;
  v_prod_b BIGINT;
  v_media_b BIGINT;
  v_stock_b BIGINT;
  v_move_b BIGINT;
  v_party_b BIGINT;
  v_agent_b BIGINT;
  v_order_a BIGINT;
  v_order_b BIGINT;
  v_order_item_b BIGINT;
  v_req_b BIGINT;
  v_inv_b BIGINT;
  v_inv_item_b BIGINT;
  v_inq_b BIGINT;
  v_settings_b BIGINT;

  v_cnt INT;
  v_rows INT;
  v_failed BOOLEAN;
  v_fn TEXT;
  v_auth_only_fns TEXT[] := ARRAY[
    'public.is_business_member(bigint)',
    'public.is_business_owner(bigint)',
    'public.current_business_id()',
    'public.generate_order_no()',
    'public.intake_stock_tx(bigint, bigint, integer, text, text, text)',
    'public.intake_stock_tx(bigint, bigint, integer, integer, text, text, text)',
    'public.transfer_stock_tx(bigint, bigint, bigint, integer, text, text, text)',
    'public.transfer_stock_tx(bigint, bigint, bigint, integer, integer, text, text, text)',
    'public.confirm_order_and_deduct_stock_tx(bigint, bigint, text)',
    'public.get_dashboard_summary()',
    'public.convert_order_request(bigint)',
    'public.reject_order_request(bigint)',
    'public.update_business_whatsapp_number(text)',
    'public.create_business(text, text, jsonb)',
    'public.list_business_members()',
    'public.update_member_role(uuid, text)',
    'public.remove_business_member(uuid)',
    'public.enforce_public_rate_limit(bigint, text, text, integer, integer)'
  ];
BEGIN
  -- ------------------------------------------------------------------
  -- 0. Seed Test Auth Users, Businesses A & B, and Tenant Data
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@isolation.test', 'test-hash', NOW(), NOW(), NOW()),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff-a@isolation.test', 'test-hash', NOW(), NOW(), NOW()),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@isolation.test', 'test-hash', NOW(), NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.businesses (name, slug, settings)
  VALUES ('Isolation Shop A', 'iso-test-a', '{"order_prefix": "ISA", "invoice_prefix": "INV"}'::jsonb)
  RETURNING id INTO v_biz_a;

  INSERT INTO public.businesses (name, slug, settings)
  VALUES ('Isolation Shop B', 'iso-test-b', '{"order_prefix": "ISB", "invoice_prefix": "INV"}'::jsonb)
  RETURNING id INTO v_biz_b;

  INSERT INTO public.memberships (user_id, business_id, role) VALUES
    (v_owner_a, v_biz_a, 'owner'),
    (v_staff_a, v_biz_a, 'staff'),
    (v_owner_b, v_biz_b, 'owner');

  -- Locations
  INSERT INTO public.inventory_locations (business_id, name, description)
  VALUES (v_biz_a, 'GODOWN', 'A Godown') RETURNING id INTO v_loc_a_godown;
  INSERT INTO public.inventory_locations (business_id, name, description)
  VALUES (v_biz_a, 'SHOP', 'A Shop') RETURNING id INTO v_loc_a_shop;

  INSERT INTO public.inventory_locations (business_id, name, description)
  VALUES (v_biz_b, 'GODOWN', 'B Godown') RETURNING id INTO v_loc_b_godown;
  INSERT INTO public.inventory_locations (business_id, name, description)
  VALUES (v_biz_b, 'SHOP', 'B Shop') RETURNING id INTO v_loc_b_shop;

  -- Products
  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_a, 'ISO-A-101', 'Brand A', 500, 4, true) RETURNING id INTO v_prod_a;

  INSERT INTO public.products (business_id, design_no, brand, rate, pcs_per_set, is_active)
  VALUES (v_biz_b, 'ISO-B-202', 'Brand B', 750, 6, true) RETURNING id INTO v_prod_b;

  -- Product Media (Business B)
  INSERT INTO public.product_media (business_id, product_id, media_url, media_type, sort_order)
  VALUES (v_biz_b, v_prod_b, 'https://example.com/b.jpg', 'image', 0) RETURNING id INTO v_media_b;

  -- Inventory Stock (Business B)
  INSERT INTO public.inventory_stock (business_id, product_id, location_id, sets, total_pcs)
  VALUES (v_biz_b, v_prod_b, v_loc_b_godown, 10, 60) RETURNING id INTO v_stock_b;

  -- Stock Movements (Business B)
  INSERT INTO public.stock_movements (business_id, product_id, to_location_id, sets, total_pcs, movement_type)
  VALUES (v_biz_b, v_prod_b, v_loc_b_godown, 10, 60, 'INTAKE') RETURNING id INTO v_move_b;

  -- Parties & Agents (Business B)
  INSERT INTO public.parties (business_id, name, phone)
  VALUES (v_biz_b, 'Party B', '+919999999999') RETURNING id INTO v_party_b;

  INSERT INTO public.agents (business_id, name, phone)
  VALUES (v_biz_b, 'Agent B', '+918888888888') RETURNING id INTO v_agent_b;

  -- Orders (Business A & Business B)
  INSERT INTO public.orders (business_id, order_no, party_name, status, total_amount)
  VALUES (v_biz_a, 'ISA-2026-0001', 'Party A', 'draft', 2000) RETURNING id INTO v_order_a;

  INSERT INTO public.orders (business_id, order_no, party_name, status, total_amount)
  VALUES (v_biz_b, 'ISB-2026-0001', 'Party B', 'draft', 4500) RETURNING id INTO v_order_b;

  -- Order Items (Business B)
  INSERT INTO public.order_items (business_id, order_id, product_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
  VALUES (v_biz_b, v_order_b, v_prod_b, 'ISO-B-202', 750, 1, 6, 6, 4500) RETURNING id INTO v_order_item_b;

  -- Order Requests & Items (Business B)
  INSERT INTO public.order_requests (business_id, party_name, phone, status, note)
  VALUES (v_biz_b, 'Buyer B', '+919876543210', 'requested', 'Test') RETURNING id INTO v_req_b;

  INSERT INTO public.order_request_items (request_id, product_id, sets)
  VALUES (v_req_b, v_prod_b, 2);

  -- Invoices & Items (Business B)
  INSERT INTO public.invoices (business_id, invoice_no, party_name, total_amount)
  VALUES (v_biz_b, 'INV-B-001', 'Party B', 4500) RETURNING id INTO v_inv_b;

  INSERT INTO public.invoice_items (business_id, invoice_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
  VALUES (v_biz_b, v_inv_b, 'ISO-B-202', 750, 1, 6, 6, 4500) RETURNING id INTO v_inv_item_b;

  -- Inquiries (Business B)
  INSERT INTO public.inquiries (business_id, customer_name, phone, design_no, message, status)
  VALUES (v_biz_b, 'Lead B', '+919111111111', 'ISO-B-202', 'Rate please', 'pending') RETURNING id INTO v_inq_b;

  -- Admin Settings (Business A & B)
  INSERT INTO public.admin_settings (business_id, whatsapp_number)
  VALUES (v_biz_a, '+919000000001');
  INSERT INTO public.admin_settings (business_id, whatsapp_number)
  VALUES (v_biz_b, '+919000000002') RETURNING id INTO v_settings_b;

  -- ==================================================================
  -- TEST SUITE 1: Cross-Tenant Isolation (User A vs Business B)
  -- User A (Owner A) must NOT be able to SELECT, INSERT, UPDATE, or
  -- DELETE any row of Business B in ANY table.
  -- ==================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::TEXT, true);

  -- 1A. SELECT isolation across all tenant tables
  SELECT COUNT(*) INTO v_cnt FROM public.businesses WHERE id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from businesses'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.memberships WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from memberships'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from products'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.product_media WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from product_media'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.inventory_locations WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from inventory_locations'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.inventory_stock WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from inventory_stock'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.stock_movements WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from stock_movements'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.parties WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from parties'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.agents WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from agents'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.orders WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from orders'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.order_items WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from order_items'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.order_requests WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from order_requests'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.order_request_items WHERE request_id = v_req_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from order_request_items'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.invoices WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from invoices'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.invoice_items WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from invoice_items'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.inquiries WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from inquiries'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.admin_settings WHERE business_id = v_biz_b;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: User A selected Business B from admin_settings'; END IF;

  -- Internal-only tables must reject direct SELECT from authenticated
  v_failed := false;
  BEGIN
    PERFORM 1 FROM public.business_order_counters LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Authenticated user accessed business_order_counters'; END IF;

  v_failed := false;
  BEGIN
    PERFORM 1 FROM public.public_request_log LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Authenticated user accessed public_request_log'; END IF;

  -- 1B. INSERT isolation (User A attempting to insert into Business B)
  -- businesses
  v_failed := false;
  BEGIN
    INSERT INTO public.businesses (name, slug) VALUES ('Hijack', 'hijack-biz');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted into businesses directly'; END IF;

  -- memberships
  v_failed := false;
  BEGIN
    INSERT INTO public.memberships (user_id, business_id, role) VALUES (v_owner_a, v_biz_b, 'owner');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted membership into Business B'; END IF;

  -- products
  v_failed := false;
  BEGIN
    INSERT INTO public.products (business_id, design_no) VALUES (v_biz_b, 'HIJACK-1');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted product into Business B'; END IF;

  -- product_media
  v_failed := false;
  BEGIN
    INSERT INTO public.product_media (business_id, product_id, media_url, media_type) VALUES (v_biz_b, v_prod_b, 'https://evil.test/x.jpg', 'image');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted product_media into Business B'; END IF;

  -- inventory_locations
  v_failed := false;
  BEGIN
    INSERT INTO public.inventory_locations (business_id, name) VALUES (v_biz_b, 'EVIL_LOC');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted inventory_locations into Business B'; END IF;

  -- inventory_stock
  v_failed := false;
  BEGIN
    INSERT INTO public.inventory_stock (business_id, product_id, location_id, sets, total_pcs) VALUES (v_biz_b, v_prod_b, v_loc_b_shop, 1, 6);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted inventory_stock into Business B'; END IF;

  -- stock_movements
  v_failed := false;
  BEGIN
    INSERT INTO public.stock_movements (business_id, product_id, to_location_id, sets, total_pcs, movement_type) VALUES (v_biz_b, v_prod_b, v_loc_b_shop, 1, 6, 'INTAKE');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted stock_movements into Business B'; END IF;

  -- parties
  v_failed := false;
  BEGIN
    INSERT INTO public.parties (business_id, name) VALUES (v_biz_b, 'Evil Party');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted party into Business B'; END IF;

  -- agents
  v_failed := false;
  BEGIN
    INSERT INTO public.agents (business_id, name) VALUES (v_biz_b, 'Evil Agent');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted agent into Business B'; END IF;

  -- orders
  v_failed := false;
  BEGIN
    INSERT INTO public.orders (business_id, order_no, party_name, status) VALUES (v_biz_b, 'ISB-HIJACK', 'Evil', 'draft');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted order into Business B'; END IF;

  -- order_items
  v_failed := false;
  BEGIN
    INSERT INTO public.order_items (business_id, order_id, product_id, design_no, rate, sets, pcs_per_set, total_pcs, line_total)
    VALUES (v_biz_b, v_order_b, v_prod_b, 'ISO-B-202', 100, 1, 6, 6, 600);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted order_items into Business B'; END IF;

  -- order_requests
  v_failed := false;
  BEGIN
    INSERT INTO public.order_requests (business_id, party_name, phone) VALUES (v_biz_b, 'Evil', '+919999999999');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted order_requests into Business B'; END IF;

  -- order_request_items
  v_failed := false;
  BEGIN
    INSERT INTO public.order_request_items (request_id, product_id, sets) VALUES (v_req_b, v_prod_b, 1);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted order_request_items into Business B'; END IF;

  -- invoices
  v_failed := false;
  BEGIN
    INSERT INTO public.invoices (business_id, invoice_no, party_name) VALUES (v_biz_b, 'INV-HIJACK', 'Evil');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted invoice into Business B'; END IF;

  -- invoice_items
  v_failed := false;
  BEGIN
    INSERT INTO public.invoice_items (business_id, invoice_id, design_no, rate, sets, total_pcs, line_total)
    VALUES (v_biz_b, v_inv_b, 'ISO-B-202', 100, 1, 6, 600);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted invoice_items into Business B'; END IF;

  -- inquiries
  v_failed := false;
  BEGIN
    INSERT INTO public.inquiries (business_id, customer_name, phone) VALUES (v_biz_b, 'Evil', '+919999999999');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted inquiry into Business B'; END IF;

  -- admin_settings
  v_failed := false;
  BEGIN
    INSERT INTO public.admin_settings (business_id, whatsapp_number) VALUES (v_biz_b, '+910000000000');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A inserted admin_settings into Business B'; END IF;

  -- 1C. UPDATE isolation (User A attempting to update Business B rows -> 0 rows affected)
  UPDATE public.businesses SET name = 'Hacked' WHERE id = v_biz_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in businesses'; END IF;

  UPDATE public.memberships SET role = 'staff' WHERE business_id = v_biz_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in memberships'; END IF;

  UPDATE public.products SET brand = 'Hacked' WHERE id = v_prod_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in products'; END IF;

  UPDATE public.product_media SET sort_order = 99 WHERE id = v_media_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in product_media'; END IF;

  UPDATE public.inventory_locations SET description = 'Hacked' WHERE id = v_loc_b_godown;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in inventory_locations'; END IF;

  UPDATE public.inventory_stock SET sets = 999 WHERE id = v_stock_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in inventory_stock'; END IF;

  UPDATE public.stock_movements SET notes = 'Hacked' WHERE id = v_move_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in stock_movements'; END IF;

  UPDATE public.parties SET phone = '0000000000' WHERE id = v_party_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in parties'; END IF;

  UPDATE public.agents SET phone = '0000000000' WHERE id = v_agent_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in agents'; END IF;

  UPDATE public.orders SET party_name = 'Hacked' WHERE id = v_order_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in orders'; END IF;

  UPDATE public.order_items SET sets = 99 WHERE id = v_order_item_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in order_items'; END IF;

  UPDATE public.order_requests SET note = 'Hacked' WHERE id = v_req_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in order_requests'; END IF;

  UPDATE public.order_request_items SET sets = 99 WHERE request_id = v_req_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in order_request_items'; END IF;

  UPDATE public.invoices SET party_name = 'Hacked' WHERE id = v_inv_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in invoices'; END IF;

  UPDATE public.invoice_items SET sets = 99 WHERE id = v_inv_item_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in invoice_items'; END IF;

  UPDATE public.inquiries SET message = 'Hacked' WHERE id = v_inq_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in inquiries'; END IF;

  UPDATE public.admin_settings SET whatsapp_number = '+910000000000' WHERE id = v_settings_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A updated Business B in admin_settings'; END IF;

  -- 1D. DELETE isolation (User A attempting to delete Business B rows -> 0 rows or privilege error)
  DELETE FROM public.businesses WHERE id = v_biz_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from businesses'; END IF;

  DELETE FROM public.memberships WHERE business_id = v_biz_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from memberships'; END IF;

  DELETE FROM public.products WHERE id = v_prod_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from products'; END IF;

  DELETE FROM public.product_media WHERE id = v_media_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from product_media'; END IF;

  DELETE FROM public.inventory_locations WHERE id = v_loc_b_godown;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from inventory_locations'; END IF;

  DELETE FROM public.inventory_stock WHERE id = v_stock_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from inventory_stock'; END IF;

  DELETE FROM public.stock_movements WHERE id = v_move_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from stock_movements'; END IF;

  DELETE FROM public.parties WHERE id = v_party_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from parties'; END IF;

  DELETE FROM public.agents WHERE id = v_agent_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from agents'; END IF;

  DELETE FROM public.orders WHERE id = v_order_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from orders'; END IF;

  DELETE FROM public.order_items WHERE id = v_order_item_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from order_items'; END IF;

  v_failed := false;
  BEGIN
    DELETE FROM public.order_requests WHERE id = v_req_b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_failed := true; END IF;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from order_requests'; END IF;

  v_failed := false;
  BEGIN
    DELETE FROM public.order_request_items WHERE request_id = v_req_b;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_failed := true; END IF;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from order_request_items'; END IF;

  DELETE FROM public.invoices WHERE id = v_inv_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from invoices'; END IF;

  DELETE FROM public.invoice_items WHERE id = v_inv_item_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from invoice_items'; END IF;

  DELETE FROM public.inquiries WHERE id = v_inq_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from inquiries'; END IF;

  DELETE FROM public.admin_settings WHERE id = v_settings_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: User A deleted Business B from admin_settings'; END IF;

  -- ==================================================================
  -- TEST SUITE 2: Staff Role Restrictions (Staff A within Business A)
  -- Staff must NOT be able to delete products or orders, view
  -- admin_settings, or call owner-only RPCs.
  -- ==================================================================
  PERFORM set_config('request.jwt.claim.sub', v_staff_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a, 'role', 'authenticated')::TEXT, true);

  -- Sanity check: Staff A can see own business product & order
  SELECT COUNT(*) INTO v_cnt FROM public.products WHERE id = v_prod_a;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Staff A could not read own business product'; END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.orders WHERE id = v_order_a;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: Staff A could not read own business order'; END IF;

  -- Staff A cannot DELETE products
  DELETE FROM public.products WHERE id = v_prod_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: Staff A deleted a product'; END IF;

  -- Staff A cannot DELETE orders
  DELETE FROM public.orders WHERE id = v_order_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: Staff A deleted an order'; END IF;

  -- Staff A cannot read admin_settings
  SELECT COUNT(*) INTO v_cnt FROM public.admin_settings WHERE business_id = v_biz_a;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: Staff A read admin_settings'; END IF;

  -- Staff A cannot invoke owner-only team RPCs
  v_failed := false;
  BEGIN
    PERFORM public.list_business_members();
  EXCEPTION WHEN raise_exception THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Staff A called list_business_members()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.update_member_role(v_owner_a, 'staff');
  EXCEPTION WHEN raise_exception THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Staff A called update_member_role()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.remove_business_member(v_owner_a);
  EXCEPTION WHEN raise_exception THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Staff A called remove_business_member()'; END IF;

  -- Owner A cannot demote or remove the last owner
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::TEXT, true);

  v_failed := false;
  BEGIN
    PERFORM public.update_member_role(v_owner_a, 'staff');
  EXCEPTION WHEN raise_exception THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Last owner was allowed to demote themselves'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.remove_business_member(v_owner_a);
  EXCEPTION WHEN raise_exception THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: Last owner was allowed to remove themselves'; END IF;

  -- ==================================================================
  -- TEST SUITE 3: Anonymous Role Restrictions (anon)
  -- anon must NOT have EXECUTE privilege on any authenticated-only
  -- function and must NOT be able to SELECT from any business table.
  -- ==================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  FOREACH v_fn IN ARRAY v_auth_only_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE privilege on authenticated-only function %', v_fn;
    END IF;
  END LOOP;

  -- Direct invocation checks as anon
  v_failed := false;
  BEGIN
    PERFORM public.generate_order_no();
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon executed generate_order_no()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.create_business('Anon Shop', 'anon-shop', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon executed create_business()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.list_business_members();
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon executed list_business_members()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.convert_order_request(v_req_b);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon executed convert_order_request()'; END IF;

  v_failed := false;
  BEGIN
    PERFORM 1 FROM public.products LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon directly selected from public.products'; END IF;

  v_failed := false;
  BEGIN
    PERFORM 1 FROM public.orders LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: anon directly selected from public.orders'; END IF;

  RAISE NOTICE 'PASS: All cross-tenant isolation, staff RBAC, last-owner guard, and anon privilege tests succeeded.';
END $$;

ROLLBACK;
