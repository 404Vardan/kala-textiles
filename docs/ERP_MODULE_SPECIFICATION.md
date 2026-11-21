# Kala ERP — Module Specification

> **Document Role:** Functional specification across Kala's five ERP layers, explicitly distinguishing implemented modules from designed/planned modules.  
> **Historical Reference:** The original Phase 1 wholesale spec is archived at [`archive/SPEC_v1.md`](archive/SPEC_v1.md).

---

## 1. Layer 1 — Kala Core (`Implemented` DB · `Partial` UI)

| Capability | Specification | Status |
| :--- | :--- | :---: |
| **Multi-Company Tenancy** | Users can belong to multiple textile companies. Every authenticated request sends `x-business-id` on `/rest/v1/` and `/functions/v1/`. Missing/invalid headers fail closed for multi-company users; single-company users retain automatic fallback. | **Implemented** |
| **Onboarding & Team Management** | Self-service `/signup` creates business, 5 default system roles, owner membership, default `MAIN` branch, active Indian FY (Apr 1–Mar 31), and `GODOWN`/`SHOP` locations. Owners invite team members via `invite-team-member` Edge Function; last-owner protection trigger prevents lockout. | **Implemented** |
| **Branches & Financial Years** | Multi-branch GSTIN/state-code support; non-overlapping FYs with immutable lock trigger and `next_document_no()` locked-FY rejection. | **Implemented** (DB) · **Planned** (Admin UI) |
| **Granular RBAC & Audit** | System roles (`Owner`, `Manager`, `Accountant`, `Inventory Staff`, `Sales Staff`) + custom roles evaluated server-side via `has_permission()`; append-only `audit_events` and payload-hashed `idempotency_keys`. | **Implemented** (DB) · **Planned** (Role Editor & Audit Viewer UI) |

---

## 2. Layer 2 — Kala Inventory (`Implemented` DB & Services · `Partial` UI)

| Capability | Specification | Status |
| :--- | :--- | :---: |
| **Product Catalog & QR Labels** | Design number, brand, collection, fabric, rate, `pcs_per_set`, `tracking_mode` (`SET|TAKA|PIECE`), `uom` (`SET|PCS|MTR|KG`), `hsn_code`, multi-image/video gallery in tenant-scoped Storage, permanent QR code generation. | **Implemented** |
| **SET Inventory & MWAC** | Multi-location SET stock (`GODOWN`, `SHOP`, custom godowns), MWAC valuation via `intake_set_stock_v2`, atomic 2-row `transfer_stock_tx` preserving source cost, legacy `intake_stock_tx` preserving existing MWAC, chronological backdated posting guard, reserved-stock protection (`sets - reserved_sets`). | **Implemented** (DB & Services) · **In Progress** (MWAC cost inputs in `StockTab`) |
| **Product Variants** | Color/size/grade SKUs (`product_variants`) with optional `rate_override` and `inventory.write` RBAC enforcement. | **Implemented** (DB & Service) · **Planned** (UI) |
| **Lots & Serialized Takas** | Dye/mill lots (`inventory_lots`) with landed cost, shade, GSM, width, and composite FK to `parties`; serialized rolls (`inventory_takas`) received via `receive_taka_lot_tx`, transferred via `transfer_taka_tx` (2 linked ledger rows), and split via `split_taka_tx` (48m → 15m + 33m with `parent_taka_id` + immutable `taka_splits` lineage and per-taka chronology guard). | **Implemented** (DB & Service) · **Planned** (Taka/Lot UI & Barcode Labels) |
| **3-Way Reconciliation** | `verify_inventory_integrity(p_business_id)` reconciles SET quantities, TAKA meters, and total inventory valuation against `stock_ledger`. | **Implemented** (DB & Service) · **Planned** (Reconciliation Dashboard Widget) |

---

## 3. Layer 3 — Kala Operations (`Partial` Implemented · `Designed/Planned` ERP Expansion)

| Capability | Specification | Status |
| :--- | :--- | :---: |
| **Public Buyer QR Commerce** | Public product page (`/:slug/p/:designNo`), buyer order request cart (`/:slug/order-request`), rate-limited `submit_order_request`, owner review (`convert_order_request` / `reject_order_request`), WhatsApp sharing. | **Implemented** |
| **Wholesale Orders & Legacy Invoices** | Draft → Confirmed order lifecycle (`confirm_order_and_deduct_stock_tx` writing frozen-cost `DISPATCH` to `stock_ledger`), party & agent directories, mobile `/staff` QR scan-to-order, PDF generation, public order/invoice links. | **Implemented** |
| **Sales Invoices & Credit Notes (GST)** | Full tax invoices linked to orders (`fulfillment_mode` preventing double stock deduction), immutable tax snapshots, automatic accounting voucher posting, sales returns / credit notes. | **Designed** (Stage 4) |
| **Purchase Orders, Bills & Debit Notes** | Supplier purchase bills posting inward stock (`PURCHASE_IN`) + MWAC/lot landed cost + input GST ITC + AP voucher atomically. | **Designed** (Stage 4) |
| **Job Work & Mill Processing** | Issue grey fabric takas to dyeing/printing/embroidery mills (`JOB_OUT`), receive finished lots (`JOB_IN`), track shortage/elongation %, capitalize job-work charges into finished lot `landed_cost_per_unit`. | **Planned** (Stage 5) |
| **Manufacturing & BOM** | Bills of Material, raw material consumption (`PRODUCTION_CONSUME`), finished goods output (`PRODUCTION_OUT`), cost rollup. | **Planned** (Stage 5) |

---

## 4. Layer 4 — Kala Finance (`Designed` — Stages 3, 4 & 6)

Detailed specification is maintained in [`ACCOUNTING_SPECIFICATION.md`](ACCOUNTING_SPECIFICATION.md):
- Chart of Accounts, Cost Centres, Multi-Currency readiness.
- Strictly immutable double-entry Vouchers & separate Reversal Vouchers (single-reversal uniqueness guard).
- Dual-locked `bill_allocations` & Party Ageing.
- Date-effective Indian GST engine (CGST/SGST/IGST/Cess, price-slab thresholds, RCM, SEZ, Export, immutable tax snapshots).
- Trial Balance, Profit & Loss, Balance Sheet, GSTR-1 / GSTR-3B reports, and Financial Year Close.

---

## 5. Layer 5 — Kala Intelligence (`Planned` — Stage 7)

- **Textile Intelligence**: Fast-moving vs. slow-moving designs, dead-stock alerts by lot/color, gross margin by design/lot (computed from frozen `stock_ledger.unit_cost`), mill shrinkage/shortage analytics.
- **Business Intelligence**: Party overdue ageing, agent-wise sales & collection performance, cashflow forecasting.
- **Tenant-Safe AI Assistant**: Edge Function (`kala-ai-assistant`) invoking **only whitelisted, read-only, tenant-scoped SQL RPCs**—never executing LLM-generated raw SQL.
