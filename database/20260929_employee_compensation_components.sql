BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payrolls
  ADD COLUMN IF NOT EXISTS base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_expenses NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_transport_allowance_nonnegative') THEN
    ALTER TABLE employees ADD CONSTRAINT employees_transport_allowance_nonnegative CHECK (transport_allowance >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_other_expenses_nonnegative') THEN
    ALTER TABLE employees ADD CONSTRAINT employees_other_expenses_nonnegative CHECK (other_expenses >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_compensation_components_nonnegative') THEN
    ALTER TABLE payrolls ADD CONSTRAINT payrolls_compensation_components_nonnegative
      CHECK (base_salary >= 0 AND transport_allowance >= 0 AND other_expenses >= 0);
  END IF;
END $$;

COMMIT;
