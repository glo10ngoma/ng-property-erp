BEGIN;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS lease_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_organization_lease_number
  ON leases (organization_id, lease_number)
  WHERE lease_number IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
