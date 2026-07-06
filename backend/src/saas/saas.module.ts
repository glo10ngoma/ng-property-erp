import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  CashController,
  CommunicationsController,
  EmployeesController,
  LeasesController,
  LeavesController,
  MaintenanceController,
  NotificationsController,
  PayrollsController,
  ReferenceDataController,
  ReportsController,
  SalaryAdvancesController,
  SettingsController,
  StockController,
  UsersController,
  WorkflowsController,
} from './saas.controllers';
import { SaasService } from './saas.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    UsersController,
    WorkflowsController,
    CommunicationsController,
    NotificationsController,
    SettingsController,
    ReferenceDataController,
    EmployeesController,
    SalaryAdvancesController,
    LeavesController,
    PayrollsController,
    CashController,
    StockController,
    MaintenanceController,
    ReportsController,
    LeasesController,
  ],
  providers: [SaasService],
  exports: [SaasService],
})
export class SaasModule {}
