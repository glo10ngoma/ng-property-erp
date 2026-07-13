BEGIN;

CREATE TABLE IF NOT EXISTS user_organizations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  role_code VARCHAR(60) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT user_organizations_unique UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS user_organizations_user_idx
  ON user_organizations (user_id);

CREATE INDEX IF NOT EXISTS user_organizations_organization_idx
  ON user_organizations (organization_id);

INSERT INTO user_organizations (
  user_id,
  organization_id,
  role_code,
  is_active,
  is_default
)
SELECT
  u.id,
  u.organization_id,
  CASE
    WHEN UPPER(COALESCE(u.role, '')) = 'SUPER_ADMIN' THEN 'ADMIN_CLIENT'
    WHEN UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'ADMIN_CLIENT') THEN 'ADMIN_CLIENT'
    WHEN UPPER(COALESCE(u.role, '')) IN ('EDITOR', 'EDITOR_CLIENT', 'ACCOUNTANT', 'STAFF', 'AGENT', 'GESTIONNAIRE', 'COMPTABLE') THEN 'EDITOR_CLIENT'
    ELSE 'VIEWER_CLIENT'
  END,
  TRUE,
  TRUE
FROM app_users u
WHERE u.organization_id IS NOT NULL
  AND u.deleted_at IS NULL
ON CONFLICT (user_id, organization_id) DO UPDATE
SET
  role_code = EXCLUDED.role_code,
  is_active = TRUE,
  updated_at = NOW();

UPDATE user_organizations uo
SET is_default = TRUE,
    updated_at = NOW()
WHERE uo.is_default = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM user_organizations uo2
    WHERE uo2.user_id = uo.user_id
      AND uo2.is_default = TRUE
  );

COMMIT;
