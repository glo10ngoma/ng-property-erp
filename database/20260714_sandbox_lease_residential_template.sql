BEGIN;

WITH sandbox_org AS (
  SELECT id
  FROM organizations
  WHERE slug = 'ng-property-sandbox'
  LIMIT 1
),
source_template AS (
  SELECT name, code, version, lease_type, content
  FROM lease_contract_templates
  WHERE organization_id = 1
    AND code = 'LEASE_RESIDENTIAL'
    AND is_active = TRUE
    AND deleted_at IS NULL
  ORDER BY version DESC, id DESC
  LIMIT 1
)
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
  sandbox_org.id,
  'Contrat de bail a usage residentiel - SANDBOX',
  source_template.code,
  source_template.version,
  source_template.lease_type,
  source_template.content,
  TRUE,
  1
FROM sandbox_org
JOIN source_template ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM lease_contract_templates existing
  WHERE existing.organization_id = sandbox_org.id
    AND existing.code = source_template.code
    AND existing.version = source_template.version
    AND existing.deleted_at IS NULL
);

UPDATE company_settings
SET default_contract_template_code = COALESCE(default_contract_template_code, 'LEASE_RESIDENTIAL'),
    default_lease_usage = COALESCE(default_lease_usage, 'RESIDENTIAL')
WHERE organization_id IN (
  SELECT id
  FROM organizations
  WHERE slug = 'ng-property-sandbox'
)
  AND deleted_at IS NULL;

COMMIT;
