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
export const SALES_SUBSCRIPTION_ORIGIN_MODES = ['DIRECT', 'RESERVATION'] as const;
export const SALES_RESERVATION_PAYMENT_METHODS = ['CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'] as const;
export const SALES_RESERVATION_PAYMENT_STATUSES = ['CONFIRMED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export const SALES_RESERVATION_DESTINATION_TYPES = ['CASH', 'BANK', 'MOBILE_MONEY', 'OTHER'] as const;
export const SALES_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export const SALES_AUTOMATION_RUN_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export const SALES_AUTOMATION_TYPES = ['INSTALLMENT_INVOICING', 'INVOICE_REMINDERS'] as const;
export const SALES_INVOICE_REMINDER_TYPES = ['INVOICE_ISSUED', 'UPCOMING_DUE', 'DUE_TODAY', 'OVERDUE', 'FINAL_NOTICE'] as const;
export const SALES_INVOICE_REMINDER_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED'] as const;

export type SalesBootstrap = {
  module: string;
  organization_id: number;
  permissions: string[];
  settings: Record<string, unknown> | null;
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
  reservation_fee_deductibility?: string | null;
  reservation_fee_deductible_percentage?: number | null;
  reservation_fee_refundable?: boolean | null;
  reservation_fee_refundable_percentage?: number | null;
  reservation_fee_refund_deadline_days?: number | null;
  reservation_fee_accounting_treatment?: string | null;
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
  sales_installment_automation_enabled?: boolean | null;
  sales_auto_generate_invoice_days_before?: number | null;
  sales_auto_issue_invoice?: boolean | null;
  sales_auto_send_invoice?: boolean | null;
  sales_reminders_enabled?: boolean | null;
  sales_reminder_days_before?: number[] | null;
  sales_overdue_reminder_days?: number[] | null;
  sales_reminder_execution_time?: string | null;
  sales_reminder_timezone?: string | null;
  sales_max_reminders_per_invoice?: number | null;
  sales_reminder_cooldown_hours?: number | null;
  sales_collection_email_mode?: string | null;
  sales_overdue_grace_days?: number | null;
  settings_json?: Record<string, unknown> | null;
};

export type SalesListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: string;
  project_id?: number;
  available_only?: boolean;
  buyer_id?: number;
  currency?: string;
  min_overdue_days?: number;
};

