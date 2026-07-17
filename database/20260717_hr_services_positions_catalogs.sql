BEGIN;

CREATE TABLE IF NOT EXISTS hr_services (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code VARCHAR(40),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hr_positions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code VARCHAR(40),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_services_org_code_unique
  ON hr_services (organization_id, code)
  WHERE deleted_at IS NULL
    AND code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hr_services_org_name_unique
  ON hr_services (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hr_positions_org_code_unique
  ON hr_positions (organization_id, code)
  WHERE deleted_at IS NULL
    AND code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hr_positions_org_name_unique
  ON hr_positions (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES hr_services(id),
  ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES hr_positions(id);

CREATE INDEX IF NOT EXISTS employees_service_idx
  ON employees (organization_id, service_id)
  WHERE deleted_at IS NULL
    AND service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS employees_position_idx
  ON employees (organization_id, position_id)
  WHERE deleted_at IS NULL
    AND position_id IS NOT NULL;

COMMIT;
