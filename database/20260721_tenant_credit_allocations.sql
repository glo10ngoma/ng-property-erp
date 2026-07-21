BEGIN;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payment_type_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN ('INVOICE', 'GUARANTEE', 'TENANT_CREDIT', 'TENANT_CREDIT_ALLOCATION'));

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
    OR
    (payment_type = 'TENANT_CREDIT_ALLOCATION' AND invoice_id IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS tenant_credit_allocations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  tenant_credit_id INTEGER NOT NULL REFERENCES tenant_credits(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount_applied NUMERIC(14,2) NOT NULL CHECK (amount_applied > 0),
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('USD', 'CDF')),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credit_allocations_credit_invoice_unique
  ON tenant_credit_allocations (organization_id, tenant_credit_id, invoice_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_credit_allocations_payment_unique
  ON tenant_credit_allocations (organization_id, payment_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credit_allocations_invoice_idx
  ON tenant_credit_allocations (organization_id, invoice_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_credit_allocations_credit_idx
  ON tenant_credit_allocations (organization_id, tenant_credit_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
