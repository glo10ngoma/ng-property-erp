BEGIN;

CREATE TABLE IF NOT EXISTS employee_monthly_attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  working_days INTEGER NOT NULL DEFAULT 0,
  present_days INTEGER NOT NULL DEFAULT 0,
  paid_leave_days INTEGER NOT NULL DEFAULT 0,
  sick_days INTEGER NOT NULL DEFAULT 0,
  unjustified_absence_days INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  absence_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  observations TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  validated_at TIMESTAMP,
  validated_by INTEGER REFERENCES app_users(id),
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_monthly_attendance_unique
  ON employee_monthly_attendance (organization_id, employee_id, year, month)
  WHERE deleted_at IS NULL;

ALTER TABLE payrolls
  ADD COLUMN IF NOT EXISTS employee_monthly_attendance_id INTEGER REFERENCES employee_monthly_attendance(id),
  ADD COLUMN IF NOT EXISTS daily_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS working_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS present_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unjustified_absence_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMIT;
