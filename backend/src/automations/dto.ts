import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdateMonthlyRentBillingDto {
  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  execution_time?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  due_day?: number;

  @IsOptional()
  @IsBoolean()
  email_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp_enabled?: boolean;
}

export class PreviewMonthlyRentBillingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;
}

export class RunMonthlyRentBillingDto extends PreviewMonthlyRentBillingDto {}

export class AutomationRunsQueryDto {
  @IsOptional()
  @IsString()
  automationCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['AUTOMATIC', 'MANUAL'])
  executionMode?: 'AUTOMATIC' | 'MANUAL';
}
