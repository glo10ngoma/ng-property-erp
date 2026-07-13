BEGIN;

CREATE TABLE IF NOT EXISTS automation_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  automation_code VARCHAR(80) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  execution_time TIME NOT NULL DEFAULT TIME '23:00',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Kinshasa',
  due_day INTEGER NOT NULL DEFAULT 5,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES app_users(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  CONSTRAINT automation_settings_due_day_check CHECK (due_day BETWEEN 1 AND 31),
  CONSTRAINT automation_settings_unique UNIQUE (organization_id, automation_code)
);

CREATE INDEX IF NOT EXISTS automation_settings_org_code_idx
  ON automation_settings (organization_id, automation_code)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS automation_runs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  automation_code VARCHAR(80) NOT NULL,
  execution_mode VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  billing_month INTEGER CHECK (billing_month BETWEEN 1 AND 12),
  billing_year INTEGER CHECK (billing_year >= 2000),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  eligible_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  triggered_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS automation_runs_org_code_started_idx
  ON automation_runs (organization_id, automation_code, started_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS automation_run_items (
  id SERIAL PRIMARY KEY,
  automation_run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INTEGER,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  reference VARCHAR(220),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automation_run_items_run_idx
  ON automation_run_items (automation_run_id, status, created_at DESC);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(30) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS billing_month INTEGER,
  ADD COLUMN IF NOT EXISTS billing_year INTEGER,
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS invoice_date DATE,
  ADD COLUMN IF NOT EXISTS generated_automatically BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generation_source VARCHAR(120),
  ADD COLUMN IF NOT EXISTS automation_run_id INTEGER REFERENCES automation_runs(id),
  ADD COLUMN IF NOT EXISTS email_delivery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS email_delivery_reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS email_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS whatsapp_delivery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS whatsapp_delivery_reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS whatsapp_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_whatsapp_at TIMESTAMP;

UPDATE invoices
SET
  invoice_date = COALESCE(invoice_date, issue_date),
  billing_month = COALESCE(billing_month, month),
  billing_year = COALESCE(billing_year, year),
  period_start = COALESCE(period_start, make_date(year, month, 1)),
  period_end = COALESCE(period_end, (date_trunc('month', make_date(year, month, 1)) + INTERVAL '1 month - 1 day')::DATE),
  invoice_type = COALESCE(
    NULLIF(invoice_type, ''),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM invoice_items ii
        WHERE ii.invoice_id = invoices.id
          AND COALESCE(ii.deleted_at, NULL) IS NULL
          AND (
            COALESCE(ii.item_type, '') = 'Monthly rent'
            OR COALESCE(ii.item_type, '') = 'Syndic'
            OR COALESCE(ii.description, '') ILIKE 'Loyer %'
            OR COALESCE(ii.description, '') ILIKE 'Syndic %'
          )
      ) THEN 'RENT'
      WHEN EXISTS (
        SELECT 1
        FROM invoice_items ii
        WHERE ii.invoice_id = invoices.id
          AND COALESCE(ii.deleted_at, NULL) IS NULL
          AND (
            COALESCE(ii.item_type, '') = 'Maintenance'
            OR COALESCE(ii.description, '') ILIKE 'Maintenance%'
          )
      ) THEN 'MAINTENANCE'
      ELSE 'OTHER'
    END
  )
WHERE COALESCE(deleted_at, NULL) IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_rent_once_per_lease_period_idx
  ON invoices (organization_id, lease_id, billing_year, billing_month, invoice_type)
  WHERE deleted_at IS NULL
    AND lease_id IS NOT NULL
    AND invoice_type = 'RENT';

CREATE INDEX IF NOT EXISTS invoices_billing_period_idx
  ON invoices (organization_id, invoice_type, billing_year, billing_month)
  WHERE deleted_at IS NULL;

INSERT INTO automation_settings (
  organization_id,
  automation_code,
  is_enabled,
  execution_time,
  timezone,
  due_day,
  email_enabled,
  whatsapp_enabled,
  updated_by
)
SELECT
  id,
  'MONTHLY_RENT_BILLING',
  FALSE,
  TIME '23:00',
  'Africa/Kinshasa',
  5,
  TRUE,
  TRUE,
  1
FROM organizations
ON CONFLICT (organization_id, automation_code) DO NOTHING;

COMMIT;
