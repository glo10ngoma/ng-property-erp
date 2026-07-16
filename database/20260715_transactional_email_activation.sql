BEGIN;

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS template_code TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS sandbox_recipient TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE email_logs
SET attempt_count = CASE
  WHEN status IN ('SIMULATED', 'SENT', 'FAILED') THEN GREATEST(COALESCE(attempt_count, 0), 1)
  ELSE COALESCE(attempt_count, 0)
END,
    updated_at = COALESCE(updated_at, created_at, NOW())
WHERE attempt_count = 0
   OR updated_at IS NULL;

ALTER TABLE email_logs
  DROP CONSTRAINT IF EXISTS email_logs_status_check;

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SIMULATED', 'SKIPPED', 'CANCELLED'));

CREATE INDEX IF NOT EXISTS idx_email_logs_org_status_created
  ON email_logs (organization_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_org_idempotency
  ON email_logs (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND deleted_at IS NULL
    AND status IN ('PENDING', 'SENDING', 'SENT', 'SKIPPED');

COMMIT;
