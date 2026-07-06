TRUNCATE payments, invoice_items, invoices, tenants, units, buildings RESTART IDENTITY CASCADE;

INSERT INTO buildings (name, address, city, description) VALUES
('Residence Lumumba', '12 Avenue Lumumba, Gombe', 'Kinshasa', 'Immeuble premium proche du centre administratif.'),
('Palm Court', '45 Boulevard du 30 Juin', 'Kinshasa', 'Residence urbaine avec parking securise.'),
('Riverside Plaza', '8 Avenue Wagenia', 'Kinshasa', 'Appartements lumineux avec vue sur le fleuve.'),
('Cite Magnolia', '22 Avenue des Ecuries', 'Kinshasa', 'Complexe familial avec services de proximite.');

INSERT INTO units (building_id, number, floor, type, monthly_rent, status)
SELECT
  ((g - 1) / 10) + 1,
  CONCAT(((g - 1) / 10) + 1, '-', LPAD((((g - 1) % 10) + 1)::TEXT, 2, '0')),
  ((g - 1) % 10) / 2,
  CASE WHEN g % 4 = 0 THEN 'Studio' WHEN g % 4 = 1 THEN '1 Bedroom' WHEN g % 4 = 2 THEN '2 Bedrooms' ELSE 'Penthouse' END,
  CASE WHEN g % 4 = 0 THEN 450 WHEN g % 4 = 1 THEN 700 WHEN g % 4 = 2 THEN 1100 ELSE 1800 END,
  'OCCUPIED'
FROM generate_series(1, 40) AS g;

INSERT INTO tenants (first_name, last_name, phone, email, unit_id, move_in_date, status)
SELECT
  (ARRAY['Esther','Grace','Daniel','Sarah','David','Merveille','Joseph','Naomi','Samuel','Rachel'])[((g - 1) % 10) + 1],
  (ARRAY['Kabasele','Mbuyi','Ilunga','Tshibanda','Mutombo','Kalala','Moke','Lukusa','Beya','Mavinga'])[((g - 1) % 10) + 1] || ' ' || g,
  '+243 89 ' || LPAD((1000000 + g)::TEXT, 7, '0'),
  'tenant' || g || '@property-erp.local',
  g,
  DATE '2025-01-01' + (g || ' days')::INTERVAL,
  'ACTIVE'
FROM generate_series(1, 40) AS g;

INSERT INTO invoices (tenant_id, invoice_number, month, year, issue_date, due_date, status, total)
SELECT
  t.id,
  'INV-2026-' || LPAD(((t.id - 1) * 3 + m)::TEXT, 4, '0'),
  m,
  2026,
  MAKE_DATE(2026, m, 1),
  MAKE_DATE(2026, m, 10),
  'UNPAID',
  0
FROM tenants t
CROSS JOIN generate_series(4, 6) AS m;

INSERT INTO invoice_items (invoice_id, description, amount)
SELECT i.id, 'Monthly rent', u.monthly_rent
FROM invoices i
JOIN tenants t ON t.id = i.tenant_id
JOIN units u ON u.id = t.unit_id;

INSERT INTO invoice_items (invoice_id, description, amount)
SELECT id, 'Water', 35 + (id % 4) * 5 FROM invoices WHERE id % 2 = 0;

INSERT INTO invoice_items (invoice_id, description, amount)
SELECT id, 'Common charges', 60 FROM invoices WHERE id % 3 = 0;

UPDATE invoices i
SET total = item_totals.total
FROM (
  SELECT invoice_id, SUM(amount)::NUMERIC(12,2) AS total
  FROM invoice_items
  GROUP BY invoice_id
) item_totals
WHERE item_totals.invoice_id = i.id;

INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes)
SELECT id, issue_date + INTERVAL '3 days', total, 'BANK', 'BANK-' || id, 'Paid in full'
FROM invoices
WHERE id % 4 = 0;

INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, notes)
SELECT id, issue_date + INTERVAL '5 days', ROUND((total * 0.45)::NUMERIC, 2), 'MOBILE_MONEY', 'MM-' || id, 'Partial payment'
FROM invoices
WHERE id % 5 = 0;

UPDATE invoices i
SET status = CASE
  WHEN s.paid_amount <= 0 THEN 'UNPAID'
  WHEN s.paid_amount < i.total THEN 'PARTIAL'
  ELSE 'PAID'
END
FROM invoice_payment_summary s
WHERE s.invoice_id = i.id;
