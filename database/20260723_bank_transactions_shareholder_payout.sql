BEGIN;

ALTER TABLE shareholder_payout_batches
  ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id);

ALTER TABLE shareholder_payout_lines
  ADD COLUMN IF NOT EXISTS bank_transaction_id INTEGER REFERENCES bank_transactions(id) ON DELETE SET NULL;

ALTER TABLE shareholder_payout_batches
  DROP CONSTRAINT IF EXISTS shareholder_payout_batches_source_register_check;

ALTER TABLE shareholder_payout_batches
  ADD CONSTRAINT shareholder_payout_batches_source_register_check
  CHECK (source_register IN ('MAIN_CASH', 'GUARANTEE_CASH', 'BANK'));

ALTER TABLE shareholder_payout_lines
  DROP CONSTRAINT IF EXISTS shareholder_payout_lines_one_register_check;

ALTER TABLE shareholder_payout_lines
  ADD CONSTRAINT shareholder_payout_lines_one_register_check
  CHECK (
    (
      CASE WHEN cash_movement_id IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN guarantee_cash_movement_id IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN bank_transaction_id IS NOT NULL THEN 1 ELSE 0 END
    ) = 1
  );

ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_transaction_type_check;

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_transaction_type_check
  CHECK (transaction_type IN ('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'RENT_PAYMENT', 'GUARANTEE_PAYMENT', 'GUARANTEE_REFUND', 'TENANT_CREDIT', 'SHAREHOLDER_PAYOUT'));

CREATE INDEX IF NOT EXISTS shareholder_payout_batches_bank_account_idx
  ON shareholder_payout_batches (organization_id, bank_account_id, payout_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS shareholder_payout_lines_bank_transaction_idx
  ON shareholder_payout_lines (organization_id, bank_transaction_id, created_at DESC);

COMMIT;
