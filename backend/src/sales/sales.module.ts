import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommunicationModule } from '../communication/communication.module';
import { DatabaseModule } from '../database/database.module';
import { SalesAutomationScheduler } from './sales-automation.scheduler';
import { SalesAutomationService } from './sales-automation.service';
import { OrganizationModulesService } from './organization-modules.service';
import { SalesController } from './sales.controller';
import { SalesDocumentsService } from './sales-documents.service';
import { SalesFinancialsService } from './sales-financials.service';
import { SalesModuleGuard } from './sales-module.guard';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [DatabaseModule, AuthModule, CommunicationModule],
  controllers: [SalesController],
  providers: [SalesService, SalesFinancialsService, SalesAutomationService, SalesAutomationScheduler, SalesRepository, SalesDocumentsService, OrganizationModulesService, SalesModuleGuard],
  exports: [OrganizationModulesService, SalesModuleGuard],
})
export class SalesModule {}
