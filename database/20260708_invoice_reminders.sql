ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS invoice_reminders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP')),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('SENT', 'FAILED', 'SIMULATED')),
  reminded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reminded_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_org_invoice ON invoice_reminders(organization_id, invoice_id, reminded_at DESC);
