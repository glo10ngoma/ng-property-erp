export { api, setAuthToken } from './core/api/axios';
export type { Option } from './core/api/api.types';
export { exportCsv } from './core/utils/exportCsv';
export { exportExcel } from './core/utils/exportExcel';
export { formatCurrency as money } from './core/utils/formatCurrency';
export { formatDate as shortDate } from './core/utils/formatDate';
export { itemLabel, paymentMethodLabel, statusLabel } from './core/utils/statusLabels';
export { includesText } from './core/hooks/useSearch';

export const isOverdueInvoice = (status: string, dueDate?: string) =>
  status !== 'PAID' && Boolean(dueDate) && new Date(`${dueDate?.slice(0, 10)}T23:59:59`) < new Date();

export const invoiceDisplayStatus = (status: string, dueDate?: string) =>
  isOverdueInvoice(status, dueDate) ? 'OVERDUE' : status;
