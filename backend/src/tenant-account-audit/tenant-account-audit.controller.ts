import { Controller, Get } from '@nestjs/common';
import { TenantAccountAuditService } from './tenant-account-audit.service';

@Controller('reports/tenant-accounts')
export class TenantAccountAuditController {
  constructor(private readonly service: TenantAccountAuditService) {}

  @Get()
  report() {
    return this.service.report();
  }
}
