# Go-Live Pre-Cleanup Audit

Date: 2026-07-13

Status before execution: `NO-GO`

Reason:
- the client decision is now explicit: all current business data for organization `1 / demo` must be purged;
- the cleanup script is aligned with that scope and remains in strict dry-run mode;
- the real purge must still not run until backup is confirmed and the dry-run volumes are manually validated.

## 1. Scope Confirmed

Target organization:

- `organization_id = 1`
- `organization_slug = demo`
- current organization name: `Demo Property ERP`
- preserved company settings: `CATALYSE`

Client decision confirmed for this scope:

- purge 100% of current business data for this organization;
- preserve the enterprise foundation only.

## 2. Script State

Audited file:

- `database/20260713_client_go_live_cleanup.sql`

Safety state:

- `execute_cleanup = FALSE`
- `confirmation_token = NULL`
- organization validation by exact `organization_id + organization_slug`
- global transaction enabled
- dry-run preview enabled
- cleanup blocked if dry run finds `0` rows to delete
- no `TRUNCATE`
- no unscoped `DELETE`

Real cleanup executed by Codex:

- `No`

## 3. Preserved Foundation

The cleanup script preserves:

- `organizations`
- `app_users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `company_settings`
- `exchange_rates`
- `lease_contract_templates`
- `reference_data`
- `automation_settings`
- `workflow_definitions`
- `workflow_step_definitions`
- `message_templates`
- `stock_categories`
- `maintenance_categories`

Verified preserved configuration in the connected database:

- company name: `CATALYSE`
- active exchange rate found: `USD/CDF = 2250`
- active lease template: `LEASE_RESIDENTIAL` version `6`
- organization users present: `5`
- official logo currently stored: `ChatGPT Image 25 juin 2026, 23_30_14.png`

## 4. Dry Run Result

Dry run executed with:

- `execute_cleanup = FALSE`

Outcome:

- matched organization: `1 / demo`
- database rows deleted: `0`
- script remained non-destructive

Dry-run deletion volumes confirmed:

| Table | Would delete |
|---|---:|
| buildings | 8 |
| units | 49 |
| tenants | 44 |
| leases | 47 |
| lease_guarantees | 47 |
| lease_documents | 12 |
| lease_contract_generations | 10 |
| invoices | 139 |
| invoice_items | 261 |
| payments | 62 |
| payment_allocations | 62 |
| invoice_reminders | 2 |
| cash_movements | 74 |
| cash_sessions | 1 |
| stock_items | 4 |
| stock_movements | 16 |
| stock_documents | 4 |
| stock_document_lines | 8 |
| stock_movement_history | 14 |
| inventory_counts | 4 |
| inventory_count_lines | 9 |
| maintenance_requests | 4 |
| maintenance_assignments | 4 |
| maintenance_timeline | 13 |
| employees | 3 |
| employee_monthly_attendance | 5 |
| payrolls | 5 |
| notifications | 3 |
| email_logs | 4 |
| sms_logs | 3 |
| whatsapp_logs | 4 |
| audit_logs | 301 |

All populated business tables in scope would be emptied for organization `1`.

## 5. Storage Review

Files to preserve:

- company logo
- company signature if later uploaded
- company stamp if later uploaded
- official contract template(s)

Business files identified as removable after DB cleanup:

- generated lease DOCX/PDF files
- lease uploaded documents
- stock business attachments
- any maintenance or HR business attachments if present

No Storage deletion was executed during this audit.

## 6. Backup State

Confirmed by Codex:

- database connectivity: `OK`
- read-only SQL inventory: `OK`
- read-only Storage inventory: `OK`

Not yet confirmed:

- full PostgreSQL dump
- CSV exports of preserved configuration tables
- downloaded copy of preserved Storage files

Backup state:

- `NOT CONFIRMED`

## 7. GO / NO-GO

Current status: `NO-GO`

Reason for `NO-GO`:

- the purge target is now correct;
- the dry run is correct;
- but backup is still not confirmed.

## 8. Conditions for GO

Before the real purge can be authorized:

1. confirm full Supabase / PostgreSQL backup;
2. export preserved configuration tables;
3. confirm preserved Storage files:
   - logo
   - signature if present
   - stamp if present
   - official contract template(s);
4. validate the dry-run row counts table by table;
5. set the exact confirmation token:
   - `DELETE_TEST_DATA_FOR_ORG_1`
6. execute once only;
7. return the script immediately to:
   - `execute_cleanup = FALSE`
   - `confirmation_token = NULL`

## 9. Post-Purge Acceptance Checklist

After human-approved execution, validate:

1. admin login;
2. Settings page still shows `CATALYSE`;
3. active exchange rate still loads;
4. lease template still exists;
5. dashboard opens with no demo rows;
6. create building;
7. create unit;
8. create tenant;
9. create lease;
10. generate Word lease contract;
11. create invoice;
12. register payment;
13. verify cash movement;
14. verify no demo data remains.
