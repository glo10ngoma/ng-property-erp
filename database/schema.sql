DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS units CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;

CREATE TABLE buildings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(220) NOT NULL,
  city VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id SERIAL PRIMARY KEY,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  number VARCHAR(40) NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0,
  type VARCHAR(80) NOT NULL,
  monthly_rent NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'VACANT',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (building_id, number)
);

CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(60) NOT NULL,
  email VARCHAR(160),
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  move_in_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tenants_one_active_per_unit
  ON tenants(unit_id)
  WHERE status = 'ACTIVE';

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(60) NOT NULL UNIQUE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'UNPAID',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(220) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(120),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW invoice_payment_summary AS
SELECT
  i.id AS invoice_id,
  i.total,
  COALESCE(SUM(p.amount), 0)::NUMERIC(12,2) AS paid_amount,
  GREATEST(i.total - COALESCE(SUM(p.amount), 0), 0)::NUMERIC(12,2) AS remaining_amount
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id;
