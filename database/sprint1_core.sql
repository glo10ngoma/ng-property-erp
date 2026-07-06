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
  ('users.create', 'Créer utilisateurs'),
  ('users.update', 'Modifier utilisateurs'),
  ('users.delete', 'Supprimer utilisateurs'),
  ('buildings.read', 'Lire immeubles'),
  ('buildings.create', 'Créer immeubles'),
  ('buildings.update', 'Modifier immeubles'),
  ('buildings.delete', 'Supprimer immeubles'),
  ('units.read', 'Lire appartements'),
  ('units.create', 'Créer appartements'),
  ('units.update', 'Modifier appartements'),
  ('units.delete', 'Supprimer appartements'),
  ('tenants.read', 'Lire locataires'),
  ('tenants.create', 'Créer locataires'),
  ('tenants.update', 'Modifier locataires'),
  ('tenants.delete', 'Supprimer locataires'),
  ('documents.read', 'Lire documents et baux'),
  ('documents.upload', 'Uploader documents'),
  ('documents.delete', 'Supprimer documents'),
  ('invoices.read', 'Lire factures'),
  ('invoices.create', 'Créer factures'),
  ('invoices.update', 'Modifier factures'),
  ('invoices.delete', 'Supprimer factures'),
  ('payments.read', 'Lire paiements'),
  ('payments.create', 'Créer paiements'),
  ('payments.update', 'Modifier paiements'),
  ('payments.delete', 'Supprimer paiements'),
  ('cash.read', 'Lire caisse'),
  ('cash.create', 'Créer mouvements caisse'),
  ('cash.update', 'Modifier caisse'),
  ('cash.close', 'Fermer caisse'),
  ('reports.read', 'Lire rapports'),
  ('reports.export', 'Exporter rapports'),
  ('staff.read', 'Lire personnel'),
  ('staff.create', 'Créer personnel'),
  ('staff.update', 'Modifier personnel'),
  ('payroll.read', 'Lire paie'),
  ('payroll.create', 'Créer paie'),
  ('stock.read', 'Lire stock'),
  ('stock.create', 'Créer stock'),
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
