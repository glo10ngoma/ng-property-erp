import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

function optionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

export class UpdateEmailSettingsDto {
  @Transform(({ value }) => optionalTrimmedString(value)?.toUpperCase() ?? 'RESEND')
  @IsIn(['RESEND'])
  provider!: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  from_name?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  from_email?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  reply_to?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  api_key?: string;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled!: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  auto_send_invoice?: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  auto_send_payment_receipt?: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  auto_send_tenant_credit_receipt?: boolean;
}
