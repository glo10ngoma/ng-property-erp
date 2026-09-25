import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { OrganizationAccessService } from './organization-access.service';
import { RequestContext } from './request-context';
import { SuperAdminOnlyGuard } from './super-admin-only.guard';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [RequestContext, OrganizationAccessService, SuperAdminOnlyGuard],
  exports: [RequestContext, OrganizationAccessService, SuperAdminOnlyGuard],
})
export class AuthModule {}
