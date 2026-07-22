BEGIN;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  bank_name VARCHAR(160) NOT NULL,
  account_name VARCHAR(180) NOT NULL,
  account_number VARCHAR(120),
  account_type VARCHAR(20) NOT NULL DEFAULT 'CURRENT'
    CHECK (account_type IN ('CURRENT', 'SAVINGS', 'ESCROW', 'OTHER')),
  currency VARCHAR(3) NOT NULL
    CHECK (currency IN ('USD', 'CDF')),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (opening_balance >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS bank_accounts_org_idx
  ON bank_accounts (organization_id, bank_name, account_name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bank_accounts_org_currency_idx
  ON bank_accounts (organization_id, currency, status)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_org_unique_account
  ON bank_accounts (organization_id, bank_name, account_number, currency)
  WHERE deleted_at IS NULL
    AND account_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  transaction_number VARCHAR(40) NOT NULL,
  transaction_date DATE NOT NULL,
  direction VARCHAR(3) NOT NULL
    CHECK (direction IN ('IN', 'OUT')),
  transaction_type VARCHAR(30) NOT NULL
    CHECK (transaction_type IN ('OPENING_BALANCE', 'MANUAL_ADJUSTMENT')),
  amount NUMERIC(14,2) NOT NULL
    CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL
    CHECK (currency IN ('USD', 'CDF')),
  reference VARCHAR(140),
  description TEXT,
  counterparty_name VARCHAR(180),
  source_module VARCHAR(40) NOT NULL DEFAULT 'BANK',
  source_entity_type VARCHAR(60),
  source_entity_id INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'VALIDATED'
    CHECK (status IN ('VALIDATED', 'REVERSED')),
  reversal_of_id INTEGER REFERENCES bank_transactions(id),
  idempotency_key TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_org_number_unique
  ON bank_transactions (organization_id, transaction_number);

CREATE INDEX IF NOT EXISTS bank_transactions_account_date_idx
  ON bank_transactions (organization_id, bank_account_id, transaction_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS bank_transactions_org_type_idx
  ON bank_transactions (organization_id, transaction_type, direction, status);

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_org_idempotency_unique
  ON bank_transactions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
