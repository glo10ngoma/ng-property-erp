import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
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
  PlatformController,
  ReferenceDataController,
  ReportsController,
  StatementsController,
  SalaryAdvancesController,
  SettingsController,
  SuppliersController,
  StockController,
  UsersController,
  WorkflowsController,
} from './saas.controllers';
import { SaasService } from './saas.service';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [
    UsersController,
    WorkflowsController,
    CommunicationsController,
    NotificationsController,
    PlatformController,
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
    SuppliersController,
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
