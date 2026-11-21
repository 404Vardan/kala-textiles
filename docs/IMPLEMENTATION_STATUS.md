# Kala ERP — Implementation Status

> **Document Role:** Single source of truth distinguishing what is **actually implemented on `main` today** from what is **designed or planned**.  
> **Baseline:** `main` (`f57d9a2`) — Migrations `001`–`019` verified on PostgreSQL (PGlite + `btree_gist`), `tsc`, `vite build`, and GitHub Actions CI.  
> **Hosted Supabase Deployment:** Migrations `011`–`019` are merged in Git on `main` and verified locally; they have **not** yet been applied to production/hosted Supabase pending an explicit deployment plan.

---

## 1. Module-by-Module Reality Matrix

| Area | Database & RPCs | Frontend UI / Services | Status |
| :--- | :--- | :--- | :---: |
| **Auth, Onboarding & Recovery** | `create_business`, `check_slug_available`, `is_reserved_business_slug` (`007`, `013`) | `/login`, `/signup`, `/reset-password`, `AuthContext`, `onboarding.ts` | **Implemented** |
| **Team Management & Invites** | `list_business_members`, `update_member_role`, `remove_business_member`, last-owner trigger (`008`) + `invite-team-member` Edge Function | Settings → Team Members UI, `team.ts` | **Implemented** |
| **Multi-Company Tenancy (`x-business-id`)** | Fail-closed `current_business_id()`, strict RLS across all tenant tables (`011`, `014`) | Scoped `x-business-id` header injection (`/rest/v1/`, `/functions/v1/`) in `supabase.ts`, company switcher in `AuthContext` | **Implemented** |
| **Branches, Financial Years & Counters** | `branches`, non-overlapping `financial_years`, `document_counters`, `next_document_no`, `assert_financial_year_open`, locked-FY immutability trigger (`012`, `014`) | TypeScript types (`Branch`, `FinancialYear`) | **Implemented** (DB) · **Planned** (Branch/FY Admin UI) |
| **Granular RBAC, Idempotency & Audit** | `roles`, `role_permissions`, `has_permission`, system-role guard, `idempotency_keys`, append-only `audit_events` (`013`, `014`) | System roles seeded on business creation; `role_id` populated in `invite-team-member` | **Implemented** (DB) · **Planned** (Custom Role Editor UI) |
| **Product Catalog, Media & QR Labels** | `products`, `product_media`, tenant-scoped `product-media` Storage bucket (`001`, `005`, `009`) | Admin `ProductTab`, `MediaManager`, QR code generation (`qrcode.ts`), public `/:slug/p/:designNo` | **Implemented** |
| **Public Buyer Order Requests** | `order_requests`, `order_request_items`, `submit_order_request`, `convert_order_request`, `reject_order_request`, `public_request_log` rate limits (`006`, `010`) | Public `/:slug/order-request`, `orderRequestCart.ts`, Admin `OrderRequestsSection` | **Implemented** |
| **Wholesale Orders & Legacy Invoices** | `orders`, `order_items`, `invoices`, `invoice_items`, `parties`, `agents`, `generate_order_no`, `confirm_order_and_deduct_stock_tx` (`002`–`005`, `018`–`019`) | Admin `OrderTab`, `InvoiceTab`, `ShopScanTab`, `/staff`, public `/order/:orderNo`, `/invoice/:invoiceNo`, PDF generators | **Implemented** |
| **Unified `stock_ledger` & MWAC Valuation** | Append-only `stock_ledger`, `OPENING_BALANCE` backfill, `intake_set_stock_v2`, upgraded `intake_stock_tx`/`transfer_stock_tx`, `assert_chronological_stock_date`, direct-write lock on `inventory_stock` (`015`–`019`) | `inventory.ts`, `takaInventory.ts`, `StockTab` (SET intake/transfer/movements) | **Implemented** (DB & Services) · **In Progress** (MWAC/Ledger UI surfacing) |
| **Product Variants, Lots & Taka Lineage** | `product_variants`, `inventory_lots`, `inventory_takas`, immutable `taka_splits`, `receive_taka_lot_tx`, `transfer_taka_tx`, `split_taka_tx`, `assert_chronological_taka_date`, 3-way `verify_inventory_integrity` (`015`, `017`, `019`) | Typed models (`index.ts`) and full RPC client (`takaInventory.ts`) | **Implemented** (DB & Services) · **Planned** (Dedicated Taka/Lot UI Screens) |
| **Double-Entry Accounting Engine** | `accounts`, `cost_centers`, immutable `vouchers` & `voucher_entries`, reversal vouchers, dual-locked `bill_allocations`, FY close | None yet | **Designed** (Stage 3) |
| **Purchases, Returns & Complete GST Engine** | `purchase_bills`, `sales_invoices`, `credit_notes`, `debit_notes`, `tax_categories`, `tax_rates`, immutable tax snapshots | None yet | **Designed** (Stage 4) |
| **Job Work, Mill Processing & Manufacturing** | Job work challans, mill stock, shortage/elongation, BOM, production runs | None yet | **Planned** (Stage 5) |
| **Financial Reports & GSTR-1/3B** | Trial Balance, P&L, Balance Sheet, party ageing, GSTR views | None yet | **Planned** (Stage 6) |
| **Windows Desktop (Tauri v2) & Offline Sync** | `row_version` trigger already exists on core & inventory tables (`012`, `015`) | Tauri shell, thermal print bridge, SQLite draft queue not started | **Designed** (Stage 6) |
| **Mobile App (Capacitor)** | Shared Supabase RPCs | Capacitor Android project configured (`capacitor.config.ts`) + mobile `/staff` bottom bar & QR scanner | **Implemented** (Android WebView + Scanner) · **Planned** (Offline Drafts & Taka Scanning) |
| **Kala Intelligence & AI Assistant** | Read-only analytical views, whitelisted AI RPC tools, E-Invoice/E-Way Bill | None yet | **Planned** (Stage 7) |
| **Platform / Developer Console** | `platform_admins`, `subscription_plans`, `business_subscriptions`, `has_module()` | None yet | **Designed** (Stage 8) |

