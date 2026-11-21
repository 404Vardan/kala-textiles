# Kala ERP — API & RPC Reference

> **Document Role:** Complete reference of implemented PostgreSQL RPCs (`001`–`019`), Edge Functions, and frontend service modules on `main`. Planned Stage 3+ RPCs are clearly marked **Designed** or **Planned**.

---

## 1. Multi-Company Request Contract (Implemented)

Every authenticated PostgREST (`/rest/v1/*`) and Edge Function (`/functions/v1/*`) request from the client automatically attaches:
- `Authorization: Bearer <supabase-jwt>`
- `x-business-id: <active_business_id>` (injected by [`src/services/supabase.ts`](../src/services/supabase.ts))

For multi-company users, omitting or sending an unauthorized `x-business-id` **fails closed**.

---

## 2. Implemented Core & Onboarding RPCs (`005`–`014`)

| RPC | Callable By | Purpose |
| :--- | :---: | :--- |
| `current_business_id()` | `authenticated` (RLS/RPC) | Resolves active `business_id` from `x-business-id` header validated against `memberships` (fails closed for multi-company users if missing/invalid). |
| `is_business_member(p_business_id)` | `authenticated` | Checks active membership for `auth.uid()`. |
| `is_business_owner(p_business_id)` | `authenticated` | Checks owner role in `p_business_id` for `auth.uid()`. |
| `has_permission(p_business_id, p_permission_key)` | `authenticated` | Evaluates granular RBAC permission (`*` wildcard for Owner or role permission key). |
| `check_slug_available(p_slug)` | `authenticated` | Validates slug format, reserved slugs, and availability during `/signup`. |
| `create_business(name, slug, settings)` | `authenticated` | Atomically creates business, 5 default system roles, owner membership (`role_id`), default `MAIN` branch, active Indian FY, `GODOWN`/`SHOP` locations, `admin_settings`, and audit event. |
| `list_business_members()` | `authenticated` (owner) | Lists team members for active business. |
| `update_member_role(p_user_id, p_role)` | `authenticated` (owner) | Updates a member's role (subject to last-owner protection). |
| `remove_business_member(p_user_id)` | `authenticated` (owner) | Removes a member (subject to last-owner protection). |
| `assert_financial_year_open(p_business_id, p_date)` | `authenticated` | Returns open `fy_id` or raises if date is outside an open FY or inside a locked FY. |
| `next_document_no(p_business_id, p_branch_id, p_fy_id, p_doc_type, p_prefix)` | `authenticated` | Generates strictly ordered, never-reused document number; rejects locked FYs. |
| `update_business_whatsapp_number(p_whatsapp_number)` | `authenticated` (owner) | Updates active business WhatsApp contact number. |
| `get_dashboard_summary()` | `authenticated` | Returns operational dashboard counts (products, godown/shop sets & pcs, draft/confirmed orders). |

### Internal Core Helpers (Revoked from `PUBLIC`, `anon`, `authenticated`)
- `claim_idempotency_key(p_business_id, p_key, p_action_type, p_request_hash)`
- `complete_idempotency_key(p_business_id, p_key, p_response)`
- `record_audit_event(p_business_id, p_entity_type, p_entity_id, p_action, p_before, p_after)`
- `seed_default_business_roles(p_business_id)`

---

## 3. Implemented Unified Inventory & Valuation RPCs (`015`–`019`)

Stage 2 separates **transactional stock mutation RPCs** (which enforce write permissions, open financial years, and posting chronology) from **read-only reconciliation** (`verify_inventory_integrity`).

### 3.1 Transactional Stock Mutation RPCs

| RPC | Auth & Tenancy Check | Permission | FY & Chronology Guards | Idempotency | Purpose & Wrapper |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `intake_set_stock_v2(...)` | `auth.uid()`, `p_business_id = current_business_id()` | `inventory.write` | `assert_financial_year_open(p_movement_date)`, `assert_chronological_stock_date()` | Optional (`p_idempotency_key`) | MWAC SET intake + `stock_ledger` append + `stock_movements` mirror. Wrapper: `intakeSetStockV2()` in `takaInventory.ts`. |
| `intake_stock_tx(...)` | `v_business_id = current_business_id()` (via `products`), delegates to `intake_set_stock_v2` | `inventory.write` | Open FY (`CURRENT_DATE`), `assert_chronological_stock_date()` (via delegation) | None (legacy) | Legacy-compatible SET intake; preserves existing `avg_unit_cost` instead of diluting MWAC with `0`. Wrapper: `intakeStock()` in `inventory.ts`. |
| `transfer_stock_tx(...)` | `auth.uid()`, `v_business_id = current_business_id()` (via `products`) | `inventory.transfer` | `assert_financial_year_open(CURRENT_DATE)` (posts on `CURRENT_DATE`) | None (legacy) | Deadlock-free atomic SET transfer emitting 2 linked `stock_ledger` rows (`TRANSFER_OUT`/`TRANSFER_IN`) preserving source MWAC. Wrapper: `transferStock()` in `inventory.ts`. |
| `receive_taka_lot_tx(...)` | `auth.uid()`, `p_business_id = current_business_id()`, validates active branch, product, variant, supplier party & location | `inventory.write` | `assert_financial_year_open(p_movement_date)`, `assert_chronological_stock_date()` | Optional (`p_idempotency_key`) | Atomically creates `inventory_lots`, serialized `inventory_takas`, and `stock_ledger` rows under one `transaction_group_id`. Wrapper: `receiveTakaLot()` in `takaInventory.ts`. |
| `transfer_taka_tx(...)` | `auth.uid()`, `p_business_id = current_business_id()` | `inventory.transfer` | `assert_financial_year_open(p_movement_date)`, `assert_chronological_taka_date()` | Optional (`p_idempotency_key`) | Atomic taka transfer emitting 2 linked `stock_ledger` rows at exact lot cost. Wrapper: `transferTaka()` in `takaInventory.ts`. |
| `split_taka_tx(...)` | `auth.uid()`, `p_business_id = current_business_id()` | `inventory.write` | `assert_financial_year_open(p_movement_date)`, `assert_chronological_taka_date()` | Optional (`p_idempotency_key`) | Splits a taka roll (child meters must equal parent `current_meters`), creates child takas (`parent_taka_id`), writes immutable `taka_splits` lineage, and appends balanced `SPLIT_OUT`/`SPLIT_IN` rows. Wrapper: `splitTaka()` in `takaInventory.ts`. |
| `confirm_order_and_deduct_stock_tx(...)` | `auth.uid()`, `v_business_id = current_business_id()` (via `orders`) | `orders.confirm` | `assert_financial_year_open(CURRENT_DATE)`, `assert_chronological_stock_date()` | None (guarded by `status = 'draft'` lock) | Confirms draft order, deducts **unreserved** stock (`sets - reserved_sets`), appends frozen-cost `DISPATCH` to `stock_ledger`, mirrors `stock_movements`, logs `audit_events`. Wrapper: `confirmOrderAndDeductStock()` in `inventory.ts`. |

