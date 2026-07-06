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
