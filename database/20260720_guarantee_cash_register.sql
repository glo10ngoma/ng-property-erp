BEGIN;

CREATE TABLE IF NOT EXISTS guarantee_cash_movements (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  movement_type VARCHAR(30) NOT NULL
    CHECK (movement_type IN ('GARANTY_PAYMENT_IN', 'GARANTY_REFUND', 'GARANTY_EXPENSE', 'GARANTY_TRANSFER')),
  type VARCHAR(10) NOT NULL CHECK (type IN ('IN', 'OUT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  exchange_rate_used NUMERIC(18,6),
  exchange_rate_date DATE,
  equivalent_usd NUMERIC(12,2),
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  lease_guarantee_id INTEGER REFERENCES lease_guarantees(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  reference VARCHAR(120),
  reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS guarantee_cash_movements_org_date_idx
  ON guarantee_cash_movements (organization_id, movement_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS guarantee_cash_movements_org_type_idx
  ON guarantee_cash_movements (organization_id, movement_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS guarantee_cash_movements_lease_idx
  ON guarantee_cash_movements (organization_id, lease_id)
  WHERE deleted_at IS NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS guarantee_cash_movement_id INTEGER REFERENCES guarantee_cash_movements(id) ON DELETE SET NULL;

COMMIT;
