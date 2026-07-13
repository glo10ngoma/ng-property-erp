-- NG Property ERP - Controlled go-live cleanup
-- ------------------------------------------------------------
-- Purpose:
--   Remove demonstration business data for one organization
--   while preserving system configuration and definitive settings.
--
-- Safety:
--   1. Run the dry run first.
--   2. Take a full PostgreSQL dump and Storage inventory before cleanup.
--   3. Keep execute_cleanup = FALSE until manual validation is complete.
--
-- Scope kept:
--   organizations
--   app_users
--   roles / permissions / user_roles / role_permissions
--   company_settings
--   reference_data
--   lease_contract_templates
--   exchange_rates
--   automation_settings
--   workflow_definitions / workflow_step_definitions
--   message_templates
--   stock_categories / maintenance_categories
--
-- Scope cleaned:
--   buildings, units, tenants, leases, generated contracts
--   invoices, payments, cash, stock operations, purchases, inventories
--   maintenance, HR business data, workflow instances, communications logs
--   notifications, automation run history, audit logs

BEGIN;

CREATE TEMP TABLE cleanup_scope (
  organization_id INTEGER NOT NULL,
  organization_slug TEXT NOT NULL,
  confirmation_token TEXT,
  execute_cleanup BOOLEAN NOT NULL DEFAULT FALSE
) ON COMMIT DROP;

-- -----------------------------------------------------------------
-- IMPORTANT
-- Replace the organization_id / slug below with the client target.
-- Keep execute_cleanup = FALSE for dry run.
-- Set execute_cleanup = TRUE only after backup + manual validation.
-- The confirmation token must remain NULL until the final human validation.
-- -----------------------------------------------------------------
INSERT INTO cleanup_scope (organization_id, organization_slug, confirmation_token, execute_cleanup)
VALUES (1, 'demo', NULL, FALSE);

CREATE TEMP TABLE cleanup_keep_users (
  email TEXT PRIMARY KEY
) ON COMMIT DROP;

-- Optional: keep definitive users here for manual review queries.
-- INSERT INTO cleanup_keep_users (email) VALUES
--   ('admin@client.tld'),
--   ('direction@client.tld');

