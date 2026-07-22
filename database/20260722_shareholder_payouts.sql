BEGIN;

CREATE TABLE IF NOT EXISTS shareholders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  shareholder_type VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL'
    CHECK (shareholder_type IN ('INDIVIDUAL', 'COMPANY')),
  display_name VARCHAR(180) NOT NULL,
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  company_name VARCHAR(180),
  phone VARCHAR(60),
  email VARCHAR(180),
  identity_number VARCHAR(120),
  address TEXT,
  ownership_percentage NUMERIC(5,2)
    CHECK (ownership_percentage IS NULL OR (ownership_percentage >= 0 AND ownership_percentage <= 100)),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS shareholders_org_idx
  ON shareholders (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shareholders_org_status_idx
  ON shareholders (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shareholders_org_display_name_idx
  ON shareholders (organization_id, LOWER(display_name))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS shareholder_payout_batches (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  source_register VARCHAR(30) NOT NULL
    CHECK (source_register IN ('MAIN_CASH', 'GUARANTEE_CASH')),
  currency VARCHAR(10) NOT NULL
    CHECK (currency IN ('USD', 'CDF')),
  payout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  operation_type VARCHAR(40) NOT NULL
    CHECK (operation_type IN ('SHAREHOLDER_REPAYMENT', 'SHAREHOLDER_CURRENT_ACCOUNT', 'DISTRIBUTION', 'ADVANCE', 'OTHER')),
  reason TEXT NOT NULL,
  reference VARCHAR(120),
  notes TEXT,
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  beneficiary_count INTEGER NOT NULL DEFAULT 0 CHECK (beneficiary_count >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'VALIDATED'
    CHECK (status IN ('DRAFT', 'VALIDATED', 'CANCELLED')),
  idempotency_key TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  validated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS shareholder_payout_batches_org_idempotency_unique
  ON shareholder_payout_batches (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS shareholder_payout_batches_org_date_idx
  ON shareholder_payout_batches (organization_id, payout_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS shareholder_payout_batches_org_source_idx
  ON shareholder_payout_batches (organization_id, source_register, payout_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS shareholder_payout_lines (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  batch_id INTEGER NOT NULL REFERENCES shareholder_payout_batches(id) ON DELETE CASCADE,
  shareholder_id INTEGER NOT NULL REFERENCES shareholders(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL
    CHECK (currency IN ('USD', 'CDF')),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH'
    CHECK (payment_method IN ('CASH', 'BANK', 'MOBILE_MONEY')),
  reference VARCHAR(120),
  notes TEXT,
  cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  guarantee_cash_movement_id INTEGER REFERENCES guarantee_cash_movements(id) ON DELETE SET NULL,
  receipt_number VARCHAR(60) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT shareholder_payout_lines_one_register_check CHECK (
    (cash_movement_id IS NOT NULL AND guarantee_cash_movement_id IS NULL)
    OR
    (cash_movement_id IS NULL AND guarantee_cash_movement_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shareholder_payout_lines_org_batch_shareholder_unique
  ON shareholder_payout_lines (organization_id, batch_id, shareholder_id);

CREATE UNIQUE INDEX IF NOT EXISTS shareholder_payout_lines_org_receipt_unique
  ON shareholder_payout_lines (organization_id, receipt_number);

CREATE INDEX IF NOT EXISTS shareholder_payout_lines_org_batch_idx
  ON shareholder_payout_lines (organization_id, batch_id, created_at ASC);

CREATE INDEX IF NOT EXISTS shareholder_payout_lines_org_shareholder_idx
  ON shareholder_payout_lines (organization_id, shareholder_id, created_at DESC);

ALTER TABLE guarantee_cash_movements
  DROP CONSTRAINT IF EXISTS guarantee_cash_movements_movement_type_check;

ALTER TABLE guarantee_cash_movements
  ADD CONSTRAINT guarantee_cash_movements_movement_type_check
  CHECK (movement_type IN ('GARANTY_PAYMENT_IN', 'GARANTY_REFUND', 'GARANTY_EXPENSE', 'GARANTY_TRANSFER', 'SHAREHOLDER_PAYOUT'));

COMMIT;
