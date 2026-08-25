import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const PLATFORM_ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const;
const PLATFORM_USER_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const PLATFORM_SCOPED_ROLE_CODES = ['ADMIN_CLIENT', 'EDITOR_CLIENT', 'VIEWER_CLIENT'] as const;
const PLATFORM_ROLES = ['SUPER_ADMIN', 'ADMIN_PLATFORM'] as const;

function trimNullableString(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

function normalizeUppercase(value: unknown) {
  const normalized = trimNullableString(value);
  return normalized ? normalized.toUpperCase() : undefined;
}

function normalizeLowercase(value: unknown) {
  const normalized = trimNullableString(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function normalizeBoolean(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'oui'].includes(normalized)) return true;
  if (['false', '0', 'no', 'non'].includes(normalized)) return false;
  return value;
}

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
  @Transform(({ value }) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().toUpperCase();
    return normalized || null;
  })
  @IsIn(['MR', 'MRS'])
  legal_representative_civility?: string | null;

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

export class PlatformListQueryDto {
  @IsOptional()
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value))
  @IsString()
  @IsIn(['ALL', ...PLATFORM_ORGANIZATION_STATUSES, ...PLATFORM_USER_STATUSES])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organizationId?: number;
}

export class CreatePlatformOrganizationDto {
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(160)
  name!: string;

  @Transform(({ value }) => normalizeLowercase(value))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug!: string;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value) ?? 'ACTIVE')
  @IsString()
  @IsIn(PLATFORM_ORGANIZATION_STATUSES)
  status?: string;
}

export class UpdatePlatformOrganizationDto {
  @IsOptional()
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowercase(value))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value))
  @IsString()
  @IsIn(PLATFORM_ORGANIZATION_STATUSES)
  status?: string;
}

export class CreatePlatformUserDto {
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(120)
  first_name!: string;

  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(120)
  last_name!: string;

  @Transform(({ value }) => normalizeLowercase(value))
  @IsEmail()
  @MaxLength(190)
  email!: string;

  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(160)
  password!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value) ?? 'ACTIVE')
  @IsString()
  @IsIn(PLATFORM_USER_STATUSES)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return null;
    return normalizeUppercase(value);
  })
  @IsOptional()
  @IsIn([...PLATFORM_ROLES, null] as const)
  platform_role?: string | null;
}

export class UpdatePlatformUserDto {
  @IsOptional()
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(120)
  first_name?: string;

  @IsOptional()
  @Transform(({ value }) => trimNullableString(value))
  @IsString()
  @MaxLength(120)
  last_name?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowercase(value))
  @IsEmail()
  @MaxLength(190)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value))
  @IsString()
  @IsIn(PLATFORM_USER_STATUSES)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return null;
    return normalizeUppercase(value);
  })
  @IsOptional()
  @IsIn([...PLATFORM_ROLES, null] as const)
  platform_role?: string | null;
}

export class CreatePlatformMembershipDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  user_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id!: number;

  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value) ?? 'VIEWER_CLIENT')
  @IsString()
  @IsIn(PLATFORM_SCOPED_ROLE_CODES)
  role_code?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  is_default?: boolean;
}

export class UpdatePlatformMembershipDto {
  @IsOptional()
  @Transform(({ value }) => normalizeUppercase(value))
  @IsString()
  @IsIn(PLATFORM_SCOPED_ROLE_CODES)
  role_code?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Transform(({ value }) => normalizeBoolean(value))
  @IsBoolean()
  is_default?: boolean;
}
