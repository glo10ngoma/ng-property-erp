import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';
import {
  SALES_BUYER_STATUSES,
  SALES_BUYER_TYPES,
  SALES_COMMERCIAL_STATUSES,
  SALES_PROJECT_STATUSES,
  SALES_SUPPORTED_CURRENCIES,
} from './types';

const trimString = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

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

  @IsOptional()
  settings_json?: Record<string, unknown>;
}

export class CreateSalesBuyerDto {
  @trimString()
  @IsString()
  buyer_ref!: string;

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

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateSalesBuyerDto extends PartialType(CreateSalesBuyerDto) {}

export class CreateSalesProjectDto {
  @trimString()
  @IsString()
  project_ref!: string;

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
  @IsString()
  catalog_ref!: string;

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
