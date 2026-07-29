BEGIN;

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS payment_allocations
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS cash_movements
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS guarantee_cash_movements
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS lease_guarantees
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS tenant_credits
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS tenant_credit_refunds
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

ALTER TABLE IF EXISTS treasury_transfers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS restored_by INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS payments_org_deleted_idx
  ON payments (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_org_deleted_idx
  ON cash_movements (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS guarantee_cash_movements_org_deleted_idx
  ON guarantee_cash_movements (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMIT;
