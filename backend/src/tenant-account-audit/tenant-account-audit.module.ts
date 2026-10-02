import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantAccountAuditController } from './tenant-account-audit.controller';
import { TenantAccountAuditService } from './tenant-account-audit.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantAccountAuditController],
  providers: [TenantAccountAuditService],
})
export class TenantAccountAuditModule {}
