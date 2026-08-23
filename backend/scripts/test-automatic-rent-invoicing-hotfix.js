const assert = require('node:assert/strict');
const path = require('node:path');

const { readEnvFile, getConfig, ensureDatabaseTarget } = require('./sales-test-helpers');

function applyEnv(filePath) {
  const env = readEnvFile(filePath);
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return env;
}

function makeUser(organizationId) {
  return {
    sub: 1,
    email: 'automation-hotfix@test.local',
    role: 'ADMIN',
    organization_id: organizationId,
    permissions: ['*'],
    active_modules: ['PROPERTY'],
    organization_confirmed: true,
  };
}

async function main() {
  const config = getConfig('main');
  const env = applyEnv(config.envPath);
  ensureDatabaseTarget(env.DATABASE_URL, config);

  require('reflect-metadata');
  const { NestFactory } = require(path.resolve(__dirname, '../node_modules/@nestjs/core'));
  const { AppModule } = require(path.resolve(__dirname, '../dist/app.module'));
  const { AutomationsService } = require(path.resolve(__dirname, '../dist/automations/automations.service'));
  const { RequestContext } = require(path.resolve(__dirname, '../dist/auth/request-context'));
  const { CommunicationService } = require(path.resolve(__dirname, '../dist/communication/communication.service'));
  const { EmailService } = require(path.resolve(__dirname, '../dist/communication/email/email.service'));
  const { DocumentType } = require(path.resolve(__dirname, '../dist/communication/shared/enums/document-type.enum'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const automations = app.get(AutomationsService);
  const requestContext = app.get(RequestContext);
  const communicationService = app.get(CommunicationService);
  const emailService = app.get(EmailService);

  const runAsOrg = (organizationId, work) =>
    requestContext.run({ user: makeUser(organizationId) }, work);

  const previewCatalyse = await runAsOrg(1, () => automations.previewMonthlyRentBilling({ month: 8, year: 2026 }));
  const previewMagic = await runAsOrg(5, () => automations.previewMonthlyRentBilling({ month: 8, year: 2026 }));
  const previewSandbox = await runAsOrg(6, () => automations.previewMonthlyRentBilling({ month: 8, year: 2026 }));

  assert.equal(previewCatalyse.create_count, 6, 'CATALYSE dry-run must predict 6 invoices.');
  assert.equal(previewMagic.create_count, 2, 'Magic Construction dry-run must predict 2 invoices.');
  assert.equal(previewSandbox.due_date, '2026-09-10', 'SANDBOX dry-run must respect the configured due_day.');

  const originalDbQuery = automations.db.query.bind(automations.db);
  automations.db.query = async () => ({ rows: [{ id: 999, status: 'SUCCESS', started_at: new Date().toISOString() }] });
  assert.equal(await automations.hasAutomaticRunForPeriod(6, 8, 2026), true, 'SUCCESS must block rerun.');
  automations.db.query = async () => ({ rows: [{ id: 999, status: 'FAILED', started_at: new Date().toISOString() }] });
  assert.equal(await automations.hasAutomaticRunForPeriod(6, 8, 2026), false, 'FAILED must allow rerun.');
  automations.db.query = async () => ({ rows: [{ id: 999, status: 'PARTIAL', started_at: new Date().toISOString() }] });
  assert.equal(await automations.hasAutomaticRunForPeriod(6, 8, 2026), false, 'PARTIAL must allow rerun.');
  automations.db.query = async () => ({ rows: [{ id: 999, status: 'RUNNING', started_at: new Date(Date.now() - 5 * 60_000).toISOString() }] });
  assert.equal(await automations.hasAutomaticRunForPeriod(6, 8, 2026), true, 'Recent RUNNING must block rerun.');
  automations.db.query = async () => ({ rows: [{ id: 999, status: 'RUNNING', started_at: new Date(Date.now() - 31 * 60_000).toISOString() }] });
  assert.equal(await automations.hasAutomaticRunForPeriod(6, 8, 2026), false, 'Stale RUNNING must allow rerun.');
  automations.db.query = originalDbQuery;

  const originalEnsureSetting = automations.ensureSetting.bind(automations);
  const originalFetchLeaseCandidates = automations.fetchLeaseCandidates.bind(automations);
  const originalLatestRun = automations.latestRunForOrganization.bind(automations);
  automations.ensureSetting = async () => ({
    id: 1,
    organization_id: 6,
    automation_code: 'MONTHLY_RENT_BILLING',
    is_enabled: true,
    execution_time: '10:00:00',
    timezone: 'Africa/Kinshasa',
    due_day: 10,
    email_enabled: true,
    whatsapp_enabled: true,
  });
  automations.fetchLeaseCandidates = async () => [];
  automations.latestRunForOrganization = async () => null;
  const previewDueDay10 = await runAsOrg(6, () => automations.previewMonthlyRentBilling({ month: 8, year: 2026 }));
  assert.equal(previewDueDay10.due_date, '2026-09-10', 'Configured due_day must be respected.');
  automations.ensureSetting = originalEnsureSetting;
  automations.fetchLeaseCandidates = originalFetchLeaseCandidates;
  automations.latestRunForOrganization = originalLatestRun;

  assert.equal(emailService.normalizeAutomaticInvoiceSetting(6, true), true, 'Org 6 must be allowed to enable invoice auto-send.');
  const autoSendAllowedOrg6 = await runAsOrg(6, () =>
    communicationService.isAutoSendEnabled(DocumentType.INVOICE, {
      autoSendInvoice: true,
      autoSendPaymentReceipt: false,
      autoSendTenantCreditReceipt: false,
    }),
  );
  assert.equal(autoSendAllowedOrg6, true, 'Communication service must no longer hardcode org filtering for invoice auto-send.');

  console.log(
    JSON.stringify(
      {
        previews: {
          catalyse: {
            create_count: previewCatalyse.create_count,
            skipped_count: previewCatalyse.skipped_count,
            due_date: previewCatalyse.due_date,
          },
          magicConstruction: {
            create_count: previewMagic.create_count,
            skipped_count: previewMagic.skipped_count,
            due_date: previewMagic.due_date,
          },
          sandbox: {
            create_count: previewSandbox.create_count,
            existing_count: previewSandbox.existing_count,
            skipped_count: previewSandbox.skipped_count,
            due_date: previewSandbox.due_date,
          },
          dueDay10: previewDueDay10.due_date,
        },
        retryLogic: {
          successBlocked: true,
          failedRetryAllowed: true,
          partialRetryAllowed: true,
          runningRecentBlocked: true,
          runningStaleAllowed: true,
        },
        autoSend: {
          sandboxCanEnableInvoiceAutoSend: true,
        },
      },
      null,
      2,
    ),
  );

  await app.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
