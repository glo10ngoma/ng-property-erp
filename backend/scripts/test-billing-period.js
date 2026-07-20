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

function testAllFrequenciesAndStartDays() {
  const startDays = [1, 2, 15, 17, 25, 28, 29, 30, 31];
  for (let frequency = 1; frequency <= 12; frequency += 1) {
    for (const day of startDays) {
      const start = `2026-07-${String(day).padStart(2, '0')}`;
      const cycle = calculateInitialBillingCycle(parseDate(start), frequency, [
        { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
      ]);
      assert.equal(cycle.period_start, start);
      assert.equal(cycle.frequency_months, frequency);
      assert.equal(cycle.lines.length, frequency);
      assert.equal(cycle.lines[0].billable_days, 31 - day + 1);
      assert.equal(cycle.lines[0].days_in_month, 31);
      assert.equal(cycle.lines[0].is_prorated, day > 1);

      let previousEnd = parseDate(cycle.period_end);
      for (let nextIndex = 0; nextIndex < 3; nextIndex += 1) {
        const next = calculateNextFullBillingPeriod(previousEnd, frequency);
        const expectedStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() + 1);
        assert.equal(next.period_start, [
          expectedStart.getFullYear(),
          String(expectedStart.getMonth() + 1).padStart(2, '0'),
          String(expectedStart.getDate()).padStart(2, '0'),
        ].join('-'));
        previousEnd = parseDate(next.period_end);
      }
    }
  }
}

function testYearTransitions() {
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-11-17'), 3), {
    period_start: '2026-11-17',
    period_end: '2027-01-31',
    frequency_months: 3,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-12-17'), 3), {
    period_start: '2026-12-17',
    period_end: '2027-02-28',
    frequency_months: 3,
  });
  assert.deepEqual(calculateInitialBillingPeriod(parseDate('2026-09-10'), 12), {
    period_start: '2026-09-10',
    period_end: '2027-08-31',
    frequency_months: 12,
  });
}

function testFrequencyChangesAfterExistingInvoice() {
  const firstMonthly = calculateInitialBillingPeriod(parseDate('2026-07-17'), 1);
  assert.equal(firstMonthly.period_end, '2026-07-31');
  const nextQuarterly = calculateNextFullBillingPeriod(parseDate(firstMonthly.period_end), 3);
  assert.deepEqual(nextQuarterly, {
    period_start: '2026-08-01',
    period_end: '2026-10-31',
    frequency_months: 3,
  });
  const nextSemiAnnual = calculateNextFullBillingPeriod(parseDate(nextQuarterly.period_end), 6);
  assert.deepEqual(nextSemiAnnual, {
    period_start: '2026-11-01',
    period_end: '2027-04-30',
    frequency_months: 6,
  });
  const backToMonthly = calculateNextFullBillingPeriod(parseDate(nextSemiAnnual.period_end), 1);
  assert.deepEqual(backToMonthly, {
    period_start: '2027-05-01',
    period_end: '2027-05-31',
    frequency_months: 1,
  });
}

function testCompleteEndToEndScenario() {
  const components = [
    { code: 'RENT', label: 'Loyer', monthlyAmount: 1000 },
    { code: 'SYNDIC', label: 'Syndic', monthlyAmount: 100 },
  ];
  const firstInvoice = calculateInitialBillingCycle(parseDate('2026-07-17'), 3, components);
  assert.equal(firstInvoice.period_start, '2026-07-17');
  assert.equal(firstInvoice.period_end, '2026-09-30');
  assert.equal(firstInvoice.total_amount, 2732.26);

  const partialPayment = 1000;
  const fullPayment = firstInvoice.total_amount - partialPayment;
  assert.equal(Math.round((partialPayment + fullPayment) * 100) / 100, firstInvoice.total_amount);

  const secondInvoice = calculateNextFullBillingPeriod(parseDate(firstInvoice.period_end), 3);
  assert.deepEqual(secondInvoice, {
    period_start: '2026-10-01',
    period_end: '2026-12-31',
    frequency_months: 3,
  });
  const secondInvoiceCycle = calculateInitialBillingCycle(parseDate(secondInvoice.period_start), 3, components);
  assert.equal(secondInvoiceCycle.total_amount, 3300);

  const thirdInvoice = calculateNextFullBillingPeriod(parseDate(secondInvoice.period_end), 3);
  assert.deepEqual(thirdInvoice, {
    period_start: '2027-01-01',
    period_end: '2027-03-31',
    frequency_months: 3,
  });
}

testInitialPeriod();
testNextPeriods();
testDays();
testProrata();
testInitialCycle();
testAllFrequenciesAndStartDays();
testYearTransitions();
testFrequencyChangesAfterExistingInvoice();
testCompleteEndToEndScenario();

console.log('billing-period tests passed');
