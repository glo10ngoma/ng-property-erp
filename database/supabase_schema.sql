-- Property ERP SaaS V1 - Supabase schema
-- Execute in Supabase SQL editor on a fresh project.
-- Auth remains managed by NestJS JWT; Supabase Auth is not used.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- >>> database\schema.sql

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS units CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;

CREATE TABLE buildings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(220) NOT NULL,
  city VARCHAR(120) NOT NULL,
  building_type VARCHAR(120) NOT NULL DEFAULT 'Residence',
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id SERIAL PRIMARY KEY,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  number VARCHAR(40) NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0,
  type VARCHAR(80) NOT NULL,
  monthly_rent NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'VACANT',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (building_id, number)
);

CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(60) NOT NULL,
  email VARCHAR(160),
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  move_in_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tenants_one_active_per_unit
  ON tenants(unit_id)
  WHERE status = 'ACTIVE';

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(60) NOT NULL UNIQUE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'UNPAID',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(220) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(120),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW invoice_payment_summary AS
SELECT
  i.id AS invoice_id,
  i.total,
  COALESCE(SUM(p.amount), 0)::NUMERIC(12,2) AS paid_amount,
  GREATEST(i.total - COALESCE(SUM(p.amount), 0), 0)::NUMERIC(12,2) AS remaining_amount
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id;


-- >>> database\saas_v1.sql

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lease_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS building_id INTEGER;

CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(220) NOT NULL DEFAULT 'demo',
  role VARCHAR(40) NOT NULL DEFAULT 'STAFF',
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leases (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE,
  monthly_rent NUMERIC(12,2) NOT NULL,
  rental_guarantee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  rental_guarantee_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  rental_guarantee_payment_date DATE,
  rental_guarantee_status VARCHAR(30) NOT NULL DEFAULT 'NOT_PAID',
  contract_file_url TEXT,
  contract_file_name VARCHAR(220),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(60),
  email VARCHAR(160),
  job_title VARCHAR(120) NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  hire_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_advances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  advance_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaves (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type VARCHAR(80) NOT NULL,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payrolls (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  advances_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  payment_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id SERIAL PRIMARY KEY,
  opened_by INTEGER REFERENCES app_users(id),
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES app_users(id),
  closed_at TIMESTAMP,
  closing_balance NUMERIC(12,2),
  expected_balance NUMERIC(12,2),
  difference_amount NUMERIC(12,2),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN'
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_one_open_session
  ON cash_sessions(status)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS cash_movements (
  id SERIAL PRIMARY KEY,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  category VARCHAR(60) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  movement_date DATE NOT NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  description TEXT,
  reference VARCHAR(120),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'piece',
  current_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  movement_date DATE NOT NULL,
  source VARCHAR(120),
  reference VARCHAR(120),
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id SERIAL PRIMARY KEY,
  count_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER REFERENCES app_users(id),
  validated_by INTEGER REFERENCES app_users(id),
  validated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id SERIAL PRIMARY KEY,
  inventory_count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  theoretical_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  physical_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  difference_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT
);

INSERT INTO app_users (first_name, last_name, email, password_hash, role)
VALUES
  ('Admin', 'Demo', 'admin@property-erp.local', 'demo', 'ADMIN'),
  ('Comptable', 'Demo', 'comptable@property-erp.local', 'demo', 'ACCOUNTANT'),
  ('Agent', 'Demo', 'agent@property-erp.local', 'demo', 'STAFF'),
  ('Directeur', 'Demo', 'directeur@property-erp.local', 'demo', 'DIRECTOR')
ON CONFLICT (email) DO NOTHING;

INSERT INTO employees (first_name, last_name, phone, email, job_title, monthly_salary, hire_date)
VALUES
  ('Jean', 'Kasongo', '+243 89 210 1001', 'jean.kasongo@property-erp.local', 'Gestionnaire immeuble', 900, '2025-02-01'),
  ('Aline', 'Mbuyi', '+243 89 210 1002', 'aline.mbuyi@property-erp.local', 'Comptable', 1200, '2025-03-15')
ON CONFLICT DO NOTHING;

INSERT INTO cash_sessions (opened_by, opening_balance, status)
SELECT 1, 500, 'OPEN'
WHERE NOT EXISTS (SELECT 1 FROM cash_sessions WHERE status = 'OPEN');

INSERT INTO stock_items (name, category, unit, current_quantity, minimum_quantity, purchase_price, description)
VALUES
  ('Ampoules LED', 'Maintenance', 'piece', 45, 10, 3.5, 'Consommables Ã©lectriques'),
  ('Peinture blanche', 'Travaux', 'seau', 8, 3, 28, 'Finition appartements')
ON CONFLICT DO NOTHING;

INSERT INTO leases (tenant_id, unit_id, start_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_status, status)
SELECT t.id, t.unit_id, t.move_in_date, u.monthly_rent, u.monthly_rent * 2, u.monthly_rent * 2, 'PAID', 'ACTIVE'
FROM tenants t
JOIN units u ON u.id = t.unit_id
WHERE NOT EXISTS (SELECT 1 FROM leases l WHERE l.tenant_id = t.id AND l.unit_id = t.unit_id);


-- >>> database\sprint1_core.sql

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id, name, slug)
VALUES (1, 'Demo Property ERP', 'demo')
ON CONFLICT (id) DO NOTHING;

SELECT setval('organizations_id_seq', (SELECT COALESCE(MAX(id), 1) FROM organizations), true);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
UPDATE app_users SET organization_id = 1 WHERE organization_id IS NULL;
ALTER TABLE app_users ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO roles (organization_id, code, name)
VALUES
  (1, 'ADMIN', 'Administrateur'),
  (1, 'ACCOUNTANT', 'Comptable'),
  (1, 'STAFF', 'Agent'),
  (1, 'DIRECTOR', 'Directeur')
ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO permissions (code, name)
VALUES
  ('dashboard.read', 'Lire tableau de bord'),
  ('users.read', 'Lire utilisateurs'),
  ('users.create', 'CrÃ©er utilisateurs'),
  ('users.update', 'Modifier utilisateurs'),
  ('users.delete', 'Supprimer utilisateurs'),
  ('buildings.read', 'Lire immeubles'),
  ('buildings.create', 'CrÃ©er immeubles'),
  ('buildings.update', 'Modifier immeubles'),
  ('buildings.delete', 'Supprimer immeubles'),
  ('units.read', 'Lire appartements'),
  ('units.create', 'CrÃ©er appartements'),
  ('units.update', 'Modifier appartements'),
  ('units.delete', 'Supprimer appartements'),
  ('tenants.read', 'Lire locataires'),
  ('tenants.create', 'CrÃ©er locataires'),
  ('tenants.update', 'Modifier locataires'),
  ('tenants.delete', 'Supprimer locataires'),
  ('documents.read', 'Lire documents et baux'),
  ('documents.upload', 'Uploader documents'),
  ('documents.delete', 'Supprimer documents'),
  ('invoices.read', 'Lire factures'),
  ('invoices.create', 'CrÃ©er factures'),
  ('invoices.update', 'Modifier factures'),
  ('invoices.delete', 'Supprimer factures'),
  ('payments.read', 'Lire paiements'),
  ('payments.create', 'CrÃ©er paiements'),
  ('payments.update', 'Modifier paiements'),
  ('payments.delete', 'Supprimer paiements'),
  ('cash.read', 'Lire caisse'),
  ('cash.create', 'CrÃ©er mouvements caisse'),
  ('cash.update', 'Modifier caisse'),
  ('cash.close', 'Fermer caisse'),
  ('reports.read', 'Lire rapports'),
  ('reports.export', 'Exporter rapports'),
  ('staff.read', 'Lire personnel'),
  ('staff.create', 'CrÃ©er personnel'),
  ('staff.update', 'Modifier personnel'),
  ('payroll.read', 'Lire paie'),
  ('payroll.create', 'CrÃ©er paie'),
  ('stock.read', 'Lire stock'),
  ('stock.create', 'CrÃ©er stock'),
  ('stock.update', 'Modifier stock'),
  ('stock.delete', 'Supprimer stock')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM app_users u
JOIN roles r ON r.organization_id = u.organization_id AND r.code = u.role
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER REFERENCES app_users(id),
  action VARCHAR(80) NOT NULL,
  resource VARCHAR(120) NOT NULL,
  resource_id VARCHAR(120),
  method VARCHAR(12) NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'buildings', 'units', 'tenants', 'invoices', 'invoice_items', 'payments',
    'leases', 'employees', 'salary_advances', 'leaves', 'payrolls',
    'cash_sessions', 'cash_movements', 'stock_items', 'stock_movements',
    'inventory_counts', 'inventory_count_lines'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id)', t);
      EXECUTE format('UPDATE %I SET organization_id = 1 WHERE organization_id IS NULL', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES app_users(id)', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)', t || '_organization_id_idx', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE VIEW invoice_payment_summary AS
SELECT
  i.id AS invoice_id,
  i.total,
  COALESCE(SUM(p.amount) FILTER (WHERE p.deleted_at IS NULL), 0)::NUMERIC(12,2) AS paid_amount,
  GREATEST(i.total - COALESCE(SUM(p.amount) FILTER (WHERE p.deleted_at IS NULL), 0), 0)::NUMERIC(12,2) AS remaining_amount
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id;


-- >>> database\sprint2_leases.sql

CREATE OR REPLACE VIEW rental_units AS
SELECT * FROM units WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW tenant_people AS
SELECT * FROM tenants WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lease_guarantees (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'NOT_PAID',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  UNIQUE (lease_id)
);

CREATE TABLE IF NOT EXISTS lease_documents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  document_type VARCHAR(80) NOT NULL DEFAULT 'CONTRACT',
  file_name VARCHAR(220) NOT NULL,
  file_url TEXT,
  uploaded_by INTEGER REFERENCES app_users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

ALTER TABLE leases ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMP;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS termination_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS leases_one_active_per_unit
  ON leases (organization_id, unit_id)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_building_id_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS units_one_number_per_building_not_deleted
  ON units (building_id, number)
  WHERE deleted_at IS NULL;

INSERT INTO lease_guarantees (organization_id, lease_id, amount, paid_amount, payment_date, status)
SELECT
  l.organization_id,
  l.id,
  COALESCE(l.rental_guarantee_amount, 0),
  COALESCE(l.rental_guarantee_paid, 0),
  l.rental_guarantee_payment_date,
  COALESCE(l.rental_guarantee_status, 'NOT_PAID')
FROM leases l
WHERE l.deleted_at IS NULL
ON CONFLICT (lease_id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  amount = EXCLUDED.amount,
  paid_amount = EXCLUDED.paid_amount,
  payment_date = EXCLUDED.payment_date,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO lease_documents (organization_id, lease_id, document_type, file_name, file_url)
SELECT organization_id, id, 'CONTRACT', contract_file_name, contract_file_url
FROM leases
WHERE contract_file_name IS NOT NULL
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM lease_documents d
    WHERE d.lease_id = leases.id
      AND d.document_type = 'CONTRACT'
      AND d.deleted_at IS NULL
  );


-- >>> database\sprint3_finance.sql

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(60) NOT NULL DEFAULT 'OTHER';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(80);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_name VARCHAR(180);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_id_idx ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_id_idx ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS payment_allocations_org_idx ON payment_allocations(organization_id);

INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, amount)
SELECT p.organization_id, p.id, p.invoice_id, p.amount
FROM payments p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa
    WHERE pa.payment_id = p.id
      AND pa.invoice_id = p.invoice_id
      AND pa.deleted_at IS NULL
  );

