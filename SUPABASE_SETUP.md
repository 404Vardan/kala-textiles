# Supabase Setup Guide (Kala ERP)

This guide walks through setting up a Supabase PostgreSQL backend for **Kala ERP** (`main` — Migrations `001` through `019`, Stage 1 Core + Stage 2 Unified Inventory).

---

## Step 1: Create a Supabase Project

1. Sign in at [https://supabase.com](https://supabase.com) and click **New Project**.
2. Choose a project name (e.g. `kala-erp-staging`), a strong database password, and a region close to your operations (e.g. `ap-south-1` Mumbai).
3. Wait 2–3 minutes for provisioning to finish.

---

## Step 2: Retrieve Project API Credentials

1. Navigate to **Project Settings → API**.
2. Copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **Project API Keys → `anon` `public`**

> **Security Warning:** Never place `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or private credentials in `.env.local` or any `VITE_*` variable. The `service_role` key is used **only** inside server-side Supabase Edge Functions.

---

## Step 3: Configure Local Environment Variables

Create `.env.local` in the project root (copied from `.env.example`):

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_PUBLISHED_DOMAIN=http://localhost:5173
```

---

## Step 4: Execute Database Migrations in Strict Order (`001`–`019`)

Ensure the `btree_gist` extension is available (migration `012` enables it via `CREATE EXTENSION IF NOT EXISTS btree_gist;`).

Run each file in [`supabase/migrations/`](supabase/migrations/) in strict numerical order inside the Supabase **SQL Editor** (or via `supabase db push` / `psql` on a staging database):

### Phase 1 & Baseline (`001`–`010`)
1. [`001_init.sql`](supabase/migrations/001_init.sql) — Base catalog, media, invoices, inquiries, and settings tables.
2. [`002_add_staff_password.sql`](supabase/migrations/002_add_staff_password.sql) — Legacy staff column (superseded by Supabase Auth in `005`).
3. [`002_orders_inventory.sql`](supabase/migrations/002_orders_inventory.sql) — Initial orders and inventory tables.
4. [`003_add_invoice_pcs_per_set.sql`](supabase/migrations/003_add_invoice_pcs_per_set.sql) — Invoice set ratio support.
5. [`004_rangoli_core_system.sql`](supabase/migrations/004_rangoli_core_system.sql) — Locations, stock balances, movements, parties, and agents.
6. [`005_auth_security_tenancy.sql`](supabase/migrations/005_auth_security_tenancy.sql) — Multi-tenant schema (`businesses`, `memberships`), composite FKs, strict RLS, transactional order/stock RPCs, and public QR RPCs.
7. [`006_order_requests.sql`](supabase/migrations/006_order_requests.sql) — Buyer QR order requests (`order_requests`, `order_request_items`) and conversion/rejection RPCs.
8. [`007_signup_create_business.sql`](supabase/migrations/007_signup_create_business.sql) — Self-service onboarding (`check_slug_available`, `create_business`).
9. [`008_team_management.sql`](supabase/migrations/008_team_management.sql) — Owner team RPCs and `guard_last_business_owner` trigger.
10. [`009_storage_tenant_policies.sql`](supabase/migrations/009_storage_tenant_policies.sql) — Public `product-media` bucket and tenant-scoped `storage.objects` policies.
11. [`010_public_rpc_rate_limits.sql`](supabase/migrations/010_public_rpc_rate_limits.sql) — `public_request_log` and hourly per-business/per-phone rate caps.

### Stage 1 — Kala Core (`011`–`014`)
12. [`011_core_multicompany_tenancy.sql`](supabase/migrations/011_core_multicompany_tenancy.sql) — Request-scoped, fail-closed `current_business_id()` reading `x-business-id` header + strict RLS across all tenant tables.
13. [`012_core_branches_fy_counters.sql`](supabase/migrations/012_core_branches_fy_counters.sql) — `branches`, non-overlapping `financial_years`, `document_counters` + `next_document_no()`, `assert_financial_year_open()`, `bump_row_version()`.
14. [`013_core_rbac_idempotency_audit.sql`](supabase/migrations/013_core_rbac_idempotency_audit.sql) — `roles`, `role_permissions`, `has_permission()`, `idempotency_keys`, append-only `audit_events`, upgraded `create_business()`.
15. [`014_stage1_security_hardening.sql`](supabase/migrations/014_stage1_security_hardening.sql) — Revoked direct `EXECUTE` on internal helpers, locked FY immutability trigger, system-role protection trigger, and locked-FY rejection in `next_document_no()`.

### Stage 2 — Unified Inventory & Valuation Engine (`015`–`019`)
16. [`015_inventory_variants_lots_takas.sql`](supabase/migrations/015_inventory_variants_lots_takas.sql) — Extended `products` & `inventory_stock`; created `product_variants`, `inventory_lots`, `inventory_takas`, immutable `taka_splits`.
17. [`016_unified_stock_ledger.sql`](supabase/migrations/016_unified_stock_ledger.sql) — Append-only `stock_ledger`, immutability trigger, `OPENING_BALANCE` backfill, internal `assert_chronological_stock_date()`.
18. [`017_inventory_rpcs_and_reconciliation.sql`](supabase/migrations/017_inventory_rpcs_and_reconciliation.sql) — `intake_set_stock_v2`, `receive_taka_lot_tx`, `transfer_taka_tx`, `split_taka_tx`, upgraded `intake_stock_tx`/`transfer_stock_tx`, 3-way `verify_inventory_integrity()`.
19. [`018_confirm_order_stock_ledger.sql`](supabase/migrations/018_confirm_order_stock_ledger.sql) — Upgraded `confirm_order_and_deduct_stock_tx` with frozen-cost `DISPATCH` ledger entries and audit logging.
20. [`019_stage2_inventory_hardening.sql`](supabase/migrations/019_stage2_inventory_hardening.sql) — Revoked direct client writes on `inventory_stock`, fail-closed `p_business_id = current_business_id()` across all Stage 2 RPCs, composite party FKs on `inventory_lots`, `assert_chronological_taka_date()`, legacy MWAC preservation, `inventory.write` RBAC on variants, and unreserved stock dispatch guard.

---

## Step 5: Verify Storage Bucket (`product-media`)

Migration `009_storage_tenant_policies.sql` creates the `product-media` bucket and installs tenant-scoped RLS policies on `storage.objects`:
- **Public Read (`SELECT`)**: Enabled so permanent QR catalog pages load product photos/videos.
- **Authenticated Tenant Write (`INSERT`, `UPDATE`, `DELETE`)**: Restricted to authenticated members whose `business_id` matches the first folder segment `{business_id}/{product_id}/{uuid}.{ext}`.

---

## Step 6: Deploy the Team Invite Edge Function

Deploy [`supabase/functions/invite-team-member/index.ts`](supabase/functions/invite-team-member/index.ts):

```bash
supabase functions deploy invite-team-member
```

Supabase automatically injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The function validates the caller's JWT, resolves the active company via `x-business-id` (with CORS support), verifies the caller is an owner of that business, sends the Auth invite, and assigns `memberships.role_id`.

---

## Step 7: Configure Auth Redirect URLs & Multi-Company Access

1. In **Authentication → URL Configuration**, add your reset-password redirect URLs:
   - `http://localhost:5173/reset-password`
   - `https://<your-domain>/reset-password`
2. **Self-Service Signup**: Owners register at `/signup` and call `create_business()`, which atomically provisions their business, 5 system roles, owner membership (`role_id`), default `MAIN` branch, active Indian financial year, and `GODOWN`/`SHOP` locations.
3. **Multi-Company Users**: Users may belong to **multiple businesses** in `public.memberships`. The client automatically sends `x-business-id` on `/rest/v1/` and `/functions/v1/` requests; multi-company users switch active companies via the header switcher in `AuthContext`.

---

## Step 8: Run Automated Verification Suites (Staging / Test DB Only)

Before promoting any environment, run all three non-destructive (`BEGIN ... ROLLBACK`) SQL test suites against your staging/test PostgreSQL instance:

1. [`supabase/tests/isolation.sql`](supabase/tests/isolation.sql)
2. [`supabase/tests/stage1_core.sql`](supabase/tests/stage1_core.sql)
3. [`supabase/tests/stage2_inventory.sql`](supabase/tests/stage2_inventory.sql)

Then verify the frontend locally:

```bash
npm run dev
```
