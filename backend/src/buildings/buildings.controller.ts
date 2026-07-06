import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto, UpdateBuildingDto } from './dto';

@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  findAll() {
    return this.buildings.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.buildings.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBuildingDto) {
    return this.buildings.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBuildingDto) {
    return this.buildings.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.buildings.remove(id);
  }
}
