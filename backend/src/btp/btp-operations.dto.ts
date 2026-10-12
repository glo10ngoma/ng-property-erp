import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const trim = () =>
  Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

export class BtpScopeQueryDto {
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() project_id?: number;
  @trim() @IsString() @IsOptional() status?: string;
}

export class CreateBtpBudgetLineDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() phase_id?: number;
  @IsIn([
    "MATERIALS",
    "LABOR",
    "SUBCONTRACTING",
    "TRANSPORT",
    "EQUIPMENT",
    "OTHER",
  ])
  category!: string;
  @trim() @IsString() @MaxLength(180) label!: string;
  @Type(() => Number) @IsNumber() @Min(0) planned_amount!: number;
  @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
}

export class CreateBtpPurchaseDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() phase_id?: number;
  @IsIn(["REQUEST", "ORDER", "DELIVERY"]) document_type!: string;
  @trim() @IsString() @MaxLength(80) reference!: string;
  @trim() @IsString() @MaxLength(180) @IsOptional() supplier_name?: string;
  @IsIn([
    "MATERIALS",
    "LABOR",
    "SUBCONTRACTING",
    "TRANSPORT",
    "EQUIPMENT",
    "OTHER",
  ])
  category!: string;
  @trim() @IsString() description!: string;
  @IsDateString() document_date!: string;
  @IsDateString() @IsOptional() expected_date?: string;
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional() amount?: number;
  @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
  @IsIn([
    "DRAFT",
    "PENDING",
    "APPROVED",
    "ORDERED",
    "PARTIAL",
    "RECEIVED",
    "CANCELLED",
  ])
  @IsOptional()
  status?: string;
}

export class CreateBtpStockMovementDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() phase_id?: number;
  @IsIn(["OUT", "RETURN", "ADJUSTMENT"]) movement_type!: string;
  @IsDateString() movement_date!: string;
  @trim() @IsString() @MaxLength(180) material_name!: string;
  @Type(() => Number) @IsNumber() @IsPositive() quantity!: number;
  @trim() @IsString() @MaxLength(30) unit!: string;
  @trim() @IsString() @MaxLength(80) @IsOptional() reference?: string;
  @trim() @IsString() @IsOptional() notes?: string;
}

export class CreateBtpSiteLogDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() phase_id?: number;
  @IsIn(["JOURNAL", "PHOTO", "DOCUMENT", "INCIDENT", "TASK", "OBSERVATION"])
  log_type!: string;
  @IsDateString() event_date!: string;
  @trim() @IsString() @MaxLength(180) title!: string;
  @trim() @IsString() @IsOptional() content?: string;
  @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"])
  @IsOptional()
  status?: string;
  @trim() @IsString() @IsOptional() attachment_url?: string;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress_percent?: number;
}

export class CreateBtpClientContractDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @trim() @IsString() @MaxLength(80) reference!: string;
  @trim() @IsString() @MaxLength(180) client_name!: string;
  @trim() @IsString() @IsOptional() description?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  @Type(() => Number) @IsNumber() @Min(0) contract_amount!: number;
  @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
  @IsIn(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"])
  @IsOptional()
  status?: string;
}

export class CreateBtpClientTransactionDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() contract_id?: number;
  @IsIn(["INVOICE", "PAYMENT"]) transaction_type!: string;
  @trim() @IsString() @MaxLength(80) reference!: string;
  @IsDateString() transaction_date!: string;
  @IsDateString() @IsOptional() due_date?: string;
  @trim() @IsString() description!: string;
  @Type(() => Number) @IsNumber() @IsPositive() amount!: number;
  @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
  @IsIn(["DRAFT", "ISSUED", "PARTIAL", "PAID", "CANCELLED"])
  @IsOptional()
  status?: string;
}

export class UpdateBtpRecordStatusDto {
  @trim() @IsString() status!: string;
}
