BEGIN;

ALTER TABLE lease_contract_generations
  ADD COLUMN IF NOT EXISTS template_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS template_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS docx_file_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS docx_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS docx_mime_type VARCHAR(160);

COMMIT;