---

## 2. Implemented Application Routes (`src/App.tsx`)

| Route | Access | Purpose |
| :--- | :--- | :--- |
| `/` | Public | Landing page |
| `/login`, `/signup`, `/reset-password` | Public | Authentication, self-service business creation, password reset |
| `/admin` | Authenticated (`owner`) | Admin ERP shell (Dashboard, Products, Stock, Orders, Requests, Parties, Agents, Scan, Settings) |
| `/staff` | Authenticated (`staff` / `owner`) | Mobile-friendly staff operations & QR scanner with bottom tab bar |
| `/p/:designNo`, `/:slug/p/:designNo` | Public | Permanent QR product catalog page |
| `/order-request`, `/:slug/order-request` | Public | Buyer order request cart & submission |
| `/order/:orderNo`, `/:slug/order/:orderNo` | Public | Public order tracking summary |
| `/invoice/:invoiceNo`, `/:slug/invoice/:invoiceNo` | Public | Public invoice viewer |

---

## 3. Verified Automated Test Suites

| Suite | Scope | Status on `main` |
| :--- | :--- | :---: |
| [`supabase/tests/isolation.sql`](../supabase/tests/isolation.sql) | Cross-tenant RLS isolation, public QR/order/invoice RPCs, buyer requests, stock intake/transfer, revoked `inventory_stock` direct writes | **Passing** (PostgreSQL / PGlite) |
| [`supabase/tests/stage1_core.sql`](../supabase/tests/stage1_core.sql) | `create_business()`, multi-company fail-closed headers, RBAC, locked FY immutability, idempotency replay/conflict, forged audit & revoked internal helpers | **Passing** (PostgreSQL / PGlite) |
| [`supabase/tests/stage2_inventory.sql`](../supabase/tests/stage2_inventory.sql) | MWAC, legacy MWAC preservation, idempotency, atomic 2-row transfers, zero partial mutations on failure, reserved-stock dispatch block, taka lot/transfer/split chronology & lineage, direct write blocks, read-only variant block, Company A vs B isolation, 3-way `verify_inventory_integrity()` | **Passing** (PostgreSQL / PGlite) |
| GitHub Actions (`ci.yml`) | `npx tsc --noEmit` & `npm run build` (`tsc && vite build`) | **Passing** |
