import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class InvoiceItemDto {
  @IsOptional()
  @IsString()
  item_type?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  amount: number;
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}

export class UpdateInvoiceDto {
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
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}
