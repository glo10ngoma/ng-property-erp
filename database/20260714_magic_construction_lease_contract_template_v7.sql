BEGIN;

WITH magic_org AS (
  SELECT id, name, slug
  FROM organizations
  WHERE id = 5
    AND slug = 'magic-construction'
  LIMIT 1
),
source_template AS (
  SELECT
    code,
    version,
    lease_type,
    content
  FROM lease_contract_templates
  WHERE organization_id = 1
    AND code = 'LEASE_RESIDENTIAL'
    AND version = 7
    AND is_active = TRUE
    AND deleted_at IS NULL
  LIMIT 1
),
inserted AS (
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
    magic_org.id,
    'Contrat de bail à usage résidentiel - modèle UTF-8 v7 MAGIC CONSTRUCTION',
    source_template.code,
    source_template.version,
    source_template.lease_type,
    source_template.content,
    TRUE,
    1
  FROM magic_org
  JOIN source_template ON TRUE
  WHERE NOT EXISTS (
    SELECT 1
    FROM lease_contract_templates existing
    WHERE existing.organization_id = magic_org.id
      AND existing.code = source_template.code
      AND existing.version = source_template.version
      AND existing.deleted_at IS NULL
  )
  RETURNING organization_id, code, version
),
deactivated AS (
  UPDATE lease_contract_templates previous
  SET is_active = FALSE
  WHERE previous.organization_id = 5
    AND previous.code = 'LEASE_RESIDENTIAL'
    AND previous.version < 7
    AND previous.deleted_at IS NULL
  RETURNING previous.id
)
UPDATE company_settings
SET default_contract_template_code = 'LEASE_RESIDENTIAL'
WHERE organization_id = 5
  AND deleted_at IS NULL
  AND COALESCE(default_contract_template_code, '') <> 'LEASE_RESIDENTIAL';

COMMIT;
