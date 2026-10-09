BEGIN;

INSERT INTO modules_catalog (code, label, description, category, icon, is_core, is_assignable, is_active, sort_order, dependencies)
VALUES ('BTP', 'BTP & chantiers', 'Pilotage des chantiers, phases, budgets et dépenses.', 'OPERATIONS', 'hard-hat', FALSE, TRUE, TRUE, 180, '["CORE"]'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  is_active = TRUE,
  dependencies = EXCLUDED.dependencies,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS btp_projects (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_ref VARCHAR(50) NOT NULL,
  name VARCHAR(180) NOT NULL,
  client_name VARCHAR(180),
  location_label TEXT,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  start_date DATE,
  planned_end_date DATE,
  actual_end_date DATE,
  manager_name VARCHAR(180),
  planned_budget NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT btp_projects_org_ref_unique UNIQUE (organization_id, project_ref),
  CONSTRAINT btp_projects_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT btp_projects_status_check CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  CONSTRAINT btp_projects_currency_check CHECK (currency IN ('USD','CDF')),
  CONSTRAINT btp_projects_progress_check CHECK (progress_percent BETWEEN 0 AND 100),
  CONSTRAINT btp_projects_budget_check CHECK (planned_budget >= 0),
  CONSTRAINT btp_projects_dates_check CHECK (planned_end_date IS NULL OR start_date IS NULL OR planned_end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS btp_phases (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_ref VARCHAR(50) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED',
  start_date DATE,
  planned_end_date DATE,
  planned_budget NUMERIC(18,2) NOT NULL DEFAULT 0,
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT btp_phases_project_fk FOREIGN KEY (project_id, organization_id)
    REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT btp_phases_org_ref_unique UNIQUE (organization_id, project_id, phase_ref),
  CONSTRAINT btp_phases_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT btp_phases_status_check CHECK (status IN ('NOT_STARTED','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),
  CONSTRAINT btp_phases_progress_check CHECK (progress_percent BETWEEN 0 AND 100),
  CONSTRAINT btp_phases_budget_check CHECK (planned_budget >= 0),
  CONSTRAINT btp_phases_dates_check CHECK (planned_end_date IS NULL OR start_date IS NULL OR planned_end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS btp_expenses (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_id BIGINT,
  expense_date DATE NOT NULL,
  reference VARCHAR(80),
  category VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  supplier_name VARCHAR(180),
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  payment_method VARCHAR(30),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT btp_expenses_project_fk FOREIGN KEY (project_id, organization_id)
    REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT btp_expenses_phase_fk FOREIGN KEY (phase_id, organization_id)
    REFERENCES btp_phases(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT btp_expenses_status_check CHECK (status IN ('DRAFT','APPROVED','PAID','CANCELLED')),
  CONSTRAINT btp_expenses_currency_check CHECK (currency IN ('USD','CDF')),
  CONSTRAINT btp_expenses_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_btp_projects_org_status ON btp_projects(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_projects_created_by ON btp_projects(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_projects_updated_by ON btp_projects(updated_by);
CREATE INDEX IF NOT EXISTS idx_btp_phases_org_project ON btp_phases(organization_id, project_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_phases_project_org ON btp_phases(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_phases_created_by ON btp_phases(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_phases_updated_by ON btp_phases(updated_by);
CREATE INDEX IF NOT EXISTS idx_btp_expenses_org_project_date ON btp_expenses(organization_id, project_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_expenses_project_org ON btp_expenses(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_expenses_phase_org ON btp_expenses(phase_id, organization_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_expenses_created_by ON btp_expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_expenses_updated_by ON btp_expenses(updated_by);

ALTER TABLE btp_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE btp_projects, btp_phases, btp_expenses FROM anon, authenticated;

INSERT INTO permissions (code, name) VALUES
  ('btp.read', 'Consulter le module BTP'),
  ('btp.projects.create', 'Créer un chantier'),
  ('btp.projects.update', 'Modifier un chantier'),
  ('btp.phases.manage', 'Gérer les phases de chantier'),
  ('btp.expenses.create', 'Créer une dépense de chantier'),
  ('btp.expenses.approve', 'Approuver une dépense de chantier'),
  ('btp.reports.read', 'Consulter les rapports BTP')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code LIKE 'btp.%'
WHERE r.code IN ('ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('btp.read','btp.reports.read')
WHERE r.code IN ('DIRECTOR', 'VIEWER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('btp.read','btp.projects.create','btp.projects.update','btp.phases.manage','btp.expenses.create','btp.reports.read')
WHERE r.code IN ('STAFF', 'EDITOR', 'GESTIONNAIRE')
ON CONFLICT DO NOTHING;

INSERT INTO organization_modules (organization_id, module_code, is_enabled, enabled_at, created_at, updated_at)
SELECT o.id, 'BTP', TRUE, NOW(), NOW(), NOW()
FROM organizations o
WHERE o.slug IN ('magic-construction', 'ng-property-sandbox') AND o.status IN ('ACTIVE','TEST')
ON CONFLICT (organization_id, module_code) DO UPDATE SET
  is_enabled = TRUE,
  enabled_at = COALESCE(organization_modules.enabled_at, NOW()),
  disabled_at = NULL,
  disabled_by = NULL,
  disable_reason = NULL,
  updated_at = NOW();

COMMIT;
