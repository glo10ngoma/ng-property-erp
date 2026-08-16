import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesProjectListQueryDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesCatalogStatusDto,
  UpdateSalesProjectDto,
  UpdateSalesSettingsDto,
} from './dto';
import { RequireOrganizationModule } from './sales-module.decorator';
import { SalesService } from './sales.service';
import { SALES_MODULE_CODE } from './types';

@Controller('sales')
@RequireOrganizationModule(SALES_MODULE_CODE)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('bootstrap')
  bootstrap() {
    return this.sales.bootstrap();
  }

  @Get('settings')
  getSettings() {
    return this.sales.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateSalesSettingsDto) {
    return this.sales.updateSettings(dto);
  }

  @Get('buyers')
  listBuyers(@Query() query: SalesBuyerListQueryDto) {
    return this.sales.listBuyers(query);
  }

  @Get('buyers/:id')
  getBuyer(@Param('id', ParseIntPipe) id: number) {
    return this.sales.getBuyer(id);
  }

  @Post('buyers')
  createBuyer(@Body() dto: CreateSalesBuyerDto) {
    return this.sales.createBuyer(dto);
  }

  @Patch('buyers/:id')
  updateBuyer(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesBuyerDto) {
    return this.sales.updateBuyer(id, dto);
  }

  @Patch('buyers/:id/archive')
  archiveBuyer(@Param('id', ParseIntPipe) id: number) {
    return this.sales.archiveBuyer(id);
  }

  @Get('projects')
  listProjects(@Query() query: SalesProjectListQueryDto) {
    return this.sales.listProjects(query);
  }

  @Get('projects/:id')
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.sales.getProject(id);
  }

  @Post('projects')
  createProject(@Body() dto: CreateSalesProjectDto) {
    return this.sales.createProject(dto);
  }

  @Patch('projects/:id')
  updateProject(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesProjectDto) {
    return this.sales.updateProject(id, dto);
  }

  @Patch('projects/:id/archive')
  archiveProject(@Param('id', ParseIntPipe) id: number) {
    return this.sales.archiveProject(id);
  }

  @Get('catalog')
  listCatalog(@Query() query: SalesCatalogListQueryDto) {
    return this.sales.listCatalog(query);
  }

  @Get('catalog/:id')
  getCatalogItem(@Param('id', ParseIntPipe) id: number) {
    return this.sales.getCatalogItem(id);
  }

  @Post('catalog')
  createCatalogItem(@Body() dto: CreateSalesCatalogItemDto) {
    return this.sales.createCatalogItem(dto);
  }

  @Patch('catalog/:id')
  updateCatalogItem(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesCatalogItemDto) {
    return this.sales.updateCatalogItem(id, dto);
  }

  @Patch('catalog/:id/status')
  updateCatalogStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesCatalogStatusDto) {
    return this.sales.updateCatalogStatus(id, dto);
  }

  @Patch('catalog/:id/archive')
  archiveCatalogItem(@Param('id', ParseIntPipe) id: number) {
    return this.sales.archiveCatalogItem(id);
  }
}
