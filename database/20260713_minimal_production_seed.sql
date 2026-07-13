-- NG Property ERP - Minimal production seed
-- ------------------------------------------------------------
-- Purpose:
--   Bootstrap a clean client organization without demo business data.
--
-- Assumptions:
--   - Core migrations are already applied.
--   - Global permissions were already inserted by the migration chain.
--   - This script does not create fake buildings / units / tenants / invoices.
--
-- Manual step:
--   Replace the values below before execution.

BEGIN;

CREATE TEMP TABLE minimal_seed_scope (
  organization_id INTEGER NOT NULL,
  organization_name TEXT NOT NULL,
  organization_slug TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_legal_name TEXT NOT NULL,
  company_city TEXT NOT NULL,
  company_country TEXT NOT NULL,
  default_currency TEXT NOT NULL,
  exchange_rate NUMERIC(14,6) NOT NULL,
  exchange_effective_date DATE NOT NULL
) ON COMMIT DROP;

INSERT INTO minimal_seed_scope (
  organization_id,
  organization_name,
  organization_slug,
  company_name,
  company_legal_name,
  company_city,
  company_country,
  default_currency,
  exchange_rate,
  exchange_effective_date
)
VALUES (
  10,
  'NG Property Client',
  'ng-property-client',
  'NG Property Client',
  'NG Property Client SARL',
  'Kinshasa',
  'RDC',
  'USD',
  2850,
  CURRENT_DATE
);

INSERT INTO organizations (id, name, slug, status)
SELECT organization_id, organization_name, organization_slug, 'ACTIVE'
FROM minimal_seed_scope
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  status = EXCLUDED.status;

INSERT INTO roles (organization_id, code, name)
SELECT scope.organization_id, role_data.code, role_data.name
FROM minimal_seed_scope scope
CROSS JOIN (
  VALUES
    ('ADMIN', 'Administrateur'),
    ('EDITOR', 'Utilisateur en écriture'),
    ('VIEWER', 'Lecture seule')
) AS role_data(code, name)
ON CONFLICT (organization_id, code) DO UPDATE
SET name = EXCLUDED.name;

INSERT INTO company_settings (
  organization_id,
  company_name,
  legal_name,
  company_legal_name,
  company_city,
  company_country,
  currency,
  language,
  timezone,
  company_address,
  default_lease_duration_months,
  default_notice_months,
  default_guarantee_months,
  default_signature_place,
  default_lease_usage,
  default_contract_template_code,
  created_by
)
SELECT
  scope.organization_id,
  scope.company_name,
  scope.company_legal_name,
  scope.company_legal_name,
  scope.company_city,
  scope.company_country,
  scope.default_currency,
  'fr',
  'Africa/Kinshasa',
  NULL,
  12,
  1,
  3,
  scope.company_city,
  'RESIDENTIAL',
  'LEASE_RESIDENTIAL',
  1
FROM minimal_seed_scope scope
ON CONFLICT (organization_id) DO UPDATE
SET
  company_name = EXCLUDED.company_name,
  legal_name = EXCLUDED.legal_name,
  company_legal_name = EXCLUDED.company_legal_name,
  company_city = EXCLUDED.company_city,
  company_country = EXCLUDED.company_country,
  currency = EXCLUDED.currency,
  language = EXCLUDED.language,
  timezone = EXCLUDED.timezone,
  default_lease_duration_months = EXCLUDED.default_lease_duration_months,
  default_notice_months = EXCLUDED.default_notice_months,
  default_guarantee_months = EXCLUDED.default_guarantee_months,
  default_signature_place = EXCLUDED.default_signature_place,
  default_lease_usage = EXCLUDED.default_lease_usage,
  default_contract_template_code = EXCLUDED.default_contract_template_code;

INSERT INTO exchange_rates (
  organization_id,
  base_currency,
  quote_currency,
  rate,
  effective_date,
  is_active,
  created_by
)
SELECT
  scope.organization_id,
  'USD',
  'CDF',
  scope.exchange_rate,
  scope.exchange_effective_date,
  TRUE,
  1
FROM minimal_seed_scope scope
WHERE NOT EXISTS (
  SELECT 1
  FROM exchange_rates er
  WHERE er.organization_id = scope.organization_id
    AND er.base_currency = 'USD'
    AND er.quote_currency = 'CDF'
    AND er.effective_date = scope.exchange_effective_date
    AND er.deleted_at IS NULL
);

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
  scope.organization_id,
  'MONTHLY_RENT_BILLING',
  FALSE,
  TIME '23:00',
  'Africa/Kinshasa',
  5,
  TRUE,
  TRUE,
  1
FROM minimal_seed_scope scope
ON CONFLICT (organization_id, automation_code) DO UPDATE
SET
  is_enabled = FALSE,
  execution_time = EXCLUDED.execution_time,
  timezone = EXCLUDED.timezone,
  due_day = EXCLUDED.due_day,
  email_enabled = EXCLUDED.email_enabled,
  whatsapp_enabled = EXCLUDED.whatsapp_enabled,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

-- Contract templates are organization-scoped. Reuse the latest active model if missing.
INSERT INTO lease_contract_templates (
  organization_id,
  name,
  code,
  version,
  lease_type,
  content,
  is_active,
  created_by
)
SELECT
  scope.organization_id,
  template.name,
  template.code,
  template.version,
  template.lease_type,
  template.content,
  TRUE,
  1
FROM minimal_seed_scope scope
JOIN LATERAL (
  SELECT name, code, version, lease_type, content
  FROM lease_contract_templates
  WHERE code = 'LEASE_RESIDENTIAL'
    AND deleted_at IS NULL
  ORDER BY version DESC
  LIMIT 1
) AS template ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM lease_contract_templates existing
  WHERE existing.organization_id = scope.organization_id
    AND existing.code = template.code
    AND existing.version = template.version
    AND existing.deleted_at IS NULL
);

-- Definitive admin procedure:
-- 1. Create the final administrator from the application UI if available.
-- 2. Or insert the user manually with a hashed password generated by the backend.
-- 3. Assign role = 'ADMIN' and organization_id = target organization.

COMMIT;
