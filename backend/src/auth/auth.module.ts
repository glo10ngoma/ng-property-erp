import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { OrganizationAccessService } from './organization-access.service';
import { RequestContext } from './request-context';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [RequestContext, OrganizationAccessService],
  exports: [RequestContext, OrganizationAccessService],
})
export class AuthModule {}
