CREATE TABLE IF NOT EXISTS sales_invoices (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  subscription_id BIGINT NOT NULL REFERENCES sales_subscriptions(id),
  installment_id BIGINT NOT NULL REFERENCES sales_subscription_installments(id),
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL,
  subtotal_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_allocation_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  generated_mode TEXT NOT NULL DEFAULT 'MANUAL',
  generation_key TEXT,
  pdf_document_id BIGINT,
  send_status TEXT,
  sent_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  metadata JSONB,
  created_by BIGINT REFERENCES app_users(id),
  updated_by BIGINT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoices_status_check CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
  CONSTRAINT sales_invoices_currency_check CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_invoices_send_status_check CHECK (send_status IS NULL OR send_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT sales_invoices_generated_mode_check CHECK (generated_mode IN ('MANUAL', 'AUTOMATIC', 'DRY_RUN')),
  CONSTRAINT sales_invoices_amounts_check CHECK (subtotal_amount >= 0 AND discount_amount >= 0 AND fee_allocation_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0 AND refunded_amount >= 0),
  CONSTRAINT sales_invoices_balance_check CHECK (balance_due >= 0),
  CONSTRAINT sales_invoices_total_formula_check CHECK (total_amount = subtotal_amount - discount_amount - fee_allocation_amount),
  CONSTRAINT sales_invoices_paid_refunded_check CHECK (paid_amount >= refunded_amount)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_subscriptions_org_id_unique
  ON sales_subscriptions (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_subscription_installments_org_id_unique
  ON sales_subscription_installments (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_org_id_unique
  ON sales_invoices (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_unique
  ON sales_invoices (organization_id, invoice_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_subscription_installment_active_unique
  ON sales_invoices (organization_id, subscription_id, installment_id)
  WHERE status <> 'CANCELLED';

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_generation_key_unique
  ON sales_invoices (organization_id, generation_key)
  WHERE generation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_invoices_subscription_idx
  ON sales_invoices (organization_id, subscription_id, due_date DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_status_idx
  ON sales_invoices (organization_id, status, due_date DESC);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  invoice_id BIGINT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL DEFAULT 'INSTALLMENT',
  label TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_items_currency_check CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_invoice_items_line_type_check CHECK (line_type IN ('INSTALLMENT', 'RESERVATION_FEE_ALLOCATION', 'ADJUSTMENT')),
  CONSTRAINT sales_invoice_items_amounts_check CHECK (quantity >= 0 AND unit_price >= 0 AND line_amount >= 0)
);

CREATE INDEX IF NOT EXISTS sales_invoice_items_invoice_idx
  ON sales_invoice_items (organization_id, invoice_id, sort_order, id);

CREATE TABLE IF NOT EXISTS sales_invoice_payments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  invoice_id BIGINT NOT NULL REFERENCES sales_invoices(id),
  subscription_id BIGINT NOT NULL REFERENCES sales_subscriptions(id),
  installment_id BIGINT REFERENCES sales_subscription_installments(id),
  payment_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  cash_session_id BIGINT REFERENCES cash_sessions(id),
  bank_account_id BIGINT REFERENCES bank_accounts(id),
  cash_movement_id BIGINT REFERENCES cash_movements(id),
  bank_transaction_id BIGINT REFERENCES bank_transactions(id),
  receipt_document_id BIGINT,
  external_reference TEXT,
  notes TEXT,
  idempotency_key TEXT,
  payload_hash TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_by BIGINT REFERENCES app_users(id),
  updated_by BIGINT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_payments_status_check CHECK (status IN ('CONFIRMED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  CONSTRAINT sales_invoice_payments_currency_check CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_invoice_payments_amounts_check CHECK (amount > 0),
  CONSTRAINT sales_invoice_payments_method_check CHECK (payment_method IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_invoice_payments_destination_check CHECK (destination_type IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payments_number_unique
  ON sales_invoice_payments (organization_id, payment_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payments_org_id_unique
  ON sales_invoice_payments (id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payments_idempotency_unique
  ON sales_invoice_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_invoice_payments_invoice_idx
  ON sales_invoice_payments (organization_id, invoice_id, payment_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS sales_invoice_payment_refunds (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id),
  payment_id BIGINT NOT NULL REFERENCES sales_invoice_payments(id),
  refund_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL,
  refund_date DATE NOT NULL,
  refund_method TEXT NOT NULL,
  destination_type TEXT NOT NULL,
  cash_session_id BIGINT REFERENCES cash_sessions(id),
  bank_account_id BIGINT REFERENCES bank_accounts(id),
  cash_movement_id BIGINT REFERENCES cash_movements(id),
  bank_transaction_id BIGINT REFERENCES bank_transactions(id),
  external_reference TEXT,
  reason TEXT NOT NULL,
  notes TEXT,
  idempotency_key TEXT,
  payload_hash TEXT,
  created_by BIGINT REFERENCES app_users(id),
  updated_by BIGINT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_invoice_payment_refunds_status_check CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  CONSTRAINT sales_invoice_payment_refunds_currency_check CHECK (currency IN ('USD', 'CDF')),
  CONSTRAINT sales_invoice_payment_refunds_amounts_check CHECK (amount > 0),
  CONSTRAINT sales_invoice_payment_refunds_method_check CHECK (refund_method IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER')),
  CONSTRAINT sales_invoice_payment_refunds_destination_check CHECK (destination_type IN ('CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payment_refunds_number_unique
  ON sales_invoice_payment_refunds (organization_id, refund_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_payment_refunds_idempotency_unique
  ON sales_invoice_payment_refunds (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_invoice_payment_refunds_payment_idx
  ON sales_invoice_payment_refunds (organization_id, payment_id, refund_date DESC, id DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_subscription_org_fk'
  ) THEN
    ALTER TABLE sales_invoices
      ADD CONSTRAINT sales_invoices_subscription_org_fk
      FOREIGN KEY (subscription_id, organization_id)
      REFERENCES sales_subscriptions(id, organization_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_installment_org_fk'
  ) THEN
    ALTER TABLE sales_invoices
      ADD CONSTRAINT sales_invoices_installment_org_fk
      FOREIGN KEY (installment_id, organization_id)
      REFERENCES sales_subscription_installments(id, organization_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_items_invoice_org_fk'
  ) THEN
    ALTER TABLE sales_invoice_items
      ADD CONSTRAINT sales_invoice_items_invoice_org_fk
      FOREIGN KEY (invoice_id, organization_id)
      REFERENCES sales_invoices(id, organization_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_payments_invoice_org_fk'
  ) THEN
    ALTER TABLE sales_invoice_payments
      ADD CONSTRAINT sales_invoice_payments_invoice_org_fk
      FOREIGN KEY (invoice_id, organization_id)
      REFERENCES sales_invoices(id, organization_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_payments_subscription_org_fk'
  ) THEN
    ALTER TABLE sales_invoice_payments
      ADD CONSTRAINT sales_invoice_payments_subscription_org_fk
      FOREIGN KEY (subscription_id, organization_id)
      REFERENCES sales_subscriptions(id, organization_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_payments_installment_org_fk'
  ) THEN
    ALTER TABLE sales_invoice_payments
      ADD CONSTRAINT sales_invoice_payments_installment_org_fk
      FOREIGN KEY (installment_id, organization_id)
      REFERENCES sales_subscription_installments(id, organization_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_payment_refunds_payment_org_fk'
  ) THEN
    ALTER TABLE sales_invoice_payment_refunds
      ADD CONSTRAINT sales_invoice_payment_refunds_payment_org_fk
      FOREIGN KEY (payment_id, organization_id)
      REFERENCES sales_invoice_payments(id, organization_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_sales_invoice_organization_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  installment_subscription_id BIGINT;
BEGIN
  SELECT subscription_id
    INTO installment_subscription_id
  FROM sales_subscription_installments
  WHERE id = NEW.installment_id
    AND organization_id = NEW.organization_id;

  IF installment_subscription_id IS NULL THEN
    RAISE EXCEPTION 'SALES_INVOICE_INSTALLMENT_ORGANIZATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF installment_subscription_id <> NEW.subscription_id THEN
    RAISE EXCEPTION 'SALES_INVOICE_INSTALLMENT_SUBSCRIPTION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_sales_invoice_organization_links() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'sales_invoice_organization_links_trigger'
      AND tgrelid = 'sales_invoices'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sales_invoice_organization_links_trigger
      BEFORE INSERT OR UPDATE OF organization_id, subscription_id, installment_id
      ON sales_invoices
      FOR EACH ROW
      EXECUTE FUNCTION enforce_sales_invoice_organization_links();
  END IF;
END;
$$;

ALTER TABLE sales_settings
  ADD COLUMN IF NOT EXISTS sales_invoice_number_format TEXT,
  ADD COLUMN IF NOT EXISTS sales_invoice_payment_number_format TEXT,
  ADD COLUMN IF NOT EXISTS sales_invoice_refund_number_format TEXT,
  ADD COLUMN IF NOT EXISTS sales_invoice_receipt_number_format TEXT,
  ADD COLUMN IF NOT EXISTS sales_invoice_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_customer_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_customer_advance_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_revenue_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_cash_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_bank_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_refund_account_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_allow_invoice_overpayment BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_auto_issue_invoice BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sales_allow_early_invoice_generation BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sales_invoice_email_mode TEXT;

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
    'RESERVATION_RECEIPT',
    'SALES_INVOICE',
    'SALES_INVOICE_PAYMENT',
    'SALES_INVOICE_REFUND',
    'SALES_INVOICE_RECEIPT'
  ));

ALTER TABLE sales_document_generations
  DROP CONSTRAINT IF EXISTS sales_document_generations_entity_type_chk;

ALTER TABLE sales_document_generations
  ADD CONSTRAINT sales_document_generations_entity_type_chk
  CHECK (entity_type IN (
    'RESERVATION',
    'SUBSCRIPTION',
    'RESERVATION_PAYMENT',
    'RESERVATION_REFUND',
    'SALES_INVOICE',
    'SALES_INVOICE_PAYMENT'
  ));

ALTER TABLE sales_document_generations
  DROP CONSTRAINT IF EXISTS sales_document_generations_template_type_chk;

ALTER TABLE sales_document_generations
  ADD CONSTRAINT sales_document_generations_template_type_chk
  CHECK (template_type IN (
    'RESERVATION_CONTRACT',
    'SUBSCRIPTION_CONTRACT',
    'RESERVATION_FEE_RECEIPT',
    'SALES_INVOICE',
    'SALES_INVOICE_RECEIPT'
  ));

INSERT INTO sales_number_sequences (organization_id, document_type, sequence_year, current_value, created_at, updated_at)
SELECT s.organization_id, x.document_type, NULL, 0, NOW(), NOW()
FROM sales_settings s
CROSS JOIN (VALUES ('SALES_INVOICE'), ('SALES_INVOICE_PAYMENT'), ('SALES_INVOICE_REFUND'), ('SALES_INVOICE_RECEIPT')) AS x(document_type)
ON CONFLICT (organization_id, document_type, sequence_year) DO NOTHING;
-- Le backend ERP pilote deja l'authentification et le contexte d'organisation.
-- On aligne donc V3.2 sur les migrations Sales existantes : RLS activee, sans
-- politiques anon/authenticated supplementaires dans cette passe.
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_payment_refunds ENABLE ROW LEVEL SECURITY;
