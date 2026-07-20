export type BillingPeriodCalculation = {
  period_start: string;
  period_end: string;
  frequency_months: number;
};

export type ProratedAmountCalculation = {
  monthly_amount: number;
  billable_days: number;
  days_in_month: number;
  amount: number;
};

export type BillingComponentInput = {
  code: string;
  label: string;
  monthlyAmount: number;
};

export type BillingCycleLine = {
  component_code: string;
  component_label: string;
  period_start: string;
  period_end: string;
  billable_days: number;
  days_in_month: number;
  is_prorated: boolean;
  amount: number;
};

export type InitialBillingCycleCalculation = BillingPeriodCalculation & {
  lines: BillingCycleLine[];
  total_amount: number;
};

export function normalizeBillingFrequency(value: unknown): number {
  const frequency = Number(value ?? 1);
  return Number.isInteger(frequency) && frequency >= 1 && frequency <= 12 ? frequency : 1;
}

export function calculateInitialBillingPeriod(leaseStartDate: Date, billingFrequencyMonths: number): BillingPeriodCalculation {
  const startDate = cloneDate(leaseStartDate);
  const frequency = normalizeBillingFrequency(billingFrequencyMonths);
  const endMonth = addMonths(startOfMonth(startDate), frequency - 1);
  const endDate = lastDayOfMonth(endMonth);

  return {
    period_start: formatDate(startDate),
    period_end: formatDate(endDate),
    frequency_months: frequency,
  };
}

export function calculateNextFullBillingPeriod(previousPeriodEnd: Date, billingFrequencyMonths: number): BillingPeriodCalculation {
  const frequency = normalizeBillingFrequency(billingFrequencyMonths);
  const startDate = addDays(previousPeriodEnd, 1);
  const endMonth = addMonths(startOfMonth(startDate), frequency - 1);
  const endDate = lastDayOfMonth(endMonth);

  return {
    period_start: formatDate(startDate),
    period_end: formatDate(endDate),
    frequency_months: frequency,
  };
}

export function countBillableDays(periodStart: Date, periodEnd: Date): number {
  const start = startOfDay(periodStart).getTime();
  const end = startOfDay(periodEnd).getTime();
  if (end < start) {
    return 0;
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function calculateProratedAmount(monthlyAmount: number, billableDays: number, daysInBillingMonth: number): ProratedAmountCalculation {
  const amount = Number(monthlyAmount ?? 0);
  const days = Number(billableDays ?? 0);
  const monthDays = Number(daysInBillingMonth ?? 0);

  return {
    monthly_amount: amount,
    billable_days: days,
    days_in_month: monthDays,
    amount: monthDays > 0 ? roundMoney((amount * days) / monthDays) : 0,
  };
}

export function calculateInitialBillingCycle(
  leaseStartDate: Date,
  billingFrequencyMonths: number,
  components: BillingComponentInput[],
): InitialBillingCycleCalculation {
  const period = calculateInitialBillingPeriod(leaseStartDate, billingFrequencyMonths);
  const periodStart = parseDate(period.period_start);
  const lines: BillingCycleLine[] = [];

  for (let index = 0; index < period.frequency_months; index += 1) {
    const monthDate = addMonths(startOfMonth(periodStart), index);
    const monthStart = index === 0 ? periodStart : startOfMonth(monthDate);
    const monthEnd = lastDayOfMonth(monthDate);
    const billableDays = countBillableDays(monthStart, monthEnd);
    const monthDays = daysInMonth(monthDate);
    const isProrated = index === 0 && monthStart.getDate() > 1;

    for (const component of components) {
      const amount = isProrated
        ? calculateProratedAmount(component.monthlyAmount, billableDays, monthDays).amount
        : roundMoney(component.monthlyAmount);

      lines.push({
        component_code: component.code,
        component_label: component.label,
        period_start: formatDate(monthStart),
        period_end: formatDate(monthEnd),
        billable_days: billableDays,
        days_in_month: monthDays,
        is_prorated: isProrated,
        amount,
      });
    }
  }

  return {
    ...period,
    lines,
    total_amount: roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)),
  };
}

export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function cloneDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, date.getDate());
}

function addDays(date: Date, offset: number): Date {
  const next = cloneDate(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function roundMoney(value: number): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}
