import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  name: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  building_type?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateBuildingDto extends PartialType(CreateBuildingDto) {}
