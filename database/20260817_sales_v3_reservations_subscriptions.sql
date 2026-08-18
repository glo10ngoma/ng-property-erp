BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS sales_buyers_id_organization_uidx
  ON sales_buyers (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_projects_id_organization_uidx
  ON sales_projects (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_property_catalog_id_organization_uidx
  ON sales_property_catalog (id, organization_id);

ALTER TABLE sales_buyers
  ADD COLUMN IF NOT EXISTS commercial_stage TEXT NOT NULL DEFAULT 'PROSPECT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_buyers_commercial_stage_chk'
  ) THEN
    ALTER TABLE sales_buyers
      ADD CONSTRAINT sales_buyers_commercial_stage_chk
      CHECK (commercial_stage IN ('PROSPECT', 'RESERVING', 'SUBSCRIBER', 'BUYER', 'OWNER', 'LOST'));
  END IF;
END $$;

ALTER TABLE sales_settings
  ADD COLUMN IF NOT EXISTS reservation_default_duration_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reservation_fee_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservation_default_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_deposit_type TEXT NOT NULL DEFAULT 'PERCENTAGE',
  ADD COLUMN IF NOT EXISTS minimum_deposit_percentage NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS minimum_deposit_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS maximum_installment_count INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS default_installment_frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_approval_threshold_percentage NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_custom_schedule BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_currencies JSONB NOT NULL DEFAULT '["USD","CDF"]'::jsonb,
  ADD COLUMN IF NOT EXISTS contract_generation_mode TEXT,
  ADD COLUMN IF NOT EXISTS invoice_generation_mode TEXT,
  ADD COLUMN IF NOT EXISTS revenue_recognition_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_reservation_default_fee_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_reservation_default_fee_chk
      CHECK (reservation_default_fee >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_minimum_deposit_percentage_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_minimum_deposit_percentage_chk
      CHECK (minimum_deposit_percentage IS NULL OR (minimum_deposit_percentage >= 0 AND minimum_deposit_percentage <= 100));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_minimum_deposit_amount_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_minimum_deposit_amount_chk
      CHECK (minimum_deposit_amount IS NULL OR minimum_deposit_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_installment_count_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_installment_count_chk
      CHECK (maximum_installment_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_grace_period_days_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_grace_period_days_chk
      CHECK (grace_period_days >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_discount_approval_threshold_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_discount_approval_threshold_chk
      CHECK (discount_approval_threshold_percentage >= 0 AND discount_approval_threshold_percentage <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_minimum_deposit_type_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_minimum_deposit_type_chk
      CHECK (minimum_deposit_type IN ('PERCENTAGE', 'FIXED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_default_installment_frequency_chk'
  ) THEN
    ALTER TABLE sales_settings
      ADD CONSTRAINT sales_settings_default_installment_frequency_chk
      CHECK (default_installment_frequency IN ('MONTHLY', 'QUARTERLY', 'CUSTOM'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_reservations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  reservation_number TEXT NOT NULL,
  buyer_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  project_id BIGINT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  currency TEXT NOT NULL,
  catalog_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  negotiated_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  reservation_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  reservation_date DATE NOT NULL,
  expires_at DATE,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  notes TEXT,
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  archived_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT sales_reservations_buyer_fk
    FOREIGN KEY (buyer_id, organization_id)
    REFERENCES sales_buyers(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservations_catalog_fk
    FOREIGN KEY (catalog_item_id, organization_id)
    REFERENCES sales_property_catalog(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservations_project_fk
    FOREIGN KEY (project_id, organization_id)
    REFERENCES sales_projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_reservations_status_chk
    CHECK (status IN ('DRAFT', 'ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'CONVERTED')),
  CONSTRAINT sales_reservations_currency_chk
    CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_reservations_catalog_price_chk
    CHECK (catalog_price >= 0),
  CONSTRAINT sales_reservations_negotiated_price_chk
    CHECK (negotiated_price >= 0),
  CONSTRAINT sales_reservations_fee_chk
    CHECK (reservation_fee >= 0),
  CONSTRAINT sales_reservations_dates_chk
    CHECK (expires_at IS NULL OR expires_at >= reservation_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservations_org_number_uidx
  ON sales_reservations (organization_id, reservation_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservations_id_organization_uidx
  ON sales_reservations (id, organization_id);

CREATE INDEX IF NOT EXISTS sales_reservations_org_idx
  ON sales_reservations (organization_id, status, reservation_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sales_reservations_active_catalog_uidx
  ON sales_reservations (organization_id, catalog_item_id)
  WHERE archived_at IS NULL AND status IN ('ACTIVE', 'CONFIRMED');

CREATE TABLE IF NOT EXISTS sales_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_number TEXT NOT NULL,
  reservation_id BIGINT,
  buyer_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  project_id BIGINT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  currency TEXT NOT NULL,
  catalog_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  final_sale_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  deposit_type TEXT NOT NULL DEFAULT 'FIXED',
  deposit_percentage NUMERIC(8,2),
  deposit_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  financed_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  first_due_date DATE,
  regular_installment_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  final_installment_amount NUMERIC(18,2),
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  approved_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  archived_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT sales_subscriptions_reservation_fk
    FOREIGN KEY (reservation_id, organization_id)
    REFERENCES sales_reservations(id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT sales_subscriptions_buyer_fk
    FOREIGN KEY (buyer_id, organization_id)
    REFERENCES sales_buyers(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_subscriptions_catalog_fk
    FOREIGN KEY (catalog_item_id, organization_id)
    REFERENCES sales_property_catalog(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_subscriptions_project_fk
    FOREIGN KEY (project_id, organization_id)
    REFERENCES sales_projects(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_subscriptions_status_chk
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED')),
  CONSTRAINT sales_subscriptions_currency_chk
    CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_subscriptions_deposit_type_chk
    CHECK (deposit_type IN ('PERCENTAGE', 'FIXED')),
  CONSTRAINT sales_subscriptions_frequency_chk
    CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'CUSTOM')),
  CONSTRAINT sales_subscriptions_catalog_price_chk
    CHECK (catalog_price >= 0),
  CONSTRAINT sales_subscriptions_discount_amount_chk
    CHECK (discount_amount >= 0),
  CONSTRAINT sales_subscriptions_final_sale_price_chk
    CHECK (final_sale_price >= 0),
  CONSTRAINT sales_subscriptions_deposit_percentage_chk
    CHECK (deposit_percentage IS NULL OR (deposit_percentage >= 0 AND deposit_percentage <= 100)),
  CONSTRAINT sales_subscriptions_deposit_amount_chk
    CHECK (deposit_amount >= 0),
  CONSTRAINT sales_subscriptions_financed_balance_chk
    CHECK (financed_balance >= 0),
  CONSTRAINT sales_subscriptions_installment_count_chk
    CHECK (installment_count >= 0),
  CONSTRAINT sales_subscriptions_grace_period_days_chk
    CHECK (grace_period_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_subscriptions_org_number_uidx
  ON sales_subscriptions (organization_id, subscription_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_subscriptions_id_organization_uidx
  ON sales_subscriptions (id, organization_id);

CREATE INDEX IF NOT EXISTS sales_subscriptions_org_idx
  ON sales_subscriptions (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_subscription_installments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id BIGINT NOT NULL,
  sequence_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  due_date DATE,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  installment_type TEXT NOT NULL DEFAULT 'REGULAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_subscription_installments_subscription_fk
    FOREIGN KEY (subscription_id, organization_id)
    REFERENCES sales_subscriptions(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT sales_subscription_installments_amount_chk
    CHECK (amount >= 0),
  CONSTRAINT sales_subscription_installments_currency_chk
    CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_subscription_installments_sequence_chk
    CHECK (sequence_number >= 1),
  CONSTRAINT sales_subscription_installments_type_chk
    CHECK (installment_type IN ('DEPOSIT', 'REGULAR', 'FINAL', 'CUSTOM', 'FEE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_subscription_installments_seq_uidx
  ON sales_subscription_installments (organization_id, subscription_id, sequence_number);

CREATE INDEX IF NOT EXISTS sales_subscription_installments_org_idx
  ON sales_subscription_installments (organization_id, due_date);

CREATE TABLE IF NOT EXISTS sales_status_history (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  changed_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_status_history_lookup_idx
  ON sales_status_history (organization_id, entity_type, entity_id, changed_at DESC);

COMMIT;
