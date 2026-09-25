import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../communication/email/email.module';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { OrganizationAccessService } from './organization-access.service';
import { PasswordResetService } from './password-reset.service';
import { RequestContext } from './request-context';
import { SuperAdminOnlyGuard } from './super-admin-only.guard';

@Global()
@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [AuthController],
  providers: [RequestContext, OrganizationAccessService, PasswordResetService, SuperAdminOnlyGuard],
  exports: [RequestContext, OrganizationAccessService, PasswordResetService, SuperAdminOnlyGuard],
})
export class AuthModule {}
