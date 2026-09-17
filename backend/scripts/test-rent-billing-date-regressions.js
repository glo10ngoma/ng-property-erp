const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('reflect-metadata');
const { AutomationsService } = require('../dist/automations/automations.service');

const automations = Object.create(AutomationsService.prototype);
automations.generationDay = 25;
automations.defaultAutomaticDueDay = 5;
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

const august = automations.buildBillingPeriod(2026, 8, 5);
const september = automations.buildBillingPeriod(2026, 9, 5);

assert.equal(
  automations.nextBillingPeriodForLease(august, quarterlyLease),
  null,
  'A July-September quarterly cycle must not be invoiced in August.',
);

const closingPeriod = automations.nextBillingPeriodForLease(september, quarterlyLease);
assert.deepEqual(
  {
    issueDate: closingPeriod.issueDate,
    dueDate: closingPeriod.dueDate,
    periodStart: closingPeriod.periodStart,
    periodEnd: closingPeriod.periodEnd,
  },
  {
    issueDate: '2026-09-25',
    dueDate: '2026-10-05',
    periodStart: '2026-07-19',
    periodEnd: '2026-09-30',
  },
);
assert.equal(
  automations.recurringAmountsForPeriod(quarterlyLease, closingPeriod).total,
  5201.61,
  'The first month must be prorated from 19 July inclusive.',
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

console.log('rent-billing date regression tests passed');
