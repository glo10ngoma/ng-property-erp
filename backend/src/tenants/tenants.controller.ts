import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { CreateTenantDto, UpdateTenantDto } from './dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  findAll() {
    return this.tenants.findAll();
  }

  @Get('trash')
  trash() {
    return this.tenants.findTrashed();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tenants.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Get(':id/deletion-impact')
  deletionImpact(@Param('id', ParseIntPipe) id: number) {
    return this.tenants.deletionImpact(id);
  }

  @Patch(':id/trash')
  trashTenant(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.tenants.trash(id, String(body.reason ?? 'Suppression sans motif'));
  }

  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.tenants.restore(id);
  }

  @Delete(':id/permanent')
  permanentDelete(@Param('id', ParseIntPipe) id: number) {
    return this.tenants.permanentDelete(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tenants.remove(id);
  }
}
