REM Rangoli Textiles - Supabase Setup Checklist for Windows
REM Follow these steps to set up Supabase

@echo off
cls
echo ============================================================
echo  Rangoli Textiles - Supabase Setup Checklist
echo ============================================================
echo.
echo STEP 1: Create Supabase Project
echo   [ ] Go to https://supabase.com and sign up/login
echo   [ ] Click "New Project"
echo   [ ] Fill in project details:
echo       - Name: rangoli-textiles
echo       - Save database password securely
echo       - Choose your region
echo   [ ] Wait for project to be created ^(~2-3 minutes^)
echo.
echo STEP 2: Get Your Credentials
echo   [ ] Open Project Dashboard
echo   [ ] Go to Settings ^> API
echo   [ ] Copy "Project URL" ^(e.g., https://xxxxx.supabase.co^)
echo   [ ] Copy "Anon public key" ^(starts with eyJhbGc...^)
echo.
echo STEP 3: Update .env.local
echo   [ ] Open .env.local in project root
echo   [ ] Replace placeholder values:
echo.
echo VITE_SUPABASE_URL=^<paste-your-project-url^>
echo VITE_SUPABASE_ANON_KEY=^<paste-your-anon-key^>
echo VITE_PUBLISHED_DOMAIN=http://localhost:5173
echo.
echo   [ ] Save the file
echo.
echo STEP 4: Create Database Tables
echo   [ ] Go back to Supabase Dashboard
echo   [ ] Click SQL Editor ^> New Query
echo   [ ] Open: supabase\migrations\001_init.sql
echo   [ ] Copy ALL content and paste into SQL Editor
echo   [ ] Click "Run" button
echo   [ ] Verify success message appears
echo.
echo STEP 5: Create Storage Bucket
echo   [ ] Go to Storage in Supabase
echo   [ ] Click "Create new bucket"
echo   [ ] Name: product-media
echo   [ ] Check: "Public bucket" checkbox
echo   [ ] Click "Create bucket"
echo.
echo STEP 6: Test Your Setup
echo   [ ] Go to admin dashboard: http://localhost:5173/admin
echo   [ ] Password: admin123
echo   [ ] You should see empty products list
echo.
echo ============================================================
echo  Setup Complete!
echo ============================================================
echo.
pause
