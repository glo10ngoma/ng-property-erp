BEGIN;

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
  CHECK (transaction_type IN ('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'RENT_PAYMENT'));

COMMIT;
