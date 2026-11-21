# Kala ERP — Master Roadmap

> **Document Role:** Phased engineering roadmap from Stage 0 through Commercial Launch & Platform Console, with mandatory automated exit gates.  
> **Rule:** No stage advances merely because UI screens render; every stage requires passing PostgreSQL migration, isolation, reconciliation, and build verification.

---

## Status Legend

- **Implemented**: Software or migrations merged to `main` and verified against PostgreSQL (PGlite) + `tsc` + `vite build` + CI.
- **Approved (Architecture Milestone)**: Design/architecture blueprint signed off (no runtime software delivered by this milestone itself).
- **In Progress**: Active branch or open PR under review.
- **Designed**: Architecture and database contract finalized; implementation not yet started.
- **Planned**: Scheduled for a future stage.

---

## Master Stage Overview

| Stage | Module / Focus | Migrations | Status | Mandatory Exit Gates |
| :---: | :--- | :---: | :---: | :--- |
| **Pre-ERP** | **Phase 1 & Phase 2 Baseline** (Auth, QR Catalog, Buyer Order Requests, Team Invites, Storage Tenancy, Rate Limits, Commercial Flat ERP UI) | `001`–`010` | **Implemented** | Tenant isolation (`isolation.sql`), public QR & order-request gateway fail-closed checks, responsive 1280px/390px UI verification. |
| **Stage 0** | **ERP Target Architecture Blueprint** | *(Design)* | **Approved (Architecture Milestone)** | Hardened Rev 3 blueprint signed off (archived at [`archive/ERP_ARCHITECTURE_Rev3.md`](archive/ERP_ARCHITECTURE_Rev3.md)). |
| **Stage 1** | **Kala Core** (Multi-Company `x-business-id` Tenancy, Branches, Non-Overlapping FYs & Lock Guards, Document Counters, Granular RBAC, Payload-Hashed Idempotency, Immutable Audit) | `011`–`014` | **Implemented** | Isolated `001`–`014` PostgreSQL suite (`stage1_core.sql` + `isolation.sql`), fail-closed multi-company headers, locked FY immutability, revoked internal helpers. |
| **Stage 2** | **Unified Inventory & Valuation Engine** (`stock_ledger`, MWAC, Variants, Lots, Serialized Takas, Split Lineage, 3-Way Reconciliation, Direct-Write Lock on `inventory_stock`) | `015`–`019` | **Implemented** | Full `001`–`019` PostgreSQL suite (`stage2_inventory.sql` + regressions), MWAC & legacy MWAC preservation, reserved-stock guard, taka chronology, 3-way `verify_inventory_integrity()`. |
| **Docs** | **Authoritative ERP Documentation Overhaul** | *(Docs)* | **In Progress** | Complete 11-doc architecture suite + refreshed `README.md` & `SUPABASE_SETUP.md` strictly separating Implemented vs. Planned. |
| **Stage 3** | **Kala Finance — Accounting Core** (Chart of Accounts, Cost Centres, Immutable Vouchers & Reversals, Deferred Balance Trigger, Dual-Locked Bill Allocations, Opening Balance & FY Close) | `020`–`024` *(planned)* | **Designed** | Balanced voucher deferred trigger, posted-voucher immutability, single-reversal uniqueness guard, concurrent dual-locked bill allocations, FY close pre-checks. |
| **Stage 4** | **Sales, Purchases & Complete Indian GST Engine** (Sales/Purchase Invoices, Credit/Debit Notes, Date-Effective `tax_categories`/`tax_rates`, Immutable Tax Snapshots, Order→Invoice No-Double-Deduction) | `025`–`030` *(planned)* | **Designed** | Duplicate confirmation idempotency, GST determination suite (intra/inter-state, SEZ, export, RCM, exempt, tax-inclusive, slab thresholds, snapshot immutability). |
| **Stage 5** | **Job Work, Mill Processing & Manufacturing** (Job Work Challans, Mill-Wise Stock, Shortage/Elongation, Landed Cost Rollup, BOM & Production Runs) | `031`–`035` *(planned)* | **Planned** | Mill-wise stock reconciliation, shortage/elongation math, landed cost capitalization into finished lots, BOM consumption valuation tie-out. |
| **Stage 6** | **Financial Reports, Taka UI, Windows Desktop (Tauri v2) & Mobile Offline Sync** (Trial Balance, P&L, Balance Sheet, GSTR-1/3B, Silent Thermal Printing, Draft-Only Offline Queue with `row_version`) | `036`–`038` *(planned)* | **Planned** | Accounting identity (`Assets = Liabilities + Equity + Net Profit`), GSTR-1/3B tie-out, Tauri ESC/POS & TSPL/ZPL printing, `row_version` conflict resolution. |
| **Stage 7** | **Kala Intelligence & Statutory Compliance** (Fast/Slow Design Analytics, Lot Margins, Overdue Ageing, Mill Shortage BI, Tenant-Safe AI Assistant via Whitelisted RPCs, E-Invoice / E-Way Bill) | `039`–`041` *(planned)* | **Planned** | Read-only AI RPC tenant isolation tests, E-Invoice / E-Way Bill Edge Function contract tests. |
| **Stage 8** | **Platform / Developer Console & Commercial Launch** (Super-Admin Tenant Lifecycle, `subscription_plans`, `has_module()` Gating, Telemetry, Audit Governance, Enterprise Packaging) | `042`–`044` *(planned)* | **Planned** | Module-gating enforcement, platform-admin separation from tenant RLS, backup/restore & multi-tenant load verification. |

---

## Git & Integration Discipline

To keep `main` permanently deployable:
1. Every stage is developed on a dedicated feature branch (e.g., `feat/stage-3-accounting`) created from `main`.
2. Each stage PR must pass sequential PostgreSQL migration execution from `001` through HEAD, all SQL regression suites, `npx tsc --noEmit`, `npm run build`, and GitHub Actions CI before merging.
3. Hosted/production Supabase deployments are executed only via an explicit deployment plan—never implicitly during feature development.
4. Documentation (`IMPLEMENTATION_STATUS.md`, `DATABASE_ARCHITECTURE.md`, `API_AND_RPC_REFERENCE.md`) is updated at the close of every stage so docs and code never drift.

