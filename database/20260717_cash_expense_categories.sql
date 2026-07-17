BEGIN;

CREATE TABLE IF NOT EXISTS cash_expense_categories (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code VARCHAR(40) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_expense_categories_org_code_unique
  ON cash_expense_categories (organization_id, code)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_expense_categories_org_name_unique
  ON cash_expense_categories (organization_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cash_expense_categories_org_status_idx
  ON cash_expense_categories (organization_id, status)
  WHERE deleted_at IS NULL;

COMMIT;
