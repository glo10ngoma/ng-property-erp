import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health() {
    try {
      await this.db.ping();
      return {
        status: 'ok',
        database: 'connected',
        service: 'property-erp-backend',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'disconnected',
        code: error?.response?.code ?? 'DATABASE_UNAVAILABLE',
        message: error?.response?.message ?? 'Database unavailable',
        service: 'property-erp-backend',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
