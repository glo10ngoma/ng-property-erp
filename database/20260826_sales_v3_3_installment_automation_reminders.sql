BEGIN;

ALTER TABLE sales_settings
  ADD COLUMN IF NOT EXISTS sales_installment_automation_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_auto_generate_invoice_days_before INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_auto_send_invoice BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_reminders_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_reminder_days_before JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sales_overdue_reminder_days JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sales_reminder_execution_time TIME DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS sales_reminder_timezone TEXT DEFAULT 'Africa/Kinshasa',
  ADD COLUMN IF NOT EXISTS sales_max_reminders_per_invoice INTEGER DEFAULT 6,
  ADD COLUMN IF NOT EXISTS sales_reminder_cooldown_hours INTEGER DEFAULT 24,
  ADD COLUMN IF NOT EXISTS sales_collection_email_mode TEXT DEFAULT 'DISABLED',
  ADD COLUMN IF NOT EXISTS sales_overdue_grace_days INTEGER DEFAULT 0;

ALTER TABLE sales_settings
  DROP CONSTRAINT IF EXISTS sales_settings_sales_auto_generate_invoice_days_before_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_max_reminders_per_invoice_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_reminder_cooldown_hours_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_overdue_grace_days_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_collection_email_mode_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_reminder_days_before_json_chk,
  DROP CONSTRAINT IF EXISTS sales_settings_sales_overdue_reminder_days_json_chk;

ALTER TABLE sales_settings
  ADD CONSTRAINT sales_settings_sales_auto_generate_invoice_days_before_chk CHECK (sales_auto_generate_invoice_days_before >= 0),
  ADD CONSTRAINT sales_settings_sales_max_reminders_per_invoice_chk CHECK (sales_max_reminders_per_invoice IS NULL OR sales_max_reminders_per_invoice >= 1),
  ADD CONSTRAINT sales_settings_sales_reminder_cooldown_hours_chk CHECK (sales_reminder_cooldown_hours IS NULL OR sales_reminder_cooldown_hours BETWEEN 0 AND 720),
  ADD CONSTRAINT sales_settings_sales_overdue_grace_days_chk CHECK (sales_overdue_grace_days >= 0),
  ADD CONSTRAINT sales_settings_sales_collection_email_mode_chk CHECK (sales_collection_email_mode IN ('DISABLED', 'TEST_REDIRECT', 'LIVE')),
  ADD CONSTRAINT sales_settings_sales_reminder_days_before_json_chk CHECK (
    jsonb_typeof(sales_reminder_days_before) = 'array'
    AND NOT jsonb_path_exists(sales_reminder_days_before, '$[*] ? (type() != "number" || @ < 0)')
  ),
  ADD CONSTRAINT sales_settings_sales_overdue_reminder_days_json_chk CHECK (
    jsonb_typeof(sales_overdue_reminder_days) = 'array'
    AND NOT jsonb_path_exists(sales_overdue_reminder_days, '$[*] ? (type() != "number" || @ < 0)')
  );

CREATE TABLE IF NOT EXISTS sales_automation_runs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  automation_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eligible_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by BIGINT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_automation_runs_status_chk CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED')),
  CONSTRAINT sales_automation_runs_execution_mode_chk CHECK (execution_mode IN ('AUTOMATIC', 'MANUAL', 'RETRY', 'DRY_RUN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_automation_runs_running_uidx
  ON sales_automation_runs (organization_id, automation_type, period_key)
  WHERE status = 'RUNNING';

CREATE INDEX IF NOT EXISTS sales_automation_runs_org_type_period_idx
  ON sales_automation_runs (organization_id, automation_type, period_key, started_at DESC);

CREATE INDEX IF NOT EXISTS sales_automation_runs_org_status_idx
  ON sales_automation_runs (organization_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS sales_invoice_reminders (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  invoice_id BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  buyer_id BIGINT NULL,
  reminder_type TEXT NOT NULL,
  reminder_stage TEXT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  channel TEXT NOT NULL DEFAULT 'EMAIL',
  recipient TEXT NULL,
  communication_log_id BIGINT NULL,
  idempotency_key TEXT NOT NULL,
  failure_code TEXT NULL,
  failure_message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_reminders_type_chk CHECK (reminder_type IN ('INVOICE_ISSUED', 'UPCOMING_DUE', 'DUE_TODAY', 'OVERDUE', 'FINAL_NOTICE')),
  CONSTRAINT sales_invoice_reminders_status_chk CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED')),
  CONSTRAINT sales_invoice_reminders_channel_chk CHECK (channel IN ('EMAIL')),
  CONSTRAINT sales_invoice_reminders_invoice_fk
    FOREIGN KEY (invoice_id, organization_id)
    REFERENCES sales_invoices(id, organization_id),
  CONSTRAINT sales_invoice_reminders_subscription_fk
    FOREIGN KEY (subscription_id, organization_id)
    REFERENCES sales_subscriptions(id, organization_id),
  CONSTRAINT sales_invoice_reminders_buyer_fk
    FOREIGN KEY (buyer_id, organization_id)
    REFERENCES sales_buyers(id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_reminders_org_idempotency_uidx
  ON sales_invoice_reminders (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS sales_invoice_reminders_org_invoice_idx
  ON sales_invoice_reminders (organization_id, invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_invoice_reminders_org_status_schedule_idx
  ON sales_invoice_reminders (organization_id, status, scheduled_for ASC);

ALTER TABLE sales_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_reminders ENABLE ROW LEVEL SECURITY;

COMMIT;
