BEGIN;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS billing_frequency_months INTEGER NOT NULL DEFAULT 1;

ALTER TABLE leases
  DROP CONSTRAINT IF EXISTS leases_billing_frequency_months_check;

ALTER TABLE leases
  ADD CONSTRAINT leases_billing_frequency_months_check
  CHECK (billing_frequency_months >= 1 AND billing_frequency_months <= 12);

COMMIT;
