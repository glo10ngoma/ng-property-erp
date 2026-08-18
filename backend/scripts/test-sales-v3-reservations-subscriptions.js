const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

function includesAll(text, expected, label) {
  for (const item of expected) {
    assert.ok(text.includes(item), `${label} is missing: ${item}`);
  }
}

function resolveScheduleModule() {
  const candidates = [
    path.resolve(backendRoot, 'dist/src/sales/subscription-schedule.js'),
    path.resolve(backendRoot, 'dist/sales/subscription-schedule.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error('subscription-schedule build artifact not found. Run npm run build first.');
}

(function runStaticChecks() {
  const migration = read('../database/20260817_sales_v3_reservations_subscriptions.sql');
  includesAll(migration, [
    'CREATE TABLE IF NOT EXISTS sales_reservations',
    'CREATE TABLE IF NOT EXISTS sales_subscriptions',
    'CREATE TABLE IF NOT EXISTS sales_subscription_installments',
    'CREATE TABLE IF NOT EXISTS sales_status_history',
    'sales_reservations_active_catalog_uidx',
    'sales_reservations_id_organization_uidx',
    'sales_subscriptions_id_organization_uidx',
    'sales_subscriptions_deposit_type_chk',
  ], 'sales v3 migration');
  assert.ok(!/\bDROP\b/i.test(migration), 'sales v3 migration must remain additive');
  assert.ok(!/\bTRUNCATE\b/i.test(migration), 'sales v3 migration must not truncate data');

  const service = read('src/sales/sales.service.ts');
  includesAll(service, [
    'listReservations(',
    'createReservation(',
    'simulateSubscription(',
    'createSubscription(',
    'approveSubscription(',
    'changeSubscriptionStatus(',
  ], 'sales service v3');

  const repository = read('src/sales/sales.repository.ts');
  includesAll(repository, [
    'listReservations(',
    'findReservation(',
    'listSubscriptions(',
    'findSubscription(',
    'replaceSubscriptionInstallments(',
    'writeStatusHistory(',
  ], 'sales repository v3');
})();

(function runSimulationChecks() {
  const { simulateSalesSubscriptionPlan } = resolveScheduleModule();

  const baseSettings = {
    minimum_deposit_type: 'PERCENTAGE',
    minimum_deposit_percentage: 10,
    maximum_installment_count: 24,
    default_installment_frequency: 'MONTHLY',
    grace_period_days: 5,
    allow_custom_schedule: true,
    discount_approval_threshold_percentage: 5,
  };

  const monthly = simulateSalesSubscriptionPlan({
    buyer_id: 1,
    catalog_item_id: 2,
    currency: 'USD',
    catalog_price: 100000,
    negotiated_price: 95000,
    deposit_type: 'PERCENTAGE',
    deposit_percentage: 20,
    installment_count: 4,
    frequency: 'MONTHLY',
    first_due_date: '2026-09-15',
  }, baseSettings);

  assert.equal(monthly.summary.final_sale_price, 95000, 'final sale price must reflect negotiated price');
  assert.equal(monthly.summary.discount_amount, 5000, 'discount amount must be derived correctly');
  assert.equal(monthly.summary.deposit_amount, 19000, 'deposit amount must be derived from percentage');
  assert.equal(monthly.summary.remaining_amount, 76000, 'remaining amount must be tracked');
  assert.equal(monthly.installments.length, 5, 'deposit + 4 installments expected');
  const monthlyTotal = Math.round(monthly.installments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  assert.equal(monthlyTotal, 95000, 'installments total must equal final sale price');

  const custom = simulateSalesSubscriptionPlan({
    buyer_id: 1,
    catalog_item_id: 2,
    currency: 'CDF',
    catalog_price: 50000,
    deposit_type: 'FIXED',
    deposit_amount: 10000,
    installment_count: 2,
    frequency: 'CUSTOM',
    custom_installments: [
      { amount: 15000, currency: 'CDF', due_date: '2026-10-01', installment_type: 'CUSTOM' },
      { amount: 25000, currency: 'CDF', due_date: '2026-11-01', installment_type: 'CUSTOM' },
    ],
  }, {
    ...baseSettings,
    minimum_deposit_type: 'FIXED',
    minimum_deposit_amount: 5000,
  });

  assert.equal(custom.summary.deposit_amount, 10000, 'fixed deposit must be preserved');
  assert.equal(custom.summary.remaining_amount, 40000, 'remaining amount must use custom schedule basis');
  assert.equal(custom.installments.length, 3, 'deposit + 2 custom installments expected');

  assert.throws(() => simulateSalesSubscriptionPlan({
    buyer_id: 1,
    catalog_item_id: 2,
    currency: 'USD',
    catalog_price: 100000,
    deposit_type: 'PERCENTAGE',
    deposit_percentage: 5,
    installment_count: 6,
    frequency: 'MONTHLY',
    first_due_date: '2026-09-01',
  }, baseSettings), /acompte minimum/i, 'minimum deposit rule must be enforced');

  assert.throws(() => simulateSalesSubscriptionPlan({
    buyer_id: 1,
    catalog_item_id: 2,
    currency: 'USD',
    catalog_price: 100000,
    deposit_type: 'FIXED',
    deposit_amount: 10000,
    installment_count: 2,
    frequency: 'CUSTOM',
    custom_installments: [
      { amount: 10000, currency: 'USD', due_date: '2026-10-01' },
      { amount: 10000, currency: 'USD', due_date: '2026-11-01' },
    ],
  }, {
    ...baseSettings,
    minimum_deposit_type: 'FIXED',
    minimum_deposit_amount: 10000,
  }), /correspondre exactement/i, 'custom schedules must match the financed balance');

  console.log('SALES_V3_RESERVATIONS_SUBSCRIPTIONS_TESTS_OK');
})();
