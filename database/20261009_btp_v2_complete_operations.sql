BEGIN;

CREATE TABLE IF NOT EXISTS btp_budget_lines (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_id BIGINT,
  category VARCHAR(40) NOT NULL,
  label VARCHAR(180) NOT NULL,
  planned_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (planned_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (phase_id, organization_id) REFERENCES btp_phases(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, label)
);

CREATE TABLE IF NOT EXISTS btp_purchases (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_id BIGINT,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('REQUEST','ORDER','DELIVERY')),
  reference VARCHAR(80) NOT NULL,
  supplier_name VARCHAR(180),
  category VARCHAR(40) NOT NULL CHECK (category IN ('MATERIALS','LABOR','SUBCONTRACTING','TRANSPORT','EQUIPMENT','OTHER')),
  description TEXT NOT NULL,
  document_date DATE NOT NULL,
  expected_date DATE,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','APPROVED','ORDERED','PARTIAL','RECEIVED','CANCELLED')),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (phase_id, organization_id) REFERENCES btp_phases(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, reference)
);

CREATE TABLE IF NOT EXISTS btp_stock_movements (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_id BIGINT,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('OUT','RETURN','ADJUSTMENT')),
  movement_date DATE NOT NULL,
  material_name VARCHAR(180) NOT NULL,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  unit VARCHAR(30) NOT NULL,
  reference VARCHAR(80),
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (phase_id, organization_id) REFERENCES btp_phases(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS btp_site_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  phase_id BIGINT,
  log_type VARCHAR(20) NOT NULL CHECK (log_type IN ('JOURNAL','PHOTO','DOCUMENT','INCIDENT','TASK','OBSERVATION')),
  event_date DATE NOT NULL,
  title VARCHAR(180) NOT NULL,
  content TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  attachment_url TEXT,
  progress_percent NUMERIC(5,2) CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (phase_id, organization_id) REFERENCES btp_phases(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS btp_client_contracts (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  reference VARCHAR(80) NOT NULL,
  client_name VARCHAR(180) NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  contract_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (contract_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, reference),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS btp_client_transactions (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id BIGINT NOT NULL,
  contract_id BIGINT,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('INVOICE','PAYMENT')),
  reference VARCHAR(80) NOT NULL,
  transaction_date DATE NOT NULL,
  due_date DATE,
  description TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PARTIAL','PAID','CANCELLED')),
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, organization_id) REFERENCES btp_projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (contract_id, organization_id) REFERENCES btp_client_contracts(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS btp_budget_lines_id_org_unique ON btp_budget_lines(id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_budget_org_project ON btp_budget_lines(organization_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_purchases_org_project ON btp_purchases(organization_id, project_id, document_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_stock_org_project ON btp_stock_movements(organization_id, project_id, movement_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_logs_org_project ON btp_site_logs(organization_id, project_id, event_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_contracts_org_project ON btp_client_contracts(organization_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_transactions_org_project ON btp_client_transactions(organization_id, project_id, transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_btp_budget_project_org ON btp_budget_lines(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_budget_phase_org ON btp_budget_lines(phase_id, organization_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_budget_created_by ON btp_budget_lines(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_purchases_project_org ON btp_purchases(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_purchases_phase_org ON btp_purchases(phase_id, organization_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_purchases_created_by ON btp_purchases(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_purchases_updated_by ON btp_purchases(updated_by);
CREATE INDEX IF NOT EXISTS idx_btp_stock_project_org ON btp_stock_movements(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_stock_phase_org ON btp_stock_movements(phase_id, organization_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_stock_created_by ON btp_stock_movements(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_logs_project_org ON btp_site_logs(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_logs_phase_org ON btp_site_logs(phase_id, organization_id) WHERE phase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_logs_created_by ON btp_site_logs(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_logs_updated_by ON btp_site_logs(updated_by);
CREATE INDEX IF NOT EXISTS idx_btp_contracts_project_org ON btp_client_contracts(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_contracts_created_by ON btp_client_contracts(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_contracts_updated_by ON btp_client_contracts(updated_by);
CREATE INDEX IF NOT EXISTS idx_btp_transactions_project_org ON btp_client_transactions(project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_btp_transactions_contract_org ON btp_client_transactions(contract_id, organization_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_btp_transactions_created_by ON btp_client_transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_btp_transactions_updated_by ON btp_client_transactions(updated_by);

ALTER TABLE btp_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_site_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_client_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE btp_client_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE btp_budget_lines, btp_purchases, btp_stock_movements, btp_site_logs, btp_client_contracts, btp_client_transactions FROM anon, authenticated;

INSERT INTO permissions (code, name) VALUES
  ('btp.budgets.manage', 'Gérer les budgets BTP'),
  ('btp.purchases.manage', 'Gérer les achats BTP'),
  ('btp.stock.manage', 'Gérer les matériaux BTP'),
  ('btp.operations.manage', 'Gérer le suivi opérationnel BTP'),
  ('btp.finance.manage', 'Gérer la finance BTP')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('ADMIN','SUPER_ADMIN') AND p.code LIKE 'btp.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('STAFF','EDITOR','GESTIONNAIRE')
  AND p.code IN ('btp.budgets.manage','btp.purchases.manage','btp.stock.manage','btp.operations.manage','btp.finance.manage')
ON CONFLICT DO NOTHING;

COMMIT;
