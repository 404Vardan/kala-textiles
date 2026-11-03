# Rangoli Textiles Management System — System Specification

## 1. Overview & Architecture
The Rangoli Textile Management System is an operational wholesale management application designed specifically for textile manufacturers and wholesale merchants. It governs product cataloging, high-resolution media galleries, permanent QR labeling, dual-location inventory management (Godown & Shop Floor), buyer QR order requests, staff mobile terminal scanning, party/agent directories, and transactional order lifecycle management with vector A4 PDF generation.

### Core Stack
- **Frontend**: React 19 + TypeScript + Vite 7
- **Styling**: Tailwind CSS + Radix UI Primitives
- **Mobile/Hardware Integration**: Native BarcodeDetector API with html5-qrcode fallback, Capacitor support
- **Backend & Database**: Supabase (PostgreSQL, Storage, RLS, Security Definer RPCs)
- **Document Generation**: Native jsPDF vector engine with multi-page A4 pagination

---

## 2. Multi-Tenancy & Security Model (Migrations 005 & 006)

### Business & Membership Model
- **`businesses`**: Root tenant table (`id`, `name`, `slug`, `settings`). Default business: `'Rangoli Textiles'` (`slug: 'rangoli'`).
- **`memberships`**: Maps Supabase Auth `auth.users(id)` to `businesses(id)` with roles `owner` and `staff`.
- **Row Level Security (RLS)**:
  - All business tables (`products`, `product_media`, `inventory_locations`, `inventory_stock`, `stock_movements`, `parties`, `agents`, `orders`, `order_items`, `order_requests`, `order_request_items`, `invoices`, `invoice_items`, `inquiries`, `admin_settings`, `business_order_counters`) enforce tenant isolation via `business_id` and helper function `is_business_member(business_id)`.
  - Destructive operations (product deletion, order deletion) are restricted to `is_business_owner(business_id)`.
  - `admin_settings` is owner-restricted.
  - `order_requests` and `order_request_items` have strict column-level grants (`SELECT` and scoped `UPDATE` on non-status fields while `status = 'requested'`); direct `INSERT` and `DELETE` are revoked and handled exclusively via secured RPCs.
- **Tenant-Scoped Uniqueness**:
  - `products(business_id, design_no)`
  - `orders(business_id, order_no)`
  - `parties(business_id, name)`
  - `agents(business_id, name)`
  - `inventory_locations(business_id, name)`
  - `invoices(business_id, invoice_no)`
  - `order_request_items(request_id, product_id)`

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

### 5. Buyer Order Request & Conversion RPCs (Migration 006)
- `submit_order_request(p_slug, p_party_name, p_phone, p_items, p_note)`: Public-safe RPC (`anon`, `authenticated`) that validates business slug, buyer name (1–120 chars), phone (7–15 digits), and 1–100 items (`sets` 1–500), aggregates duplicate design numbers, verifies active products in that business, and atomically creates `order_requests` + `order_request_items`.
- `convert_order_request(p_request_id)`: Authenticated member RPC (`authenticated` only) that locks the request `FOR UPDATE`, verifies single active business membership and `status = 'requested'`, resolves or creates the `parties` record, generates a new order number via `generate_order_no()`, creates a `draft` order in `orders` first, copies items into `order_items` (validated by `guard_and_sync_order_items()`), and marks the request `'converted'`. Does **not** deduct stock; stock deduction occurs only when the draft order is later confirmed.
- `reject_order_request(p_request_id)`: Authenticated member RPC (`authenticated` only) that locks the request `FOR UPDATE`, verifies business membership and `status = 'requested'`, and transitions `status` to `'rejected'`.
- `get_public_business_settings(p_slug)`: Public-safe RPC (`anon`, `authenticated`) returning only `{ business_name, business_slug, whatsapp_number }` from `businesses.settings` (filtering out placeholder numbers).
- `update_business_whatsapp_number(p_whatsapp_number)`: Owner-only RPC (`authenticated`) that merges `whatsapp_number` into `businesses.settings` without overwriting other settings keys (`order_prefix`, `invoice_prefix`, etc.).

### 6. Public Gateway RPCs (Anonymous Safe)
- `get_public_product(p_slug, p_design_no)`: Returns approved public catalog details and media.
- `get_public_order(p_slug, p_order_no)`: Returns public order summary for customer viewing.
- `get_public_invoice(p_slug, p_invoice_no)`: Returns invoice verification.
- `create_public_inquiry(p_slug, ...)`: Safe public customer inquiry submission.

