import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { OrganizationModulesService } from './organization-modules.service';
import { SalesController } from './sales.controller';
import { SalesModuleGuard } from './sales-module.guard';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SalesController],
  providers: [SalesService, SalesRepository, OrganizationModulesService, SalesModuleGuard],
  exports: [OrganizationModulesService, SalesModuleGuard],
})
export class SalesModule {}
