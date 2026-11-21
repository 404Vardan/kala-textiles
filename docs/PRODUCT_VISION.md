# Kala ERP — Product Vision

> **Document Role:** Authoritative product vision describing what Kala is becoming, who it serves, how it is accessed, and how it differentiates itself from legacy textile accounting software.  
> **For what is actually built and working today**, see [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

---

## 1. Mission

**Kala ERP** is a modern, multi-company, multi-industry **Textile ERP** built for Indian textile businesses—replacing fragmented legacy desktop billing tools, WhatsApp spreadsheets, and disconnected warehouse registers with a single auditable system of record.

Kala began as a QR-based wholesale catalog and order-management application (`001`–`010`) and is evolving in test-gated stages into a complete five-layer ERP capable of running both **SaaS subscriptions** and **enterprise deployments** from one shared codebase and database contract.

---

## 2. Target Textile Segments

Kala is designed for the full textile value chain rather than a single niche:

| Segment | Operational Focus | Status |
| :--- | :--- | :--- |
| **Wholesalers & Traders** | Design catalogs, QR sharing, buyer order requests, set/piece inventory, multi-godown dispatch, party & agent ledgers | **Implemented** (Catalog/QR/Orders/Stock) · **Designed** (Full Accounting & GST) |
| **Fabric Traders & Taka Stockists** | Dye-lot tracking, serialized taka/roll barcodes, meter-level transfers, parent-child taka splitting, specific-lot costing | **Implemented** (DB Engine & Service Layer) · **Planned** (Dedicated Taka UI) |
| **Dyeing, Printing & Finishing Mills** | Job work challans, grey-to-finished lot tracking, shortage/elongation reconciliation, landed cost rollups | **Planned** (Stage 5) |
| **Manufacturers & Embroidery Units** | Bills of Material (BOM), raw material consumption, work orders, finished goods valuation | **Planned** (Stage 5) |
| **Textile Agents & Multi-Company Groups** | Strict multi-company switching (`x-business-id`), branch-level GSTINs, consolidated commission & ageing reports | **Implemented** (Multi-Company Core) · **Planned** (Agent Commission & Consolidated BI) |

---

## 3. Five-Layer Product Architecture

All modules share one PostgreSQL/Supabase data foundation and one TypeScript domain layer:

| Layer | Purpose | Current Status |
| :--- | :--- | :--- |
| **1. Kala Core** | Multi-company tenancy, branches, financial years, document numbering, granular RBAC, idempotency, immutable audit log | **Implemented** (`011`–`014`) |
| **2. Kala Inventory** | Unified append-only `stock_ledger`, SET projection + MWAC valuation, variants, lots, serialized takas, split lineage, 3-way reconciliation | **Implemented** (`015`–`019`) |
| **3. Kala Operations** | Wholesale orders, buyer QR requests, invoices, purchases, returns, job work challans, mill processing, BOM/manufacturing | **Implemented** (Wholesale Orders/Requests) · **Planned** (Purchases/Job Work/Manufacturing) |
| **4. Kala Finance** | Chart of Accounts, immutable double-entry vouchers & reversals, dual-locked bill allocations, date-effective Indian GST engine, Trial Balance / P&L / Balance Sheet | **Designed** (Stage 3–4) |
| **5. Kala Intelligence** | Textile intelligence (fast/slow designs, lot margins, mill shortage %), business ageing/cashflow insights, tenant-safe AI assistant | **Planned** (Stage 7) |

---

## 4. Three Access Channels (One Shared Contract)

Kala is architected so **Web**, **Windows Desktop**, and **Mobile** share the exact same React + TypeScript domain layer and PostgreSQL RPC contracts—avoiding three diverging products:

| Channel | Target Users & Workflows | Technology | Status |
| :--- | :--- | :--- | :--- |
| **Kala Web (Cloud)** | Owners, managers, accountants, multi-branch administration, public buyer QR pages | React 19 + TypeScript + Vite 7 + Supabase | **Implemented** |
| **Kala Mobile** | Godown & shop staff: QR/barcode scanning, stock transfers, order capture, approvals | Capacitor (Android/iOS) sharing the web app | **Implemented** (Capacitor Android + `/staff` scanner) · **Planned** (Offline draft queue & Taka scan UI) |
| **Kala Desktop (Windows)** | High-speed counter billing, keyboard-first accounting entry, silent ESC/POS & thermal label printing, USB barcode scanners | Tauri v2 (planned) + shared React UI + Rust native print bridge | **Designed** (Stage 6) |

---

## 5. What Differentiates Kala

1. **Accounting-Grade Integrity by Construction**: Every inventory and financial posting is immutable, server-enforced via `SECURITY DEFINER` RPCs, guarded by financial-year locks, and verifiable via automated reconciliation (`verify_inventory_integrity()` today; trial balance & sub-ledger tie-outs in Stage 3).
2. **True Textile Data Model**: Native support for both **SET** (wholesale catalogs with pieces-per-set) and **TAKA/LOT** (serialized rolls with meter lineage and dye-lot landed cost) inside one unified `stock_ledger`.
3. **Permanent Public QR Commerce**: Every design carries a permanent QR URL (`/:slug/p/:designNo`) so physical sample books, showroom tags, and WhatsApp shares feed directly into buyer order requests without exposing internal tenant tables.
4. **Commercial Flexibility (SaaS + Enterprise)**: Designed for multi-tenant SaaS subscriptions (`subscription_plans` / module gating) as well as dedicated enterprise deployments, governed by a future **Platform / Developer Console** (see [`PLATFORM_ADMIN_ARCHITECTURE.md`](PLATFORM_ADMIN_ARCHITECTURE.md)).
