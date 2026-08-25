import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, ValidateNested } from 'class-validator';
import {
  SALES_AUTOMATION_EXECUTION_MODES,
  SALES_AUTOMATION_RUN_STATUSES,
  SALES_AUTOMATION_TYPES,
  SALES_BUYER_STATUSES,
  SALES_BUYER_TYPES,
  SALES_COLLECTION_EMAIL_MODES,
  SALES_COMMERCIAL_STATUSES,
  SALES_COMMERCIAL_STAGES,
  SALES_DEPOSIT_TYPES,
  SALES_DOCUMENT_GENERATION_STATUSES,
  SALES_INSTALLMENT_TYPES,
  SALES_INVOICE_REMINDER_STATUSES,
  SALES_INVOICE_REMINDER_TYPES,
  SALES_PROJECT_STATUSES,
  SALES_RESERVATION_DESTINATION_TYPES,
  SALES_RESERVATION_PAYMENT_METHODS,
  SALES_RESERVATION_PAYMENT_STATUSES,
  SALES_RESERVATION_STATUSES,
  SALES_SCHEDULE_FREQUENCIES,
  SALES_SUBSCRIPTION_STATUSES,
  SALES_SUBSCRIPTION_ORIGIN_MODES,
  SALES_SUPPORTED_CURRENCIES,
  SALES_TEMPLATE_TYPES,
} from './types';

const trimString = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const numberArray = () =>
  Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    const source = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').map((item) => item.trim()).filter(Boolean)
        : [value];
    return source.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  });

export class SalesPaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;

  @trimString()
  @IsOptional()
  @IsString()
  search?: string;

  @trimString()
  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortOrder?: string = 'desc';
}

export class SalesBuyerListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(['buyer_ref', 'full_name', 'company_name', 'created_at', 'updated_at'])
  sortBy?: string = 'created_at';

  @trimString()
  @IsOptional()
  @IsIn(SALES_BUYER_STATUSES)
  status?: string;
}

export class SalesProjectListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(['project_ref', 'name', 'status', 'created_at', 'updated_at'])
  sortBy?: string = 'created_at';

  @trimString()
  @IsOptional()
  @IsIn(SALES_PROJECT_STATUSES)
  status?: string;
}

export class SalesCatalogListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(['catalog_ref', 'title', 'commercial_status', 'list_price', 'created_at', 'updated_at'])
  sortBy?: string = 'created_at';

  @trimString()
  @IsOptional()
  @IsIn(SALES_COMMERCIAL_STATUSES)
  status?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  project_id?: number;

  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  available_only?: boolean;
}

export class SalesReservationListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(['reservation_number', 'status', 'reservation_date', 'expires_at', 'updated_at'])
  sortBy?: string = 'updated_at';

  @trimString()
  @IsOptional()
  @IsIn(SALES_RESERVATION_STATUSES)
  status?: string;
}

export class SalesSubscriptionListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(['subscription_number', 'status', 'created_at', 'updated_at', 'first_due_date'])
  sortBy?: string = 'updated_at';

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUBSCRIPTION_STATUSES)
  status?: string;
}

export class UpdateSalesSettingsDto {
  @trimString()
  @IsOptional()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  default_currency?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  secondary_currency?: string;

  @trimString()
  @IsOptional()
  @IsString()
  quotation_prefix?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_prefix?: string;

  @trimString()
  @IsOptional()
  @IsString()
  contract_prefix?: string;

  @trimString()
  @IsOptional()
  @IsString()
  receipt_prefix?: string;

  @trimString()
  @IsOptional()
  @IsString()
  invoice_prefix?: string;

  @trimString()
  @IsOptional()
  @IsString()
  buyer_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  project_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  catalog_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  subscription_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_contract_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  subscription_contract_number_format?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  reservation_default_duration_days?: number;

  @IsOptional()
  @IsBoolean()
  reservation_fee_required?: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  reservation_default_fee?: number;

