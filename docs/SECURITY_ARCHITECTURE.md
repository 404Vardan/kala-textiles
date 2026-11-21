# Kala ERP — Security Architecture

> **Document Role:** Authoritative security model, multi-company isolation rules, RBAC enforcement, `SECURITY DEFINER` contract, storage isolation, and rate-limiting architecture.

---

## 1. Security Invariants (Implemented on `main`)

### 1.1 Request-Scoped Multi-Company Isolation (`011`, `014`, `019`)
`is_business_member(business_id)` alone is **not sufficient** for multi-company users, because a user belonging to Company A and Company B could accidentally or maliciously access Company B while operating in Company A's tab.

Kala enforces **fail-closed request-scoped tenancy**:
1. **Frontend Header Injection (`src/services/supabase.ts`)**:
   - Injects `x-business-id` **strictly on `/rest/v1/` and `/functions/v1/`** requests (never on `/auth/v1/` or `/storage/v1/`).
2. **Database Context Resolution (`public.current_business_id()`)**:
   - Reads `x-business-id` from `current_setting('request.headers', true)::jsonb->>'x-business-id'`.
   - If present: validates positive integer AND membership in `public.memberships` for `auth.uid()`. If invalid or unauthorized → returns `NULL` (**fail closed**).
   - If absent: returns the sole `business_id` ONLY when `COUNT(*) = 1` in `public.memberships`. For multi-company users with no header → returns `NULL` (**fail closed**).
