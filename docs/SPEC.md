# Rangoli Textiles Management System — System Specification

## 1. Overview & Architecture
The Rangoli Textile Management System is an operational wholesale management application designed specifically for textile manufacturers and wholesale merchants. It governs product cataloging, high-resolution media galleries, permanent QR labeling, dual-location inventory management (Godown & Shop Floor), staff mobile terminal scanning, party/agent directories, and transactional order lifecycle management with vector A4 PDF generation.

### Core Stack
- **Frontend**: React 19 + TypeScript + Vite 7
- **Styling**: Tailwind CSS + Radix UI Primitives
- **Mobile/Hardware Integration**: Native BarcodeDetector API with html5-qrcode fallback, Capacitor support
- **Backend & Database**: Supabase (PostgreSQL, Storage, RLS, Security Definer RPCs)
- **Document Generation**: Native jsPDF vector engine with multi-page A4 pagination

---

## 2. Multi-Tenancy & Security Model (Migration 005)

### Business & Membership Model
- **`businesses`**: Root tenant table (`id`, `name`, `slug`, `settings`). Default business: `'Rangoli Textiles'` (`slug: 'rangoli'`).
- **`memberships`**: Maps Supabase Auth `auth.users(id)` to `businesses(id)` with roles `owner` and `staff`.
- **Row Level Security (RLS)**:
  - All 13 business tables enforce tenant isolation via `business_id` and helper function `is_business_member(business_id)`.
  - Destructive operations (product deletion, order deletion) are restricted to `is_business_owner(business_id)`.
  - `admin_settings` is owner-restricted.
- **Tenant-Scoped Uniqueness**:
  - `products(business_id, design_no)`
  - `orders(business_id, order_no)`
  - `parties(business_id, name)`
  - `agents(business_id, name)`
  - `inventory_locations(business_id, name)`
  - `invoices(business_id, invoice_no)`

---

## 3. Atomic Database RPCs

### 1. `intake_stock_tx`
Inward inventory into a designated warehouse location (e.g., Godown) with movement tracking and staff signature.
- Validates user membership in the target product's business.
- Atomically upserts `inventory_stock`.
- Inserts audit log into `stock_movements` (`movement_type = 'INTAKE'`).

### 2. `transfer_stock_tx`
Transfer sets between Godown and Shop floor with row-level locking (`FOR UPDATE`).
- Verifies membership and ensures both locations belong to the same business.
- Rejects transfers if requested quantity exceeds source balance.
- Atomically adjusts source and destination balances and writes `stock_movements` (`movement_type = 'TRANSFER'`).

### 3. `confirm_order_and_deduct_stock_tx`
Explicit order confirmation with transactional stock deduction.
- Validates order state (`status = 'draft'`).
- Locks all required stock rows and checks aggregate quantity across all order items.
- Atomically decreases inventory from selected location (e.g., Shop Floor or Godown) and logs `DISPATCH` movements.
- Sets order `status = 'confirmed'`.

### 4. `generate_order_no`
Concurrent-safe, atomic order sequence generator using `business_order_counters`.
- Sequence format: `RNG-YYYY-NNNN`.
- Resets/maintains sequences per business and per year.

### 5. Public Gateway RPCs (Anonymous Safe)
- `get_public_product(p_slug, p_design_no)`: Returns approved public catalog details and media.
- `get_public_order(p_slug, p_order_no)`: Returns public order summary for customer viewing.
- `get_public_invoice(p_slug, p_invoice_no)`: Returns invoice verification.
- `create_public_inquiry(p_slug, ...)`: Safe public customer inquiry submission.

---

## 4. Frontend Route Structure
- `/`: Public Landing Page (catalog search, QR scanner, quick links)
- `/login`: Secure Supabase Auth login for Owners and Staff
- `/admin`: Role-protected management portal (Owner role required)
  - Dashboard: Operational KPIs, recent orders, recent movements, quick actions
  - Products: Catalog, multi-photo/video staging, primary photo selection, QR printing
  - Stock & Godown: Warehouse metrics, stock intake, atomic transfers, audit log
  - Orders: Draft/Confirmed/Cancelled lifecycle, duplication, deduction
  - Shop Terminal: Mobile-first scanner with availability checking
  - Parties & Agents: Directory masters with autocomplete
- `/staff`: Role-protected staff terminal (Staff & Owner access)
- `/:slug/p/:designNo` & `/p/:designNo`: Public customer-facing design catalog page
- `/:slug/order/:orderNo` & `/order/:orderNo`: Public customer order review & PDF download
- `/:slug/invoice/:invoiceNo` & `/invoice/:invoiceNo`: Legacy invoice route
