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
  CHECK (payment_type IN ('INVOICE', 'GUARANTEE'));

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_invoice_or_guarantee_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_invoice_or_guarantee_check
  CHECK (
    (payment_type = 'INVOICE' AND invoice_id IS NOT NULL)
    OR
    (payment_type = 'GUARANTEE' AND invoice_id IS NULL AND lease_guarantee_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS payments_org_type_idx
  ON payments (organization_id, payment_type, payment_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_org_lease_guarantee_idx
  ON payments (organization_id, lease_guarantee_id)
  WHERE deleted_at IS NULL
    AND lease_guarantee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_idempotency_unique
  ON payments (organization_id, idempotency_key)
  WHERE deleted_at IS NULL
    AND idempotency_key IS NOT NULL;

COMMIT;
