import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PAYMENT_METHODS } from '../common/status';

export class PaymentAllocationDto {
  @IsInt()
  invoice_id: number;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreatePaymentDto {
  @IsOptional()
  @IsInt()
  invoice_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];

  @IsDateString()
  payment_date: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsIn(['USD', 'CDF', 'MIXED'])
  payment_currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount_usd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount_cdf?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  exchange_rate_used?: number;

  @IsOptional()
  @IsDateString()
  exchange_rate_date?: string;

  @IsIn(PAYMENT_METHODS)
  payment_method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  payer_name?: string;
}

export class UpdatePaymentDto extends CreatePaymentDto {}
