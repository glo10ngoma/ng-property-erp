import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class InvoiceItemDto {
  @IsOptional()
  @IsString()
  item_type?: string;

  @IsOptional()
  @IsString()
  charge_type?: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unit_price?: number;
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsInt()
  tenant_id?: number;

  @IsOptional()
  @IsInt()
  lease_id?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  invoice_type?: string;

  @IsInt()
  @Min(1)
  month: number;

  @IsInt()
  @Min(2000)
  year: number;

  @IsDateString()
  issue_date: string;

  @IsDateString()
  due_date: string;

  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  billing_year?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @IsString()
  public_notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  attachment_file_name?: string;

  @IsOptional()
  @IsString()
  attachment_file_url?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  invoice_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;

  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  billing_year?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @IsString()
  public_notes?: string;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  @IsOptional()
  @IsString()
  attachment_file_name?: string;

  @IsOptional()
  @IsString()
  attachment_file_url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}
