BEGIN;

CREATE TABLE IF NOT EXISTS stock_documents (
  id SERIAL PRIMARY KEY,
  document_number VARCHAR(30) NOT NULL,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('ENTRY', 'EXIT')),
  document_date DATE NOT NULL,
  supplier VARCHAR(180),
  supplier_reference VARCHAR(160),
  store VARCHAR(120),
  reference VARCHAR(160),
  reason VARCHAR(180),
  observations TEXT,
  attachment_file_name VARCHAR(220),
  attachment_file_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'VALIDATED',
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_documents_org_number_unique
  ON stock_documents (organization_id, document_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_documents_org_date_idx
  ON stock_documents (organization_id, document_date DESC, document_type)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_document_lines (
  id SERIAL PRIMARY KEY,
  stock_document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS stock_document_id INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason VARCHAR(180),
  ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS stock_movements_document_idx
  ON stock_movements (stock_document_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_movement_history (
  id SERIAL PRIMARY KEY,
  stock_movement_id INTEGER NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
  action VARCHAR(40) NOT NULL,
  description TEXT,
  performed_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_movement_history_movement_idx
  ON stock_movement_history (stock_movement_id, created_at DESC);

COMMIT;
