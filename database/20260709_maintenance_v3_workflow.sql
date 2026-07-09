BEGIN;

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS technician_signature_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS technician_signed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS client_signature_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS client_signed_at TIMESTAMP;

ALTER TABLE maintenance_assignments
  ADD COLUMN IF NOT EXISTS planned_date DATE,
  ADD COLUMN IF NOT EXISTS planned_time TIME;

ALTER TABLE maintenance_expenses
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(180),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reference VARCHAR(140),
  ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS attachment_file_url TEXT,
  ADD COLUMN IF NOT EXISTS observation TEXT;

CREATE INDEX IF NOT EXISTS maintenance_assignments_org_planned_idx
  ON maintenance_assignments (organization_id, planned_date)
  WHERE deleted_at IS NULL;

COMMIT;
