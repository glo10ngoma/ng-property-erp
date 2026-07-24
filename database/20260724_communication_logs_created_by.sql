BEGIN;

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS communication_logs_org_channel_created_by_idx
  ON communication_logs (organization_id, channel, created_by)
  WHERE created_by IS NOT NULL;

COMMIT;
