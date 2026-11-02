# Supabase Setup Guide

## Step 1: Create Supabase Project

1. Go to https://supabase.com
2. Sign up or log in
3. Create a new project:
   - Click "New Project"
   - Choose your organization
   - Project name: `rangoli-textiles`
   - Database password: Save this securely
   - Region: Choose closest to you (e.g., us-east-1 for US)
   - Click "Create new project"
4. Wait for project to provision (~2-3 minutes)

## Step 2: Get Your Credentials

1. Go to **Settings > API** in your Supabase project dashboard
2. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **Anon Public Key** (starts with `eyJhbGc...`)

## Step 3: Update Environment Variables

1. Open `.env.local` in the project root
2. Replace with your actual credentials:

```env
VITE_SUPABASE_URL=https://your-project-uuid.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
VITE_PUBLISHED_DOMAIN=http://localhost:5173
```

3. Save the file

## Step 4: Create Database Tables

1. Go to **SQL Editor** in Supabase dashboard
2. Click **New Query**
3. Copy the entire content from `supabase/migrations/001_init.sql`
4. Paste it into the SQL Editor
5. Click **Run** (or press Ctrl+Enter)
6. Wait for success message

## Step 5: Create Storage Bucket

1. Go to **Storage** in Supabase dashboard
2. Click **Create a new bucket**
3. Bucket name: `product-media`
4. Check: **Public bucket** (so images/videos are publicly accessible)
5. Click **Create bucket**

## Step 6: Configure RLS (Row Level Security)

1. Go to **Storage > Buckets > product-media**
2. Click **Policies** tab
3. The default policy should allow public access (auto-created)
4. If needed, add policy:
   - Click **New Policy**
   - Choose "For queries"
   - Check all: SELECT, INSERT, UPDATE, DELETE
   - **With check**: `true`
   - Click **Save**

## Step 7: Verify Setup

Return to your terminal and:

```bash
npm run dev
```

Then test:
1. Go to http://localhost:5173/admin
2. Enter password: `admin123`
3. You should see empty product tables

## Troubleshooting

### "Failed to verify admin credentials"
- Ensure `.env.local` has correct VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
- Restart dev server after changing .env.local

### "No tables found"
- Check if SQL migration ran successfully in Supabase SQL Editor
- Verify all 6 tables exist (look in Supabase Dashboard > Tables)

### Media upload fails
- Verify `product-media` bucket exists and is public
- Check Storage bucket policies allow uploads

### Still getting errors?
- Check browser console (F12) for detailed error messages
- Check Supabase dashboard > Logs for server-side errors
