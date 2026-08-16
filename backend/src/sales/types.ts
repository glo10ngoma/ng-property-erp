export const SALES_MODULE_CODE = 'SALES';

export const SALES_SUPPORTED_CURRENCIES = ['USD', 'CDF'] as const;
export const SALES_BUYER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export const SALES_BUYER_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const SALES_PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
export const SALES_COMMERCIAL_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN', 'BLOCKED'] as const;

export function normalizeSalesModuleCode(moduleCode: string) {
  return String(moduleCode ?? '').trim().toUpperCase();
}
