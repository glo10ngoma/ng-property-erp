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
export const SALES_RESERVATION_PAYMENT_METHODS = ['CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'] as const;
export const SALES_RESERVATION_PAYMENT_STATUSES = ['CONFIRMED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export const SALES_RESERVATION_REFUND_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export const SALES_RESERVATION_DESTINATION_TYPES = ['CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'] as const;
export const SALES_SEQUENCE_DOCUMENT_TYPES = [
  'BUYER',
  'PROJECT',
  'CATALOG',
  'RESERVATION',
  'SUBSCRIPTION',
  'RESERVATION_CONTRACT',
  'SUBSCRIPTION_CONTRACT',
  'RESERVATION_PAYMENT',
  'RESERVATION_REFUND',
  'RESERVATION_RECEIPT',
] as const;
export const SALES_TEMPLATE_TYPES = ['RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT'] as const;
export const SALES_DOCUMENT_GENERATION_STATUSES = ['PENDING', 'GENERATED', 'GENERATION_FAILED', 'SIGNED'] as const;
export const SALES_SUBSCRIPTION_ORIGIN_MODES = ['RESERVATION', 'DIRECT'] as const;

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
  buyer_number_format?: string | null;
  project_number_format?: string | null;
  catalog_number_format?: string | null;
  reservation_number_format?: string | null;
  subscription_number_format?: string | null;
  reservation_contract_number_format?: string | null;
  subscription_contract_number_format?: string | null;
  reservation_default_duration_days?: number | null;
  reservation_fee_required?: boolean | null;
  reservation_default_fee?: number | null;
  reservation_fee_enabled?: boolean | null;
  reservation_fee_default_amount?: number | null;
  reservation_fee_default_currency?: string | null;
  reservation_fee_deductibility?: 'DEDUCTIBLE' | 'NON_DEDUCTIBLE' | 'PARTIALLY_DEDUCTIBLE' | string | null;
  reservation_fee_deductible_percentage?: number | null;
  reservation_fee_refundable?: boolean | null;
  reservation_fee_refundable_percentage?: number | null;
  reservation_fee_refund_deadline_days?: number | null;
  reservation_fee_accounting_treatment?: 'CUSTOMER_ADVANCE' | 'RESERVATION_FEE_REVENUE' | string | null;
  reservation_payment_number_format?: string | null;
  reservation_refund_number_format?: string | null;
  reservation_receipt_number_format?: string | null;
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
  fee_paid?: number | null;
  fee_refunded?: number | null;
  fee_allocated?: number | null;
  fee_available?: number | null;
  fee_remaining?: number | null;
  payment_status?: string | null;
  deductibility?: string | null;
  refundable_amount?: number | null;
  payments?: SalesReservationPayment[];
  payment_destinations?: SalesReservationPaymentDestinations | null;
  fee_summary?: SalesReservationFeeSummary | null;
};

export type SalesReservationFeeSummary = {
  fee_agreed: number;
  fee_paid: number;
  fee_refunded: number;
  fee_allocated: number;
  fee_available: number;
  fee_remaining: number;
  payment_status: string;
  deductibility: string;
  refundable_amount: number;
  currency: string;
};

export type SalesReservationPaymentDestination = {
  id: number;
  label: string;
  type: string;
  currency?: string | null;
  status?: string | null;
};

export type SalesReservationPaymentDestinations = {
  cash_sessions: SalesReservationPaymentDestination[];
  bank_accounts: SalesReservationPaymentDestination[];
};

export type SalesReservationReceipt = {
  id: number;
  document_number: string;
  entity_type: string;
  entity_id: number;
  generation_status?: string | null;
  generated_at?: string | null;
  file_name?: string | null;
};

export type SalesReservationRefund = {
  id: number;
  organization_id: number;
  reservation_payment_id: number;
  reservation_id: number;
  refund_number: string;
  refund_date: string;
  amount: number;
  currency: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string;
  refund_method: (typeof SALES_RESERVATION_PAYMENT_METHODS)[number] | string;
  destination_type: (typeof SALES_RESERVATION_DESTINATION_TYPES)[number] | string;
  reason: string;
  status: (typeof SALES_RESERVATION_REFUND_STATUSES)[number] | string;
  cash_session_id?: number | null;
  cash_movement_id?: number | null;
  bank_account_id?: number | null;
  bank_transaction_id?: number | null;
  receipt?: SalesReservationReceipt | null;
  created_at?: string | null;
};

export type SalesReservationPayment = {
  id: number;
  organization_id: number;
  reservation_id: number;
  payment_number: string;
  payment_date: string;
  amount: number;
  currency: (typeof SALES_SUPPORTED_CURRENCIES)[number] | string;
  payment_method: (typeof SALES_RESERVATION_PAYMENT_METHODS)[number] | string;
  destination_type: (typeof SALES_RESERVATION_DESTINATION_TYPES)[number] | string;
  status: (typeof SALES_RESERVATION_PAYMENT_STATUSES)[number] | string;
  external_reference?: string | null;
  notes?: string | null;
  cash_session_id?: number | null;
  cash_movement_id?: number | null;
  bank_account_id?: number | null;
  bank_transaction_id?: number | null;
  refunded_amount?: number | null;
  allocated_amount?: number | null;
  available_refundable_amount?: number | null;
  receipt?: SalesReservationReceipt | null;
  refunds?: SalesReservationRefund[];
  created_at?: string | null;
  cancelled_at?: string | null;
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

export type SalesDocumentTemplate = {
  id: number;
  organization_id: number;
  template_type: (typeof SALES_TEMPLATE_TYPES)[number] | string;
  title: string;
  template_body: string;
  header_html?: string | null;
  footer_html?: string | null;
  variables_schema?: string[] | null;
  clause_order?: string[] | null;
  version: number;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SalesDocumentGeneration = {
  id: number;
  organization_id: number;
  entity_type: 'RESERVATION' | 'SUBSCRIPTION' | string;
  entity_id: number;
  template_type: (typeof SALES_TEMPLATE_TYPES)[number] | string;
  template_id?: number | null;
  version: number;
  document_number: string;
  file_name?: string | null;
  mime_type?: string | null;
  generation_status: (typeof SALES_DOCUMENT_GENERATION_STATUSES)[number] | string;
  generated_at?: string | null;
  signed_at?: string | null;
  signed_file_url?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
