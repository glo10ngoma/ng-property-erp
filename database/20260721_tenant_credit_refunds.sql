BEGIN;

ALTER TABLE tenant_credits
  DROP CONSTRAINT IF EXISTS tenant_credits_status_check;

ALTER TABLE tenant_credits
  ADD CONSTRAINT tenant_credits_status_check
  CHECK (status IN ('AVAILABLE', 'PARTIALLY_USED', 'USED', 'REFUNDED', 'CANCELLED'));

CREATE TABLE IF NOT EXISTS tenant_credit_refunds (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tenant_credit_id INTEGER NOT NULL REFERENCES tenant_credits(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('USD', 'CDF')),
  refund_date DATE NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'MOBILE_MONEY')),
  reference VARCHAR(120),
  reason TEXT NOT NULL,
  cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  receipt_number VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'REFUNDED' CHECK (status IN ('REFUNDED', 'CANCELLED')),
  created_by INTEGER REFERENCES app_users(id),
  idempotency_key TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credit_refunds_org_idempotency_unique
  ON tenant_credit_refunds (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credit_refunds_org_receipt_unique
  ON tenant_credit_refunds (organization_id, receipt_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credit_refunds_org_credit_idx
  ON tenant_credit_refunds (organization_id, tenant_credit_id, refund_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credit_refunds_org_lease_idx
  ON tenant_credit_refunds (organization_id, lease_id, refund_date DESC, id DESC)
  WHERE lease_id IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
