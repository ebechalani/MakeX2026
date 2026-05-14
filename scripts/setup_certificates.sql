-- Run this in Supabase SQL editor before running generate_certificates.mjs

-- 1. App settings table (key/value for feature flags)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT 'false'
);
ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON app_settings TO anon;

INSERT INTO app_settings (key, value) VALUES ('certificates_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

-- 2. Storage bucket for certificates (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificates', 'certificates', true, 5242880, ARRAY['application/pdf'])
  ON CONFLICT (id) DO NOTHING;

-- Allow anon to upload / update / delete in the certificates bucket
DROP POLICY IF EXISTS "anon can manage certificates" ON storage.objects;
CREATE POLICY "anon can manage certificates"
  ON storage.objects FOR ALL
  TO anon
  USING (bucket_id = 'certificates')
  WITH CHECK (bucket_id = 'certificates');

-- Allow public read
DROP POLICY IF EXISTS "public can read certificates" ON storage.objects;
CREATE POLICY "public can read certificates"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'certificates');
