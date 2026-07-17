BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tenant_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_organization_tenant_number
  ON tenants (organization_id, tenant_number)
  WHERE tenant_number IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
