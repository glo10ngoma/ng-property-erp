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
  building_type VARCHAR(120) NOT NULL DEFAULT 'Residence',
  state VARCHAR(40) NOT NULL DEFAULT 'EXPLOITED',
  commune VARCHAR(120),
  floors_count INTEGER,
  total_units INTEGER,
  manager_name VARCHAR(160),
  manager_phone VARCHAR(60),
  manager_email VARCHAR(160),
  observations TEXT,
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
  surface_area NUMERIC(10,2),
  bedrooms_count INTEGER,
  bathrooms_count INTEGER,
  has_balcony BOOLEAN NOT NULL DEFAULT FALSE,
  has_parking BOOLEAN NOT NULL DEFAULT FALSE,
  is_furnished BOOLEAN NOT NULL DEFAULT FALSE,
  has_air_conditioning BOOLEAN NOT NULL DEFAULT FALSE,
  has_equipped_kitchen BOOLEAN NOT NULL DEFAULT FALSE,
  has_internet BOOLEAN NOT NULL DEFAULT FALSE,
  has_water_meter BOOLEAN NOT NULL DEFAULT FALSE,
  water_meter_number VARCHAR(120),
  has_electricity_meter BOOLEAN NOT NULL DEFAULT FALSE,
  electricity_meter_number VARCHAR(120),
  description TEXT,
  observations TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (building_id, number)
);

CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  post_name VARCHAR(100),
  phone VARCHAR(60) NOT NULL,
  secondary_phone VARCHAR(60),
  email VARCHAR(160),
  profession VARCHAR(140),
  address TEXT,
  id_document_type VARCHAR(80),
  id_number VARCHAR(120),
  id_document_file_name VARCHAR(220),
  id_document_file_url TEXT,
  nationality VARCHAR(100),
  emergency_contact_name VARCHAR(160),
  emergency_contact_phone VARCHAR(60),
  notes TEXT,
  unit_id INTEGER REFERENCES units(id) ON DELETE RESTRICT,
  move_in_date DATE,
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
  last_reminder_at TIMESTAMP,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description VARCHAR(220) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE invoice_reminders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP')),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('SENT', 'FAILED', 'SIMULATED')),
  reminded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reminded_by INTEGER
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
