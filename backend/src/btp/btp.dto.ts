import { PartialType } from "@nestjs/mapped-types";
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

export class BtpListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;
  @trim() @IsString() @IsOptional() search?: string;
  @trim() @IsString() @IsOptional() status?: string;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() project_id?: number;
}

export class CreateBtpProjectDto {
  @trim() @IsString() @MaxLength(50) project_ref!: string;
  @trim() @IsString() @MaxLength(180) name!: string;
  @trim() @IsString() @MaxLength(180) @IsOptional() client_name?: string;
  @trim() @IsString() @IsOptional() location_label?: string;
  @trim() @IsString() @IsOptional() description?: string;
  @trim()
  @IsIn(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"])
  @IsOptional()
  status?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() planned_end_date?: string;
  @IsDateString() @IsOptional() actual_end_date?: string;
  @trim() @IsString() @MaxLength(180) @IsOptional() manager_name?: string;
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional() planned_budget?: number;
  @trim() @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress_percent?: number;
}

export class UpdateBtpProjectDto extends PartialType(CreateBtpProjectDto) {}

export class CreateBtpPhaseDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @trim() @IsString() @MaxLength(50) phase_ref!: string;
  @trim() @IsString() @MaxLength(180) name!: string;
  @trim() @IsString() @IsOptional() description?: string;
  @trim()
  @IsIn(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"])
  @IsOptional()
  status?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() planned_end_date?: string;
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional() planned_budget?: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress_percent?: number;
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() sort_order?: number;
}

export class UpdateBtpPhaseDto extends PartialType(CreateBtpPhaseDto) {}

export class CreateBtpExpenseDto {
  @Type(() => Number) @IsInt() @IsPositive() project_id!: number;
  @Type(() => Number) @IsInt() @IsPositive() @IsOptional() phase_id?: number;
  @IsDateString() expense_date!: string;
  @trim() @IsString() @MaxLength(80) @IsOptional() reference?: string;
  @trim()
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
  @trim() @IsString() @MaxLength(180) @IsOptional() supplier_name?: string;
  @Type(() => Number) @IsNumber() @IsPositive() amount!: number;
  @trim() @IsIn(["USD", "CDF"]) @IsOptional() currency?: string;
  @trim()
  @IsIn(["DRAFT", "APPROVED", "PAID", "CANCELLED"])
  @IsOptional()
  status?: string;
  @trim() @IsString() @MaxLength(30) @IsOptional() payment_method?: string;
}

export class UpdateBtpExpenseDto extends PartialType(CreateBtpExpenseDto) {}
