import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { UNIT_STATUSES } from '../common/status';

export class CreateUnitDto {
  @IsInt()
  building_id: number;

  @IsString()
  number: string;

  @IsInt()
  @Min(0)
  floor: number;

  @IsString()
  type: string;

  @IsNumber()
  @Min(0)
  monthly_rent: number;

  @IsIn(UNIT_STATUSES)
  status: string;

  @IsOptional()
  @IsNumber()
  surface_area?: number;

  @IsOptional()
  @IsInt()
  bedrooms_count?: number;

  @IsOptional()
  @IsInt()
  bathrooms_count?: number;

  @IsOptional()
  has_balcony?: boolean;

  @IsOptional()
  has_parking?: boolean;

  @IsOptional()
  is_furnished?: boolean;

  @IsOptional()
  has_air_conditioning?: boolean;

  @IsOptional()
  has_equipped_kitchen?: boolean;

  @IsOptional()
  has_internet?: boolean;

  @IsOptional()
  has_water_meter?: boolean;

  @IsOptional()
  @IsString()
  water_meter_number?: string;

  @IsOptional()
  has_electricity_meter?: boolean;

  @IsOptional()
  @IsString()
  electricity_meter_number?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  observations?: string;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}
