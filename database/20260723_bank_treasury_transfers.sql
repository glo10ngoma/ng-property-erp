BEGIN;

CREATE TABLE IF NOT EXISTS treasury_transfers (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  transfer_number VARCHAR(40) NOT NULL,
  transfer_type VARCHAR(20) NOT NULL
    CHECK (transfer_type IN ('CASH_TO_BANK', 'BANK_TO_CASH', 'BANK_TO_BANK')),
  transfer_date DATE NOT NULL,
  currency VARCHAR(3) NOT NULL
    CHECK (currency IN ('USD', 'CDF')),
  amount NUMERIC(14,2) NOT NULL
    CHECK (amount > 0),
  source_type VARCHAR(20) NOT NULL
    CHECK (source_type IN ('MAIN_CASH', 'BANK')),
  source_cash_session_id INTEGER REFERENCES cash_sessions(id),
  source_bank_account_id INTEGER REFERENCES bank_accounts(id),
  destination_type VARCHAR(20) NOT NULL
    CHECK (destination_type IN ('MAIN_CASH', 'BANK')),
  destination_cash_session_id INTEGER REFERENCES cash_sessions(id),
  destination_bank_account_id INTEGER REFERENCES bank_accounts(id),
  payment_method VARCHAR(40),
  reference VARCHAR(140),
  description TEXT,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'VALIDATED'
    CHECK (status IN ('VALIDATED', 'CANCELLED')),
  idempotency_key TEXT,
  source_cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  source_bank_transaction_id INTEGER REFERENCES bank_transactions(id) ON DELETE SET NULL,
  destination_cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  destination_bank_transaction_id INTEGER REFERENCES bank_transactions(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  validated_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_transfers_org_number_unique
  ON treasury_transfers (organization_id, transfer_number);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_transfers_org_idempotency_unique
  ON treasury_transfers (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS treasury_transfers_org_date_idx
  ON treasury_transfers (organization_id, transfer_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS treasury_transfers_org_source_bank_idx
  ON treasury_transfers (organization_id, source_bank_account_id, transfer_date DESC)
  WHERE source_bank_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS treasury_transfers_org_destination_bank_idx
  ON treasury_transfers (organization_id, destination_bank_account_id, transfer_date DESC)
  WHERE destination_bank_account_id IS NOT NULL;

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS treasury_transfer_id INTEGER REFERENCES treasury_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_movements_treasury_transfer_idx
  ON cash_movements (organization_id, treasury_transfer_id, movement_date DESC)
  WHERE treasury_transfer_id IS NOT NULL
    AND deleted_at IS NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'bank_transactions'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%transaction_type%'
  ORDER BY c.conname
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bank_transactions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'OPENING_BALANCE',
    'MANUAL_ADJUSTMENT',
    'RENT_PAYMENT',
    'GUARANTEE_PAYMENT',
    'GUARANTEE_REFUND',
    'TENANT_CREDIT',
    'SHAREHOLDER_PAYOUT',
    'BANK_EXPENSE',
    'TRANSFER_IN',
    'TRANSFER_OUT'
  ));

COMMIT;
