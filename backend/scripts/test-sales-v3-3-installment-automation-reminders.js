const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function includesAll(haystack, needles, context) {
  for (const needle of needles) {
    assert(haystack.includes(needle), `${context}: missing "${needle}"`);
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const migration = read(path.join(root, '..', 'database', '20260826_sales_v3_3_installment_automation_reminders.sql'));
  const dto = read(path.join(root, 'src', 'sales', 'dto.ts'));
  const controller = read(path.join(root, 'src', 'sales', 'sales.controller.ts'));
  const financials = read(path.join(root, 'src', 'sales', 'sales-financials.service.ts'));
  const moduleFile = read(path.join(root, 'src', 'sales', 'sales.module.ts'));
  const scheduler = read(path.join(root, 'src', 'sales', 'sales-automation.scheduler.ts'));
  const service = read(path.join(root, 'src', 'sales', 'sales-automation.service.ts'));
  const repository = read(path.join(root, 'src', 'sales', 'sales.repository.ts'));
  const emailService = read(path.join(root, 'src', 'communication', 'email', 'email.service.ts'));
  const guard = read(path.join(root, 'src', 'auth', 'permissions.guard.ts'));
  const permissions = read(path.join(root, 'src', 'saas', 'permissions.ts'));
  const router = read(path.join(root, '..', 'frontend', 'src', 'app', 'router.tsx'));
  const ui = read(path.join(root, '..', 'frontend', 'src', 'modules', 'sales', 'components', 'SalesUi.tsx'));
  const api = read(path.join(root, '..', 'frontend', 'src', 'modules', 'sales', 'api', 'sales.api.ts'));

  assert(!/\bDROP\s+TABLE\b/i.test(migration), 'migration must not contain DROP TABLE');
  assert(!/\bTRUNCATE\b/i.test(migration), 'migration must not contain TRUNCATE');
  assert(!/^\s*DELETE\s+/im.test(migration), 'migration must not contain DELETE');
  assert(!/^\s*UPDATE\s+/im.test(migration), 'migration must not contain UPDATE');

  includesAll(migration, [
    'ALTER TABLE sales_settings',
    'sales_installment_automation_enabled',
    'sales_auto_generate_invoice_days_before',
    'sales_auto_send_invoice',
    'sales_reminders_enabled',
    'sales_collection_email_mode',
    'CREATE TABLE IF NOT EXISTS sales_automation_runs',
    'CREATE TABLE IF NOT EXISTS sales_invoice_reminders',
    'FOREIGN KEY (invoice_id, organization_id)',
    'FOREIGN KEY (subscription_id, organization_id)',
    'ENABLE ROW LEVEL SECURITY',
  ], 'migration');

  includesAll(dto, [
    'export class SalesAutomationRunListQueryDto',
    'export class SalesAutomationExecuteDto',
    'export class SalesInvoiceReminderListQueryDto',
    'export class SendSalesInvoiceReminderDto',
    'export class SalesCollectionsQueryDto',
  ], 'dto');

  includesAll(service, [
    'runSchedulerTick(',
    'dryRunInstallments(',
    'runInstallments(',
    'dryRunReminders(',
    'runReminders(',
    'listRuns(',
    'listInvoiceReminders(',
    'sendInvoiceReminder(',
    'getCollections(',
    'runScheduledInstallmentsForOrganization(',
    'runScheduledRemindersForOrganization(',
    'resolveOrganizationClock(',
    'resolvePeriodKeyForOrganization(',
    'prepareAutomationRun(',
    'touchAutomationRunHeartbeat',
    'tryAcquireAutomationLock',
    'resolveReminderDeliveryOutcome(',
    'resolveReminderFailureCode(',
  ], 'service');

  includesAll(repository, [
    'listOrganizationsEligibleForSalesAutomation(',
    'listAutomationRuns(',
    'listInvoiceReminders(',
    'touchAutomationRunHeartbeat(',
    'listReminderStatsForInvoice(',
    'lockInstallmentForAutomation(',
    'lockInvoiceForReminderAutomation(',
    'createInvoiceReminder(',
    'listCollections(',
    'summarizeCollections(',
  ], 'repository');

  includesAll(repository, [
    'COALESCE(ss.sales_installment_automation_enabled, FALSE) = TRUE',
    'COALESCE(ss.sales_reminders_enabled, FALSE) = TRUE',
    'pg_try_advisory_xact_lock',
  ], 'repository automation selection');

  includesAll(controller, [
    "@Get('automation/settings')",
    "@Patch('automation/settings')",
    "@Post('automation/installments/dry-run')",
    "@Post('automation/installments/run')",
    "@Post('automation/reminders/dry-run')",
    "@Post('automation/reminders/run')",
    "@Get('automation/runs')",
    "@Get('invoices/:id/reminders')",
    "@Post('invoices/:id/reminders/send')",
    "@Get('collections')",
  ], 'controller');

  includesAll(moduleFile, [
    'SalesAutomationScheduler',
    'providers: [SalesService, SalesFinancialsService, SalesAutomationService, SalesAutomationScheduler',
  ], 'sales module');

  includesAll(scheduler, [
    "@Cron('0 */5 * * * *')",
    'executeSalesAutomationTick()',
    'runSchedulerTick(new Date())',
  ], 'scheduler');

  includesAll(financials, [
    'generateInvoiceForAutomation(',
    'issueInvoiceForAutomation(',
    'sendInvoiceForAutomation(',
  ], 'financials');

  includesAll(service, [
    'resolveReminderDeliveryOutcome(',
    'COMMUNICATION_LOG_REQUIRED',
    'EMAIL_PROVIDER_NOT_CONFIGURED',
    'EMAIL_TEST_REDIRECT_NOT_CONFIGURED',
  ], 'service reminder invariants');

  includesAll(emailService, [
    'findDocumentLogByIdempotencyKey(',
    "existingLog?.status === 'FAILED'",
    'logStatus',
  ], 'email service idempotency');

  includesAll(guard, [
    'sales_automation.read',
    'sales_automation.manage',
    'sales_automation.run',
    'sales_reminders.read',
    'sales_reminders.send',
    'sales_reports.collection',
  ], 'guard');

  includesAll(permissions, [
    "'sales_automation.read'",
    "'sales_automation.manage'",
    "'sales_automation.run'",
    "'sales_reminders.read'",
    "'sales_reminders.send'",
    "'sales_reports.collection'",
  ], 'permissions');

  includesAll(api, [
    'getSalesAutomationSettings',
    'updateSalesAutomationSettings',
    'dryRunSalesInstallmentAutomation',
    'dryRunSalesReminderAutomation',
    'listSalesAutomationRuns',
    'listSalesInvoiceReminders',
    'sendSalesInvoiceReminder',
    'getSalesCollections',
  ], 'frontend api');

  includesAll(ui, [
    "type SalesTabKey = 'overview' | 'buyers' | 'projects' | 'catalog' | 'reservations' | 'subscriptions' | 'invoices' | 'collections' | 'settings'",
    "label: 'Recouvrement', to: '/sales/collections'",
  ], 'frontend nav');

  includesAll(router, [
    "path=\"/sales/collections\"",
    "sales_reports.collection",
  ], 'router');

  console.log('test-sales-v3-3-installment-automation-reminders: OK');
}

try {
  main();
} catch (error) {
  console.error('test-sales-v3-3-installment-automation-reminders: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
