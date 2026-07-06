ALTER TABLE invoices ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(60) NOT NULL DEFAULT 'OTHER';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(80);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_name VARCHAR(180);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_id_idx ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_id_idx ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS payment_allocations_org_idx ON payment_allocations(organization_id);

INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, amount)
SELECT p.organization_id, p.id, p.invoice_id, p.amount
FROM payments p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa
    WHERE pa.payment_id = p.id
      AND pa.invoice_id = p.invoice_id
      AND pa.deleted_at IS NULL
  );

CREATE OR REPLACE VIEW invoice_payment_summary AS
SELECT
  i.id AS invoice_id,
  i.total,
  COALESCE(SUM(pa.amount) FILTER (WHERE pa.deleted_at IS NULL), 0)::NUMERIC(12,2) AS paid_amount,
  GREATEST(i.total - COALESCE(SUM(pa.amount) FILTER (WHERE pa.deleted_at IS NULL), 0), 0)::NUMERIC(12,2) AS remaining_amount
FROM invoices i
LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id;
