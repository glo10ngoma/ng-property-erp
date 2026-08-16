BEGIN;

CREATE TABLE IF NOT EXISTS organization_modules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  module_code VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled_at TIMESTAMP NULL,
  enabled_by INTEGER NULL REFERENCES app_users(id),
  disabled_at TIMESTAMP NULL,
  disabled_by INTEGER NULL REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_modules_unique UNIQUE (organization_id, module_code),
  CONSTRAINT organization_modules_module_code_uppercase CHECK (module_code = UPPER(module_code))
);

CREATE INDEX IF NOT EXISTS organization_modules_organization_idx
  ON organization_modules (organization_id);

CREATE INDEX IF NOT EXISTS organization_modules_module_code_idx
  ON organization_modules (module_code);

CREATE INDEX IF NOT EXISTS organization_modules_enabled_idx
  ON organization_modules (organization_id, module_code, is_enabled);

COMMENT ON TABLE organization_modules IS 'Feature flags modulaires par organisation. Aucun module n''est activé par défaut.';
COMMENT ON COLUMN organization_modules.module_code IS 'Code canonique du module, par exemple SALES.';
COMMENT ON COLUMN organization_modules.settings IS 'Configuration extensible du module pour l''organisation.';

COMMIT;
