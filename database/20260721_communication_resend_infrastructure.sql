BEGIN;

CREATE TABLE IF NOT EXISTS communication_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL DEFAULT 'RESEND',
  from_name VARCHAR(180),
  from_email VARCHAR(255),
  reply_to VARCHAR(255),
  api_key_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_settings_provider_check
    CHECK (provider IN ('RESEND'))
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_settings_org_unique
  ON communication_settings (organization_id);

CREATE TABLE IF NOT EXISTS communication_logs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  provider VARCHAR(40),
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  status VARCHAR(40) NOT NULL,
  external_message_id VARCHAR(255),
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_logs_channel_check
    CHECK (channel IN ('EMAIL'))
);

CREATE INDEX IF NOT EXISTS communication_logs_org_channel_created_idx
  ON communication_logs (organization_id, channel, created_at DESC);

COMMIT;