### 3.2 Read-Only Reconciliation RPC

| RPC | Volatility | Auth & Tenancy Check | FY / Chronology Guards | Purpose & Wrapper |
| :--- | :---: | :--- | :---: | :--- |
| `verify_inventory_integrity(p_business_id)` | `STABLE` (read-only) | `auth.uid() IS NOT NULL`, `p_business_id = current_business_id()`, `is_business_member(p_business_id)` | Not applicable (read-only audit across all posted rows) | 3-way reconciliation of SET quantities, physical TAKA meters, and total inventory valuation against `stock_ledger`. Wrapper: `verifyInventoryIntegrity()` in `takaInventory.ts`. |

### 3.3 Internal Inventory Helpers (Revoked from `PUBLIC`, `anon`, `authenticated`)
- `assert_chronological_stock_date(p_business_id, p_product_id, p_location_id, p_movement_date)`
- `assert_chronological_taka_date(p_business_id, p_taka_id, p_movement_date)`

---

## 4. Implemented Order & Public QR RPCs (`005`, `006`, `010`)

| RPC | Callable By | Purpose |
| :--- | :---: | :--- |
| `generate_order_no()` | `authenticated` | Generates unique order number for active business. |
| `convert_order_request(p_request_id)` | `authenticated` | Converts buyer order request into a draft wholesale order. |
| `reject_order_request(p_request_id)` | `authenticated` | Marks buyer order request as `rejected`. |
| `get_public_product(p_design_no, p_business_slug)` | `anon`, `authenticated` | Fail-closed sanitized public product & media DTO for QR catalog page. |
| `get_public_business_settings(p_business_slug)` | `anon`, `authenticated` | Returns business name, slug, and public WhatsApp number. |
| `get_public_order(p_order_no, p_business_slug)` | `anon`, `authenticated` | Returns public order tracking summary. |
| `get_public_invoice(p_invoice_no, p_business_slug)` | `anon`, `authenticated` | Returns public invoice summary. |
| `submit_order_request(p_party_name, p_phone, p_note, p_items, p_business_slug)` | `anon`, `authenticated` | Rate-limited public buyer order request submission. |
| `create_public_inquiry(p_customer_name, p_phone, p_design_no, p_message, p_business_slug)` | `anon`, `authenticated` | Rate-limited public inquiry submission. |

---

## 5. Edge Functions

| Function | Status | Purpose |
| :--- | :---: | :--- |
| `invite-team-member` (`supabase/functions/invite-team-member/index.ts`) | **Implemented** | Resolves active business from `x-business-id`, verifies caller is an owner of that business, sends Supabase Auth invitation via `SUPABASE_SERVICE_ROLE_KEY`, and populates `memberships.role_id`. |
| `kala-ai-assistant` | **Planned** (Stage 7) | Invokes whitelisted, read-only, tenant-scoped SQL RPCs for Textile & Business Intelligence. |
| `gst-einvoice-gateway` | **Planned** (Stage 7) | NIC E-Invoice / E-Way Bill integration. |

---

## 6. Planned Stage 3–5 RPCs (Not Yet Implemented)

- **Stage 3 (Designed)**: `post_voucher_tx`, `reverse_voucher_tx`, `allocate_bill_payment_tx`, `verify_opening_balances`, `close_financial_year_tx`.
- **Stage 4 (Designed)**: `confirm_sales_invoice_tx`, `confirm_purchase_bill_tx`, `confirm_sales_return_tx`, `confirm_purchase_return_tx`.
- **Stage 5 (Planned)**: `issue_job_work_challan_tx`, `receive_job_work_tx`, `complete_production_run_tx`.

