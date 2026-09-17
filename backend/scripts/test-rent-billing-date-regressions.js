const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('reflect-metadata');
require('../dist/database/database.service');
const { types } = require('pg');
const { AutomationsService } = require('../dist/automations/automations.service');

assert.equal(
  types.getTypeParser(types.builtins.DATE, 'text')('2026-09-16'),
  '2026-09-16',
  'PostgreSQL DATE values must remain date-only strings and never shift to the previous UTC day.',
);

const automations = Object.create(AutomationsService.prototype);
automations.generationDay = 1;
automations.defaultAutomaticDueDay = 5;
assert.equal(automations.resolveDueDay(10), 5, 'Rent invoice due dates must always use the fixed five-day grace period.');
assert.equal(automations.addCalendarDays('2026-12-29', 5), '2027-01-03', 'The five-day deadline must cross month and year boundaries safely.');
const quarterlyLease = {
  id: 999,
  tenant_id: 1,
  unit_id: 1,
  monthly_rent: 2000,
  maintenance_fee_amount: 0,
  monthly_syndic_amount: 150,
  billing_frequency_months: 3,
  status: 'ACTIVE',
  start_date: '2026-07-19',
};

const july = automations.buildBillingPeriod(2026, 7, 5);
const august = automations.buildBillingPeriod(2026, 8, 5);
const september = automations.buildBillingPeriod(2026, 9, 5);

const openingPeriod = automations.nextBillingPeriodForLease(july, quarterlyLease);
assert.deepEqual(
  {
    issueDate: openingPeriod.issueDate,
    dueDate: openingPeriod.dueDate,
    periodStart: openingPeriod.periodStart,
    periodEnd: openingPeriod.periodEnd,
  },
  {
    issueDate: '2026-07-19',
    dueDate: '2026-07-24',
    periodStart: '2026-07-19',
    periodEnd: '2026-09-30',
  },
);
assert.equal(automations.nextBillingPeriodForLease(august, quarterlyLease), null);
assert.equal(automations.nextBillingPeriodForLease(september, quarterlyLease), null);
assert.equal(
  automations.recurringAmountsForPeriod(quarterlyLease, openingPeriod).total,
  5201.61,
  'The first month must be prorated from 19 July inclusive.',
);

const nextQuarter = automations.nextBillingPeriodForLease(
  automations.buildBillingPeriod(2026, 10, 5),
  { ...quarterlyLease, last_rent_period_end: '2026-09-30' },
);
assert.deepEqual(
  {
    issueDate: nextQuarter.issueDate,
    dueDate: nextQuarter.dueDate,
    periodStart: nextQuarter.periodStart,
    periodEnd: nextQuarter.periodEnd,
  },
  {
    issueDate: '2026-10-01',
    dueDate: '2026-10-06',
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
  },
);

const midMonthMonthly = automations.nextBillingPeriodForLease(
  automations.buildBillingPeriod(2026, 9, 5),
  { ...quarterlyLease, billing_frequency_months: 1, start_date: '2026-09-17' },
);
assert.deepEqual(
  {
    issueDate: midMonthMonthly.issueDate,
    dueDate: midMonthMonthly.dueDate,
    periodStart: midMonthMonthly.periodStart,
    periodEnd: midMonthMonthly.periodEnd,
  },
  {
    issueDate: '2026-09-17',
    dueDate: '2026-09-22',
    periodStart: '2026-09-17',
    periodEnd: '2026-09-30',
  },
);

const saasSource = fs.readFileSync(path.resolve(__dirname, '../src/saas/saas.service.ts'), 'utf8');
assert.match(saasSource, /issue_date::TEXT AS issue_date/);
assert.doesNotMatch(saasSource, /SELECT id, invoice_number, invoice_type, issue_date, status, total/);

for (const relativePath of [
  '../../frontend/src/pages/LeaseNew.tsx',
  '../../frontend/src/modules/leases/pages/LeasesPage.tsx',
]) {
  const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  assert.doesNotMatch(source, /new Date\(dateValue\)/, `${relativePath} must not parse date-only input as UTC.`);
  assert.match(source, /function dateOnlyParts\(/, `${relativePath} must use date-only arithmetic.`);
}

const invoicePdfSource = fs.readFileSync(path.resolve(__dirname, '../src/invoices/invoice-pdf.service.ts'), 'utf8');
assert.doesNotMatch(invoicePdfSource, /start\.toISOString\(\)/);
assert.doesNotMatch(invoicePdfSource, /end\.toISOString\(\)/);

const automationsSource = fs.readFileSync(path.resolve(__dirname, '../src/automations/automations.service.ts'), 'utf8');
assert.match(automationsSource, /@Cron\('0 \* \* \* \* \*'/, 'The scheduler must check every day for leases starting that day.');
assert.match(automationsSource, /generateInitialInvoicesStartingOnDate\(setting, today\)/);
assert.doesNotMatch(automationsSource, /@Cron\('0 \* \* 25 \* \*'/);

console.log('rent-billing date regression tests passed');
