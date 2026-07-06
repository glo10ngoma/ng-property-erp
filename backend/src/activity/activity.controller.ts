import { Controller, Get, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  overview() {
    return this.activity.overview();
  }

  @Get('tasks')
  tasks() {
    return this.activity.tasks();
  }

  @Get('alerts')
  alerts() {
    return this.activity.alerts();
  }

  @Get('recent')
  recent() {
    return this.activity.recent();
  }

  @Get('kpis')
  kpis() {
    return this.activity.kpis();
  }

  @Get('today')
  today() {
    return this.activity.today();
  }

  @Get('week')
  week() {
    return this.activity.week();
  }

  @Get('search')
  search(@Query('q') q?: string) {
    return this.activity.search(q ?? '');
  }
}
