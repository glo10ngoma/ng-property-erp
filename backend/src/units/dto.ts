import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsInt, IsNumber, IsString, Min } from 'class-validator';
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
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}
