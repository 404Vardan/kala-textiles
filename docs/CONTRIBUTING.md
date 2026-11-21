# Contributing to Kala ERP

Thank you for contributing to **Kala ERP**. This guide covers local setup, engineering and security invariants, PostgreSQL testing requirements, UI standards, and PR discipline.

---

## 1. Local Development Setup

### Prerequisites
- **Node.js:** `v18.0.0+` (`v20+` LTS recommended)
- **npm:** `v9.0.0+`
- **Supabase Project** (for full local/staging testing with migrations `001` through `019` applied — see [`SUPABASE_SETUP.md`](../SUPABASE_SETUP.md)).

### Steps
1. Clone and install dependencies:
   ```bash
   git clone https://github.com/404Vardan/kala-textiles.git
   cd kala-textiles
   npm install
   ```
2. Copy `.env.example` to `.env.local` and configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLISHED_DOMAIN`.
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```

---

## 2. Non-Negotiable Engineering & Security Guardrails

1. **Sequential Migrations Only**:
   - Never silently rewrite a migration that has already been merged to `main` or applied to a shared/staging database. Add a new sequential migration (`020_...sql`, etc.).
2. **Never Bypass Transactional RPCs**:
   - Direct `INSERT`/`UPDATE`/`DELETE` on `inventory_stock`, `inventory_lots`, `inventory_takas`, `taka_splits`, `stock_ledger`, and `audit_events` is revoked at the database level. All state changes must flow through `SECURITY DEFINER` RPCs.
3. **`SECURITY DEFINER` Contract**:
   - Every privileged RPC must declare `SECURITY DEFINER`, pin `SET search_path = public, pg_temp`, revoke execution from `PUBLIC` and `anon`, verify `auth.uid() IS NOT NULL`, enforce `p_business_id = public.current_business_id()` (fail-closed multi-company context), and check `public.has_permission(p_business_id, '<perm>')`.
4. **Preserve Backward Compatibility**:
   - Public QR URLs (`/:slug/p/:designNo`, `/p/:designNo`), buyer order requests (`submit_order_request`), order tracking (`/order/:orderNo`), and legacy `intake_stock_tx`/`transfer_stock_tx` paths must continue working across every ERP stage.
5. **Never Commit Secrets**:
   - Never commit `.env`, `.env.local`, `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or private keys.
6. **Honest Documentation**:
   - Every doc change must explicitly distinguish **Implemented**, **In Progress**, **Designed**, and **Planned**—never advertise planned blueprint items as implemented.

---

## 3. Commercial ERP UI Standards (Phase 2)

- **Design Tokens (`src/style.css`, `tailwind.config.ts`)**:
  - Primary `#1E2A4A`, Canvas `#F4F5F7`, Surface `#FFFFFF`, Border `#E3E5EA`, Text `#1A1D24`, Muted `#667085`, Success `#1F7A4D`, Warning `#B7791F`, Danger `#B42318`.
  - `6px` border radius; flat surfaces with 1px borders; no gradients, no tinted colored panels, no shadows, no emojis, no icons inside colored circles.
- **Typography & Formatting (`src/utils/formatters.ts`)**:
  - `IBM Plex Sans` with `Noto Sans Gujarati` and `Noto Sans Devanagari` fallbacks.
  - `tabular-nums` on every numeric column.
  - Indian currency grouping (`en-IN`, e.g., `₹12,45,000`) and `DD MMM YYYY` dates.
- **Accessibility**:
  - Visible focus rings, `44px` minimum touch targets on `/staff` and public buyer pages, at least `4.5:1` contrast, concise one-line empty/loading states.

---

## 4. Mandatory Pre-PR Verification Checklist

Before opening a Pull Request against `main`:

1. **Frontend Type Check & Production Build**:
   ```bash
   npx tsc --noEmit
   npm run build
   ```
2. **PostgreSQL Migration & SQL Test Suite Verification**:
   - Apply **all** migrations sequentially from `001_init.sql` through HEAD on a clean PostgreSQL test instance (local Postgres, Supabase local, or PGlite with `btree_gist`).
   - Run all SQL test suites and confirm zero failures:
     - `supabase/tests/isolation.sql`
     - `supabase/tests/stage1_core.sql`
     - `supabase/tests/stage2_inventory.sql`
     - *(plus any new test suite added for the current stage)*
3. **Documentation Sync**:
   - Update [`docs/IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md), [`docs/DATABASE_ARCHITECTURE.md`](DATABASE_ARCHITECTURE.md), and [`docs/API_AND_RPC_REFERENCE.md`](API_AND_RPC_REFERENCE.md) whenever migrations, RPCs, or modules change.
4. **Clean PR Hygiene**:
   - Keep PRs scoped to a single stage or concern, target `main`, verify zero `.env`/credential leaks in the diff, and never deploy migrations to production Supabase without an explicit deployment plan.