CREATE OR REPLACE VIEW invoice_payment_summary AS
SELECT
  i.id AS invoice_id,
  i.total,
  COALESCE(SUM(pa.amount) FILTER (WHERE pa.deleted_at IS NULL), 0)::NUMERIC(12,2) AS paid_amount,
  GREATEST(i.total - COALESCE(SUM(pa.amount) FILTER (WHERE pa.deleted_at IS NULL), 0), 0)::NUMERIC(12,2) AS remaining_amount
FROM invoices i
LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id;


-- >>> database\sprint5_staff_payroll.sql

BEGIN;

UPDATE leaves
SET status = 'PENDING'
WHERE status = 'REQUESTED';

ALTER TABLE salary_advances
  ALTER COLUMN status SET DEFAULT 'DRAFT';

ALTER TABLE leaves
  ALTER COLUMN status SET DEFAULT 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS payrolls_one_month_per_employee
  ON payrolls (organization_id, employee_id, year, month)
  WHERE deleted_at IS NULL;

COMMIT;


-- >>> database\sprint6_stock_enterprise.sql

BEGIN;

CREATE TABLE IF NOT EXISTS stock_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_categories_org_name_unique
  ON stock_categories (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS average_purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observations TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE stock_items
SET average_purchase_price = purchase_price
WHERE average_purchase_price = 0 AND purchase_price > 0;

UPDATE stock_items
SET code = 'ART-' || LPAD(id::TEXT, 5, '0')
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_items_org_code_unique
  ON stock_items (organization_id, code)
  WHERE deleted_at IS NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS movement_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier VARCHAR(180),
  ADD COLUMN IF NOT EXISTS destination VARCHAR(120),
  ADD COLUMN IF NOT EXISTS quantity_before NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maintenance_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS inventory_count_id INTEGER REFERENCES inventory_counts(id) ON DELETE SET NULL;

UPDATE stock_movements
SET movement_number = COALESCE(movement_number, 'MVT-' || LPAD(id::TEXT, 6, '0'))
WHERE movement_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_org_number_unique
  ON stock_movements (organization_id, movement_number)
  WHERE deleted_at IS NULL;

ALTER TABLE inventory_counts
  ADD COLUMN IF NOT EXISTS inventory_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE inventory_counts
SET inventory_number = COALESCE(inventory_number, 'INV-STK-' || LPAD(id::TEXT, 5, '0'))
WHERE inventory_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_org_number_unique
  ON inventory_counts (organization_id, inventory_number)
  WHERE deleted_at IS NULL;

INSERT INTO stock_categories (name, organization_id)
SELECT category_name, org.id
FROM organizations org
CROSS JOIN (VALUES
  ('Plomberie'),
  ('Ã‰lectricitÃ©'),
  ('Peinture'),
  ('Entretien'),
  ('Bureau'),
  ('Consommables'),
  ('Autres')
) AS defaults(category_name)
ON CONFLICT DO NOTHING;

INSERT INTO stock_categories (name, organization_id)
SELECT DISTINCT si.category, si.organization_id
FROM stock_items si
WHERE si.deleted_at IS NULL
ON CONFLICT DO NOTHING;

COMMIT;


-- >>> database\sprint7_maintenance_enterprise.sql

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
  ('ElectricitÃ©'),
  ('Plomberie'),
  ('Peinture'),
  ('MaÃ§onnerie'),
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
  ('maintenance.create', 'CrÃ©er maintenance'),
  ('maintenance.update', 'Modifier maintenance'),
  ('maintenance.assign', 'Affecter maintenance'),
  ('maintenance.validate', 'Valider maintenance'),
  ('maintenance.close', 'ClÃ´turer maintenance'),
  ('maintenance.report', 'Rapports maintenance')
ON CONFLICT (code) DO NOTHING;

COMMIT;


-- >>> database\sprint8_workflow_engine.sql

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
  ('EXPENSE_APPROVAL', 'Approbation dÃ©pense', 'EXPENSE_APPROVAL'),
  ('SALARY_ADVANCE_APPROVAL', 'Approbation avance salaire', 'SALARY_ADVANCE_APPROVAL'),
  ('LEAVE_APPROVAL', 'Approbation congÃ©', 'LEAVE_APPROVAL'),
  ('MAINTENANCE_APPROVAL', 'Approbation maintenance', 'MAINTENANCE_APPROVAL'),
  ('PAYMENT_APPROVAL', 'Approbation paiement', 'PAYMENT_APPROVAL'),
  ('CUSTOM', 'Workflow personnalisÃ©', 'CUSTOM')
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
  ('workflow.create', 'CrÃ©er workflows'),
  ('workflow.approve', 'Approuver workflows'),
  ('workflow.reject', 'Rejeter workflows'),
  ('workflow.cancel', 'Annuler workflows'),
  ('workflow.configure', 'Configurer workflows')
ON CONFLICT (code) DO NOTHING;

COMMIT;


-- >>> database\sprint10_communications.sql

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES app_users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD', 'READ', 'ARCHIVED')),
  source TEXT NOT NULL DEFAULT 'INTERNAL',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  link_path TEXT,
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'INTERNAL')),
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id SERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  provider_response JSONB,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  sent_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_status ON notifications(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_message_templates_org_channel ON message_templates(organization_id, channel, status);
CREATE INDEX IF NOT EXISTS idx_email_logs_org_created ON email_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_org_created ON sms_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_org_created ON whatsapp_logs(organization_id, created_at DESC);

INSERT INTO permissions (code, name)
VALUES
  ('communication.read', 'Consulter communications'),
  ('communication.template.create', 'Creer modele communication'),
  ('communication.template.update', 'Modifier modele communication'),
  ('communication.template.delete', 'Desactiver modele communication'),
  ('communication.send', 'Envoyer communication'),
  ('communication.logs.read', 'Consulter logs communication'),
  ('notifications.read', 'Consulter notifications'),
  ('notifications.update', 'Modifier notifications')
ON CONFLICT (code) DO NOTHING;

INSERT INTO message_templates (code, name, channel, subject, body, variables, organization_id, created_by)
SELECT code, name, channel, subject, body, variables::JSONB, 1, 1
FROM (VALUES
  ('INVOICE_EMAIL', 'Facture par email', 'EMAIL', 'Facture {{invoice_number}}', 'Bonjour {{tenant_full_name}}, votre facture {{invoice_number}} de {{amount}} est disponible. Echeance : {{due_date}}.', '["tenant_full_name","invoice_number","amount","due_date"]'),
  ('PAYMENT_RECEIPT_EMAIL', 'Recu de paiement par email', 'EMAIL', 'Recu {{payment_number}}', 'Bonjour {{tenant_full_name}}, nous confirmons la reception du paiement {{payment_number}} de {{amount}}.', '["tenant_full_name","payment_number","amount"]'),
  ('INVOICE_REMINDER_SMS', 'Relance facture SMS', 'SMS', NULL, 'Rappel : facture {{invoice_number}} de {{amount}} a regler avant {{due_date}}.', '["invoice_number","amount","due_date"]'),
  ('INVOICE_REMINDER_WHATSAPP', 'Relance facture WhatsApp', 'WHATSAPP', NULL, 'Bonjour {{tenant_full_name}}, votre facture {{invoice_number}} reste due. Montant : {{amount}}.', '["tenant_full_name","invoice_number","amount"]'),
  ('WORKFLOW_PENDING_INTERNAL', 'Validation en attente', 'INTERNAL', NULL, 'Une validation {{tenant_name}} est en attente de traitement.', '["tenant_name"]')
) AS defaults(code, name, channel, subject, body, variables)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;


-- >>> database\sprint11_settings_admin.sql

BEGIN;

CREATE TABLE IF NOT EXISTS company_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) UNIQUE,
  logo_url TEXT,
  invoice_logo_url TEXT,
  signature_url TEXT,
  stamp_url TEXT,
  company_name TEXT NOT NULL DEFAULT 'Demo Property ERP',
  legal_name TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  language TEXT NOT NULL DEFAULT 'fr',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kinshasa',
  invoice_footer TEXT,
  paper_format TEXT NOT NULL DEFAULT 'A4',
  invoice_bottom_text TEXT,
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS reference_data (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  UNIQUE (organization_id, type, code)
);

