BEGIN;

CREATE TABLE IF NOT EXISTS user_organization_access_denials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES app_users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES app_users(id),
  CONSTRAINT user_organization_access_denials_unique UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS user_organization_access_denials_user_idx
  ON user_organization_access_denials (user_id);

CREATE INDEX IF NOT EXISTS user_organization_access_denials_organization_idx
  ON user_organization_access_denials (organization_id);

COMMIT;