CREATE TEMP TABLE cleanup_plan (
  sort_order INTEGER NOT NULL,
  relation_name TEXT NOT NULL,
  label TEXT NOT NULL,
  count_sql TEXT NOT NULL,
  delete_sql TEXT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE cleanup_preview (
  sort_order INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  rows_to_delete BIGINT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE cleanup_totals (
  sort_order INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  total_rows BIGINT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE cleanup_deleted (
  sort_order INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  rows_deleted BIGINT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE cleanup_sequences (
  sequence_name TEXT NOT NULL,
  table_name TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  matches INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO matches
  FROM organizations o
  JOIN cleanup_scope s
    ON s.organization_id = o.id
   AND s.organization_slug = o.slug;

  IF matches = 0 THEN
    RAISE EXCEPTION 'cleanup_scope does not match any organization by id + slug';
  END IF;

  IF matches > 1 THEN
    RAISE EXCEPTION 'cleanup_scope matches more than one organization';
  END IF;
END $$;

INSERT INTO cleanup_plan (sort_order, relation_name, label, count_sql, delete_sql)
VALUES
  (
    10,
    'automation_run_items',
    'automation_run_items',
    $$SELECT COUNT(*)
      FROM automation_run_items ari
      JOIN automation_runs ar ON ar.id = ari.automation_run_id
      WHERE ar.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM automation_run_items ari
      USING automation_runs ar
      WHERE ari.automation_run_id = ar.id
        AND ar.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    20,
    'automation_runs',
    'automation_runs',
    $$SELECT COUNT(*)
      FROM automation_runs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM automation_runs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    30,
    'invoice_reminders',
    'invoice_reminders',
    $$SELECT COUNT(*)
      FROM invoice_reminders
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM invoice_reminders
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    40,
    'payment_allocations',
    'payment_allocations',
    $$SELECT COUNT(*)
      FROM payment_allocations
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM payment_allocations
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    50,
    'lease_contract_generations',
    'lease_contract_generations',
    $$SELECT COUNT(*)
      FROM lease_contract_generations
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM lease_contract_generations
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    60,
    'lease_documents',
    'lease_documents',
    $$SELECT COUNT(*)
      FROM lease_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM lease_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    70,
    'lease_guarantees',
    'lease_guarantees',
    $$SELECT COUNT(*)
      FROM lease_guarantees
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM lease_guarantees
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    80,
    'stock_movement_history',
    'stock_movement_history',
    $$SELECT COUNT(*)
      FROM stock_movement_history
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_movement_history
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    90,
    'stock_document_lines',
    'stock_document_lines',
    $$SELECT COUNT(*)
      FROM stock_document_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_document_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    100,
    'stock_purchase_receipt_lines',
    'stock_purchase_receipt_lines',
    $$SELECT COUNT(*)
      FROM stock_purchase_receipt_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchase_receipt_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    110,
    'stock_purchase_payments',
    'stock_purchase_payments',
    $$SELECT COUNT(*)
      FROM stock_purchase_payments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchase_payments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    120,
    'stock_purchase_timeline',
    'stock_purchase_timeline',
    $$SELECT COUNT(*)
      FROM stock_purchase_timeline
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchase_timeline
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    130,
    'maintenance_documents',
    'maintenance_documents',
    $$SELECT COUNT(*)
      FROM maintenance_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM maintenance_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    140,
    'maintenance_expenses',
    'maintenance_expenses',
    $$SELECT COUNT(*)
      FROM maintenance_expenses
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM maintenance_expenses
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    150,
    'maintenance_timeline',
    'maintenance_timeline',
    $$SELECT COUNT(*)
      FROM maintenance_timeline
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM maintenance_timeline
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    160,
    'maintenance_assignments',
    'maintenance_assignments',
    $$SELECT COUNT(*)
      FROM maintenance_assignments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM maintenance_assignments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    170,
    'cash_movements',
    'cash_movements',
    $$SELECT COUNT(*)
      FROM cash_movements
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM cash_movements
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    180,
    'payments',
    'payments',
    $$SELECT COUNT(*)
      FROM payments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM payments
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    190,
    'invoice_items',
    'invoice_items',
    $$SELECT COUNT(*)
      FROM invoice_items
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM invoice_items
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    200,
    'invoices',
    'invoices',
    $$SELECT COUNT(*)
      FROM invoices
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM invoices
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    210,
    'stock_movements',
    'stock_movements',
    $$SELECT COUNT(*)
      FROM stock_movements
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_movements
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    220,
    'stock_purchase_receipts',
    'stock_purchase_receipts',
    $$SELECT COUNT(*)
      FROM stock_purchase_receipts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchase_receipts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    230,
    'stock_purchase_lines',
    'stock_purchase_lines',
    $$SELECT COUNT(*)
      FROM stock_purchase_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchase_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    240,
    'stock_purchases',
    'stock_purchases',
    $$SELECT COUNT(*)
      FROM stock_purchases
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_purchases
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    250,
    'stock_documents',
    'stock_documents',
    $$SELECT COUNT(*)
      FROM stock_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_documents
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    260,
    'stock_alerts',
    'stock_alerts',
    $$SELECT COUNT(*)
      FROM stock_alerts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_alerts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    270,
    'inventory_count_lines',
    'inventory_count_lines',
    $$SELECT COUNT(*)
      FROM inventory_count_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM inventory_count_lines
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    280,
    'inventory_counts',
    'inventory_counts',
    $$SELECT COUNT(*)
      FROM inventory_counts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM inventory_counts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    290,
    'employee_contracts',
    'employee_contracts',
    $$SELECT COUNT(*)
      FROM employee_contracts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM employee_contracts
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    300,
    'employee_attendance',
    'employee_attendance',
    $$SELECT COUNT(*)
      FROM employee_attendance
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM employee_attendance
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    310,
    'payrolls',
    'payrolls',
    $$SELECT COUNT(*)
      FROM payrolls
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM payrolls
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    320,
    'employee_monthly_attendance',
    'employee_monthly_attendance',
    $$SELECT COUNT(*)
      FROM employee_monthly_attendance
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM employee_monthly_attendance
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    330,
    'salary_advances',
    'salary_advances',
    $$SELECT COUNT(*)
      FROM salary_advances
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM salary_advances
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    340,
    'leaves',
    'leaves',
    $$SELECT COUNT(*)
      FROM leaves
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM leaves
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    350,
    'employees',
    'employees',
    $$SELECT COUNT(*)
      FROM employees
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM employees
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    360,
    'maintenance_requests',
    'maintenance_requests',
    $$SELECT COUNT(*)
      FROM maintenance_requests
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM maintenance_requests
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    370,
    'workflow_actions',
    'workflow_actions',
    $$SELECT COUNT(*)
      FROM workflow_actions
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM workflow_actions
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    380,
    'workflow_steps',
    'workflow_steps',
    $$SELECT COUNT(*)
      FROM workflow_steps
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM workflow_steps
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    390,
    'workflow_instances',
    'workflow_instances',
    $$SELECT COUNT(*)
      FROM workflow_instances
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM workflow_instances
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    400,
    'cash_sessions',
    'cash_sessions',
    $$SELECT COUNT(*)
      FROM cash_sessions
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM cash_sessions
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    410,
    'stock_items',
    'stock_items',
    $$SELECT COUNT(*)
      FROM stock_items
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM stock_items
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    420,
    'leases',
    'leases',
    $$SELECT COUNT(*)
      FROM leases
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM leases
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    430,
    'tenants',
    'tenants',
    $$SELECT COUNT(*)
      FROM tenants
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM tenants
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    440,
    'units',
    'units',
    $$SELECT COUNT(*)
      FROM units
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM units
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    450,
    'buildings',
    'buildings',
    $$SELECT COUNT(*)
      FROM buildings
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM buildings
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    460,
    'notifications',
    'notifications',
    $$SELECT COUNT(*)
      FROM notifications
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM notifications
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    470,
    'email_logs',
    'email_logs',
    $$SELECT COUNT(*)
      FROM email_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM email_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    480,
    'sms_logs',
    'sms_logs',
    $$SELECT COUNT(*)
      FROM sms_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM sms_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    490,
    'whatsapp_logs',
    'whatsapp_logs',
    $$SELECT COUNT(*)
      FROM whatsapp_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM whatsapp_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  ),
  (
    500,
    'audit_logs',
    'audit_logs',
    $$SELECT COUNT(*)
      FROM audit_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$,
    $$DELETE FROM audit_logs
      WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)$$
  );

INSERT INTO cleanup_sequences (sequence_name, table_name)
VALUES
  ('automation_runs_id_seq', 'automation_runs'),
  ('automation_run_items_id_seq', 'automation_run_items'),
  ('invoice_reminders_id_seq', 'invoice_reminders'),
  ('payment_allocations_id_seq', 'payment_allocations'),
  ('lease_contract_generations_id_seq', 'lease_contract_generations'),
  ('lease_documents_id_seq', 'lease_documents'),
  ('lease_guarantees_id_seq', 'lease_guarantees'),
  ('stock_movement_history_id_seq', 'stock_movement_history'),
  ('stock_document_lines_id_seq', 'stock_document_lines'),
  ('stock_purchase_receipt_lines_id_seq', 'stock_purchase_receipt_lines'),
  ('stock_purchase_payments_id_seq', 'stock_purchase_payments'),
  ('stock_purchase_timeline_id_seq', 'stock_purchase_timeline'),
  ('maintenance_documents_id_seq', 'maintenance_documents'),
  ('maintenance_expenses_id_seq', 'maintenance_expenses'),
  ('maintenance_timeline_id_seq', 'maintenance_timeline'),
  ('maintenance_assignments_id_seq', 'maintenance_assignments'),
  ('cash_movements_id_seq', 'cash_movements'),
  ('payments_id_seq', 'payments'),
  ('invoice_items_id_seq', 'invoice_items'),
  ('invoices_id_seq', 'invoices'),
  ('stock_movements_id_seq', 'stock_movements'),
  ('stock_purchase_receipts_id_seq', 'stock_purchase_receipts'),
  ('stock_purchase_lines_id_seq', 'stock_purchase_lines'),
  ('stock_purchases_id_seq', 'stock_purchases'),
  ('stock_documents_id_seq', 'stock_documents'),
  ('stock_alerts_id_seq', 'stock_alerts'),
  ('inventory_count_lines_id_seq', 'inventory_count_lines'),
  ('inventory_counts_id_seq', 'inventory_counts'),
  ('employee_contracts_id_seq', 'employee_contracts'),
  ('employee_attendance_id_seq', 'employee_attendance'),
  ('payrolls_id_seq', 'payrolls'),
  ('employee_monthly_attendance_id_seq', 'employee_monthly_attendance'),
  ('salary_advances_id_seq', 'salary_advances'),
  ('leaves_id_seq', 'leaves'),
  ('employees_id_seq', 'employees'),
  ('maintenance_requests_id_seq', 'maintenance_requests'),
  ('workflow_actions_id_seq', 'workflow_actions'),
  ('workflow_steps_id_seq', 'workflow_steps'),
  ('workflow_instances_id_seq', 'workflow_instances'),
  ('cash_sessions_id_seq', 'cash_sessions'),
  ('stock_items_id_seq', 'stock_items'),
  ('leases_id_seq', 'leases'),
  ('tenants_id_seq', 'tenants'),
  ('units_id_seq', 'units'),
  ('buildings_id_seq', 'buildings'),
  ('notifications_id_seq', 'notifications'),
  ('email_logs_id_seq', 'email_logs'),
  ('sms_logs_id_seq', 'sms_logs'),
  ('whatsapp_logs_id_seq', 'whatsapp_logs'),
  ('audit_logs_id_seq', 'audit_logs');

DO $$
DECLARE
  item RECORD;
  row_count BIGINT;
  total_rows BIGINT;
BEGIN
  DELETE FROM cleanup_preview;
  DELETE FROM cleanup_totals;

  FOR item IN
    SELECT *
    FROM cleanup_plan
    ORDER BY sort_order
  LOOP
    IF to_regclass(item.relation_name) IS NULL THEN
      INSERT INTO cleanup_preview (sort_order, table_name, rows_to_delete)
      VALUES (item.sort_order, item.label, 0);
      INSERT INTO cleanup_totals (sort_order, table_name, total_rows)
      VALUES (item.sort_order, item.label, 0);
    ELSE
      EXECUTE item.count_sql INTO row_count;
      EXECUTE format('SELECT COUNT(*) FROM %I', item.relation_name) INTO total_rows;
      INSERT INTO cleanup_preview (sort_order, table_name, rows_to_delete)
      VALUES (item.sort_order, item.label, COALESCE(row_count, 0));
      INSERT INTO cleanup_totals (sort_order, table_name, total_rows)
      VALUES (item.sort_order, item.label, COALESCE(total_rows, 0));
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------
-- DRY RUN RESULT
-- -----------------------------------------------------------------
SELECT
  o.id AS organization_id,
  o.slug,
  o.name,
  s.execute_cleanup
FROM cleanup_scope s
JOIN organizations o ON o.id = s.organization_id;

SELECT
  p.sort_order,
  p.table_name,
  t.total_rows,
  p.rows_to_delete,
  GREATEST(t.total_rows - p.rows_to_delete, 0) AS rows_to_remain,
  CASE
    WHEN p.table_name IN ('buildings', 'units', 'tenants', 'leases', 'lease_guarantees') THEN 'Immobilier - depend des baux, locataires et unites'
    WHEN p.table_name IN ('lease_documents', 'lease_contract_generations') THEN 'Documents de bail relies aux baux'
    WHEN p.table_name IN ('invoices', 'invoice_items', 'invoice_reminders', 'payments', 'payment_allocations') THEN 'Finance - depend des factures, paiements et baux'
    WHEN p.table_name IN ('cash_sessions', 'cash_movements') THEN 'Caisse - depend des paiements et depenses'
    WHEN p.table_name IN ('stock_items', 'stock_movements', 'stock_alerts', 'stock_documents', 'stock_document_lines', 'stock_movement_history', 'stock_purchases', 'stock_purchase_lines', 'stock_purchase_receipts', 'stock_purchase_receipt_lines', 'stock_purchase_payments', 'stock_purchase_timeline', 'inventory_counts', 'inventory_count_lines') THEN 'Stock - depend des articles, documents, achats et inventaires'
    WHEN p.table_name IN ('maintenance_requests', 'maintenance_assignments', 'maintenance_timeline', 'maintenance_documents', 'maintenance_expenses') THEN 'Maintenance - depend des interventions et couts'
    WHEN p.table_name IN ('employees', 'employee_contracts', 'employee_attendance', 'employee_monthly_attendance', 'salary_advances', 'leaves', 'payrolls') THEN 'RH - depend des employes, pointages et paies'
    WHEN p.table_name IN ('workflow_instances', 'workflow_steps', 'workflow_actions') THEN 'Workflow runtime - depend des executions'
    WHEN p.table_name IN ('notifications', 'email_logs', 'sms_logs', 'whatsapp_logs') THEN 'Communication runtime - depend des envois et notifications'
    WHEN p.table_name IN ('automation_runs', 'automation_run_items') THEN 'Automation runtime - depend des executions automatiques'
    WHEN p.table_name = 'audit_logs' THEN 'Audit transverse lie aux operations metier de demonstration'
    ELSE 'Suppression ciblee par organization_id ou lien parent'
  END AS dependency_note,
  CASE
    WHEN p.table_name = 'lease_contract_generations' THEN 'Storage potentiel: contrats DOCX/PDF generes'
    WHEN p.table_name = 'lease_documents' THEN 'Storage potentiel: documents de bail'
    WHEN p.table_name = 'maintenance_documents' THEN 'Storage potentiel: pieces jointes maintenance'
    WHEN p.table_name = 'stock_documents' THEN 'Storage potentiel: pieces jointes stock'
    WHEN p.table_name = 'employee_contracts' THEN 'Storage potentiel: contrats employes'
    ELSE 'Pas de fichier Storage direct inventorie dans ce script'
  END AS storage_scope
FROM cleanup_preview p
JOIN cleanup_totals t
  ON t.sort_order = p.sort_order
 AND t.table_name = p.table_name
ORDER BY p.sort_order;

SELECT
  'app_users_to_review_only' AS table_name,
  COUNT(*) AS rows_to_review
FROM app_users u
WHERE u.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
  AND NOT EXISTS (
    SELECT 1
    FROM cleanup_keep_users k
    WHERE LOWER(k.email) = LOWER(u.email)
  );

-- Official files to preserve.
SELECT
  'company_settings' AS source_table,
  'logo' AS file_kind,
  cs.logo_file_name AS file_name,
  cs.logo_file_url AS file_url
FROM company_settings cs
WHERE cs.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
  AND cs.deleted_at IS NULL
  AND cs.logo_file_name IS NOT NULL
UNION ALL
SELECT
  'company_settings',
  'signature',
  cs.signature_file_name,
  cs.signature_file_url
FROM company_settings cs
WHERE cs.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
  AND cs.deleted_at IS NULL
  AND cs.signature_file_name IS NOT NULL
UNION ALL
SELECT
  'company_settings',
  'stamp',
  cs.stamp_file_name,
  cs.stamp_file_url
FROM company_settings cs
WHERE cs.organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
  AND cs.deleted_at IS NULL
  AND cs.stamp_file_name IS NOT NULL;

-- Business files that may be removed from Storage after DB cleanup.
SELECT *
FROM (
  SELECT
    'lease_documents' AS source_table,
    document_type AS file_kind,
    file_name,
    file_url,
    NULL::TEXT AS storage_path
  FROM lease_documents
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)

  UNION ALL

  SELECT
    'lease_contract_generations',
    'DOCX',
    docx_file_name,
    docx_file_url,
    docx_storage_path
  FROM lease_contract_generations
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
    AND docx_file_name IS NOT NULL

  UNION ALL

  SELECT
    'lease_contract_generations',
    'PDF',
    pdf_file_name,
    pdf_file_url,
    NULL::TEXT
  FROM lease_contract_generations
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
    AND pdf_file_name IS NOT NULL

  UNION ALL

  SELECT
    'maintenance_documents',
    document_type,
    file_name,
    file_url,
    NULL::TEXT
  FROM maintenance_documents
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)

  UNION ALL

  SELECT
    'stock_documents',
    document_type,
    attachment_file_name,
    attachment_file_url,
    NULL::TEXT
  FROM stock_documents
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
    AND attachment_file_name IS NOT NULL

  UNION ALL

  SELECT
    'employee_contracts',
    'CONTRACT',
    contract_file_name,
    contract_file_url,
    NULL::TEXT
  FROM employee_contracts
  WHERE organization_id = (SELECT organization_id FROM cleanup_scope LIMIT 1)
    AND contract_file_name IS NOT NULL
) files_to_review
ORDER BY source_table, file_name;

DO $$
DECLARE
  item RECORD;
  row_count BIGINT;
  sequence_row RECORD;
  execute_cleanup_flag BOOLEAN;
  confirmation_token_value TEXT;
  expected_token TEXT;
  target_org_id INTEGER;
  planned_rows BIGINT;
BEGIN
  SELECT cs.organization_id, cs.execute_cleanup, cs.confirmation_token
  INTO target_org_id, execute_cleanup_flag, confirmation_token_value
  FROM cleanup_scope cs
  LIMIT 1;

  IF NOT execute_cleanup_flag THEN
    RAISE NOTICE 'Dry run only. No DELETE executed because cleanup_scope.execute_cleanup = FALSE.';
    RETURN;
  END IF;

  expected_token := format('DELETE_TEST_DATA_FOR_ORG_%s', target_org_id);

  IF confirmation_token_value IS NULL OR confirmation_token_value <> expected_token THEN
    RAISE EXCEPTION 'Cleanup blocked: confirmation_token must equal %', expected_token;
  END IF;

  SELECT COALESCE(SUM(rows_to_delete), 0)
  INTO planned_rows
  FROM cleanup_preview;

  IF planned_rows = 0 THEN
    RAISE EXCEPTION 'Cleanup blocked: dry run found 0 rows to delete. Possible second execution or wrong target.';
  END IF;

  DELETE FROM cleanup_deleted;

  FOR item IN
    SELECT *
    FROM cleanup_plan
    ORDER BY sort_order
  LOOP
    IF to_regclass(item.relation_name) IS NULL THEN
      INSERT INTO cleanup_deleted (sort_order, table_name, rows_deleted)
      VALUES (item.sort_order, item.label, 0);
    ELSE
      EXECUTE item.delete_sql;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      INSERT INTO cleanup_deleted (sort_order, table_name, rows_deleted)
      VALUES (item.sort_order, item.label, COALESCE(row_count, 0));
    END IF;
  END LOOP;

  FOR sequence_row IN
    SELECT *
    FROM cleanup_sequences
  LOOP
    IF to_regclass(sequence_row.sequence_name) IS NOT NULL
       AND to_regclass(sequence_row.table_name) IS NOT NULL THEN
      EXECUTE format(
        'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 1), COALESCE((SELECT MAX(id) FROM %I), 0) > 0)',
        sequence_row.sequence_name,
        sequence_row.table_name,
        sequence_row.table_name
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------
-- EXECUTION SUMMARY
-- -----------------------------------------------------------------
SELECT
  sort_order,
  table_name,
  rows_deleted
FROM cleanup_deleted
ORDER BY sort_order;

SELECT
  COALESCE(SUM(rows_deleted), 0) AS total_rows_deleted
FROM cleanup_deleted;

COMMIT;
