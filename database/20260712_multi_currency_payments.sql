BEGIN;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  quote_currency VARCHAR(10) NOT NULL DEFAULT 'CDF',
  rate NUMERIC(14,6) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS exchange_rates_org_active_idx
  ON exchange_rates (organization_id, base_currency, quote_currency, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_cdf NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate_used NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS exchange_rate_date DATE,
  ADD COLUMN IF NOT EXISTS cdf_equivalent_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_equivalent_usd NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS exchange_rate_used NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS exchange_rate_date DATE,
  ADD COLUMN IF NOT EXISTS equivalent_usd NUMERIC(12,2) NOT NULL DEFAULT 0;

INSERT INTO exchange_rates (organization_id, base_currency, quote_currency, rate, effective_date, is_active, created_by)
SELECT id, 'USD', 'CDF', 2850, CURRENT_DATE, TRUE, 1
FROM organizations
ON CONFLICT DO NOTHING;

COMMIT;
