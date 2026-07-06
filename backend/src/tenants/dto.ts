import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { TENANT_STATUSES } from '../common/status';

export class CreateTenantDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsInt()
  unit_id: number;

  @IsDateString()
  move_in_date: string;

  @IsIn(TENANT_STATUSES)
  status: string;
}

export class UpdateTenantDto extends PartialType(CreateTenantDto) {}
