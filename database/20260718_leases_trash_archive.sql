BEGIN;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS leases_org_deleted_idx
  ON leases (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS leases_org_archived_idx
  ON leases (organization_id, archived_at)
  WHERE archived_at IS NOT NULL;

COMMIT;
