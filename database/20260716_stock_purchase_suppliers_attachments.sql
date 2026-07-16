BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  supplier_code VARCHAR(30),
  supplier_type VARCHAR(20) NOT NULL DEFAULT 'COMPANY'
    CHECK (supplier_type IN ('INDIVIDUAL', 'COMPANY')),
  name VARCHAR(180) NOT NULL,
  company_name VARCHAR(180),
  contact_person VARCHAR(180),
  phone VARCHAR(60),
  secondary_phone VARCHAR(60),
  email VARCHAR(180),
  address TEXT,
  tax_number VARCHAR(120),
  national_id VARCHAR(120),
  rccm VARCHAR(120),
  payment_terms VARCHAR(180),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS suppliers_org_idx
  ON suppliers (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS suppliers_org_status_idx
  ON suppliers (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS suppliers_org_name_idx
  ON suppliers (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_code_unique
  ON suppliers (organization_id, supplier_code)
  WHERE deleted_at IS NULL
    AND supplier_code IS NOT NULL;

ALTER TABLE stock_purchases
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS received_by INTEGER REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS stock_purchases_supplier_idx
  ON stock_purchases (organization_id, supplier_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS purchase_attachments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  file_name VARCHAR(220) NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(180) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS purchase_attachments_purchase_idx
  ON purchase_attachments (organization_id, purchase_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
