BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS platform_role VARCHAR(60);

UPDATE app_users
SET platform_role = 'SUPER_ADMIN'
WHERE LOWER(email) = 'glodyngoma64@gmail.com'
  AND COALESCE(platform_role, '') <> 'SUPER_ADMIN';

UPDATE app_users
SET platform_role = 'ADMIN_PLATFORM'
WHERE LOWER(email) = 'admin@property-erp.local'
  AND COALESCE(platform_role, '') <> 'ADMIN_PLATFORM';

ALTER TABLE user_organizations
  ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id),
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS user_organizations_role_idx
  ON user_organizations (role_id);

UPDATE user_organizations uo
SET role_id = r.id
FROM roles r
WHERE r.organization_id = uo.organization_id
  AND (
    (uo.role_code = 'ADMIN_CLIENT' AND r.code = 'ADMIN')
    OR (uo.role_code = 'EDITOR_CLIENT' AND r.code IN ('STAFF', 'ACCOUNTANT'))
    OR (uo.role_code = 'VIEWER_CLIENT' AND r.code IN ('DIRECTOR'))
  )
  AND uo.role_id IS NULL;

CREATE TABLE IF NOT EXISTS platform_admin_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES app_users(id),
  target_user_id INTEGER REFERENCES app_users(id),
  organization_id INTEGER REFERENCES organizations(id),
  action VARCHAR(120) NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_admin_audit_logs_actor_idx
  ON platform_admin_audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS platform_admin_audit_logs_org_idx
  ON platform_admin_audit_logs (organization_id);

COMMIT;
