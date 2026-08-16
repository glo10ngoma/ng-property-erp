BEGIN;

CREATE TABLE IF NOT EXISTS sales_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  default_currency VARCHAR(3) NULL,
  secondary_currency VARCHAR(3) NULL,
  quotation_prefix VARCHAR(30) NULL,
  reservation_prefix VARCHAR(30) NULL,
  contract_prefix VARCHAR(30) NULL,
  receipt_prefix VARCHAR(30) NULL,
  invoice_prefix VARCHAR(30) NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_settings_organization_unique UNIQUE (organization_id),
  CONSTRAINT sales_settings_default_currency_check CHECK (default_currency IS NULL OR default_currency IN ('USD', 'CDF')),
  CONSTRAINT sales_settings_secondary_currency_check CHECK (secondary_currency IS NULL OR secondary_currency IN ('USD', 'CDF'))
);

CREATE INDEX IF NOT EXISTS sales_settings_organization_idx
  ON sales_settings (organization_id);

CREATE TABLE IF NOT EXISTS sales_buyers (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  buyer_ref VARCHAR(50) NOT NULL,
  buyer_type VARCHAR(20) NOT NULL,
  full_name VARCHAR(180) NULL,
  company_name VARCHAR(180) NULL,
  phone VARCHAR(60) NULL,
  whatsapp VARCHAR(60) NULL,
  email VARCHAR(180) NULL,
  address TEXT NULL,
  city VARCHAR(120) NULL,
  country VARCHAR(120) NULL,
  id_document_type VARCHAR(80) NULL,
  id_document_number VARCHAR(120) NULL,
  tax_number VARCHAR(120) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMP NULL,
  archived_by INTEGER NULL REFERENCES app_users(id),
  deleted_at TIMESTAMP NULL,
  deleted_by INTEGER NULL REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER NULL REFERENCES app_users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER NULL REFERENCES app_users(id),
  CONSTRAINT sales_buyers_org_ref_unique UNIQUE (organization_id, buyer_ref),
  CONSTRAINT sales_buyers_type_check CHECK (buyer_type IN ('INDIVIDUAL', 'COMPANY')),
  CONSTRAINT sales_buyers_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT sales_buyers_name_check CHECK (
    (buyer_type = 'INDIVIDUAL' AND full_name IS NOT NULL AND LENGTH(TRIM(full_name)) > 0)
    OR (buyer_type = 'COMPANY' AND company_name IS NOT NULL AND LENGTH(TRIM(company_name)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS sales_buyers_org_idx
  ON sales_buyers (organization_id);

CREATE INDEX IF NOT EXISTS sales_buyers_org_status_idx
  ON sales_buyers (organization_id, status);

CREATE TABLE IF NOT EXISTS sales_projects (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_ref VARCHAR(50) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  location_label VARCHAR(180) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  launch_date DATE NULL,
  closing_date DATE NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMP NULL,
  archived_by INTEGER NULL REFERENCES app_users(id),
  deleted_at TIMESTAMP NULL,
  deleted_by INTEGER NULL REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER NULL REFERENCES app_users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER NULL REFERENCES app_users(id),
  CONSTRAINT sales_projects_org_ref_unique UNIQUE (organization_id, project_ref),
  CONSTRAINT sales_projects_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS sales_projects_org_idx
  ON sales_projects (organization_id);

CREATE INDEX IF NOT EXISTS sales_projects_org_status_idx
  ON sales_projects (organization_id, status);

CREATE TABLE IF NOT EXISTS sales_property_catalog (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  project_id INTEGER NULL REFERENCES sales_projects(id),
  building_id INTEGER NULL REFERENCES buildings(id),
  unit_id INTEGER NULL REFERENCES units(id),
  catalog_ref VARCHAR(60) NOT NULL,
  property_type VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  list_price NUMERIC(14,2) NULL,
  minimum_price NUMERIC(14,2) NULL,
  currency VARCHAR(3) NULL,
  commercial_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  availability_date DATE NULL,
  surface_area NUMERIC(12,2) NULL,
  location_label VARCHAR(180) NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMP NULL,
  archived_by INTEGER NULL REFERENCES app_users(id),
  deleted_at TIMESTAMP NULL,
  deleted_by INTEGER NULL REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by INTEGER NULL REFERENCES app_users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by INTEGER NULL REFERENCES app_users(id),
  CONSTRAINT sales_catalog_org_ref_unique UNIQUE (organization_id, catalog_ref),
  CONSTRAINT sales_catalog_status_check CHECK (commercial_status IN ('DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN', 'BLOCKED')),
  CONSTRAINT sales_catalog_currency_check CHECK (currency IS NULL OR currency IN ('USD', 'CDF')),
  CONSTRAINT sales_catalog_price_currency_check CHECK ((list_price IS NULL AND minimum_price IS NULL) OR currency IS NOT NULL),
  CONSTRAINT sales_catalog_positive_list_price CHECK (list_price IS NULL OR list_price >= 0),
  CONSTRAINT sales_catalog_positive_minimum_price CHECK (minimum_price IS NULL OR minimum_price >= 0),
  CONSTRAINT sales_catalog_surface_positive CHECK (surface_area IS NULL OR surface_area >= 0)
);

CREATE INDEX IF NOT EXISTS sales_catalog_org_idx
  ON sales_property_catalog (organization_id);

CREATE INDEX IF NOT EXISTS sales_catalog_org_status_idx
  ON sales_property_catalog (organization_id, commercial_status);

CREATE INDEX IF NOT EXISTS sales_catalog_org_project_idx
  ON sales_property_catalog (organization_id, project_id);

CREATE INDEX IF NOT EXISTS sales_catalog_org_building_idx
  ON sales_property_catalog (organization_id, building_id);

CREATE INDEX IF NOT EXISTS sales_catalog_org_unit_idx
  ON sales_property_catalog (organization_id, unit_id);

CREATE TABLE IF NOT EXISTS sales_audit_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  user_id INTEGER NULL REFERENCES app_users(id),
  before_data JSONB NULL,
  after_data JSONB NULL,
  context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_audit_events_org_idx
  ON sales_audit_events (organization_id);

CREATE INDEX IF NOT EXISTS sales_audit_events_entity_idx
  ON sales_audit_events (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS sales_audit_events_event_idx
  ON sales_audit_events (organization_id, event_type, created_at DESC);

COMMENT ON TABLE sales_settings IS 'Paramètres du module Ventes par organisation.';
COMMENT ON TABLE sales_buyers IS 'Référentiel des acquéreurs du module Ventes, distinct des locataires.';
COMMENT ON TABLE sales_projects IS 'Programmes commerciaux et opérations de vente.';
COMMENT ON TABLE sales_property_catalog IS 'Catalogue commercial indépendant, avec liens optionnels vers le patrimoine.';
COMMENT ON TABLE sales_audit_events IS 'Audit applicatif spécifique au module Ventes.';

COMMIT;
