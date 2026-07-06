BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES app_users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD', 'READ', 'ARCHIVED')),
  source TEXT NOT NULL DEFAULT 'INTERNAL',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  link_path TEXT,
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'INTERNAL')),
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_status ON notifications(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_message_templates_org_channel ON message_templates(organization_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_email_logs_org_created ON email_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_org_created ON sms_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_org_created ON whatsapp_logs(organization_id, created_at DESC);

INSERT INTO permissions (code, name)
VALUES
  ('communication.read', 'Consulter communications'),
  ('communication.template.create', 'Creer modele communication'),
  ('communication.template.update', 'Modifier modele communication'),
  ('communication.template.delete', 'Desactiver modele communication'),
  ('communication.send', 'Envoyer communication'),
  ('communication.logs.read', 'Consulter logs communication'),
  ('notifications.read', 'Consulter notifications'),
  ('notifications.update', 'Modifier notifications')
ON CONFLICT (code) DO NOTHING;

INSERT INTO message_templates (code, name, channel, subject, body, variables, organization_id, created_by)
SELECT code, name, channel, subject, body, variables::JSONB, 1, 1
FROM (VALUES
  ('INVOICE_EMAIL', 'Facture par email', 'EMAIL', 'Facture {{invoice_number}}', 'Bonjour {{tenant_full_name}}, votre facture {{invoice_number}} de {{amount}} est disponible. Echeance : {{due_date}}.', '["tenant_full_name","invoice_number","amount","due_date"]'),
  ('PAYMENT_RECEIPT_EMAIL', 'Recu de paiement par email', 'EMAIL', 'Recu {{payment_number}}', 'Bonjour {{tenant_full_name}}, nous confirmons la reception du paiement {{payment_number}} de {{amount}}.', '["tenant_full_name","payment_number","amount"]'),
  ('INVOICE_REMINDER_SMS', 'Relance facture SMS', 'SMS', NULL, 'Rappel : facture {{invoice_number}} de {{amount}} a regler avant {{due_date}}.', '["invoice_number","amount","due_date"]'),
  ('INVOICE_REMINDER_WHATSAPP', 'Relance facture WhatsApp', 'WHATSAPP', NULL, 'Bonjour {{tenant_full_name}}, votre facture {{invoice_number}} reste due. Montant : {{amount}}.', '["tenant_full_name","invoice_number","amount"]'),
  ('WORKFLOW_PENDING_INTERNAL', 'Validation en attente', 'INTERNAL', NULL, 'Une validation {{tenant_name}} est en attente de traitement.', '["tenant_name"]')
) AS defaults(code, name, channel, subject, body, variables)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