CREATE INDEX IF NOT EXISTS idx_reference_data_org_type ON reference_data(organization_id, type, status);

INSERT INTO company_settings (organization_id, company_name, legal_name, address, phone, email, website, currency, language, timezone, invoice_footer, invoice_bottom_text, created_by)
SELECT id, name, name, 'Kinshasa', '+243 000 000 000', 'contact@property-erp.local', 'https://property-erp.local', 'USD', 'fr', 'Africa/Kinshasa', 'Merci pour votre confiance.', 'Facture generee par Property ERP.', 1
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO reference_data (organization_id, type, code, label, sort_order, created_by)
SELECT 1, type, code, label, sort_order, 1
FROM (VALUES
  ('charge_types', 'RENT', 'Loyer', 10),
  ('charge_types', 'WATER', 'Eau', 20),
  ('charge_types', 'ELECTRICITY', 'Electricite', 30),
  ('charge_types', 'MAINTENANCE', 'Maintenance', 40),
  ('expense_categories', 'MAINTENANCE', 'Maintenance', 10),
  ('expense_categories', 'SALARY', 'Salaire', 20),
  ('expense_categories', 'SUPPLIES', 'Fournitures', 30),
  ('stock_categories', 'PLUMBING', 'Plomberie', 10),
  ('stock_categories', 'ELECTRICITY', 'Electricite', 20),
  ('stock_categories', 'PAINT', 'Peinture', 30),
  ('stock_categories', 'OFFICE', 'Bureau', 40),
  ('document_types', 'LEASE_CONTRACT', 'Contrat de bail', 10),
  ('document_types', 'ID_DOCUMENT', 'Piece identite', 20),
  ('staff_positions', 'MANAGER', 'Gestionnaire', 10),
  ('staff_positions', 'TECHNICIAN', 'Technicien', 20),
  ('leave_types', 'ANNUAL', 'Conge annuel', 10),
  ('leave_types', 'SICK', 'Conge maladie', 20),
  ('payment_methods', 'CASH', 'Especes', 10),
  ('payment_methods', 'BANK', 'Banque', 20),
  ('payment_methods', 'MOBILE_MONEY', 'Mobile Money', 30),
  ('banks', 'RAWBANK', 'Rawbank', 10),
  ('banks', 'EQUITY_BCDC', 'Equity BCDC', 20),
  ('cities', 'KINSHASA', 'Kinshasa', 10),
  ('cities', 'LUBUMBASHI', 'Lubumbashi', 20)
) AS defaults(type, code, label, sort_order)
ON CONFLICT (organization_id, type, code) DO NOTHING;

