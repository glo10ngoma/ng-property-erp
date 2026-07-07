-- Property ERP SaaS V1 - Enterprise demo seed
-- Safe scope: recreates data only for organization id 2 / slug ng-erp-demo-property.
-- Execute after database/supabase_schema.sql.

BEGIN;

INSERT INTO organizations (id, name, slug, status)
VALUES (2, 'NG ERP Demo Property', 'ng-erp-demo-property', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, status = EXCLUDED.status;

DELETE FROM whatsapp_logs WHERE organization_id = 2;
DELETE FROM sms_logs WHERE organization_id = 2;
DELETE FROM email_logs WHERE organization_id = 2;
DELETE FROM message_templates WHERE organization_id = 2;
DELETE FROM notifications WHERE organization_id = 2;
DELETE FROM workflow_actions WHERE organization_id = 2;
DELETE FROM workflow_steps WHERE organization_id = 2;
DELETE FROM workflow_instances WHERE organization_id = 2;
DELETE FROM maintenance_documents WHERE organization_id = 2;
DELETE FROM maintenance_expenses WHERE organization_id = 2;
DELETE FROM maintenance_timeline WHERE organization_id = 2;
DELETE FROM maintenance_assignments WHERE organization_id = 2;
DELETE FROM maintenance_requests WHERE organization_id = 2;
DELETE FROM stock_movements WHERE organization_id = 2;
DELETE FROM inventory_count_lines WHERE organization_id = 2;
DELETE FROM inventory_counts WHERE organization_id = 2;
DELETE FROM stock_items WHERE organization_id = 2;
DELETE FROM stock_categories WHERE organization_id = 2;
DELETE FROM payrolls WHERE organization_id = 2;
DELETE FROM leaves WHERE organization_id = 2;
DELETE FROM salary_advances WHERE organization_id = 2;
DELETE FROM cash_movements WHERE organization_id = 2;
DELETE FROM cash_sessions WHERE organization_id = 2;
DELETE FROM employees WHERE organization_id = 2;
DELETE FROM payment_allocations WHERE organization_id = 2;
DELETE FROM payments WHERE organization_id = 2;
DELETE FROM invoice_items WHERE organization_id = 2;
DELETE FROM invoices WHERE organization_id = 2;
DELETE FROM lease_documents WHERE organization_id = 2;
DELETE FROM lease_guarantees WHERE organization_id = 2;
DELETE FROM leases WHERE organization_id = 2;
DELETE FROM tenants WHERE organization_id = 2;
DELETE FROM units WHERE organization_id = 2;
DELETE FROM buildings WHERE organization_id = 2;
DELETE FROM app_users WHERE organization_id = 2;

INSERT INTO app_users (first_name, last_name, email, password_hash, role, status, organization_id)
VALUES
  ('Admin', 'Demo', 'admin@ng-erp-demo.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'ADMIN', 'ACTIVE', 2),
  ('Comptable', 'Demo', 'comptable@ng-erp-demo.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'ACCOUNTANT', 'ACTIVE', 2),
  ('Agent', 'Demo', 'agent@ng-erp-demo.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'STAFF', 'ACTIVE', 2),
  ('Directeur', 'Demo', 'directeur@ng-erp-demo.local', 'scrypt|16384|8|1|property-erp-demo-v1|zAYcJ3nmtuQlcwQxiAzyQVNhlAvGSF1c-taJwKkEs-1HNKkwaPDWULImFCjGAaFGMjehxkPqe3YH-9-JZYqg8Q', 'DIRECTOR', 'ACTIVE', 2)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = EXCLUDED.status, organization_id = EXCLUDED.organization_id;

INSERT INTO buildings (name, address, city, building_type, description, organization_id)
VALUES
  ('Residence Fleuve Congo', '12 Avenue Wagenia, Gombe', 'Kinshasa', 'Residence', 'Residence premium proche du fleuve.', 2),
  ('Immeuble Lumumba Plaza', '88 Boulevard Lumumba, Limete', 'Kinshasa', 'Immeuble R+10', 'Immeuble mixte avec commerces au rez-de-chaussee.', 2),
  ('Villa Kivu Gardens', '6 Avenue du Lac, Ngaliema', 'Kinshasa', 'Villa', 'Complexe residentiel securise.', 2),
  ('Centre Kasavubu Business', '45 Avenue Kasavubu', 'Kinshasa', 'Immeuble de bureaux', 'Bureaux et locaux commerciaux.', 2),
  ('Residence Baobab', '19 Avenue des Ecuries', 'Kinshasa', 'Immeuble R+5', 'Appartements familiaux.', 2),
  ('Palmier Court', '31 Avenue de la Paix', 'Lubumbashi', 'Residence', 'Residence urbaine avec parking.', 2),
  ('Immeuble Katanga Heights', '9 Avenue Sendwe', 'Lubumbashi', 'Immeuble R+4', 'Immeuble de standing moyen.', 2),
  ('Riverside Commerce', '22 Quai du Port', 'Matadi', 'Centre commercial', 'Locaux commerciaux et bureaux.', 2),
  ('Residence Sankuru', '14 Avenue Sankuru', 'Mbuji-Mayi', 'Immeuble R+3', 'Logements abordables.', 2),
  ('Complexe Magnolia', '7 Route Aeroport', 'Kinshasa', 'Mixte', 'Complexe mixte appartements et magasins.', 2);

INSERT INTO units (building_id, number, floor, type, monthly_rent, status, organization_id)
SELECT
  b.id,
  'U' || LPAD(bn::TEXT, 2, '0') || '-' || LPAD(u::TEXT, 2, '0'),
  CEIL(u::NUMERIC / 3)::INT,
  CASE u % 8
    WHEN 0 THEN 'Studio'
    WHEN 1 THEN 'Appartement 1 chambre'
    WHEN 2 THEN 'Appartement 2 chambres'
    WHEN 3 THEN 'Appartement 3 chambres'
    WHEN 4 THEN 'Bureau'
    WHEN 5 THEN 'Local commercial'
    WHEN 6 THEN 'Parking'
    ELSE 'Penthouse'
  END,
  CASE u % 8
    WHEN 0 THEN 450
    WHEN 1 THEN 700
    WHEN 2 THEN 1050
    WHEN 3 THEN 1450
    WHEN 4 THEN 900
    WHEN 5 THEN 1250
    WHEN 6 THEN 120
    ELSE 2200
  END + (bn * 35),
  CASE WHEN ((bn - 1) * 15 + u) <= 130 THEN 'OCCUPIED' WHEN u IN (14, 15) THEN 'MAINTENANCE' ELSE 'VACANT' END,
  2
FROM buildings b
JOIN generate_series(1, 10) AS bn ON b.name = (ARRAY[
  'Residence Fleuve Congo','Immeuble Lumumba Plaza','Villa Kivu Gardens','Centre Kasavubu Business','Residence Baobab',
  'Palmier Court','Immeuble Katanga Heights','Riverside Commerce','Residence Sankuru','Complexe Magnolia'
])[bn]
CROSS JOIN generate_series(1, 15) AS u
WHERE b.organization_id = 2;

INSERT INTO tenants (first_name, last_name, phone, email, unit_id, move_in_date, status, organization_id)
SELECT
  (ARRAY['Aminata','Grace','Chantal','Mireille','Sarah','Naomi','Aline','Esther','Nadine','Merveille','Daniel','Joseph','Samuel','David','Patrick','Cedric','Christian','Junior','Landry','Yannick'])[((n - 1) % 20) + 1],
  (ARRAY['Mbuyi','Kabasele','Ilunga','Mutombo','Kalala','Tshibanda','Lukusa','Moke','Beya','Mavinga','Mbala','Kitenge','Kabongo','Mulumba','Ngoy','Mwanza','Kasongo','Tshisekedi','Mpoyi','Lutete'])[((n - 1) % 20) + 1] || ' ' || n,
  '+243 89 ' || LPAD((2000000 + n)::TEXT, 7, '0'),
  'locataire' || n || '@ng-erp-demo.local',
  u.id,
  DATE '2025-01-01' + (n % 420),
  'ACTIVE',
  2
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY building_id, number) AS n
  FROM units
  WHERE organization_id = 2
  ORDER BY building_id, number
  LIMIT 130
) u;

INSERT INTO leases (tenant_id, unit_id, start_date, end_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_payment_date, rental_guarantee_status, contract_file_name, status, organization_id)
SELECT
  t.id, t.unit_id, t.move_in_date, NULL, u.monthly_rent,
  u.monthly_rent * 2,
  CASE WHEN rn % 9 = 0 THEN 0 WHEN rn % 5 = 0 THEN u.monthly_rent ELSE u.monthly_rent * 2 END,
  CASE WHEN rn % 9 = 0 THEN NULL ELSE t.move_in_date END,
  CASE WHEN rn % 9 = 0 THEN 'NOT_PAID' WHEN rn % 5 = 0 THEN 'PARTIAL' ELSE 'PAID' END,
  'contrat-bail-' || t.id || '.pdf',
  'ACTIVE',
  2
FROM (
  SELECT t.*, ROW_NUMBER() OVER (ORDER BY t.id) AS rn
  FROM tenants t
  WHERE t.organization_id = 2
) t
JOIN units u ON u.id = t.unit_id;

INSERT INTO leases (tenant_id, unit_id, start_date, end_date, monthly_rent, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_payment_date, rental_guarantee_status, contract_file_name, status, organization_id)
SELECT tenant_id, unit_id, start_date - INTERVAL '14 months', start_date - INTERVAL '2 months', monthly_rent * 0.92,
       rental_guarantee_amount, rental_guarantee_amount, start_date - INTERVAL '14 months', 'PAID',
       'ancien-contrat-' || tenant_id || '.pdf', 'TERMINATED', 2
FROM leases
WHERE organization_id = 2 AND status = 'ACTIVE'
ORDER BY id
LIMIT 25;

INSERT INTO lease_guarantees (organization_id, lease_id, amount, paid_amount, payment_date, status)
SELECT organization_id, id, rental_guarantee_amount, rental_guarantee_paid, rental_guarantee_payment_date, rental_guarantee_status
FROM leases
WHERE organization_id = 2;

INSERT INTO lease_documents (organization_id, lease_id, document_type, file_name, file_url)
SELECT organization_id, id, 'CONTRACT', contract_file_name, 'contracts/demo/' || contract_file_name
FROM leases
WHERE organization_id = 2 AND contract_file_name IS NOT NULL;

INSERT INTO invoices (tenant_id, lease_id, unit_id, building_id, invoice_number, month, year, issue_date, due_date, status, total, organization_id)
SELECT
  l.tenant_id, l.id, l.unit_id, u.building_id,
  'ENT-2026-' || LPAD(l.id::TEXT, 4, '0') || '-' || LPAD(m::TEXT, 2, '0'),
  m, 2026, MAKE_DATE(2026, m, 1), MAKE_DATE(2026, m, 10),
  CASE WHEN (l.id + m) % 11 = 0 THEN 'UNPAID' WHEN (l.id + m) % 7 = 0 THEN 'PARTIAL' ELSE 'PAID' END,
  l.monthly_rent,
  2
FROM leases l
JOIN units u ON u.id = l.unit_id
CROSS JOIN generate_series(1, 7) AS m
WHERE l.organization_id = 2 AND l.status = 'ACTIVE';

INSERT INTO invoice_items (invoice_id, description, amount, item_type, organization_id)
SELECT id, 'Loyer mensuel', total, 'RENT', 2
FROM invoices
WHERE organization_id = 2;

INSERT INTO payments (invoice_id, payment_date, amount, payment_method, reference, receipt_number, payer_name, organization_id)
SELECT
  i.id,
  i.issue_date + ((i.id % 8) + 2),
  CASE WHEN i.status = 'PARTIAL' THEN ROUND((i.total * 0.45)::NUMERIC, 2) ELSE i.total END,
  CASE i.id % 3 WHEN 0 THEN 'CASH' WHEN 1 THEN 'BANK' ELSE 'MOBILE_MONEY' END,
  'PAY-DEMO-' || i.id,
  'REC-DEMO-' || LPAD(i.id::TEXT, 6, '0'),
  CONCAT(t.first_name, ' ', t.last_name),
  2
FROM invoices i
JOIN tenants t ON t.id = i.tenant_id
WHERE i.organization_id = 2 AND i.status IN ('PAID', 'PARTIAL');

INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, amount)
SELECT 2, p.id, p.invoice_id, p.amount
FROM payments p
WHERE p.organization_id = 2;

INSERT INTO employees (first_name, last_name, phone, email, job_title, monthly_salary, hire_date, status, organization_id)
VALUES
  ('Jean', 'Mukendi', '+243 81 300 1001', 'jean.mukendi@ng-erp-demo.local', 'Gestionnaire immeubles', 1200, '2024-02-01', 'ACTIVE', 2),
  ('Carine', 'Kabeya', '+243 81 300 1002', 'carine.kabeya@ng-erp-demo.local', 'Comptable', 1400, '2024-03-15', 'ACTIVE', 2),
  ('Joel', 'Kasongo', '+243 81 300 1003', 'joel.kasongo@ng-erp-demo.local', 'Technicien maintenance', 900, '2024-04-10', 'ACTIVE', 2),
  ('Nathalie', 'Bimpa', '+243 81 300 1004', 'nathalie.bimpa@ng-erp-demo.local', 'Assistante administrative', 850, '2024-05-20', 'ACTIVE', 2),
  ('Patrick', 'Tshiala', '+243 81 300 1005', 'patrick.tshiala@ng-erp-demo.local', 'Agent terrain', 780, '2024-07-01', 'ACTIVE', 2),
  ('Aline', 'Mavungu', '+243 81 300 1006', 'aline.mavungu@ng-erp-demo.local', 'Responsable stock', 820, '2024-08-01', 'ACTIVE', 2);

INSERT INTO salary_advances (employee_id, amount, advance_date, reason, status, organization_id)
SELECT id, CASE WHEN id % 2 = 0 THEN 180 ELSE 120 END, DATE '2026-06-18', 'Avance salaire demo', CASE WHEN id % 2 = 0 THEN 'PAID' ELSE 'PENDING' END, 2
FROM employees WHERE organization_id = 2 LIMIT 4;

INSERT INTO leaves (employee_id, start_date, end_date, leave_type, reason, status, organization_id)
SELECT id, DATE '2026-07-15', DATE '2026-07-20', 'Conges annuels', 'Repos planifie', CASE WHEN id % 2 = 0 THEN 'APPROVED' ELSE 'PENDING' END, 2
FROM employees WHERE organization_id = 2 LIMIT 4;

INSERT INTO payrolls (employee_id, month, year, gross_salary, advances_total, deductions_total, net_salary, status, payment_date, organization_id)
SELECT id, 6, 2026, monthly_salary, 0, 0, monthly_salary, 'PAID', DATE '2026-06-30', 2
FROM employees WHERE organization_id = 2;

INSERT INTO cash_sessions (opened_by, opened_at, opening_balance, closed_by, closed_at, closing_balance, expected_balance, difference_amount, status, organization_id)
SELECT u.id, TIMESTAMP '2026-07-01 08:00', 2500, u.id, TIMESTAMP '2026-07-01 18:00', 2500, 2500, 0, 'CLOSED', 2
FROM app_users u WHERE u.email = 'comptable@ng-erp-demo.local' AND u.organization_id = 2;

INSERT INTO cash_movements (cash_session_id, type, category, amount, movement_date, payment_id, invoice_id, tenant_id, description, reference, organization_id)
SELECT cs.id, 'IN', 'INVOICE_PAYMENT', p.amount, p.payment_date, p.id, p.invoice_id, i.tenant_id, 'Paiement facture demo', p.reference, 2
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
CROSS JOIN (SELECT id FROM cash_sessions WHERE organization_id = 2 LIMIT 1) cs
WHERE p.organization_id = 2
LIMIT 220;

INSERT INTO stock_categories (name, description, organization_id)
VALUES
  ('Plomberie', 'Pieces et consommables plomberie', 2),
  ('Electricite', 'Materiel electrique', 2),
  ('Peinture', 'Peinture et finition', 2),
  ('Entretien', 'Produits entretien', 2),
  ('Bureau', 'Fournitures administratives', 2)
ON CONFLICT DO NOTHING;

INSERT INTO stock_items (code, name, category, unit, current_quantity, minimum_quantity, purchase_price, average_purchase_price, description, status, organization_id)
VALUES
  ('ART-DEMO-001', 'Ampoule LED 12W', 'Electricite', 'piece', 85, 20, 3.50, 3.50, 'Ampoules pour parties communes', 'ACTIVE', 2),
  ('ART-DEMO-002', 'Robinet standard', 'Plomberie', 'piece', 18, 8, 12.00, 12.00, 'Robinetterie appartements', 'ACTIVE', 2),
  ('ART-DEMO-003', 'Peinture blanche 20L', 'Peinture', 'seau', 11, 5, 32.00, 32.00, 'Finition murs', 'ACTIVE', 2),
  ('ART-DEMO-004', 'Serrure securite', 'Entretien', 'piece', 6, 10, 18.00, 18.00, 'Stock sous minimum', 'ACTIVE', 2),
  ('ART-DEMO-005', 'Papier A4', 'Bureau', 'rame', 22, 6, 5.20, 5.20, 'Administration', 'ACTIVE', 2);

INSERT INTO stock_movements (stock_item_id, movement_number, type, quantity, movement_date, source, reference, notes, unit_price, quantity_before, quantity_after, organization_id)
SELECT id, 'MVT-DEMO-IN-' || id, 'IN', current_quantity, DATE '2026-06-01', 'Fournisseur demo', 'BL-DEMO-' || id, 'Stock initial demo', purchase_price, 0, current_quantity, 2
FROM stock_items WHERE organization_id = 2;

INSERT INTO maintenance_requests (request_number, title, description, category, priority, status, building_id, unit_id, tenant_id, reported_by_name, reported_at, due_date, diagnostic, estimated_cost, estimated_hours, actual_hours, organization_id)
SELECT
  'MNT-DEMO-' || LPAD(n::TEXT, 4, '0'),
  CASE n % 4 WHEN 0 THEN 'Fuite salle de bain' WHEN 1 THEN 'Panne electricite' WHEN 2 THEN 'Peinture a reprendre' ELSE 'Serrure defectueuse' END,
  'Signalement de maintenance demo',
  CASE n % 4 WHEN 0 THEN 'Plomberie' WHEN 1 THEN 'Electricite' WHEN 2 THEN 'Peinture' ELSE 'Serrurerie' END,
  CASE n % 5 WHEN 0 THEN 'URGENT' WHEN 1 THEN 'HIGH' ELSE 'NORMAL' END,
  CASE n % 6 WHEN 0 THEN 'RESOLVED' WHEN 1 THEN 'IN_PROGRESS' WHEN 2 THEN 'ASSIGNED' ELSE 'NEW' END,
  u.building_id, u.id, t.id, CONCAT(t.first_name, ' ', t.last_name),
  TIMESTAMP '2026-07-01 09:00' + (n || ' hours')::INTERVAL,
  TIMESTAMP '2026-07-05 18:00' + (n || ' hours')::INTERVAL,
  'Diagnostic initial enregistre', 45 + (n * 7), 2 + (n % 4), 1 + (n % 3), 2
FROM generate_series(1, 24) AS n
JOIN tenants t ON t.organization_id = 2 AND t.id = (SELECT id FROM tenants WHERE organization_id = 2 ORDER BY id OFFSET (n - 1) LIMIT 1)
JOIN units u ON u.id = t.unit_id;

INSERT INTO workflow_instances (type, entity_type, entity_id, title, requester_id, status, comment, organization_id)
SELECT 'MAINTENANCE_APPROVAL', 'maintenance_requests', mr.id, 'Validation maintenance ' || mr.request_number,
       (SELECT id FROM app_users WHERE organization_id = 2 AND role = 'STAFF' LIMIT 1),
       CASE WHEN mr.priority = 'URGENT' THEN 'PENDING' ELSE 'APPROVED' END,
       'Workflow demo', 2
FROM maintenance_requests mr
WHERE mr.organization_id = 2
LIMIT 12;

INSERT INTO notifications (user_id, title, message, priority, status, source, related_entity_type, related_entity_id, link_path, organization_id)
SELECT u.id, 'Alerte demo Property ERP', 'Factures et interventions a suivre aujourd''hui.', 'HIGH', 'UNREAD', 'INTERNAL', 'activity', NULL, '/activity', 2
FROM app_users u
WHERE u.organization_id = 2;

INSERT INTO message_templates (code, name, channel, subject, body, variables, status, organization_id)
VALUES
  ('INVOICE_REMINDER_DEMO', 'Relance facture demo', 'EMAIL', 'Relance facture {{invoice_number}}', 'Bonjour {{tenant_full_name}}, votre solde est de {{amount}} {{currency}}.', '["tenant_full_name","invoice_number","amount","currency"]'::JSONB, 'ACTIVE', 2),
  ('PAYMENT_RECEIPT_DEMO', 'Recu paiement demo', 'EMAIL', 'Recu paiement {{payment_number}}', 'Votre paiement a ete enregistre avec succes.', '["payment_number","amount"]'::JSONB, 'ACTIVE', 2)
ON CONFLICT (organization_id, code) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status;

INSERT INTO email_logs (recipient, subject, message, status, provider_response, related_entity_type, related_entity_id, sent_at, organization_id)
SELECT t.email, 'Relance facture demo', 'Envoi simule pour demonstration', 'SIMULATED', '{"provider":"local-demo"}'::JSONB, 'tenant', t.id, NOW(), 2
FROM tenants t
WHERE t.organization_id = 2
LIMIT 20;

COMMIT;
