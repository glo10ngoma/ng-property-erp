BEGIN;

UPDATE leaves
SET status = 'PENDING'
WHERE status = 'REQUESTED';

ALTER TABLE salary_advances
  ALTER COLUMN status SET DEFAULT 'DRAFT';

ALTER TABLE leaves
  ALTER COLUMN status SET DEFAULT 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS payrolls_one_month_per_employee
  ON payrolls (organization_id, employee_id, year, month)
  WHERE deleted_at IS NULL;

COMMIT;
