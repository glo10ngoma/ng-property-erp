import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  CashController,
  CommunicationsController,
  EmployeeAttendanceController,
  EmployeeContractsController,
  EmployeesController,
  HrController,
  LeasesController,
  LeavesController,
  MaintenanceController,
  NotificationsController,
  PayrollsController,
  ReferenceDataController,
  ReportsController,
  StatementsController,
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
    EmployeeContractsController,
    EmployeeAttendanceController,
    SalaryAdvancesController,
    LeavesController,
    PayrollsController,
    HrController,
    CashController,
    StockController,
    MaintenanceController,
    ReportsController,
    StatementsController,
    LeasesController,
  ],
  providers: [SaasService],
  exports: [SaasService],
})
export class SaasModule {}