INSERT INTO permissions (code, name)
VALUES
  ('settings.read', 'Consulter parametres'),
  ('settings.update', 'Modifier parametres'),
  ('reference_data.read', 'Consulter referentiels'),
  ('reference_data.create', 'Creer referentiel'),
  ('reference_data.update', 'Modifier referentiel'),
  ('reference_data.delete', 'Desactiver referentiel'),
  ('publisher_settings.read', 'Consulter parametres reserves editeur')
ON CONFLICT (code) DO NOTHING;

COMMIT;


-- Public UUIDs for cloud-safe external references while preserving local integer IDs.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations','app_users','buildings','units','tenants','leases','lease_guarantees','lease_documents',
    'invoices','invoice_items','payments','payment_allocations','cash_sessions','cash_movements',
    'employees','salary_advances','leaves','payrolls','stock_categories','stock_items','stock_movements',
    'inventory_counts','inventory_count_lines','maintenance_categories','maintenance_requests','maintenance_assignments',
    'maintenance_timeline','maintenance_documents','maintenance_expenses','workflow_definitions','workflow_step_definitions',
    'workflow_instances','workflow_steps','workflow_actions','notifications','message_templates','email_logs','sms_logs',
    'whatsapp_logs','company_settings','reference_data','audit_logs'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid()', table_name);
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I(public_id)', 'idx_' || table_name || '_public_id', table_name);
    END IF;
  END LOOP;
