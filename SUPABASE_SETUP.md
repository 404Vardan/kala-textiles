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

> **Important:** Never copy or expose the `service_role` secret key in `.env.local` or any frontend configuration.

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

---

## Step 5: Verify Storage Bucket (`product-media`)

1. Navigate to **Storage** in the Supabase dashboard.
2. Confirm that the `product-media` bucket exists and is marked **Public** (for reading catalog images/videos).
3. Upload/delete permissions are restricted to authenticated business members by the storage policies defined in `005_auth_security_tenancy.sql`.

---

## Step 6: Provision Owner & Staff Accounts

**Kala** uses **Supabase Auth** paired with the `public.memberships` table for role-based access control:

1. In the Supabase dashboard, go to **Authentication → Users** and click **Add User → Create New User**.
2. Create an account for the business owner (and optionally staff accounts).
3. Copy the newly created user's **User UID** and run the following query in the **SQL Editor**:

```sql
-- Grant Owner access to the default business (slug = 'rangoli' preserved for QR compatibility)
INSERT INTO public.memberships (user_id, business_id, role, is_active)
SELECT '<OWNER_USER_UUID>', id, 'owner', true
FROM public.businesses
WHERE slug = 'rangoli';

-- Optional: Grant Staff access to a staff account
INSERT INTO public.memberships (user_id, business_id, role, is_active)
SELECT '<STAFF_USER_UUID>', id, 'staff', true
FROM public.businesses
WHERE slug = 'rangoli';
```

> **Note:** Each user must have **one** active business membership (`is_active = true`).

---

## Step 7: Verify Application Sign-In

1. Start the development server:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:5173/login` and sign in with your Owner email and password.
3. Open **Settings** in the `/admin` header to configure your **Business WhatsApp Contact** number for customer QR order sharing.
