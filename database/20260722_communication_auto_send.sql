BEGIN;

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS auto_send_invoice BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_send_payment_receipt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_send_tenant_credit_receipt BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS document_id INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_trigger VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_delivery_trigger_check;

ALTER TABLE communication_logs
  ADD CONSTRAINT communication_logs_delivery_trigger_check
  CHECK (delivery_trigger IN ('AUTO', 'MANUAL', 'SYSTEM'));

CREATE UNIQUE INDEX IF NOT EXISTS communication_logs_org_channel_idempotency_unique
  ON communication_logs (organization_id, channel, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
