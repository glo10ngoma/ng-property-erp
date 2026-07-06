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
