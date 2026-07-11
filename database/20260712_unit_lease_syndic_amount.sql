BEGIN;

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS monthly_syndic_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_syndic_amount >= 0),
  ADD COLUMN IF NOT EXISTS syndic_currency VARCHAR(10) NOT NULL DEFAULT 'USD';

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS monthly_syndic_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_syndic_amount >= 0);

COMMIT;
