BEGIN;

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(120) NOT NULL,
  name VARCHAR(180) NOT NULL,
  type VARCHAR(80) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_definitions_org_code_unique
  ON workflow_definitions (organization_id, code)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workflow_step_definitions (
  id SERIAL PRIMARY KEY,
  workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(180) NOT NULL,
  approver_role VARCHAR(80),
  approver_user_id INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id SERIAL PRIMARY KEY,
  workflow_definition_id INTEGER REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  type VARCHAR(80) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id INTEGER,
  title VARCHAR(220) NOT NULL,
  requester_id INTEGER REFERENCES app_users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  current_step_order INTEGER NOT NULL DEFAULT 1,
  comment TEXT,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS workflow_instances_org_status_idx
  ON workflow_instances (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workflow_steps (
  id SERIAL PRIMARY KEY,
  workflow_instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(180) NOT NULL,
  approver_role VARCHAR(80),
  approver_user_id INTEGER REFERENCES app_users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  comment TEXT,
  acted_by INTEGER REFERENCES app_users(id),
  acted_at TIMESTAMP,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id SERIAL PRIMARY KEY,
  workflow_instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  comment TEXT,
  acted_by INTEGER REFERENCES app_users(id),
  acted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS workflow_instance_id INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL;

ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS workflow_instance_id INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL;

ALTER TABLE leaves
  ADD COLUMN IF NOT EXISTS workflow_instance_id INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL;

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS workflow_instance_id INTEGER REFERENCES workflow_instances(id) ON DELETE SET NULL;

INSERT INTO workflow_definitions (code, name, type, organization_id)
SELECT defaults.code, defaults.name, defaults.type, org.id
FROM organizations org
CROSS JOIN (VALUES
  ('EXPENSE_APPROVAL', 'Approbation dépense', 'EXPENSE_APPROVAL'),
  ('SALARY_ADVANCE_APPROVAL', 'Approbation avance salaire', 'SALARY_ADVANCE_APPROVAL'),
  ('LEAVE_APPROVAL', 'Approbation congé', 'LEAVE_APPROVAL'),
  ('MAINTENANCE_APPROVAL', 'Approbation maintenance', 'MAINTENANCE_APPROVAL'),
  ('PAYMENT_APPROVAL', 'Approbation paiement', 'PAYMENT_APPROVAL'),
  ('CUSTOM', 'Workflow personnalisé', 'CUSTOM')
) AS defaults(code, name, type)
ON CONFLICT DO NOTHING;

INSERT INTO workflow_step_definitions (workflow_definition_id, step_order, name, approver_role, organization_id)
SELECT wd.id, 1, 'Validation direction', 'DIRECTOR', wd.organization_id
FROM workflow_definitions wd
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_step_definitions wsd
  WHERE wsd.workflow_definition_id = wd.id AND wsd.organization_id = wd.organization_id
);

INSERT INTO permissions (code, name)
VALUES
  ('workflow.read', 'Lire workflows'),
  ('workflow.create', 'Créer workflows'),
  ('workflow.approve', 'Approuver workflows'),
  ('workflow.reject', 'Rejeter workflows'),
  ('workflow.cancel', 'Annuler workflows'),
  ('workflow.configure', 'Configurer workflows')
ON CONFLICT (code) DO NOTHING;

COMMIT;
