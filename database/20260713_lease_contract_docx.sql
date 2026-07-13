BEGIN;

ALTER TABLE lease_contract_generations
  ADD COLUMN IF NOT EXISTS docx_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS docx_file_url TEXT;

COMMIT;
