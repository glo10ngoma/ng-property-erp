BEGIN;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS logo_file_name TEXT,
  ADD COLUMN IF NOT EXISTS logo_file_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_file_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_file_url TEXT,
  ADD COLUMN IF NOT EXISTS stamp_file_name TEXT,
  ADD COLUMN IF NOT EXISTS stamp_file_url TEXT;

UPDATE company_settings
SET
  logo_file_name = COALESCE(logo_file_name, NULLIF(split_part(regexp_replace(COALESCE(logo_url, ''), '^.*/', ''), '?', 1), '')),
  logo_file_url = COALESCE(logo_file_url, logo_url),
  signature_file_name = COALESCE(signature_file_name, NULLIF(split_part(regexp_replace(COALESCE(signature_url, ''), '^.*/', ''), '?', 1), '')),
  signature_file_url = COALESCE(signature_file_url, signature_url),
  stamp_file_name = COALESCE(stamp_file_name, NULLIF(split_part(regexp_replace(COALESCE(stamp_url, ''), '^.*/', ''), '?', 1), '')),
  stamp_file_url = COALESCE(stamp_file_url, stamp_url)
WHERE deleted_at IS NULL;

COMMIT;
