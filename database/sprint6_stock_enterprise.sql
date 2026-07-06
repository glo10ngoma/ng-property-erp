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
  ('Électricité'),
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