3. **Strict RLS on Every Tenant Table**:
   - Every tenant-scoped `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policy enforces `business_id = public.current_business_id()`.
4. **Explicit `p_business_id` Validation on Privileged RPCs**:
   - All Stage 2 RPCs (`intake_set_stock_v2`, `receive_taka_lot_tx`, `transfer_taka_tx`, `split_taka_tx`, `verify_inventory_integrity`) require `p_business_id IS NOT NULL AND p_business_id = public.current_business_id()` in addition to `has_permission()` / `is_business_member()`.

### 1.2 Database Function Security Contracts (By Function Class)

Database functions in Kala fall into four distinct categories, each with its own security contract:

1. **Privileged Transactional RPCs** (e.g., `intake_set_stock_v2`, `receive_taka_lot_tx`, `transfer_taka_tx`, `split_taka_tx`, `transfer_stock_tx`, `confirm_order_and_deduct_stock_tx`):
   - Declare `SECURITY DEFINER` and pin `SET search_path = public, pg_temp`.
   - `REVOKE ALL` from `PUBLIC` and `anon`; `GRANT EXECUTE` only to `authenticated`.
   - Verify `auth.uid() IS NOT NULL`, enforce active company scope (`p_business_id = public.current_business_id()` or entity `business_id = public.current_business_id()`), and enforce server-side RBAC (`public.has_permission(...)`).
   - Enforce open financial year (`assert_financial_year_open`) and posting chronology where applicable, and derive `created_by` / `actor_user_id` server-side from `auth.uid()`.
2. **Authenticated Read-Only & Reconciliation Functions** (e.g., `verify_inventory_integrity`, `get_dashboard_summary`, `list_business_members`):
   - Declare `STABLE` (where side-effect-free), pin `SET search_path = public, pg_temp`, and revoke execution from `PUBLIC` and `anon`.
   - Verify `auth.uid() IS NOT NULL`, enforce active company scope (`current_business_id()`) and membership (or `is_business_owner()` for owner-only views like `list_business_members`).
   - Do **not** require write RBAC, open financial year locks, or chronological posting guards because they perform no mutations.
3. **Public Gateway RPCs** (e.g., `get_public_product`, `get_public_order`, `get_public_invoice`, `submit_order_request`, `create_public_inquiry`):
   - Declare `SECURITY DEFINER`, pin `SET search_path = public, pg_temp`, and explicitly grant `EXECUTE` to `anon` and `authenticated`.
   - Return strictly sanitized DTOs, fail closed on unknown/inactive records, and enforce hourly rate limits via `public_request_log` on public write endpoints.
4. **Internal Helpers & Trigger Functions**:
   - **Internal helpers** (`claim_idempotency_key`, `complete_idempotency_key`, `record_audit_event`, `assert_chronological_stock_date`, `assert_chronological_taka_date`) are **revoked from `PUBLIC`, `anon`, and `authenticated`** and may only be invoked inside trusted `SECURITY DEFINER` orchestrators.
   - **Trigger functions** (`guard_audit_events_immutable`, `guard_stock_ledger_immutable`, `guard_locked_financial_year`, `guard_system_roles`, `guard_last_business_owner`, `bump_row_version`) pin `SET search_path = public, pg_temp` and run automatically on table DML to enforce structural invariants regardless of caller.

### 1.3 Revoked Internal Helpers (`014`, `016`, `019`)
The following internal functions are **revoked from `PUBLIC`, `anon`, and `authenticated`** and may only be invoked by trusted `SECURITY DEFINER` orchestrator RPCs:
- `claim_idempotency_key(...)`
- `complete_idempotency_key(...)`
- `record_audit_event(...)`
- `assert_chronological_stock_date(...)`
- `assert_chronological_taka_date(...)`

### 1.4 Direct-Write Protection on Ledgers & Stock Projections (`013`, `015`, `016`, `019`)
Authenticated clients have **`SELECT`-only** privileges (zero `INSERT`/`UPDATE`/`DELETE`) on:
- `public.audit_events` (+ immutability trigger)
- `public.stock_ledger` (+ immutability trigger)
- `public.inventory_stock` (revoked in `019`)
- `public.inventory_lots`
- `public.inventory_takas`
- `public.taka_splits`

All mutations must flow through audited, FY-checked, transactional RPCs.

### 1.5 Granular RBAC & Protected Records (`013`, `014`, `019`)
- System roles (`Owner`, `Manager`, `Accountant`, `Inventory Staff`, `Sales Staff`) cannot be renamed or deleted (`trg_guard_system_roles`).
- Locked financial years cannot be unlocked or have dates modified (`trg_guard_locked_financial_year`), and `next_document_no()` rejects locked FYs.
- Last-owner protection (`guard_last_business_owner`) prevents removing or demoting the sole owner of a business.
- `product_variants` `INSERT`/`UPDATE` RLS requires `has_permission(business_id, 'inventory.write')`.

### 1.6 Public QR Gateway & Rate Limiting (`005`, `006`, `010`)
- `anon` has **zero** direct table access on tenant tables.
- Public QR endpoints (`get_public_product`, `get_public_order`, `get_public_invoice`, `get_public_business_settings`, `submit_order_request`, `create_public_inquiry`) return minimal sanitized DTOs and fail closed.
- `submit_order_request` and `create_public_inquiry` enforce hourly per-business and per-phone rate caps via `public_request_log` + `enforce_public_rate_limit()`.

### 1.7 Storage Tenant Isolation (`009`)
- Bucket `product-media` is public for `SELECT` (QR catalog images/videos).
- `INSERT`/`UPDATE`/`DELETE` on `storage.objects` is restricted to authenticated members whose `business_id` matches the first path segment `{business_id}/{product_id}/{uuid}.{ext}`.

### 1.8 Edge Function Security (`supabase/functions/invite-team-member`)
- Validates caller JWT via `auth.getUser()`.
- Resolves active business from `x-business-id` header (with single-company fallback) and verifies caller is an authorized `owner` of that business.
- Populates `role_id` consistently with the selected system role.
- `SUPABASE_SERVICE_ROLE_KEY` exists **only** in server-side Edge Function environment variables—never in `VITE_*` client env files.

---

## 2. Planned Security Extensions (Stages 3–8)

- **Stage 3**: Unconditional immutability trigger on posted `vouchers` & `voucher_entries`; single-reversal uniqueness index; dual-locked `bill_allocations`.
- **Stage 7**: Tenant-safe AI assistant restricted strictly to whitelisted read-only SQL RPCs (zero raw SQL execution).
- **Stage 8**: Strict separation between Platform Super-Admin governance tables and tenant RLS (see [`PLATFORM_ADMIN_ARCHITECTURE.md`](PLATFORM_ADMIN_ARCHITECTURE.md)).

