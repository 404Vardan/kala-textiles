# 🚀 Rangoli Textiles - Quick Start Guide

## Prerequisites
- Node.js 18+ installed
- Supabase account (free at https://supabase.com)

## Installation

1. **Install dependencies**
```bash
npm install
```

2. **Start development server**
```bash
npm run dev
```

3. **Access the app**
Open http://localhost:5173 in your browser

---

## ⚙️ Supabase Setup (REQUIRED)

### Option A: Interactive Setup (Fastest)

**Windows users:** Double-click `SUPABASE_SETUP_CHECKLIST.bat`

**Mac/Linux users:** Run `bash SUPABASE_SETUP_CHECKLIST.sh`

Or scroll down for manual steps...

### Option B: Manual Setup

#### 1️⃣ Create Supabase Project
- Go to https://supabase.com
- Sign up/login
- Click "New Project"
- Fill in details:
  - Name: `rangoli-textiles`
  - Save your database password
  - Choose your region
- Wait 2-3 minutes for provisioning

#### 2️⃣ Get API Credentials
- Open your project dashboard
- Go to Settings > API
- Copy these two values:
  - **Project URL** (example: `https://abc123xyz.supabase.co`)
  - **Anon Public Key** (long string starting with `eyJhbGc...`)

#### 3️⃣ Update `.env.local`
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
VITE_PUBLISHED_DOMAIN=http://localhost:5173
```

#### 4️⃣ Create Database Tables
- In Supabase, go to SQL Editor
- Click "New Query"
- Open `supabase/migrations/001_init.sql`
- Copy all content into the SQL editor
- Click "Run"
- ✅ Wait for success message

#### 5️⃣ Create Storage Bucket
- Go to Storage in Supabase
- Click "Create new bucket"
- Name: `product-media`
- ✅ Check "Public bucket"
- Click "Create bucket"

#### 6️⃣ Test Connection
- Restart dev server: `npm run dev`
- Open http://localhost:5173/admin
- Password: `admin123`
- ✅ You should see empty product list

---

## 📱 Using the Admin Dashboard

**URL:** http://localhost:5173/admin  
**Password:** `admin123` (change in Supabase after setup)

### Features:
- **Products Tab** - Add/edit/delete products with QR codes
- **Invoices Tab** - Create and manage invoices
- **Inquiries Tab** - Respond to customer inquiries

---

## 🔗 Public Pages

- **Products:** http://localhost:5173/p/{design-no}
- **Invoices:** http://localhost:5173/invoice/{invoice-no}

---

## 📦 Build & Deploy

**Development:**
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
npm run preview
```

**Deploy to Vercel:**
```bash
npm install -g vercel
vercel
```

---

## 🆘 Troubleshooting

### "Failed to verify admin credentials"
- Check `.env.local` has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Restart dev server after editing `.env.local`
- Check browser DevTools Console (F12) for error details

### "Cannot read products" / Tables not found
- Verify SQL migration ran successfully
- Check Supabase Dashboard > Tables to see if all 6 tables exist:
  - `admin_settings`
  - `products`
  - `product_media`
  - `invoices`
  - `invoice_items`
  - `inquiries`

### Media upload fails
- Ensure `product-media` bucket exists
- Check it's set as "Public bucket"
- Verify RLS policies allow uploads

### Still stuck?
- Check browser console for errors (F12 > Console tab)
- Check Supabase project Logs tab for server errors
- Review SUPABASE_SETUP.md for detailed instructions

---

## 📂 Project Structure

```
src/
├── components/
│   ├── admin/          # Admin dashboard components
│   ├── products/       # Product management
│   ├── invoices/       # Invoice management
│   ├── galleries/      # Media gallery
│   ├── common/         # Shared components
│   └── ui/             # shadcn/ui components
├── pages/              # Route pages
├── services/           # Supabase CRUD operations
├── hooks/              # React hooks
├── utils/              # Utilities
└── types/              # TypeScript types
```

---

## 🔐 Security Notes

- Default password `admin123` is for development only
- Change it in Supabase `admin_settings` table before production
- RLS policies are set to allow public access (suitable for admin-only app)
- Use proper authentication in production

---

## 📖 Tech Stack

- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Backend:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage
- **Routing:** React Router v7
- **Drag & Drop:** dnd-kit
- **QR Codes:** qrcode.react

---

## 📝 Next Steps

1. ✅ Complete Supabase setup (see above)
2. Add your first product
3. Generate QR codes for products
4. Create your first invoice
5. Test public product pages
6. Set up WhatsApp notifications
7. Deploy to production

---

**Questions?** Check SUPABASE_SETUP.md for detailed instructions.
