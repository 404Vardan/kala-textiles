# Supabase Setup Guide

This guide walks through setting up a Supabase backend for **Kala — Textile Wholesale Management System**.

---

## Step 1: Create a Supabase Project

1. Sign in at [https://supabase.com](https://supabase.com) and click **New Project**.
2. Enter project name `kala-textiles` (or your preferred project identifier), choose a strong database password, and select the region closest to your operations.
3. Wait 2–3 minutes for database provisioning to complete.

---

## Step 2: Retrieve Project API Credentials

1. Navigate to **Project Settings → API** in your Supabase dashboard.
2. Copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **Project API Keys → `anon` `public`**

> **Important:** Never copy or expose the `service_role` secret key in `.env.local` or any frontend configuration. The `service_role` key is only used server-side inside Supabase Edge Functions.

---

## Step 3: Configure Local Environment Variables

Create `.env.local` in the project root (copied from [`.env.example`](.env.example)):

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_PUBLISHED_DOMAIN=http://localhost:5173
```

---

## Step 4: Execute Database Migrations in Order

Open the **SQL Editor** in your Supabase dashboard and run each migration file from [`supabase/migrations/`](supabase/migrations/) in strict numerical order:

1. [`001_init.sql`](supabase/migrations/001_init.sql) — Base catalog, media, invoices, inquiries, and settings tables.
2. [`002_orders_inventory.sql`](supabase/migrations/002_orders_inventory.sql) — Initial orders and inventory tables.
3. [`002_add_staff_password.sql`](supabase/migrations/002_add_staff_password.sql) — Legacy staff column migration (superseded by Supabase Auth in `005`).
4. [`003_add_invoice_pcs_per_set.sql`](supabase/migrations/003_add_invoice_pcs_per_set.sql) — Invoice set ratio support.
5. [`004_rangoli_core_system.sql`](supabase/migrations/004_rangoli_core_system.sql) — Locations (`Godown`, `Shop`), stock balances, movements, parties, and agents.
6. [`005_auth_security_tenancy.sql`](supabase/migrations/005_auth_security_tenancy.sql) — Multi-tenant schema (`businesses`, `memberships`), composite foreign keys, strict Row Level Security (RLS), and transactional inventory/order RPCs.
7. [`006_order_requests.sql`](supabase/migrations/006_order_requests.sql) — Buyer QR order requests (`order_requests`, `order_request_items`) and public/owner order request RPCs.
8. [`007_signup_create_business.sql`](supabase/migrations/007_signup_create_business.sql) — Self-service onboarding (`check_slug_available`, `create_business`) with reserved slug checks and default `GODOWN`/`SHOP` locations.
9. [`008_team_management.sql`](supabase/migrations/008_team_management.sql) — Owner-only team management RPCs and last-owner protection trigger on `memberships`.
10. [`009_storage_tenant_policies.sql`](supabase/migrations/009_storage_tenant_policies.sql) — Public `product-media` bucket creation and tenant-scoped `storage.objects` policies.
11. [`010_public_rpc_rate_limits.sql`](supabase/migrations/010_public_rpc_rate_limits.sql) — `public_request_log` table, hourly per-business/per-phone rate caps, and input validation on public RPCs.

---

## Step 5: Verify Storage Bucket (`product-media`) & Tenant Policies

Migration [`009_storage_tenant_policies.sql`](supabase/migrations/009_storage_tenant_policies.sql) creates the `product-media` bucket and installs tenant-scoped RLS policies on `storage.objects`:

1. Navigate to **Storage** in the Supabase dashboard and confirm that the `product-media` bucket exists and is marked **Public** (for reading catalog images/videos).
2. All media uploads use the tenant-scoped object path format:
   ```text
   {business_id}/{product_id}/{uuid}.{ext}
   ```
3. **Storage Policies**:
   - **Public Read (`SELECT`)**: Anyone can read objects in `product-media` so public QR product galleries work.
   - **Authenticated Tenant Write (`INSERT`, `UPDATE`, `DELETE`)**: Authenticated members can only insert, update, or delete objects whose first folder (`(storage.foldername(name))[1]`) matches one of their `business_id` memberships (`public.is_business_member(...)`).

---

## Step 6: Deploy the Team Invite Edge Function

The owner-only **Team Members** screen under **Settings** uses the `invite-team-member` Supabase Edge Function (`supabase/functions/invite-team-member/index.ts`) to send Supabase Auth invitations using the server-only `SUPABASE_SERVICE_ROLE_KEY`:

```bash
supabase functions deploy invite-team-member
```

Supabase automatically injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into deployed Edge Functions.

---

## Step 7: Configure Auth Redirect URLs & Provision Accounts

1. In **Authentication → URL Configuration**, add your application origin and reset-password route to **Redirect URLs**:
   - `http://localhost:5173/reset-password`
   - `https://<your-domain>/reset-password`
2. **Self-Service Signup**: New shop owners can register directly at `/signup`, then complete **Create Your Shop** to provision their business, owner membership, and default `GODOWN`/`SHOP` locations atomically.
3. **Manual Provisioning (Optional — e.g. for the default `'rangoli'` business)**:
   Create a user in **Authentication → Users**, copy their **User UID**, and run:

```sql
-- Grant Owner access to the default business (slug = 'rangoli' preserved for QR compatibility)
INSERT INTO public.memberships (user_id, business_id, role)
SELECT '<OWNER_USER_UUID>', id, 'owner'
FROM public.businesses
WHERE slug = 'rangoli';

-- Optional: Grant Staff access to a staff account
INSERT INTO public.memberships (user_id, business_id, role)
SELECT '<STAFF_USER_UUID>', id, 'staff'
FROM public.businesses
WHERE slug = 'rangoli';
```

> **Note:** Each user must belong to a **single** business in `public.memberships`.

---

## Step 8: Verify Application Sign-In

1. Start the development server:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:5173/signup` to create a new shop, or `http://localhost:5173/login` to sign in with an existing Owner or Staff account.
3. Open **Settings** in the `/admin` header to configure your **Business WhatsApp Contact** number and manage **Team Members**.
