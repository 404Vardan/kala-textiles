-- ====================================================================
-- Migration 009: Tenant-Scoped Storage Policies for product-media
-- Upload path format: {business_id}/{product_id}/{uuid}.{ext}
-- Prerequisite:  005_auth_security_tenancy.sql must be applied first.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Ensure product-media Bucket Exists & Is Public Read
-- --------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-media', 'product-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- --------------------------------------------------------------------
-- SECTION 2: Replace storage.objects Policies for product-media
-- Public read stays; authenticated members can insert, update, and
-- delete only objects whose first folder matches one of their
-- business IDs.
-- --------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read product-media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant members insert product-media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant members update product-media" ON storage.objects;
DROP POLICY IF EXISTS "Tenant members delete product-media" ON storage.objects;

-- Drop any legacy broad policies if present
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;

-- 1. Public Read (Catalog images/videos remain publicly readable)
CREATE POLICY "Public read product-media"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-media');

-- 2. Authenticated Tenant Member Insert
CREATE POLICY "Tenant members insert product-media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] ~ '^[0-9]+$'
    AND public.is_business_member(((storage.foldername(name))[1])::BIGINT)
  );

-- 3. Authenticated Tenant Member Update
CREATE POLICY "Tenant members update product-media"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] ~ '^[0-9]+$'
    AND public.is_business_member(((storage.foldername(name))[1])::BIGINT)
  )
  WITH CHECK (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] ~ '^[0-9]+$'
    AND public.is_business_member(((storage.foldername(name))[1])::BIGINT)
  );

-- 4. Authenticated Tenant Member Delete
CREATE POLICY "Tenant members delete product-media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] ~ '^[0-9]+$'
    AND public.is_business_member(((storage.foldername(name))[1])::BIGINT)
  );

COMMIT;
