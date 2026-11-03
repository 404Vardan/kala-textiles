# Kala — Quick Start Guide

## Prerequisites

- **Node.js:** `v18.0.0+` (`v20+` LTS recommended)
- **npm:** `v9.0.0+`
- **Supabase Account:** [https://supabase.com](https://supabase.com)

---

## 1. Local Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Populate `.env.local` with your Supabase Project URL and Anon Public Key:
   ```dotenv
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   VITE_PUBLISHED_DOMAIN=http://localhost:5173
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 2. Database & Auth Setup

Follow **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** to:
1. Run migrations `001` through `006` in the Supabase SQL Editor.
2. Create the `product-media` storage bucket.
3. Create your Owner and Staff users in **Supabase Authentication** and link them in `public.memberships`.

---

## 3. Core Application Routes

| Route | Access | Purpose |
| :--- | :--- | :--- |
| `/` | Public | Commercial entry page, design number lookup, and QR scanner |
| `/login` | Public | Supabase Auth sign-in for Owners and Staff |
| `/admin` | Owner (`role = 'owner'`) | Full management portal (Dashboard, Products, Stock, Orders, Buyer QR Requests, Parties, Agents) |
| `/staff` | Staff / Owner | Mobile-first floor scanner and wholesale order drafting terminal |
| `/:slug/p/:designNo` | Public (+ Staff Mode) | Public QR design catalog page, set quantity stepper, and buyer order list |
| `/:slug/order-request` | Public | Buyer order request checkout (**Send on WhatsApp** & **Send to Shop**) |
| `/:slug/order/:orderNo` | Public | Public order summary & A4 PDF download |

---

## 4. Build & Type Verification

```bash
# Type-check with TypeScript
npx tsc --noEmit

# Build production bundle into dist/
npm run build

# Preview production build locally
npm run preview
```

For full architectural details, see **[README.md](README.md)**, **[docs/SPEC.md](docs/SPEC.md)**, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
