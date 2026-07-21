BEGIN;

ALTER TABLE payments
  ALTER COLUMN invoice_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN IF NOT EXISTS lease_guarantee_id INTEGER REFERENCES lease_guarantees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payment_type_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN ('INVOICE', 'GUARANTEE', 'TENANT_CREDIT'));

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_invoice_or_guarantee_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_invoice_or_guarantee_check
  CHECK (
    (payment_type = 'INVOICE' AND invoice_id IS NOT NULL)
    OR
    (payment_type = 'GUARANTEE' AND invoice_id IS NULL AND lease_guarantee_id IS NOT NULL)
    OR
    (payment_type = 'TENANT_CREDIT' AND invoice_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_idempotency_unique
  ON payments (organization_id, idempotency_key)
  WHERE deleted_at IS NULL
    AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_org_type_idx
  ON payments (organization_id, payment_type, payment_date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_credits (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  source_payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('USD', 'CDF')),
  original_amount NUMERIC(14,2) NOT NULL CHECK (original_amount > 0),
  remaining_amount NUMERIC(14,2) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount),
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'PARTIALLY_USED', 'USED', 'CANCELLED')),
  payment_date DATE NOT NULL,
  reference VARCHAR(120),
  notes TEXT,
  idempotency_key TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credits_org_source_payment_unique
  ON tenant_credits (organization_id, source_payment_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credits_org_idempotency_unique
  ON tenant_credits (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credits_org_tenant_idx
  ON tenant_credits (organization_id, tenant_id, payment_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credits_org_lease_idx
  ON tenant_credits (organization_id, lease_id, payment_date DESC)
  WHERE lease_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credits_org_status_idx
  ON tenant_credits (organization_id, status, payment_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS tenant_credit_id INTEGER REFERENCES tenant_credits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_movements_tenant_credit_idx
  ON cash_movements (organization_id, tenant_credit_id)
  WHERE tenant_credit_id IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
