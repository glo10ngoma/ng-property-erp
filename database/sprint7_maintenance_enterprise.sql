BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_categories_org_name_unique
  ON maintenance_categories (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id SERIAL PRIMARY KEY,
  request_number VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  category VARCHAR(120) NOT NULL DEFAULT 'Autre',
  priority VARCHAR(30) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(40) NOT NULL DEFAULT 'NEW',
  building_id INTEGER REFERENCES buildings(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  reported_by_name VARCHAR(180),
  reported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  due_date TIMESTAMP,
  diagnostic TEXT,
  cause TEXT,
  proposed_solution TEXT,
  estimated_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  recommended_technician VARCHAR(180),
  approved_by INTEGER REFERENCES app_users(id),
  approved_at TIMESTAMP,
  assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  external_provider VARCHAR(180),
  started_at TIMESTAMP,
  paused_at TIMESTAMP,
  resolved_at TIMESTAMP,
  validated_by INTEGER REFERENCES app_users(id),
  validated_at TIMESTAMP,
  closed_by INTEGER REFERENCES app_users(id),
  closed_at TIMESTAMP,
  actual_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  resolution_comments TEXT,
  final_validation_comments TEXT,
  cancellation_reason TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_requests_org_number_unique
  ON maintenance_requests (organization_id, request_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS maintenance_requests_org_status_idx
  ON maintenance_requests (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS maintenance_assignments (
  id SERIAL PRIMARY KEY,
  maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  external_provider VARCHAR(180),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by INTEGER REFERENCES app_users(id),
  notes TEXT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS maintenance_timeline (
  id SERIAL PRIMARY KEY,
  maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  details TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS maintenance_documents (
  id SERIAL PRIMARY KEY,
  maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  document_type VARCHAR(80) NOT NULL,
  file_name VARCHAR(220) NOT NULL,
  file_url TEXT,
  uploaded_by INTEGER REFERENCES app_users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS maintenance_expenses (
  id SERIAL PRIMARY KEY,
  maintenance_request_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category VARCHAR(120) NOT NULL DEFAULT 'Autre',
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS maintenance_request_id INTEGER REFERENCES maintenance_requests(id) ON DELETE SET NULL;

INSERT INTO maintenance_categories (name, organization_id)
SELECT category_name, org.id
FROM organizations org
CROSS JOIN (VALUES
  ('Electricité'),
  ('Plomberie'),
  ('Peinture'),
  ('Maçonnerie'),
  ('Menuiserie'),
  ('Climatisation'),
  ('Serrurerie'),
  ('Nettoyage'),
  ('Autre')
) AS defaults(category_name)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name)
VALUES
  ('maintenance.read', 'Lire maintenance'),
  ('maintenance.create', 'Créer maintenance'),
  ('maintenance.update', 'Modifier maintenance'),
  ('maintenance.assign', 'Affecter maintenance'),
  ('maintenance.validate', 'Valider maintenance'),
  ('maintenance.close', 'Clôturer maintenance'),
  ('maintenance.report', 'Rapports maintenance')
ON CONFLICT (code) DO NOTHING;

COMMIT;
