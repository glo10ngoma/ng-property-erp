BEGIN;

CREATE TABLE IF NOT EXISTS stock_purchases (
  id SERIAL PRIMARY KEY,
  purchase_number VARCHAR(30) NOT NULL,
  purchase_date DATE NOT NULL,
  supplier_name VARCHAR(180) NOT NULL,
  supplier_reference VARCHAR(180),
  store VARCHAR(120),
  payment_terms VARCHAR(180),
  payment_method VARCHAR(60),
  payment_type VARCHAR(30) NOT NULL DEFAULT 'DEFERRED'
    CHECK (payment_type IN ('CASH', 'PARTIAL', 'DEFERRED')),
  due_date DATE,
  subtotal_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  purchase_status VARCHAR(30) NOT NULL DEFAULT 'OPEN'
    CHECK (purchase_status IN ('DRAFT', 'OPEN', 'CANCELLED', 'CLOSED')),
  reception_status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
    CHECK (reception_status IN ('PENDING', 'PARTIAL', 'RECEIVED')),
  payment_status VARCHAR(30) NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
  observations TEXT,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_purchases_org_number_unique
  ON stock_purchases (organization_id, purchase_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_purchases_org_date_idx
  ON stock_purchases (organization_id, purchase_date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_purchase_lines (
  id SERIAL PRIMARY KEY,
  stock_purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  received_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stock_purchase_lines_purchase_idx
  ON stock_purchase_lines (stock_purchase_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_purchase_receipts (
  id SERIAL PRIMARY KEY,
  stock_purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  receipt_number VARCHAR(30) NOT NULL,
  receipt_date DATE NOT NULL,
  receiver_name VARCHAR(180),
  store VARCHAR(120),
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_purchase_receipts_org_number_unique
  ON stock_purchase_receipts (organization_id, receipt_number)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_purchase_receipt_lines (
  id SERIAL PRIMARY KEY,
  stock_purchase_receipt_id INTEGER NOT NULL REFERENCES stock_purchase_receipts(id) ON DELETE CASCADE,
  stock_purchase_line_id INTEGER NOT NULL REFERENCES stock_purchase_lines(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity_received NUMERIC(12,2) NOT NULL CHECK (quantity_received > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stock_purchase_receipt_lines_receipt_idx
  ON stock_purchase_receipt_lines (stock_purchase_receipt_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_purchase_payments (
  id SERIAL PRIMARY KEY,
  stock_purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(60),
  reference VARCHAR(180),
  notes TEXT,
  cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stock_purchase_payments_purchase_idx
  ON stock_purchase_payments (stock_purchase_id, payment_date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS stock_purchase_timeline (
  id SERIAL PRIMARY KEY,
  stock_purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  details TEXT,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_purchase_timeline_purchase_idx
  ON stock_purchase_timeline (stock_purchase_id, created_at DESC);

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS stock_purchase_id INTEGER REFERENCES stock_purchases(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS stock_purchase_id INTEGER REFERENCES stock_purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_purchase_receipt_id INTEGER REFERENCES stock_purchase_receipts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_movements_purchase_idx
  ON cash_movements (stock_purchase_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_movements_purchase_idx
  ON stock_movements (stock_purchase_id, stock_purchase_receipt_id)
  WHERE deleted_at IS NULL;

COMMIT;
