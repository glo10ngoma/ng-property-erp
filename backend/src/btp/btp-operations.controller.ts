import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { RequireOrganizationModule } from "../sales/sales-module.decorator";
import {
  BtpScopeQueryDto,
  CreateBtpBudgetLineDto,
  CreateBtpClientContractDto,
  CreateBtpClientTransactionDto,
  CreateBtpPurchaseDto,
  CreateBtpSiteLogDto,
  CreateBtpStockMovementDto,
} from "./btp-operations.dto";
import { BtpOperationsService } from "./btp-operations.service";

@Controller("btp")
@RequireOrganizationModule("BTP")
export class BtpOperationsController {
  constructor(private readonly service: BtpOperationsService) {}
  @Get("budgets") budgets(@Query() q: BtpScopeQueryDto) {
    return this.service.budget(q);
  }
  @Post("budgets") createBudget(@Body() d: CreateBtpBudgetLineDto) {
    return this.service.createBudget(d);
  }
  @Get("purchases") purchases(@Query() q: BtpScopeQueryDto) {
    return this.service.purchases(q);
  }
  @Post("purchases") createPurchase(@Body() d: CreateBtpPurchaseDto) {
    return this.service.createPurchase(d);
  }
  @Get("stock-movements") stock(@Query() q: BtpScopeQueryDto) {
    return this.service.stock(q);
  }
  @Post("stock-movements") createStock(@Body() d: CreateBtpStockMovementDto) {
    return this.service.createStock(d);
  }
  @Get("stock-balances") balances(@Query() q: BtpScopeQueryDto) {
    return this.service.stockBalances(q);
  }
  @Get("site-logs") logs(@Query() q: BtpScopeQueryDto) {
    return this.service.logs(q);
  }
  @Post("site-logs") createLog(@Body() d: CreateBtpSiteLogDto) {
    return this.service.createLog(d);
  }
  @Get("client-contracts") contracts(@Query() q: BtpScopeQueryDto) {
    return this.service.contracts(q);
  }
  @Post("client-contracts") createContract(
    @Body() d: CreateBtpClientContractDto,
  ) {
    return this.service.createContract(d);
  }
  @Get("client-transactions") transactions(@Query() q: BtpScopeQueryDto) {
    return this.service.transactions(q);
  }
  @Post("client-transactions") createTransaction(
    @Body() d: CreateBtpClientTransactionDto,
  ) {
    return this.service.createTransaction(d);
  }
  @Get("reports") reports(@Query() q: BtpScopeQueryDto) {
    return this.service.reports(q);
  }
}
