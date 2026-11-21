# Kala ERP — Master Roadmap (Stage 0 + 8 Implementation Stages)

> **Document Role:** Authoritative phased engineering roadmap from Stage 0 through Stage 8, incorporating Kala's three governance pillars (**Accounting Master Specification**, **Kala Accounting Quality Gate**, and **Kala Developer / Super Admin Console**) and the **5-Point Stage Completion Rule**.  
> **Rule:** No stage advances merely because UI screens render; every stage must pass its mandatory automated verification gates and full diff audit before merging to `main`.

---

## Status Legend

- **Implemented**: Software or migrations merged to `main` and verified against PostgreSQL + `tsc` + `vite build` + CI.
- **Approved (Architecture Milestone)**: Design/architecture blueprint signed off (no runtime software delivered by this milestone itself).
- **In Progress**: Active branch or open PR under review.
- **Designed**: Architecture and database contract finalized; implementation not yet started.
- **Planned**: Scheduled for a future stage.

---

## Master Stage Overview

| Stage | Module / Focus | Migrations | Status | Mandatory Exit Gates & Governance |
| :---: | :--- | :---: | :---: | :--- |
| **Pre-ERP** | **Phase 1 & Phase 2 Baseline** (Auth, QR Catalog, Buyer Order Requests, Team Invites, Storage Tenancy, Rate Limits, Commercial Flat ERP UI) | `001`–`010` | **Implemented** | Tenant isolation (`isolation.sql`), fail-closed public QR & order-request gateway, responsive 1280px/390px UI verification. |
| **Stage 0** | **Architecture & Planning** (Target Architecture, DB Principles, Security Model & Roadmap) | *(Design)* | **Approved (Architecture Milestone)** | Hardened Rev 3 blueprint signed off (archived at [`archive/ERP_ARCHITECTURE_Rev3.md`](archive/ERP_ARCHITECTURE_Rev3.md)). |
| **Stage 1** | **ERP Core** (Multi-Company `x-business-id` Tenancy, Branches, Non-Overlapping FYs & Lock Guards, Document Counters, Granular RBAC, Idempotency & Audit) | `011`–`014` | **Implemented** *(Merged)* | Isolated `001`–`014` PostgreSQL suite (`stage1_core.sql` + `isolation.sql`), fail-closed multi-company headers, locked FY immutability, revoked internal helpers. |
| **Stage 2** | **Inventory Core** (Unified `stock_ledger`, SET + MWAC Valuation, Variants, Lots, Serialized Takas & Split Lineage, 3-Way Reconciliation, Direct-Write Lock on `inventory_stock`) | `015`–`019` | **Implemented** *(Merged)* | Full `001`–`019` PostgreSQL suite (`stage2_inventory.sql` + regressions), MWAC & legacy MWAC preservation, reserved-stock guard, taka chronology, 3-way `verify_inventory_integrity()`. |
| **Stage 3** | **Accounting & Finance Core** (COA, Double-Entry Vouchers & Reversals, Party Subledger & Bill-Wise Allocations, Per-FY Opening Balances, Trial Balance & FY Close) | `020`–`026` *(PR #7)* + `027`+ *(pending spec review)* | **In Progress** *(PR #7 under review)* | **Prerequisite:** [`ACCOUNTING_MASTER_SPECIFICATION.md`](ACCOUNTING_MASTER_SPECIFICATION.md), [`ACCOUNTING_GAP_ANALYSIS.md`](ACCOUNTING_GAP_ANALYSIS.md), [`ACCOUNTING_TEST_STRATEGY.md`](ACCOUNTING_TEST_STRATEGY.md).<br/>**Exit Gate:** **Kala Accounting Quality Gate** (accounting correctness, C1 party-level subledger allocation integrity, C2 per-FY opening balances & 2-year carry-forward, currency/rounding correctness, concurrency & transaction safety, reversal/immutability tests, auditability & signed reconciliation). |
| **Stage 4** | **ERP Operations** (Sales & Purchase Workflows, Quotations, Orders, Sales & Purchase Invoices, Returns, Credit/Debit Notes, Approvals, Customer/Supplier Workflows, Inventory-to-Accounting Integration) | `028`–`033` *(planned)* | **Designed** | Atomic single-transaction confirmation (`stock_ledger` + party subledger + GL voucher + audit), zero double stock deduction, Kala Accounting Quality Gate regressions. |
| **Stage 5** | **Advanced Textile Operations** (Job Work, Dyeing/Printing/Embroidery Workflows, Manufacturing & BOM, Grey/Finished Tracking, TAKA/LOT Lineage, Configurable Shortage/Wastage & Processing Costing) | `034`–`038` *(planned)* | **Planned** | Mill-wise quantity + valuation reconciliation (`Input = Finished + Normal Loss + Abnormal + Recoverable`), capitalized landed cost rollup, BOM valuation tie-out. |
| **Stage 6** | **GST, Compliance & Financial Reporting** (CGST/SGST/IGST/Cess, HSN/SAC & Conditional GST Engine, GSTR-1/GSTR-3B, E-Invoice & E-Way Bill, Cheque/PDC & Bank Reconciliation, P&L, Balance Sheet, Cash Flow) | `039`–`042` *(planned)* | **Planned** | Conditional GST matrix (Sec 15 discounts, RCM, SEZ, export, slabs, immutable snapshots), `Assets = Liabilities + Equity + Net Profit`, GSTR-1/3B tie-out, BRS & 3-entry cheque bounce tests. |
| **Stage 7** | **Desktop, Mobile & Enterprise Capabilities** (Windows Desktop via Tauri v2, Thermal/ESC-POS & Label Printing, Barcode/QR Scanning, Mobile Stock Ops, Draft-Only Offline Sync with `row_version`, Multi-Branch & Enterprise Packaging) | `043`–`045` *(planned)* | **Planned** | Tauri thermal/TSPL/ZPL printing, `row_version` conflict resolution, idempotent draft sync, multi-branch isolation. |
| **Stage 8** | **Platform Administration & Intelligence** (**Kala Developer / Super Admin Console** — separate platform-level app for businesses, users, subscriptions, health, migrations, central audit, feature flags, time-limited support access with MFA & strict platform RBAC + BI & Tenant-Safe AI Insights) | `046`–`049` *(planned)* | **Planned** | Strict separation from tenant RLS (`platform.*`), server-side `has_module()` gating, whitelisted read-only AI RPC tenant isolation, load & backup/restore verification. |

---

## Three Mandatory Governance Pillars

| Pillar | Roadmap Placement | Purpose |
| :--- | :--- | :--- |
| **Accounting Master Specification** | Prerequisite before Stage 3 finalizes | Defines RELY-replacement Indian textile accounting treatments, C1 party subledger, C2 per-FY carry-forward, FX, cheques, GST & TDS. |
| **Kala Accounting Quality Gate** | Stage 3 exit gate & mandatory ongoing requirement | Enforces accounting correctness, party allocation integrity, currency/rounding, concurrency safety, immutability, FY transitions, and signed reconciliation on every financial change. |
| **Kala Developer / Super Admin Console** | Stage 8 (prior to broad SaaS launch) | Separate platform-level control plane for multi-tenant governance, subscriptions, health, and audited support access (see [`PLATFORM_ADMIN_ARCHITECTURE.md`](PLATFORM_ADMIN_ARCHITECTURE.md)). |

---

## Five-Point Stage Completion Rule (Mandatory for Stages 3–8)

Every implementation stage (and every corrective milestone) must satisfy all five criteria before merging to `main`:
1. **Architecture & scope documented** before implementation.
2. **Database & security review completed** (RLS, `SECURITY DEFINER`, fail-closed multi-company context, immutability).
3. **Automated tests passed** (full sequential PostgreSQL migration run `001`–HEAD, SQL exit-gate & regression suites, `tsc --noEmit`, `vite build`, and CI).
4. **Documentation updated** (`IMPLEMENTATION_STATUS.md`, `DATABASE_ARCHITECTURE.md`, `API_AND_RPC_REFERENCE.md`, and stage specs).
5. **Full diff audited** for secrets, unintended changes, and migration hygiene before merging.

Hosted/production Supabase deployments are never executed implicitly during stage development and always require an explicit deployment plan.
