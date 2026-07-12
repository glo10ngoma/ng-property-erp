import { PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { TENANT_STATUSES } from '../common/status';

export class CreateTenantDto {
  @IsOptional()
  @IsIn(['PHYSICAL', 'COMPANY'])
  tenant_type?: string;

  @ValidateIf((dto) => (dto.tenant_type ?? 'PHYSICAL') === 'PHYSICAL')
  @IsString()
  @IsNotEmpty()
  first_name?: string;

  @ValidateIf((dto) => (dto.tenant_type ?? 'PHYSICAL') === 'PHYSICAL')
  @IsString()
  @IsNotEmpty()
  last_name?: string;

  @IsOptional()
  @IsString()
  post_name?: string;

  @ValidateIf((dto) => (dto.tenant_type ?? 'PHYSICAL') === 'COMPANY')
  @IsString()
  @IsNotEmpty()
  company_name?: string;

  @IsOptional()
  @IsString()
  legal_form?: string;

  @IsOptional()
  @IsString()
  rccm?: string;

  @IsOptional()
  @IsString()
  national_id_number?: string;

  @IsOptional()
  @IsString()
  tax_number?: string;

  @IsOptional()
  @IsString()
  business_sector?: string;

  @IsOptional()
  @IsString()
  legal_representative_name?: string;

  @IsOptional()
  @IsString()
  representative_post_name?: string;

  @IsOptional()
  @IsString()
  representative_first_name?: string;

  @IsOptional()
  @IsString()
  legal_representative_role?: string;

  @IsOptional()
  @IsString()
  legal_representative_phone?: string;

  @IsOptional()
  @IsEmail()
  legal_representative_email?: string;

  @IsOptional()
  @IsString()
  company_document_name?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  secondary_phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  commune?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  id_document_type?: string;

  @IsOptional()
  @IsString()
  id_number?: string;

  @IsOptional()
  @IsString()
  id_document_file_name?: string;

  @IsOptional()
  @IsString()
  id_document_file_url?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  emergency_contact_name?: string;

  @IsOptional()
  @IsString()
  emergency_contact_phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  unit_id?: number;

  @IsOptional()
  @IsDateString()
  move_in_date?: string;

  @IsIn(TENANT_STATUSES)
  status: string;
}

export class UpdateTenantDto extends PartialType(CreateTenantDto) {}