  @IsOptional()
  @IsBoolean()
  reservation_fee_enabled?: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  reservation_fee_default_amount?: number;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  reservation_fee_default_currency?: string;

  @trimString()
  @IsOptional()
  @IsIn(['DEDUCTIBLE', 'NON_DEDUCTIBLE', 'PARTIALLY_DEDUCTIBLE'])
  reservation_fee_deductibility?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  reservation_fee_deductible_percentage?: number;

  @IsOptional()
  @IsBoolean()
  reservation_fee_refundable?: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  reservation_fee_refundable_percentage?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  reservation_fee_refund_deadline_days?: number;

  @trimString()
  @IsOptional()
  @IsIn(['CUSTOMER_ADVANCE', 'RESERVATION_FEE_REVENUE'])
  reservation_fee_accounting_treatment?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_payment_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_refund_number_format?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reservation_receipt_number_format?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_DEPOSIT_TYPES)
  minimum_deposit_type?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  minimum_deposit_percentage?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minimum_deposit_amount?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maximum_installment_count?: number;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SCHEDULE_FREQUENCIES)
  default_installment_frequency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  grace_period_days?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  discount_approval_threshold_percentage?: number;

  @IsOptional()
  @IsBoolean()
  allow_custom_schedule?: boolean;

  @IsArray()
  @IsOptional()
  allowed_currencies?: string[];

  @trimString()
  @IsOptional()
  @IsString()
  contract_generation_mode?: string;

  @trimString()
  @IsOptional()
  @IsString()
  invoice_generation_mode?: string;

  @trimString()
  @IsOptional()
  @IsString()
  revenue_recognition_mode?: string;

  @IsOptional()
  @IsBoolean()
  sales_installment_automation_enabled?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sales_auto_generate_invoice_days_before?: number;

  @IsOptional()
  @IsBoolean()
  sales_auto_issue_invoice?: boolean;

  @IsOptional()
  @IsBoolean()
  sales_auto_send_invoice?: boolean;

  @IsOptional()
  @IsBoolean()
  sales_reminders_enabled?: boolean;

  @numberArray()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @IsOptional()
  sales_reminder_days_before?: number[];

  @numberArray()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @IsOptional()
  sales_overdue_reminder_days?: number[];

  @trimString()
  @IsOptional()
  @IsString()
  sales_reminder_execution_time?: string;

  @trimString()
  @IsOptional()
  @IsString()
  sales_reminder_timezone?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sales_max_reminders_per_invoice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  @IsOptional()
  sales_reminder_cooldown_hours?: number;

  @trimString()
  @IsOptional()
  @IsIn(SALES_COLLECTION_EMAIL_MODES)
  sales_collection_email_mode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sales_overdue_grace_days?: number;

  @IsOptional()
  settings_json?: Record<string, unknown>;
}

export class CreateSalesBuyerDto {
  @trimString()
  @IsOptional()
  @IsString()
  buyer_ref?: string;

  @trimString()
  @IsIn(SALES_BUYER_TYPES)
  buyer_type!: string;

  @trimString()
  @IsOptional()
  @IsString()
  full_name?: string;

  @trimString()
  @IsOptional()
  @IsString()
  company_name?: string;

  @trimString()
  @IsOptional()
  @IsString()
  phone?: string;

  @trimString()
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @trimString()
  @IsOptional()
  @IsEmail()
  email?: string;

  @trimString()
  @IsOptional()
  @IsString()
  address?: string;

  @trimString()
  @IsOptional()
  @IsString()
  city?: string;

  @trimString()
  @IsOptional()
  @IsString()
  country?: string;

  @trimString()
  @IsOptional()
  @IsString()
  id_document_type?: string;

  @trimString()
  @IsOptional()
  @IsString()
  id_document_number?: string;

  @trimString()
  @IsOptional()
  @IsString()
  tax_number?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_BUYER_STATUSES)
  status?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_COMMERCIAL_STAGES)
  commercial_stage?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateSalesBuyerDto extends PartialType(CreateSalesBuyerDto) {}