export type SalesDocumentTemplate = {
  id: number;
  organization_id: number;
  template_type: string;
  title: string;
  template_body: string;
  header_html?: string | null;
  footer_html?: string | null;
  variables_schema?: string[] | null;
  clause_order?: string[] | null;
  version?: number | null;
  is_active?: boolean | null;
  used_documents_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SalesDocumentTemplatePayload = {
  template_type: string;
  title: string;
  template_body: string;
  header_html?: string | null;
  footer_html?: string | null;
  variables_schema?: string[] | null;
  clause_order?: string[] | null;
  is_active?: boolean | null;
};

export type SalesDocumentGeneration = {
  id: number;
  organization_id: number;
  entity_type: string;
  entity_id: number;
  template_type: string;
  template_id?: number | null;
  version?: number | null;
  document_number: string;
  file_name?: string | null;
  generation_status?: string | null;
  mime_type?: string | null;
  generated_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
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
  buyer_name?: string | null;
  buyer_ref?: string | null;
  catalog_title?: string | null;
  catalog_ref?: string | null;
  project_name?: string | null;
  fee_agreed?: number | null;
  fee_paid?: number | null;
  fee_refunded?: number | null;
  fee_allocated?: number | null;
  fee_available?: number | null;
  fee_remaining?: number | null;
  payment_status?: string | null;
  deductibility?: string | null;
  refundable_amount?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  documents?: SalesDocumentGeneration[];
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
  file_name?: string | null;
  generated_at?: string | null;
};

export type SalesReservationRefund = {
  id: number;
  reservation_payment_id: number;
  reservation_id: number;
  refund_number: string;
  refund_date: string;
  amount: number;
  currency: string;
  refund_method: string;
  destination_type: string;
  reason: string;
  status: string;
  receipt?: SalesReservationReceipt | null;
};

export type SalesReservationPayment = {
  id: number;
  reservation_id: number;
  payment_number: string;
  payment_date: string;
  amount: number;
  currency: string;
  payment_method: string;
  destination_type: string;
  status: string;
  external_reference?: string | null;
  notes?: string | null;
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
  notes?: string | null;
  approved_by?: number | null;
  approved_at?: string | null;
  buyer_name?: string | null;
  buyer_ref?: string | null;
  catalog_title?: string | null;
  catalog_ref?: string | null;
  project_name?: string | null;
  reservation_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  installments?: SalesSubscriptionInstallment[];
  documents?: SalesDocumentGeneration[];
};

export type SalesInvoiceItem = {
  id: number;
  invoice_id: number;
  organization_id: number;
  line_type: string;
  label: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  line_amount: number;
  currency: string;
  sort_order: number;
};

export type SalesInvoicePayment = {
  id: number;
  organization_id: number;
  invoice_id: number;
  subscription_id: number;
  installment_id?: number | null;
  payment_number: string;
  status: string;
  amount: number;
  currency: string;
  payment_date: string;
  payment_method: string;
  destination_type: string;
  cash_session_id?: number | null;
  bank_account_id?: number | null;
  receipt_document_id?: number | null;
  external_reference?: string | null;
  notes?: string | null;
  refunded_amount?: number | null;
  available_refundable_amount?: number | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export type SalesInvoice = {
  id: number;
  organization_id: number;
  subscription_id: number;
  installment_id: number;
  invoice_number: string;
  status: (typeof SALES_INVOICE_STATUSES)[number] | string;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal_amount: number;
  discount_amount: number;
  fee_allocation_amount: number;
  total_amount: number;
  paid_amount: number;
  refunded_amount: number;
  balance_due: number;
  buyer_name?: string | null;
  subscription_number?: string | null;
  catalog_title?: string | null;
  project_name?: string | null;
  installment_label?: string | null;
  installment_sequence_number?: number | null;
  send_status?: string | null;
  sent_at?: string | null;
  cancellation_reason?: string | null;
  overdue_days?: number | null;
  last_reminder_at?: string | null;
  items?: SalesInvoiceItem[];
  payments?: SalesInvoicePayment[];
  documents?: SalesDocumentGeneration[];
  payment_destinations?: SalesReservationPaymentDestinations | null;
};

export type SalesAutomationRun = {
  id: number;
  organization_id: number;
  automation_type: (typeof SALES_AUTOMATION_TYPES)[number] | string;
  period_key: string;
  status: (typeof SALES_AUTOMATION_RUN_STATUSES)[number] | string;
  execution_mode: string;
  started_at: string;
  completed_at?: string | null;
  heartbeat_at?: string | null;
  eligible_count: number;
  processed_count: number;
  created_count: number;
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  error_summary?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SalesInvoiceReminder = {
  id: number;
  organization_id: number;
  invoice_id: number;
  subscription_id: number;
  buyer_id?: number | null;
  reminder_type: (typeof SALES_INVOICE_REMINDER_TYPES)[number] | string;
  reminder_stage?: string | null;
  scheduled_for: string;
  sent_at?: string | null;
  status: (typeof SALES_INVOICE_REMINDER_STATUSES)[number] | string;
  channel: string;
  recipient?: string | null;
  masked_recipient?: string | null;
  communication_log_id?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
  communication_status?: string | null;
  communication_subject?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type SalesCollectionsSummary = {
  total_balance_due: number;
  overdue_balance: number;
  upcoming_balance: number;
  collected_this_month: number;
  overdue_invoices: number;
  buyers_with_balance: number;
};

export type SalesCollectionInvoice = SalesInvoice & {
  buyer_id?: number | null;
  project_id?: number | null;
  overdue_days?: number | null;
  last_reminder_at?: string | null;
};

export type SalesCollectionsResponse = {
  summary: SalesCollectionsSummary | null;
  items: SalesCollectionInvoice[];
  total: number;
  page: number;
  pageSize: number;
};

export type SalesSubscriptionFinancialSummary = {
  subscription_id: number;
  subscription_number: string;
  currency: string;
  final_sale_price: number;
  deposit_expected: number;
  deposit_paid: number;
  financed_balance: number;
  total_invoiced: number;
  total_paid: number;
  total_refunded: number;
  balance_due: number;
  global_balance_due: number;
  amount_due: number;
  overdue_amount: number;
  next_due_date?: string | null;
  installments_paid: number;
  installments_remaining: number;
  installments_overdue: number;
  reservation_fee: {
    paid: number;
    refunded: number;
    allocated: number;
    available: number;
  };
  installments: Array<SalesSubscriptionInstallment & {
    invoice_id?: number | null;
    invoice_number?: string | null;
    invoice_status?: string | null;
    total_amount?: number | null;
    paid_amount?: number | null;
    refunded_amount?: number | null;
    balance_due?: number | null;
    financial_status?: string | null;
  }>;
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

export type CreateSalesBuyerInput = {
  buyer_ref?: string;
  buyer_type: string;
  full_name?: string;
  company_name?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  id_document_type?: string;
  id_document_number?: string;
  tax_number?: string;
  status?: string;
  commercial_stage?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSalesProjectInput = {
  project_ref?: string;
  name: string;
  description?: string;
  location_label?: string;
  status?: string;
  launch_date?: string;
  closing_date?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSalesCatalogInput = {
  catalog_ref?: string;
  property_type: string;
  title: string;
  description?: string;
  project_id?: number;
  building_id?: number;
  unit_id?: number;
  list_price?: number;
  minimum_price?: number;
  currency?: string;
  commercial_status?: string;
  availability_date?: string;
  surface_area?: number;
  location_label?: string;
  metadata?: Record<string, unknown>;
};

export type CreateSalesReservationInput = {
  reservation_number?: string;
  buyer_id: number;
  catalog_item_id: number;
  project_id?: number;
  status?: string;
  currency: string;
  catalog_price: number;
  negotiated_price: number;
  reservation_fee?: number;
  reservation_date: string;
  expires_at?: string;
  notes?: string;
};

export type SalesStatusActionInput = {
  reason?: string;
};

export type CreateSalesReservationPaymentInput = {
  amount: number;
  payment_date: string;
  payment_method: string;
  destination_type: string;
  cash_session_id?: number;
  bank_account_id?: number;
  external_reference?: string;
  notes?: string;
  idempotency_key?: string;
};

export type CancelSalesReservationPaymentInput = {
  reason: string;
};

export type CreateSalesReservationRefundInput = {
  amount: number;
  refund_date: string;
  refund_method: string;
  destination_type: string;
  cash_session_id?: number;
  bank_account_id?: number;
  reason: string;
  external_reference?: string;
  notes?: string;
  idempotency_key?: string;
};

export type CustomInstallmentInput = {
  sequence_number?: number;
  label?: string;
  due_date?: string;
  amount: number;
  currency: string;
  installment_type?: string;
};

export type SimulateSalesSubscriptionInput = {
  origin_mode?: (typeof SALES_SUBSCRIPTION_ORIGIN_MODES)[number] | string;
  buyer_id: number;
  catalog_item_id: number;
  project_id?: number;
  reservation_id?: number;
  currency: string;
  catalog_price: number;
  negotiated_price?: number;
  discount_amount?: number;
  deposit_type: string;
  deposit_percentage?: number;
  deposit_amount?: number;
  installment_count: number;
  frequency: string;
  first_due_date?: string;
  grace_period_days?: number;
  allow_custom_schedule?: boolean;
  custom_installments?: CustomInstallmentInput[];
};

export type CreateSalesSubscriptionInput = SimulateSalesSubscriptionInput & {
  subscription_number?: string;
  status?: string;
  notes?: string;
};
