BEGIN;

ALTER TABLE IF EXISTS shareholder_payout_batches
  DROP CONSTRAINT IF EXISTS shareholder_payout_batches_total_amount_check;

ALTER TABLE IF EXISTS shareholder_payout_batches
  ADD CONSTRAINT shareholder_payout_batches_total_amount_check
  CHECK (total_amount >= 0);

COMMIT;
