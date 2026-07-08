import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { TENANT_STATUSES } from '../common/status';

export class CreateTenantDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsOptional()
  @IsString()
  post_name?: string;

  @IsString()
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
