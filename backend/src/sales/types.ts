export const SALES_MODULE_CODE = 'SALES';

export const SALES_BUYER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export const SALES_BUYER_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const SALES_PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
export const SALES_COMMERCIAL_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN', 'BLOCKED'] as const;
export const SALES_SUPPORTED_CURRENCIES = ['USD', 'CDF'] as const;
export const SALES_COMMERCIAL_STAGES = ['PROSPECT', 'RESERVING', 'SUBSCRIBER', 'BUYER', 'OWNER', 'LOST'] as const;
export const SALES_RESERVATION_STATUSES = ['DRAFT', 'ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'CONVERTED'] as const;
export const SALES_SUBSCRIPTION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;
export const SALES_SCHEDULE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'CUSTOM'] as const;
export const SALES_DEPOSIT_TYPES = ['PERCENTAGE', 'FIXED'] as const;
export const SALES_INSTALLMENT_TYPES = ['DEPOSIT', 'REGULAR', 'FINAL', 'CUSTOM', 'FEE'] as const;

export function normalizeSalesModuleCode(moduleCode: string | null | undefined) {
  return String(moduleCode ?? SALES_MODULE_CODE).trim().toUpperCase() || SALES_MODULE_CODE;
}

export type SalesBootstrap = {
  module: string;
  organization_id: number;
  permissions: string[];
  settings: SalesSettings | null;
};

export type SalesSettings = {
  id?: number;
  organization_id?: number;
  default_currency?: string | null;
  secondary_currency?: string | null;
  quotation_prefix?: string | null;
  reservation_prefix?: string | null;
  contract_prefix?: string | null;
  receipt_prefix?: string | null;
  invoice_prefix?: string | null;
  reservation_default_duration_days?: number | null;
  reservation_fee_required?: boolean | null;
  reservation_default_fee?: number | null;
  minimum_deposit_type?: string | null;
  minimum_deposit_percentage?: number | null;
  minimum_deposit_amount?: number | null;
  maximum_installment_count?: number | null;
  default_installment_frequency?: string | null;
  grace_period_days?: number | null;
  discount_approval_threshold_percentage?: number | null;
  allow_custom_schedule?: boolean | null;
  allowed_currencies?: string[] | null;
  contract_generation_mode?: string | null;
  invoice_generation_mode?: string | null;
  revenue_recognition_mode?: string | null;
  settings_json?: Record<string, unknown> | null;
};

export type SalesListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: string;
};

export type SalesListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type SalesBuyer = {
  id: number;
  organization_id: number;
  buyer_ref: string;
  buyer_type: (typeof SALES_BUYER_TYPES)[number] | string;
  full_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  id_document_type?: string | null;
  id_document_number?: string | null;
  tax_number?: string | null;
  status: (typeof SALES_BUYER_STATUSES)[number] | string;
  commercial_stage?: (typeof SALES_COMMERCIAL_STAGES)[number] | string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type SalesProject = {
  id: number;
  organization_id: number;
  project_ref: string;
  name: string;
  description?: string | null;
  location_label?: string | null;
  status: (typeof SALES_PROJECT_STATUSES)[number] | string;
  launch_date?: string | null;
  closing_date?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type SalesCatalogItem = {
  id: number;
  organization_id: number;
  project_id?: number | null;
  building_id?: number | null;
  unit_id?: number | null;
  catalog_ref: string;
  property_type: string;
  title: string;
  description?: string | null;
  list_price?: number | null;
  minimum_price?: number | null;
  currency?: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string | null;
  commercial_status: (typeof SALES_COMMERCIAL_STATUSES)[number] | string;
  availability_date?: string | null;
  surface_area?: number | null;
  location_label?: string | null;
  metadata?: Record<string, unknown> | null;
  project_name?: string | null;
  building_name?: string | null;
  unit_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type SalesReservation = {
  id: number;
  organization_id: number;
  reservation_number: string;
  buyer_id: number;
  catalog_item_id: number;
  project_id?: number | null;
  status: (typeof SALES_RESERVATION_STATUSES)[number] | string;
  currency: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string;
  catalog_price: number;
  negotiated_price: number;
  reservation_fee?: number | null;
  reservation_date: string;
  expires_at?: string | null;
  confirmed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  notes?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  buyer_name?: string | null;
  buyer_ref?: string | null;
  catalog_title?: string | null;
  catalog_ref?: string | null;
  project_name?: string | null;
};

export type SalesSubscriptionInstallment = {
  id?: number;
  organization_id?: number;
  subscription_id?: number;
  sequence_number: number;
  label?: string | null;
  due_date: string;
  amount: number;
  currency: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string;
  installment_type?: (typeof SALES_INSTALLMENT_TYPES)[number] | string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SalesSubscription = {
  id: number;
  organization_id: number;
  subscription_number: string;
  reservation_id?: number | null;
  buyer_id: number;
  catalog_item_id: number;
  project_id?: number | null;
  status: (typeof SALES_SUBSCRIPTION_STATUSES)[number] | string;
  currency: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string;
  catalog_price: number;
  discount_amount?: number | null;
  final_sale_price: number;
  deposit_type: (typeof SALES_DEPOSIT_TYPES)[number] | string;
  deposit_percentage?: number | null;
  deposit_amount?: number | null;
  financed_balance?: number | null;
  installment_count: number;
  frequency: (typeof SALES_SCHEDULE_FREQUENCIES)[number] | string;
  first_due_date?: string | null;
  regular_installment_amount?: number | null;
  final_installment_amount?: number | null;
  grace_period_days?: number | null;
  allow_custom_schedule?: boolean | null;
  notes?: string | null;
  approved_by?: number | null;
  approved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  buyer_name?: string | null;
  buyer_ref?: string | null;
  catalog_title?: string | null;
  catalog_ref?: string | null;
  project_name?: string | null;
  reservation_number?: string | null;
  installments?: SalesSubscriptionInstallment[];
};

export type SalesSimulationSummary = {
  currency: string;
  catalog_price: number;
  final_sale_price: number;
  discount_amount: number;
  total_installments: number;
  deposit_amount: number;
  remaining_amount: number;
  approval_required: boolean;
  approval_reason?: string | null;
};

export type SalesSubscriptionSimulation = {
  summary: SalesSimulationSummary;
  installments: SalesSubscriptionInstallment[];
};