export class CreateSalesProjectDto {
  @trimString()
  @IsOptional()
  @IsString()
  project_ref?: string;

  @trimString()
  @IsString()
  name!: string;

  @trimString()
  @IsOptional()
  @IsString()
  description?: string;

  @trimString()
  @IsOptional()
  @IsString()
  location_label?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_PROJECT_STATUSES)
  status?: string;

  @trimString()
  @IsOptional()
  @IsString()
  launch_date?: string;

  @trimString()
  @IsOptional()
  @IsString()
  closing_date?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateSalesProjectDto extends PartialType(CreateSalesProjectDto) {}

export class CreateSalesCatalogItemDto {
  @trimString()
  @IsOptional()
  @IsString()
  catalog_ref?: string;

  @trimString()
  @IsString()
  property_type!: string;

  @trimString()
  @IsString()
  title!: string;

  @trimString()
  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  project_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  building_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  unit_id?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  list_price?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minimum_price?: number;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  currency?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_COMMERCIAL_STATUSES)
  commercial_status?: string;

  @trimString()
  @IsOptional()
  @IsString()
  availability_date?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  surface_area?: number;

  @trimString()
  @IsOptional()
  @IsString()
  location_label?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateSalesCatalogItemDto extends PartialType(CreateSalesCatalogItemDto) {}

export class UpdateSalesCatalogStatusDto {
  @trimString()
  @IsIn(SALES_COMMERCIAL_STATUSES)
  commercial_status!: string;
}

export class CreateSalesReservationDto {
  @trimString()
  @IsOptional()
  @IsString()
  reservation_number?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  buyer_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  catalog_item_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  project_id?: number;

  @trimString()
  @IsOptional()
  @IsIn(SALES_RESERVATION_STATUSES)
  status?: string;

  @trimString()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  catalog_price!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  negotiated_price!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  reservation_fee?: number;

  @trimString()
  @IsString()
  reservation_date!: string;

  @trimString()
  @IsOptional()
  @IsString()
  expires_at?: string;

  @trimString()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSalesReservationDto extends PartialType(CreateSalesReservationDto) {}

export class SalesReservationStatusActionDto {
  @trimString()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateSalesReservationPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @trimString()
  @IsString()
  payment_date!: string;

  @trimString()
  @IsIn(SALES_RESERVATION_PAYMENT_METHODS)
  payment_method!: string;

  @trimString()
  @IsIn(SALES_RESERVATION_DESTINATION_TYPES)
  destination_type!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  cash_session_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  bank_account_id?: number;

  @trimString()
  @IsOptional()
  @IsString()
  external_reference?: string;

  @trimString()
  @IsOptional()
  @IsString()
  notes?: string;

  @trimString()
  @IsOptional()
  @IsString()
  idempotency_key?: string;
}

export class CancelSalesReservationPaymentDto {
  @trimString()
  @IsString()
  reason!: string;
}

export class CreateSalesReservationRefundDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @trimString()
  @IsString()
  refund_date!: string;

  @trimString()
  @IsIn(SALES_RESERVATION_PAYMENT_METHODS)
  refund_method!: string;

  @trimString()
  @IsIn(SALES_RESERVATION_DESTINATION_TYPES)
  destination_type!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  cash_session_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  bank_account_id?: number;

  @trimString()
  @IsString()
  reason!: string;

  @trimString()
  @IsOptional()
  @IsString()
  external_reference?: string;

  @trimString()
  @IsOptional()
  @IsString()
  notes?: string;

  @trimString()
  @IsOptional()
  @IsString()
  idempotency_key?: string;
}

export class CustomInstallmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  sequence_number?: number;

  @trimString()
  @IsOptional()
  @IsString()
  label?: string;

  @trimString()
  @IsOptional()
  @IsString()
  due_date?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @trimString()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  currency!: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_INSTALLMENT_TYPES)
  installment_type?: string;
}

