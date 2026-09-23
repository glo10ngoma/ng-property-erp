BEGIN;

CREATE TABLE IF NOT EXISTS syndic_cash_movements (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  type VARCHAR(10) NOT NULL DEFAULT 'IN' CHECK (type IN ('IN', 'OUT')),
  movement_type VARCHAR(40) NOT NULL DEFAULT 'SYNDIC_PAYMENT'
    CHECK (movement_type IN ('SYNDIC_PAYMENT', 'SYNDIC_ADJUSTMENT')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  equivalent_usd NUMERIC(12,2) NOT NULL CHECK (equivalent_usd >= 0),
  exchange_rate_used NUMERIC(18,6),
  exchange_rate_date DATE,
  movement_date DATE NOT NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  payment_method VARCHAR(40) NOT NULL,
  treasury_location VARCHAR(20) NOT NULL
    CHECK (treasury_location IN ('MAIN_CASH', 'BANK')),
  reference VARCHAR(120),
  description TEXT,
  allocation_breakdown JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  deletion_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS syndic_cash_movements_payment_currency_active_uidx
  ON syndic_cash_movements (organization_id, payment_id, currency)
  WHERE payment_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS syndic_cash_movements_org_date_idx
  ON syndic_cash_movements (organization_id, movement_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS syndic_cash_movements_invoice_idx
  ON syndic_cash_movements (organization_id, invoice_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS syndic_cash_reclassification_audit (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  cash_movement_id INTEGER REFERENCES cash_movements(id),
  currency VARCHAR(10) NOT NULL,
  original_cash_amount NUMERIC(12,2),
  reclassified_syndic_amount NUMERIC(12,2) NOT NULL,
  resulting_cash_amount NUMERIC(12,2),
  original_equivalent_usd NUMERIC(12,2),
  reclassified_equivalent_usd NUMERIC(12,2) NOT NULL,
  resulting_equivalent_usd NUMERIC(12,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, payment_id, currency)
);

COMMIT;
