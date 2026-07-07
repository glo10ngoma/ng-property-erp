ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lease_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS building_id INTEGER;

CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(220) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'STAFF',
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leases (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE,
  monthly_rent NUMERIC(12,2) NOT NULL,
  rental_guarantee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  rental_guarantee_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  rental_guarantee_payment_date DATE,
  rental_guarantee_status VARCHAR(30) NOT NULL DEFAULT 'NOT_PAID',
  contract_file_url TEXT,
  contract_file_name VARCHAR(220),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(60),
  email VARCHAR(160),
  job_title VARCHAR(120) NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  hire_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_advances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  advance_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaves (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type VARCHAR(80) NOT NULL,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payrolls (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  advances_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  payment_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id SERIAL PRIMARY KEY,
  opened_by INTEGER REFERENCES app_users(id),
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES app_users(id),
  closed_at TIMESTAMP,
  closing_balance NUMERIC(12,2),
  expected_balance NUMERIC(12,2),
  difference_amount NUMERIC(12,2),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN'
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_one_open_session
  ON cash_sessions(status)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS cash_movements (
  id SERIAL PRIMARY KEY,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  category VARCHAR(60) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  movement_date DATE NOT NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  description TEXT,
  reference VARCHAR(120),
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'piece',
  current_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  movement_date DATE NOT NULL,
  source VARCHAR(120),
  reference VARCHAR(120),
  notes TEXT,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id SERIAL PRIMARY KEY,
  count_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER REFERENCES app_users(id),
  validated_by INTEGER REFERENCES app_users(id),
  validated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id SERIAL PRIMARY KEY,
  inventory_count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  theoretical_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  physical_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  difference_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT
);

INSERT INTO app_users (first_name, last_name, email, password_hash, role)
VALUES
  ('Admin', 'Demo', 'admin@property-erp.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'ADMIN'),
  ('Comptable', 'Demo', 'comptable@property-erp.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'ACCOUNTANT'),
  ('Agent', 'Demo', 'agent@property-erp.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'STAFF'),
  ('Directeur', 'Demo', 'directeur@property-erp.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'DIRECTOR')
ON CONFLICT (email) DO NOTHING;

INSERT INTO employees (first_name, last_name, phone, email, job_title, monthly_salary, hire_date)
VALUES
  ('Jean', 'Kasongo', '+243 89 210 1001', 'jean.kasongo@property-erp.local', 'Gestionnaire immeuble', 900, '2025-02-01'),
  ('Aline', 'Mbuyi', '+243 89 210 1002', 'aline.mbuyi@property-erp.local', 'Comptable', 1200, '2025-03-15')
ON CONFLICT DO NOTHING;

INSERT INTO cash_sessions (opened_by, opening_balance, status)
SELECT 1, 500, 'OPEN'
WHERE NOT EXISTS (SELECT 1 FROM cash_sessions WHERE status = 'OPEN');

INSERT INTO stock_items (name, category, unit, current_quantity, minimum_quantity, purchase_price, description)
VALUES
  ('Ampoules LED', 'Maintenance', 'piece', 45, 10, 3.5, 'Consommables électriques'),
  ('Peinture blanche', 'Travaux', 'seau', 8, 3, 28, 'Finition appartements')
ON CONFLICT DO NOTHING;

INSERT INTO leases (tenant_id, unit_id, start_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_status, status)
SELECT t.id, t.unit_id, t.move_in_date, u.monthly_rent, u.monthly_rent * 2, u.monthly_rent * 2, 'PAID', 'ACTIVE'
FROM tenants t
JOIN units u ON u.id = t.unit_id
WHERE NOT EXISTS (SELECT 1 FROM leases l WHERE l.tenant_id = t.id AND l.unit_id = t.unit_id);
