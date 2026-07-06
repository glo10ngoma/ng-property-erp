import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CreateUnitDto, UpdateUnitDto } from './dto';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  findAll() {
    return this.units.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.units.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUnitDto) {
    return this.units.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUnitDto) {
    return this.units.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.units.remove(id);
  }
}
