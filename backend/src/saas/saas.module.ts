import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { AutomationsModule } from '../automations/automations.module';
import {
  CashController,
  CommunicationsController,
  EmployeeAttendanceController,
  EmployeeContractsController,
  EmployeesController,
  GuaranteeCashController,
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
  TenantCreditsController,
  StockController,
  UsersController,
  WorkflowsController,
} from './saas.controllers';
import { SaasService } from './saas.service';

@Module({
  imports: [DatabaseModule, EmailModule, forwardRef(() => AutomationsModule)],
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
    GuaranteeCashController,
    TenantCreditsController,
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
