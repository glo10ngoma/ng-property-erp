import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsString()
  invoice_logo_url?: string;

  @IsOptional()
  @IsString()
  signature_url?: string;

  @IsOptional()
  @IsString()
  stamp_url?: string;

  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsString()
  legal_name?: string;

  @IsOptional()
  @IsString()
  company_legal_name?: string;

  @IsOptional()
  @IsString()
  company_acronym?: string;

  @IsOptional()
  @IsString()
  company_legal_form?: string;

  @IsOptional()
  @IsString()
  company_rccm?: string;

  @IsOptional()
  @IsString()
  company_national_id?: string;

  @IsOptional()
  @IsString()
  company_tax_id?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  company_address?: string;

  @IsOptional()
  @IsString()
  company_commune?: string;

  @IsOptional()
  @IsString()
  company_city?: string;

  @IsOptional()
  @IsString()
  company_country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  legal_representative_name?: string;

  @IsOptional()
  @IsString()
  legal_representative_title?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  invoice_footer?: string;

  @IsOptional()
  @IsString()
  paper_format?: string;

  @IsOptional()
  @IsString()
  invoice_bottom_text?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  default_lease_duration_months?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  default_notice_months?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  default_guarantee_months?: number;

  @IsOptional()
  @IsString()
  default_signature_place?: string;

  @IsOptional()
  @IsString()
  default_lease_usage?: string;

  @IsOptional()
  @IsString()
  default_contract_template_code?: string;
}

export class UpdateExchangeRateDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rate?: number;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  effective_date?: string;
}

export class SendTestEmailDto {
  @IsEmail()
  recipient!: string;
}