---

## 4. One-QR Product Viewing, Buyer Order Requests & Staff Operations

### Permanent QR Code Format
- Generated by `src/utils/qrcode.ts`: `https://<domain>/:slug/p/:designNo`.
- Parsed by `parseProductQRUrl(rawInput, defaultSlug)` supporting both `/:slug/p/:designNo` and legacy `/p/:designNo` while rejecting `/order/` and `/invoice/` URLs in product scan flows.

### Customer Flow on `/:slug/p/:designNo` & `/:slug/order-request`
1. **Product Page (`src/pages/ProductPage.tsx`)**:
   - Displays public product media, wholesale rate, pieces per set, and inquiry form.
   - Includes set quantity stepper (`1`–`500`), **Add to Order List** button, and a sticky mobile-safe floating bottom bar (`X designs · Y sets · Review Order`) linking to `/:slug/order-request`.
2. **Buyer Order List Store (`src/services/orderRequestCart.ts`)**:
   - Stored in `localStorage` under `rangoli:order-request-cart:${slug}`.
   - Scoped per business slug so multi-tenant carts never collide.
3. **Review Order Request Page (`src/pages/OrderRequestPage.tsx`)**:
   - Allows adjusting set quantities (`1`–`500`), removing designs, and entering required Customer Name, Phone, and optional Note.
   - **Send on WhatsApp**: Uses `get_public_business_settings(slug)` to open `https://wa.me/<normalized_digits>?text=<encoded_summary>`. Does not clear the cart.
   - **Send to Shop**: Calls `submit_order_request` RPC, displays the returned request reference ID, and clears the slug cart only after server confirmation.

### Staff & Owner Flow
1. **Conditional Staff Section on Product Page (`src/pages/ProductPage.tsx`)**:
   - Rendered only when `user` is logged in, `isStaff` is true, and `business.slug === slug`.
   - Queries private Godown and Shop Floor inventory via authenticated RLS-protected services (`fetchProduct`, `fetchLocations`, `fetchStockByProduct`) and provides an **Add to Current Order** action.
2. **Shared Staff Order Draft (`src/contexts/StaffOrderDraftContext.tsx`)**:
   - Persisted in `localStorage` under `rangoli:staff-order-draft:${user.id}:${business.id}`.
   - Shared across `ProductPage.tsx`, `ShopScanTab.tsx`, and `OrderTab.tsx` so staff can scan or browse multiple designs and resume the unsaved draft order in `OrderTab.tsx` before clicking **Save Draft Order**.
3. **Admin Buyer Order Requests Section (`src/components/admin/OrderRequestsSection.tsx`)**:
   - Rendered inside `OrderTab.tsx` for business owners (`!isStaff`) with a pending-request count badge.
   - Supports **Convert to Draft Order** (`convert_order_request`) and **Reject** (`reject_order_request`).

---

## 5. Frontend Route Structure
- `/`: Public Landing Page (catalog search, QR scanner preserving `:slug`, quick links)
- `/login`: Secure Supabase Auth login for Owners and Staff
- `/admin`: Role-protected management portal (Owner role required)
  - Dashboard: Operational KPIs, recent orders, recent movements, quick actions
  - Products: Catalog, multi-photo/video staging, primary photo selection, QR printing
  - Stock & Godown: Warehouse metrics, stock intake, atomic transfers, audit log
  - Orders: Buyer QR Order Requests section (owner), Draft/Confirmed/Cancelled lifecycle, duplication, stock deduction
  - Shop Terminal: Mobile-first scanner with tenant QR validation, availability checking, and shared draft order integration
  - Parties & Agents: Directory masters with autocomplete
- `/staff`: Role-protected staff terminal (Staff & Owner access)
- `/:slug/p/:designNo` & `/p/:designNo`: Public customer-facing design catalog page (+ authenticated staff live stock & draft controls)
- `/:slug/order-request` & `/order-request`: Public buyer order request review & submission screen
- `/:slug/order/:orderNo` & `/order/:orderNo`: Public customer order review & PDF download
- `/:slug/invoice/:invoiceNo` & `/invoice/:invoiceNo`: Legacy invoice route
