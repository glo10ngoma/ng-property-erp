BEGIN;

ALTER TABLE sales_settings
  ADD COLUMN IF NOT EXISTS reservation_fee_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reservation_fee_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reservation_fee_default_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_fee_default_currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS reservation_fee_deductibility TEXT NOT NULL DEFAULT 'DEDUCTIBLE',
  ADD COLUMN IF NOT EXISTS reservation_fee_deductible_percentage NUMERIC(8,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS reservation_fee_refundable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reservation_fee_refundable_percentage NUMERIC(8,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS reservation_fee_refund_deadline_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_fee_accounting_treatment TEXT NOT NULL DEFAULT 'CUSTOMER_ADVANCE',
  ADD COLUMN IF NOT EXISTS reservation_payment_number_format TEXT NOT NULL DEFAULT 'PRS-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS reservation_refund_number_format TEXT NOT NULL DEFAULT 'RRS-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS reservation_receipt_number_format TEXT NOT NULL DEFAULT 'RCR-{YYYY}-{SEQ:5}';

ALTER TABLE sales_reservation_payments
  ADD COLUMN IF NOT EXISTS accounting_treatment_snapshot TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_default_amount_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_default_amount_chk
      CHECK (reservation_fee_default_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_default_currency_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_default_currency_chk
      CHECK (reservation_fee_default_currency IN ('USD', 'CDF'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_deductibility_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_deductibility_chk
      CHECK (reservation_fee_deductibility IN ('DEDUCTIBLE', 'NON_DEDUCTIBLE', 'PARTIALLY_DEDUCTIBLE'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_deductible_pct_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_deductible_pct_chk
      CHECK (reservation_fee_deductible_percentage >= 0 AND reservation_fee_deductible_percentage <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_refundable_pct_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_refundable_pct_chk
      CHECK (reservation_fee_refundable_percentage >= 0 AND reservation_fee_refundable_percentage <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_refund_deadline_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_refund_deadline_chk
      CHECK (reservation_fee_refund_deadline_days >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_fee_accounting_treatment_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_fee_accounting_treatment_chk
      CHECK (reservation_fee_accounting_treatment IN ('CUSTOMER_ADVANCE', 'RESERVATION_FEE_REVENUE'));
  END IF;
END $$;

ALTER TABLE sales_number_sequences
  DROP CONSTRAINT IF EXISTS sales_number_sequences_document_type_chk;

ALTER TABLE sales_number_sequences
  ADD CONSTRAINT sales_number_sequences_document_type_chk
  CHECK (document_type IN (
    'BUYER',
    'PROJECT',
    'CATALOG',
    'RESERVATION',
    'SUBSCRIPTION',
    'RESERVATION_CONTRACT',
    'SUBSCRIPTION_CONTRACT',
    'RESERVATION_PAYMENT',
    'RESERVATION_REFUND',
    'RESERVATION_RECEIPT'
  ));

ALTER TABLE sales_document_generations
  DROP CONSTRAINT IF EXISTS sales_document_generations_entity_type_chk;

ALTER TABLE sales_document_generations
  ADD CONSTRAINT sales_document_generations_entity_type_chk
  CHECK (entity_type IN ('RESERVATION', 'SUBSCRIPTION', 'RESERVATION_PAYMENT', 'RESERVATION_REFUND'));

ALTER TABLE sales_document_generations
  DROP CONSTRAINT IF EXISTS sales_document_generations_template_type_chk;

ALTER TABLE sales_document_generations
  ADD CONSTRAINT sales_document_generations_template_type_chk
  CHECK (template_type IN ('RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT', 'RESERVATION_FEE_RECEIPT'));

CREATE TABLE IF NOT EXISTS sales_reservation_payments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reservation_id BIGINT NOT NULL,
  payment_number TEXT NOT NULL,
  payment_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  cash_session_id BIGINT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  cash_movement_id BIGINT NULL REFERENCES cash_movements(id) ON DELETE SET NULL,
  bank_account_id BIGINT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  bank_transaction_id BIGINT NULL REFERENCES bank_transactions(id) ON DELETE SET NULL,
  external_reference TEXT NULL,
  idempotency_key TEXT NOT NULL,
  accounting_treatment_snapshot TEXT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  cancellation_reason TEXT NULL,
  CONSTRAINT sales_reservation_payments_reservation_fk
    FOREIGN KEY (reservation_id, organization_id)
    REFERENCES sales_reservations(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_payments_amount_chk
    CHECK (amount > 0),
  CONSTRAINT sales_reservation_payments_currency_chk
    CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_reservation_payments_method_chk
    CHECK (payment_method IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_reservation_payments_destination_chk
    CHECK (destination_type IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_reservation_payments_accounting_treatment_chk
    CHECK (accounting_treatment_snapshot IS NULL OR accounting_treatment_snapshot IN ('CUSTOMER_ADVANCE', 'RESERVATION_FEE_REVENUE')),
  CONSTRAINT sales_reservation_payments_status_chk
    CHECK (status IN ('CONFIRMED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_payments_org_number_uidx
  ON sales_reservation_payments (organization_id, payment_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_payments_id_org_uidx
  ON sales_reservation_payments (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_payments_org_idempotency_uidx
  ON sales_reservation_payments (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS sales_reservation_payments_org_reservation_idx
  ON sales_reservation_payments (organization_id, reservation_id, payment_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_reservation_payments_org_status_idx
  ON sales_reservation_payments (organization_id, status, payment_date DESC);

CREATE TABLE IF NOT EXISTS sales_reservation_refunds (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reservation_payment_id BIGINT NOT NULL,
  reservation_id BIGINT NOT NULL,
  refund_number TEXT NOT NULL,
  refund_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  refund_method TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  cash_session_id BIGINT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  cash_movement_id BIGINT NULL REFERENCES cash_movements(id) ON DELETE SET NULL,
  bank_account_id BIGINT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  bank_transaction_id BIGINT NULL REFERENCES bank_transactions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT sales_reservation_refunds_payment_fk
    FOREIGN KEY (reservation_payment_id, organization_id)
    REFERENCES sales_reservation_payments(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_refunds_reservation_fk
    FOREIGN KEY (reservation_id, organization_id)
    REFERENCES sales_reservations(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_refunds_amount_chk
    CHECK (amount > 0),
  CONSTRAINT sales_reservation_refunds_currency_chk
    CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_reservation_refunds_method_chk
    CHECK (refund_method IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_reservation_refunds_destination_chk
    CHECK (destination_type IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_reservation_refunds_status_chk
    CHECK (status IN ('CONFIRMED', 'CANCELLED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_refunds_org_number_uidx
  ON sales_reservation_refunds (organization_id, refund_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_refunds_id_org_uidx
  ON sales_reservation_refunds (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservation_refunds_org_idempotency_uidx
  ON sales_reservation_refunds (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS sales_reservation_refunds_org_reservation_idx
  ON sales_reservation_refunds (organization_id, reservation_id, refund_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_reservation_refunds_org_status_idx
  ON sales_reservation_refunds (organization_id, status, refund_date DESC);

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS sales_reservation_payment_id BIGINT REFERENCES sales_reservation_payments(id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS sales_reservation_refund_id BIGINT REFERENCES sales_reservation_refunds(id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_id_org_uidx
  ON cash_movements (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_id_org_uidx
  ON cash_sessions (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_id_org_uidx
  ON bank_accounts (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_id_org_uidx
  ON bank_transactions (id, organization_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_sales_reservation_payment_org_fk'
  ) THEN
    ALTER TABLE cash_movements
      ADD CONSTRAINT cash_movements_sales_reservation_payment_org_fk
      FOREIGN KEY (sales_reservation_payment_id, organization_id)
      REFERENCES sales_reservation_payments(id, organization_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_movements_sales_reservation_refund_org_fk'
  ) THEN
    ALTER TABLE cash_movements
      ADD CONSTRAINT cash_movements_sales_reservation_refund_org_fk
      FOREIGN KEY (sales_reservation_refund_id, organization_id)
      REFERENCES sales_reservation_refunds(id, organization_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cash_movements_sales_reservation_payment_idx
  ON cash_movements (organization_id, sales_reservation_payment_id)
  WHERE sales_reservation_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_movements_sales_reservation_refund_idx
  ON cash_movements (organization_id, sales_reservation_refund_id)
  WHERE sales_reservation_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_reservation_fee_allocations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reservation_id BIGINT NOT NULL,
  reservation_payment_id BIGINT NULL,
  subscription_id BIGINT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_at TIMESTAMPTZ NULL,
  reversed_by BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reversal_reason TEXT NULL,
  CONSTRAINT sales_reservation_fee_allocations_reservation_fk
    FOREIGN KEY (reservation_id, organization_id)
    REFERENCES sales_reservations(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_fee_allocations_payment_fk
    FOREIGN KEY (reservation_payment_id, organization_id)
    REFERENCES sales_reservation_payments(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_fee_allocations_subscription_fk
    FOREIGN KEY (subscription_id, organization_id)
    REFERENCES sales_subscriptions(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservation_fee_allocations_amount_chk
    CHECK (amount > 0),
  CONSTRAINT sales_reservation_fee_allocations_currency_chk
    CHECK (currency IN ('USD', 'CDF'))
);

CREATE INDEX IF NOT EXISTS sales_reservation_fee_allocations_org_reservation_idx
  ON sales_reservation_fee_allocations (organization_id, reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_reservation_fee_allocations_org_subscription_idx
  ON sales_reservation_fee_allocations (organization_id, subscription_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_payments_cash_session_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_payments
      ADD CONSTRAINT sales_reservation_payments_cash_session_org_fk
      FOREIGN KEY (cash_session_id, organization_id)
      REFERENCES cash_sessions(id, organization_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_payments_cash_movement_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_payments
      ADD CONSTRAINT sales_reservation_payments_cash_movement_org_fk
      FOREIGN KEY (cash_movement_id, organization_id)
      REFERENCES cash_movements(id, organization_id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_payments_bank_account_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_payments
      ADD CONSTRAINT sales_reservation_payments_bank_account_org_fk
      FOREIGN KEY (bank_account_id, organization_id)
      REFERENCES bank_accounts(id, organization_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_payments_bank_transaction_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_payments
      ADD CONSTRAINT sales_reservation_payments_bank_transaction_org_fk
      FOREIGN KEY (bank_transaction_id, organization_id)
      REFERENCES bank_transactions(id, organization_id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_refunds_cash_session_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_refunds
      ADD CONSTRAINT sales_reservation_refunds_cash_session_org_fk
      FOREIGN KEY (cash_session_id, organization_id)
      REFERENCES cash_sessions(id, organization_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_refunds_cash_movement_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_refunds
      ADD CONSTRAINT sales_reservation_refunds_cash_movement_org_fk
      FOREIGN KEY (cash_movement_id, organization_id)
      REFERENCES cash_movements(id, organization_id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_refunds_bank_account_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_refunds
      ADD CONSTRAINT sales_reservation_refunds_bank_account_org_fk
      FOREIGN KEY (bank_account_id, organization_id)
      REFERENCES bank_accounts(id, organization_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_reservation_refunds_bank_transaction_org_fk'
  ) THEN
    ALTER TABLE sales_reservation_refunds
      ADD CONSTRAINT sales_reservation_refunds_bank_transaction_org_fk
      FOREIGN KEY (bank_transaction_id, organization_id)
      REFERENCES bank_transactions(id, organization_id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE sales_reservation_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_reservation_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_reservation_fee_allocations ENABLE ROW LEVEL SECURITY;

COMMIT;
