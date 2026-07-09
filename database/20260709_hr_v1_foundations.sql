BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS post_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS nationality VARCHAR(120),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS secondary_phone VARCHAR(60),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS department VARCHAR(140),
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS assigned_site VARCHAR(160),
  ADD COLUMN IF NOT EXISTS manager_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(140),
  ADD COLUMN IF NOT EXISTS account_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS mobile_money_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS id_document_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS id_document_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS identity_attachment_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS cv_attachment_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS signed_contract_attachment_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(60),
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40),
  ADD COLUMN IF NOT EXISTS reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS repayment_schedule TEXT,
  ADD COLUMN IF NOT EXISTS observations TEXT;

ALTER TABLE leaves
  ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS observations TEXT;

CREATE TABLE IF NOT EXISTS employee_contracts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_number VARCHAR(40) NOT NULL,
  contract_type VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  salary_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  job_title VARCHAR(140),
  department VARCHAR(140),
  contract_file_name VARCHAR(220),
  contract_file_url TEXT,
  observations TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  check_in_time TIME,
  check_out_time TIME,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  absence BOOLEAN NOT NULL DEFAULT FALSE,
  worked_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PRESENT',
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  organization_id INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_number_unique
  ON employees (organization_id, employee_number)
  WHERE deleted_at IS NULL AND employee_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employee_contracts_contract_number_unique
  ON employee_contracts (organization_id, contract_number)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employee_attendance_day_unique
  ON employee_attendance (organization_id, employee_id, attendance_date)
  WHERE deleted_at IS NULL;

COMMIT;
