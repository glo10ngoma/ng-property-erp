import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationRunsQueryDto, PreviewMonthlyRentBillingDto, RunMonthlyRentBillingDto, UpdateMonthlyRentBillingDto } from './dto';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  listAutomations() {
    return this.automations.listAutomations();
  }

  @Get('monthly-rent-billing')
  monthlyRentBilling() {
    return this.automations.getMonthlyRentBillingSetting();
  }

  @Patch('monthly-rent-billing')
  updateMonthlyRentBilling(@Body() body: UpdateMonthlyRentBillingDto) {
    return this.automations.updateMonthlyRentBillingSetting(body as Record<string, unknown>);
  }

  @Get('runs')
  runs(@Query() query: AutomationRunsQueryDto) {
    return this.automations.listRuns({
      automationCode: query.automationCode,
      limit: query.limit,
      executionMode: query.executionMode,
    });
  }

  @Get('runs/:id')
  run(@Param('id', ParseIntPipe) id: number) {
    return this.automations.getRun(id);
  }

  @Post('monthly-rent-billing/preview')
  preview(@Body() body: PreviewMonthlyRentBillingDto) {
    return this.automations.previewMonthlyRentBilling(body);
  }

  @Post('monthly-rent-billing/run')
  runMonthlyRentBilling(@Body() body: RunMonthlyRentBillingDto) {
    return this.automations.runMonthlyRentBillingManually(body);
  }
}