export class SimulateSalesSubscriptionDto {
  @trimString()
  @IsOptional()
  @IsIn(SALES_SUBSCRIPTION_ORIGIN_MODES)
  origin_mode?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  buyer_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  catalog_item_id!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  project_id?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  reservation_id?: number;

  @trimString()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  catalog_price!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  negotiated_price?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  @trimString()
  @IsIn(SALES_DEPOSIT_TYPES)
  deposit_type!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  deposit_percentage?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  deposit_amount?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  installment_count!: number;

  @trimString()
  @IsIn(SALES_SCHEDULE_FREQUENCIES)
  frequency!: string;

  @trimString()
  @IsOptional()
  @IsString()
  first_due_date?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  grace_period_days?: number;

  @IsOptional()
  allow_custom_schedule?: boolean;

  @IsOptional()
  @Type(() => CustomInstallmentDto)
  @ValidateNested({ each: true })
  @IsArray()
  custom_installments?: CustomInstallmentDto[];
}

export class CreateSalesSubscriptionDto extends SimulateSalesSubscriptionDto {
  @trimString()
  @IsOptional()
  @IsString()
  subscription_number?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUBSCRIPTION_STATUSES)
  status?: string;

  @trimString()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSalesSubscriptionDto extends PartialType(CreateSalesSubscriptionDto) {}

export class SalesInvoiceListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsString()
  search?: string;

  @trimString()
  @IsOptional()
  @IsIn(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
  status?: string;

  @trimString()
  @IsOptional()
  @IsIn(['invoice_number', 'status', 'issue_date', 'due_date', 'total_amount', 'paid_amount', 'balance_due', 'created_at', 'updated_at'])
  sortBy?: string = 'due_date';
}

export class SalesDocumentTemplateDto {
  @trimString()
  @IsIn(SALES_TEMPLATE_TYPES)
  template_type!: string;

  @trimString()
  @IsString()
  title!: string;

  @trimString()
  @IsString()
  template_body!: string;

  @trimString()
  @IsOptional()
  @IsString()
  header_html?: string;

  @trimString()
  @IsOptional()
  @IsString()
  footer_html?: string;

  @IsArray()
  @IsOptional()
  variables_schema?: string[];

  @IsArray()
  @IsOptional()
  clause_order?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSalesDocumentTemplateDto extends PartialType(SalesDocumentTemplateDto) {}

export class RegenerateSalesDocumentDto {
  @trimString()
  @IsOptional()
  @IsIn(SALES_DOCUMENT_GENERATION_STATUSES)
  generation_status?: string;
}

export class SalesAutomationRunListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(SALES_AUTOMATION_TYPES)
  automation_type?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_AUTOMATION_RUN_STATUSES)
  status?: string;
}

export class SalesAutomationExecuteDto {
  @trimString()
  @IsOptional()
  @IsString()
  as_of_date?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_AUTOMATION_EXECUTION_MODES)
  execution_mode?: string;

  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SalesInvoiceReminderListQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsIn(SALES_INVOICE_REMINDER_TYPES)
  reminder_type?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_INVOICE_REMINDER_STATUSES)
  status?: string;
}

export class SendSalesInvoiceReminderDto {
  @trimString()
  @IsIn(SALES_INVOICE_REMINDER_TYPES)
  reminder_type!: string;

  @trimString()
  @IsOptional()
  @IsString()
  reminder_stage?: string;

  @trimString()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SalesCollectionsQueryDto extends SalesPaginationQueryDto {
  @trimString()
  @IsOptional()
  @IsString()
  buyer_id?: string;

  @trimString()
  @IsOptional()
  @IsString()
  project_id?: string;

  @trimString()
  @IsOptional()
  @IsIn(SALES_SUPPORTED_CURRENCIES)
  currency?: string;

  @trimString()
  @IsOptional()
  @IsIn(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
  status?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  min_overdue_days?: number;
}
