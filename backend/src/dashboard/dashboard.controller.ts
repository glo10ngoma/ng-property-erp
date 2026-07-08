import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(
    @Query('period') period?: string,
    @Query('buildingId') buildingId?: string,
    @Query('city') city?: string,
    @Query('manager') manager?: string,
    @Query('currency') currency?: string,
  ) {
    return this.dashboard.summary({
      period,
      buildingId: buildingId ? Number(buildingId) : undefined,
      city,
      manager,
      currency,
    });
  }
}
