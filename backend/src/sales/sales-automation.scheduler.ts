import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SalesAutomationService } from './sales-automation.service';

@Injectable()
export class SalesAutomationScheduler {
  private readonly logger = new Logger(SalesAutomationScheduler.name);

  constructor(private readonly automation: SalesAutomationService) {}

  @Cron('0 */5 * * * *')
  async executeSalesAutomationTick() {
    try {
      await this.automation.runSchedulerTick(new Date());
    } catch (error) {
      this.logger.error(
        `[SALES_AUTOMATION] scheduler_tick_failed code=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
