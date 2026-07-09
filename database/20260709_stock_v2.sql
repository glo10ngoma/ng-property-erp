BEGIN;

ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS store VARCHAR(120),
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(120),
  ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model VARCHAR(120),
  ADD COLUMN IF NOT EXISTS photo_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220);

ALTER TABLE inventory_count_lines
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difference_cost NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE inventory_counts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS stock_alerts (
  id SERIAL PRIMARY KEY,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  level VARCHAR(30) NOT NULL CHECK (level IN ('LOW_STOCK', 'OUT_OF_STOCK')),
  quantity NUMERIC(12,2) NOT NULL,
  minimum_quantity NUMERIC(12,2) NOT NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'INTERNAL'
    CHECK (channel IN ('INTERNAL', 'EMAIL', 'SMS', 'WHATSAPP')),
  recipient VARCHAR(220),
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'SIMULATED'
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SIMULATED')),
  resolved_at TIMESTAMP,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS stock_alerts_org_item_idx
  ON stock_alerts (organization_id, stock_item_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_alerts_active_unique
  ON stock_alerts (organization_id, stock_item_id, level, channel)
  WHERE resolved_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stock_movements_org_date_type_idx
  ON stock_movements (organization_id, movement_date DESC, type)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_lines_inventory_item_unique
  ON inventory_count_lines (inventory_count_id, stock_item_id)
  WHERE deleted_at IS NULL;

COMMIT;