END $$;

-- Supabase Storage buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('contracts', 'contracts', false, 10485760, ARRAY['application/pdf','image/png','image/jpeg','image/webp']),
  ('tenant-documents', 'tenant-documents', false, 10485760, ARRAY['application/pdf','image/png','image/jpeg','image/webp']),
  ('maintenance', 'maintenance', false, 10485760, ARRAY['application/pdf','image/png','image/jpeg','image/webp']),
  ('employees', 'employees', false, 10485760, ARRAY['application/pdf','image/png','image/jpeg','image/webp']),
  ('exports', 'exports', false, 52428800, ARRAY['text/csv','application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('company', 'company', false, 10485760, ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Bucket path convention:
-- contracts/{organization_id}/leases/{lease_id}/{filename}
-- tenant-documents/{organization_id}/tenants/{tenant_id}/{filename}
-- maintenance/{organization_id}/requests/{request_id}/{before|after|invoice|report}/{filename}
-- employees/{organization_id}/employees/{employee_id}/{filename}
-- exports/{organization_id}/{module}/{yyyy}/{filename}
-- company/{organization_id}/{logo|invoice-logo|signature|stamp}/{filename}

-- Storage policies prepared for backend service-role usage and future signed-url flows.
DROP POLICY IF EXISTS "Property ERP service role storage access" ON storage.objects;
CREATE POLICY "Property ERP service role storage access"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id IN ('contracts','tenant-documents','maintenance','employees','exports','company'))
WITH CHECK (bucket_id IN ('contracts','tenant-documents','maintenance','employees','exports','company'));

DROP POLICY IF EXISTS "Property ERP authenticated read storage" ON storage.objects;
CREATE POLICY "Property ERP authenticated read storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id IN ('contracts','tenant-documents','maintenance','employees','exports','company'));
