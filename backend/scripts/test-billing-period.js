const assert = require('node:assert/strict');
const {
  calculateInitialBillingCycle,
  calculateInitialBillingPeriod,
  calculateNextFullBillingPeriod,
  calculateProratedAmount,
  countBillableDays,
  daysInMonth,
  parseDate,
} = require('../dist/utils/billing-period');

function testInitialPeriod() {
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-07-17'), 3), {
    period_start: '2026-07-17',
    period_end: '2026-09-30',
    frequency_months: 3,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-04-12'), 2), {
    period_start: '2026-04-12',
    period_end: '2026-05-31',
    frequency_months: 2,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-07-01'), 3), {
    period_start: '2026-07-01',
    period_end: '2026-09-30',
    frequency_months: 3,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2027-02-28'), 1), {
    period_start: '2027-02-28',
    period_end: '2027-02-28',
    frequency_months: 1,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2028-02-29'), 1), {
    period_start: '2028-02-29',
    period_end: '2028-02-29',
    frequency_months: 1,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-01-31'), 1), {
    period_start: '2026-01-31',
    period_end: '2026-01-31',
    frequency_months: 1,
  });
}

function testNextPeriods() {
  assert.deepEqual(calculateNextFullBillingPeriod(parseDate('2026-09-30'), 3), {
    period_start: '2026-10-01',
    period_end: '2026-12-31',
    frequency_months: 3,
  });
  assert.deepEqual(calculateNextFullBillingPeriod(parseDate('2026-12-31'), 6), {
    period_start: '2027-01-01',
    period_end: '2027-06-30',
    frequency_months: 6,
  });
}

function testDays() {
  assert.equal(daysInMonth(parseDate('2027-02-01')), 28);
  assert.equal(daysInMonth(parseDate('2028-02-01')), 29);
  assert.equal(daysInMonth(parseDate('2026-04-01')), 30);
  assert.equal(daysInMonth(parseDate('2026-07-01')), 31);
  assert.equal(countBillableDays(parseDate('2026-07-17'), parseDate('2026-07-31')), 15);
  assert.equal(countBillableDays(parseDate('2027-02-17'), parseDate('2027-02-28')), 12);
  assert.equal(countBillableDays(parseDate('2028-02-17'), parseDate('2028-02-29')), 13);
}

function testProrata() {
  assert.equal(calculateProratedAmount(1000, 15, 31).amount, 483.87);
  assert.equal(calculateProratedAmount(1000, 12, 28).amount, 428.57);
  assert.equal(calculateProratedAmount(1000, 13, 29).amount, 448.28);
}

function testInitialCycle() {
  const cycle = calculateInitialBillingCycle(parseDate('2026-07-17'), 3, [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
    { code: 'SYNDIC', label: 'Syndic', monthlyAmount: 100 },
  ]);
  assert.equal(cycle.period_start, '2026-07-17');
  assert.equal(cycle.period_end, '2026-09-30');
  assert.equal(cycle.lines.length, 6);
  assert.deepEqual(cycle.lines.map((line) => line.amount), [483.87, 48.39, 1000, 100, 1000, 100]);
  assert.equal(cycle.total_amount, 2732.26);

  assert.equal(calculateInitialBillingCycle(parseDate('2026-07-01'), 1, [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
  ]).total_amount, 1000);
  assert.equal(calculateInitialBillingCycle(parseDate('2026-04-12'), 2, [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
  ]).total_amount, 1633.33);
  assert.equal(calculateInitialBillingCycle(parseDate('2026-07-17'), 6, [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
  ]).period_end, '2026-12-31');
  assert.equal(calculateInitialBillingCycle(parseDate('2026-09-10'), 12, [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
  ]).period_end, '2027-08-31');
}

testInitialPeriod();
testNextPeriods();
testDays();
testProrata();
testInitialCycle();

console.log('billing-period tests passed');
