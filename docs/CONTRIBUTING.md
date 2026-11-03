# Contributing to Kala

Thank you for your interest in contributing to **Kala — Textile Wholesale Management System**. This guide explains the local development setup, architectural guardrails, and verification steps required before submitting a pull request.

---

## 1. Local Development Setup

### Prerequisites

- **Node.js:** `v18.0.0+` (`v20+` LTS recommended)
- **npm:** `v9.0.0+`
- **Supabase Project:** A test or local Supabase project with migrations `001` through `006` applied.

### Steps

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/404Vardan/kala-textiles.git
   cd kala-textiles
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy [`.env.example`](../.env.example) to `.env.local` and populate your Supabase URL and Anon Key:

   ```bash
   cp .env.example .env.local
   ```

4. Start the Vite development server:

   ```bash
   npm run dev
   ```

---

## 2. Engineering & Security Guardrails

When modifying or extending the codebase, adhere strictly to the following architectural rules (see [`docs/SPEC.md`](SPEC.md) and [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)):

1. **Never Bypass Transactional RPCs:**
   - Stock intake (`intake_stock_tx`), stock transfer (`transfer_stock_tx`), order confirmation (`confirm_order_and_deduct_stock_tx`), order number generation (`generate_order_no`), and buyer request conversion (`convert_order_request`) must never fall back to client-side multi-step table updates.
2. **Preserve Fail-Closed Public Gateway Behavior:**
   - Public QR pages (`ProductPage`, `OrderRequestPage`, `OrderPage`, `InvoicePage`) must use their designated public RPCs (`get_public_product`, `submit_order_request`, `get_public_order`, `get_public_invoice`) and fail closed if the RPC fails.
3. **Maintain Multi-Tenant Isolation:**
   - All tenant-scoped URLs (`/:slug/p/:designNo`, `/:slug/order-request`, `/:slug/order/:orderNo`), `localStorage` keys, and database queries must respect the active business `slug` and `business_id`.
4. **Never Commit Secrets:**
   - Do not commit `.env`, `.env.local`, Supabase `service_role` keys, or private credentials.

---

## 3. UI & Accessibility Standards

- **Commercial Design Language:** Use the established stone/ivory (`#f8f7f4`), deep charcoal (`#1c1917`), and burnt-orange (`#c2410c`) palette defined in [`src/style.css`](../src/style.css) and reusable components in [`src/components/ui/primitives.tsx`](../src/components/ui/primitives.tsx).
- **Accessible Status & Form Controls:** Always pair status colors with icons and explicit text labels (`StatusBadge`), associate `<Label htmlFor="...">` with form inputs, and keep touch targets at least `36px–44px` on mobile screens.

---

## 4. Pre-Submission Checklist

Before opening a Pull Request, run both checks locally and ensure zero errors:

```bash
# 1. TypeScript type check
npx tsc --noEmit

# 2. Full production bundle build
npm run build
```

If your change introduces or updates a database migration under `supabase/migrations/`, document the migration order and any new RPC signatures in [`docs/SPEC.md`](SPEC.md) and [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

