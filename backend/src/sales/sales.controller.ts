import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateSalesBuyerDto,
  CreateSalesCatalogItemDto,
  CreateSalesProjectDto,
  CreateSalesReservationDto,
  CreateSalesSubscriptionDto,
  SalesBuyerListQueryDto,
  SalesCatalogListQueryDto,
  SalesProjectListQueryDto,
  SalesReservationListQueryDto,
  SalesReservationStatusActionDto,
  SalesSubscriptionListQueryDto,
  SimulateSalesSubscriptionDto,
  UpdateSalesBuyerDto,
  UpdateSalesCatalogItemDto,
  UpdateSalesCatalogStatusDto,
  UpdateSalesProjectDto,
  UpdateSalesReservationDto,
  UpdateSalesSettingsDto,
  UpdateSalesSubscriptionDto,
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

  @Get('reservations')
  listReservations(@Query() query: SalesReservationListQueryDto) {
    return this.sales.listReservations(query);
  }

  @Get('reservations/:id')
  getReservation(@Param('id', ParseIntPipe) id: number) {
    return this.sales.getReservation(id);
  }

  @Post('reservations')
  createReservation(@Body() dto: CreateSalesReservationDto) {
    return this.sales.createReservation(dto);
  }

  @Patch('reservations/:id')
  updateReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesReservationDto) {
    return this.sales.updateReservation(id, dto);
  }

  @Post('reservations/:id/confirm')
  confirmReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.confirmReservation(id, dto.reason);
  }

  @Post('reservations/:id/cancel')
  cancelReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.cancelReservation(id, dto.reason);
  }

  @Post('reservations/:id/expire')
  expireReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.expireReservation(id, dto.reason);
  }

  @Post('reservations/:id/convert')
  convertReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.convertReservation(id, dto.reason);
  }

  @Get('subscriptions')
  listSubscriptions(@Query() query: SalesSubscriptionListQueryDto) {
    return this.sales.listSubscriptions(query);
  }

  @Get('subscriptions/:id')
  getSubscription(@Param('id', ParseIntPipe) id: number) {
    return this.sales.getSubscription(id);
  }

  @Post('subscriptions/simulate')
  simulateSubscription(@Body() dto: SimulateSalesSubscriptionDto) {
    return this.sales.simulateSubscription(dto);
  }

  @Post('subscriptions')
  createSubscription(@Body() dto: CreateSalesSubscriptionDto) {
    return this.sales.createSubscription(dto);
  }

  @Patch('subscriptions/:id')
  updateSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSalesSubscriptionDto) {
    return this.sales.updateSubscription(id, dto);
  }

  @Post('subscriptions/:id/submit')
  submitSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.submitSubscription(id, dto.reason);
  }

  @Post('subscriptions/:id/approve')
  approveSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.approveSubscription(id, dto.reason);
  }

  @Post('subscriptions/:id/reject')
  rejectSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.rejectSubscription(id, dto.reason);
  }

  @Post('subscriptions/:id/cancel')
  cancelSubscription(@Param('id', ParseIntPipe) id: number, @Body() dto: SalesReservationStatusActionDto) {
    return this.sales.cancelSubscription(id, dto.reason);
  }
}
