-- Property ERP SaaS V1 - Supabase demo seed
-- Execute after database/supabase_schema.sql.

BEGIN;

INSERT INTO organizations (id, name, slug, status)
VALUES (1, 'Demo Property ERP', 'demo', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, status = EXCLUDED.status;

INSERT INTO app_users (first_name, last_name, email, password_hash, role, status, organization_id)
VALUES
  ('Admin', 'Demo', 'admin@property-erp.local', 'demo', 'ADMIN', 'ACTIVE', 1),
  ('Comptable', 'Demo', 'comptable@property-erp.local', 'demo', 'ACCOUNTANT', 'ACTIVE', 1),
  ('Agent', 'Demo', 'agent@property-erp.local', 'demo', 'STAFF', 'ACTIVE', 1),
  ('Directeur', 'Demo', 'directeur@property-erp.local', 'demo', 'DIRECTOR', 'ACTIVE', 1)
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, organization_id = EXCLUDED.organization_id;

TRUNCATE
  payment_allocations,
  cash_movements,
  payments,
  invoice_items,
  invoices,
  lease_documents,
  lease_guarantees,
  leases,
  tenants,
  units,
  buildings
RESTART IDENTITY CASCADE;

INSERT INTO buildings (name, address, city, building_type, description, organization_id)
VALUES
  ('Residence Lumumba', '12 Avenue Lumumba, Gombe', 'Kinshasa', 'Residence', 'Immeuble premium proche du centre administratif.', 1),
  ('Palm Court', '45 Boulevard du 30 Juin', 'Kinshasa', 'Immeuble R+5', 'Residence urbaine avec parking securise.', 1),
  ('Riverside Plaza', '8 Avenue Wagenia', 'Kinshasa', 'Immeuble R+10', 'Appartements lumineux avec vue sur le fleuve.', 1),
  ('Cite Magnolia', '22 Avenue des Ecuries', 'Kinshasa', 'Mixte', 'Complexe familial avec services de proximite.', 1);

INSERT INTO units (building_id, number, floor, type, monthly_rent, status, organization_id)
SELECT
  ((g - 1) / 10) + 1,
  CONCAT(((g - 1) / 10) + 1, '-', LPAD((((g - 1) % 10) + 1)::TEXT, 2, '0')),
  ((g - 1) % 10) / 2,
  CASE WHEN g % 4 = 0 THEN 'Studio' WHEN g % 4 = 1 THEN '1 Bedroom' WHEN g % 4 = 2 THEN '2 Bedrooms' ELSE 'Penthouse' END,
  CASE WHEN g % 4 = 0 THEN 450 WHEN g % 4 = 1 THEN 700 WHEN g % 4 = 2 THEN 1100 ELSE 1800 END,
  'OCCUPIED',
  1
FROM generate_series(1, 40) AS g;

INSERT INTO tenants (first_name, last_name, phone, email, unit_id, move_in_date, status, organization_id)
SELECT
  (ARRAY['Esther','Grace','Daniel','Sarah','David','Merveille','Joseph','Naomi','Samuel','Rachel'])[((g - 1) % 10) + 1],
  (ARRAY['Kabasele','Mbuyi','Ilunga','Tshibanda','Mutombo','Kalala','Moke','Lukusa','Beya','Mavinga'])[((g - 1) % 10) + 1] || ' ' || g,
  '+243 89 ' || LPAD((1000000 + g)::TEXT, 7, '0'),
  'tenant' || g || '@property-erp.local',
  g,
  DATE '2025-01-01' + (g || ' days')::INTERVAL,
  'ACTIVE',
  1
FROM generate_series(1, 40) AS g;

INSERT INTO leases (tenant_id, unit_id, start_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_payment_date, rental_guarantee_status, status, organization_id)
SELECT
  t.id,
  t.unit_id,
  t.move_in_date,
  u.monthly_rent,
  u.monthly_rent * 2,
  u.monthly_rent * 2,
  t.move_in_date,
  'PAID',
  'ACTIVE',
  1
FROM tenants t
JOIN units u ON u.id = t.unit_id;

INSERT INTO lease_guarantees (lease_id, amount, paid_amount, payment_date, status, organization_id)
SELECT id, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_payment_date, rental_guarantee_status, organization_id
FROM leases;

INSERT INTO invoices (tenant_id, lease_id, unit_id, building_id, invoice_number, month, year, issue_date, due_date, status, total, organization_id)
SELECT
  t.id,
  l.id,
  u.id,
  u.building_id,
  'INV-2026-' || LPAD(((t.id - 1) * 3 + m)::TEXT, 4, '0'),
  m,
  2026,
  MAKE_DATE(2026, m, 1),
  MAKE_DATE(2026, m, 10),
  'UNPAID',
  0,
  1
FROM tenants t
JOIN units u ON u.id = t.unit_id
JOIN leases l ON l.tenant_id = t.id AND l.unit_id = u.id
CROSS JOIN generate_series(4, 6) AS m;

INSERT INTO invoice_items (invoice_id, description, amount, item_type, organization_id)
SELECT i.id, 'Loyer mensuel', u.monthly_rent, 'RENT', 1
FROM invoices i
JOIN units u ON u.id = i.unit_id;

INSERT INTO invoice_items (invoice_id, description, amount, item_type, organization_id)
SELECT id, 'Eau', 35 + (id % 4) * 5, 'WATER', 1 FROM invoices WHERE id % 2 = 0;

INSERT INTO invoice_items (invoice_id, description, amount, item_type, organization_id)
SELECT id, 'Charges communes', 60, 'COMMON_CHARGES', 1 FROM invoices WHERE id % 3 = 0;

UPDATE invoices i
SET total = item_totals.total
FROM (
  SELECT invoice_id, SUM(amount)::NUMERIC(12,2) AS total
  FROM invoice_items
  GROUP BY invoice_id
) item_totals
WHERE item_totals.invoice_id = i.id;

INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes, payer_name, receipt_number, organization_id)
SELECT id, issue_date + INTERVAL '3 days', total, 'BANK', 'BANK-' || id, 'Paiement complet', 'Locataire demo', 'REC-' || LPAD(id::TEXT, 5, '0'), 1
FROM invoices
WHERE id % 4 = 0;

INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes, payer_name, receipt_number, organization_id)
SELECT id, issue_date + INTERVAL '5 days', ROUND((total * 0.45)::NUMERIC, 2), 'MOBILE_MONEY', 'MM-' || id, 'Paiement partiel', 'Locataire demo', 'REC-P-' || LPAD(id::TEXT, 5, '0'), 1
FROM invoices
WHERE id % 5 = 0;

INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, amount)
SELECT organization_id, id, invoice_id, amount
FROM payments;

TRUNCATE cash_movements, cash_sessions RESTART IDENTITY CASCADE;

INSERT INTO cash_sessions (opened_by, opening_balance, status, organization_id)
VALUES (1, 500, 'OPEN', 1);

INSERT INTO cash_movements (cash_session_id, type, category, amount, movement_date, payment_id, invoice_id, tenant_id, description, reference, created_by, organization_id)
SELECT
  1,
  'IN',
  'INVOICE_PAYMENT',
  p.amount,
  p.payment_date,
  p.id,
  p.invoice_id,
  i.tenant_id,
  'Paiement facture',
  p.reference,
  1,
  1
FROM payments p
JOIN invoices i ON i.id = p.invoice_id;

UPDATE invoices i
SET status = CASE
  WHEN s.paid_amount <= 0 THEN 'UNPAID'
  WHEN s.paid_amount < i.total THEN 'PARTIAL'
  ELSE 'PAID'
END
FROM invoice_payment_summary s
WHERE s.invoice_id = i.id;

UPDATE units SET status = 'OCCUPIED' WHERE organization_id = 1;

COMMIT;
