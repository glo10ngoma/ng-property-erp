# Go-Live Cleanup

Date: 2026-07-13

This guide prepares a client tenant for production by removing all current business data for the approved target organization without touching the validated enterprise foundation.

Important: this cleanup is intended for a pre-production tenant that still contains demo business data. Do not run it on a tenant that already contains validated live operations.

## Scope

Artifacts added for go-live:

- `database/20260713_client_go_live_cleanup.sql`
- `database/20260713_minimal_production_seed.sql`

Nothing is deleted automatically. The cleanup SQL runs in dry-run mode by default because `execute_cleanup = FALSE`.
The cleanup now also requires a matching `confirmation_token` before any real deletion can start.

Current approved cleanup target:

- `organization_id = 1`
- `organization_slug = demo`
- preserved company settings: `CATALYSE`

## Inventory

### A. System data to keep

- `organizations`
- `app_users` definitive users
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `company_settings`
- `reference_data`
- `lease_contract_templates`
- `exchange_rates`
- `automation_settings`
- `workflow_definitions`
- `workflow_step_definitions`
- `message_templates`
- `stock_categories`
- `maintenance_categories`
- migration history and all SQL migration files

### B. Business data to clean

- Property:
  `buildings`, `units`, `tenants`, `leases`, `lease_guarantees`, `lease_documents`, `lease_contract_generations`
- Finance:
  `invoices`, `invoice_items`, `invoice_reminders`, `payments`, `payment_allocations`, `cash_sessions`, `cash_movements`
- Stock:
  `stock_items`, `stock_movements`, `stock_alerts`, `stock_documents`, `stock_document_lines`, `stock_movement_history`, `inventory_counts`, `inventory_count_lines`, `stock_purchases`, `stock_purchase_lines`, `stock_purchase_receipts`, `stock_purchase_receipt_lines`, `stock_purchase_payments`, `stock_purchase_timeline`
- Maintenance:
  `maintenance_requests`, `maintenance_assignments`, `maintenance_timeline`, `maintenance_documents`, `maintenance_expenses`
- Workflow runtime:
  `workflow_instances`, `workflow_steps`, `workflow_actions`
- Communication runtime:
  `notifications`, `email_logs`, `sms_logs`, `whatsapp_logs`
- HR runtime:
  `employees`, `employee_contracts`, `employee_attendance`, `employee_monthly_attendance`, `salary_advances`, `leaves`, `payrolls`
- Automation runtime:
  `automation_runs`, `automation_run_items`
- Audit:
  `audit_logs`

## Backup Procedure

Run all of this before any cleanup execution.

### 1. PostgreSQL dump

Recommended commands:

```bash
pg_dump --format=custom --file=backup_ng_property_pre_cleanup.dump "$DATABASE_URL"
pg_dump --format=plain --schema-only --file=backup_ng_property_schema.sql "$DATABASE_URL"
```

### 2. Critical table exports

At minimum export:

- `organizations`
- `app_users`
- `company_settings`
- `reference_data`
- `lease_contract_templates`
- `exchange_rates`
- `automation_settings`

Recommended pattern:

```sql
COPY (
  SELECT *
  FROM company_settings
  WHERE organization_id = <CLIENT_ORG_ID>
) TO STDOUT WITH CSV HEADER;
```

### 3. Storage inventory

Prepare a manual inventory of Storage objects before deletion.

Buckets / paths already used by the app:

- Company files:
  `company/<organization_id>/logo/...`
  `company/<organization_id>/signature/...`
  `company/<organization_id>/stamp/...`
- Lease contracts:
  `contracts/<organization_id>/leases/...`
- Legacy lease contract path:
  `leases/<organization_id>/contracts/...`

### 4. Manual confirmation

Do not switch `execute_cleanup` to `TRUE` before validating:

- target organization id and slug
- confirmation token for the exact organization
- definitive users to keep
- official company files to preserve
- latest active lease contract template

## Dry Run

Open `database/20260713_client_go_live_cleanup.sql` and update:

- `organization_id`
- `organization_slug`
- optional `cleanup_keep_users`

Keep:

```sql
execute_cleanup = FALSE
```

Then run the script.

Review:

- dry-run counts by table
- current rows / rows to delete / rows to remain
- dependency note per table
- Storage impact note per table
- users to review only
- official files to preserve
- business file candidates to remove from Storage

## Cleanup Execution

Only after backup and dry-run validation:

1. Change `execute_cleanup` to `TRUE`
2. Set `confirmation_token = 'DELETE_TEST_DATA_FOR_ORG_<ID>'`
3. Re-run the same SQL script
4. Review the deletion summary returned at the end

The script:

- deletes in dependency order
- only targets the selected `organization_id`
- validates the exact `organization_id + slug` pair
- blocks accidental second execution if the dry run finds nothing to delete
- preserves settings and template tables
- resets business sequences when the cleanup really executes

## Storage Handling

### Preserve

Never delete:

- company logo
- company signature
- company stamp
- official Word lease template

### Review and delete after DB cleanup

The SQL script already lists DB-linked business files to review, including:

- generated lease DOCX / PDF
- lease uploaded documents
- maintenance documents
- stock document attachments
- employee contract files

Delete those objects from Storage only after the database cleanup succeeds.

## Minimal Production Seed

`database/20260713_minimal_production_seed.sql` provides a clean starting point with:

- one organization
- roles `ADMIN`, `EDITOR`, `VIEWER`
- company settings
- USD/CDF exchange rate
- `automation_settings` disabled by default
- active residential lease template copied from the latest available version

Notes:

- It does not create any fake building, unit, tenant, lease, invoice, payment, stock, maintenance, or HR data.
- Definitive admin creation is left as an explicit manual step because email and password policy are client-specific.
- Global permissions must already exist from the migration chain.

## Sequences Reset by Cleanup

The cleanup script resets business sequences for:

- automation runs
- invoices / payments / cash
- generated lease contracts and lease documents
- stock operations and purchases
- maintenance runtime tables
- HR runtime tables
- workflow runtime tables
- notifications / communication logs
- audit logs
- buildings / units / tenants / leases

It does not reset:

- organizations
- app users
- roles
- permissions
- reference data
- company settings
- exchange rates
- lease contract templates
- automation settings

## Post-Cleanup QA Checklist

Run this checklist after cleanup and minimal seed:

1. Login
2. Settings page opens and shows saved company data
3. Exchange rate still loads
4. Create building
5. Create unit
6. Create tenant
7. Create lease
8. Generate Word lease contract
9. Create invoice
10. Register payment
11. Verify cash movement
12. Open tenant statement
13. Verify roles and permissions still work

## Recommended Operator Flow

1. Backup database
2. Export critical tables
3. Inventory Storage
4. Run cleanup script in dry-run mode
5. Validate counts and preservation list
6. Switch `execute_cleanup` to `TRUE`
7. Set the matching `confirmation_token`
8. Run cleanup script again
9. Remove business Storage files
10. Run minimal production seed if needed
11. Execute the post-cleanup QA checklist
