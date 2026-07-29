BEGIN;

ALTER TABLE IF EXISTS shareholder_payout_batches
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS shareholder_payout_lines
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS shareholder_payout_batches_org_deleted_idx
  ON shareholder_payout_batches (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS shareholder_payout_lines_org_deleted_idx
  ON shareholder_payout_lines (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMIT;
