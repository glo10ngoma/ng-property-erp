import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlatformRoleGuard } from '../auth/platform-role.guard';
import { SuperAdminOnly, SuperAdminOnlyGuard } from '../auth/super-admin-only.guard';
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS } from './permissions';
import { SaasService } from './saas.service';
import { UpdateCompanySettingsDto, UpdateExchangeRateDto } from './settings.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly service: SaasService) {}

  @Get()
  findUsers() {
    return this.service.listUsers();
  }

  @Post()
  @UseGuards(SuperAdminOnlyGuard)
  @SuperAdminOnly('Seul le Super Administrateur peut créer un utilisateur.')
  createUser(@Body() body: Record<string, unknown>) {
    return this.service.createScopedUser(body);
  }

  @Put(':id')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateScopedUser(id, body);
  }

  @Get('roles')
  roles() {
    return {
      roles: {
        ADMIN: ROLE_LABELS.ADMIN,
        EDITOR: ROLE_LABELS.EDITOR,
        VIEWER: ROLE_LABELS.VIEWER,
      },
      permissions: PERMISSIONS,
    };
  }
}

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly service: SaasService) {}

  @Get()
  workflows() {
    return this.service.workflowInstances();
  }

  @Get('my-approvals')
  myApprovals() {
    return this.service.myWorkflowApprovals();
  }

  @Get('definitions')
  definitions() {
    return this.service.workflowDefinitions();
  }

  @Get(':id')
  workflow(@Param('id', ParseIntPipe) id: number) {
    return this.service.workflowDetail(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createWorkflowInstance(body);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.approveWorkflow(id, body.comment ? String(body.comment) : undefined);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.rejectWorkflow(id, body.comment ? String(body.comment) : undefined);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.cancelWorkflow(id, body.comment ? String(body.comment) : undefined);
  }
}

@Controller('communications')
export class CommunicationsController {
  constructor(private readonly service: SaasService) {}

  @Get('templates')
  templates() {
    return this.service.messageTemplates();
  }

  @Post('templates')
  createTemplate(@Body() body: Record<string, unknown>) {
    return this.service.createMessageTemplate(body);
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateMessageTemplate(id, body);
  }

  @Delete('templates/:id')
  deactivateTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivateMessageTemplate(id);
  }

  @Get('email-logs')
  emailLogs() {
    return this.service.communicationLogs('EMAIL');
  }

  @Get('sms-logs')
  smsLogs() {
    return this.service.communicationLogs('SMS');
  }

  @Get('whatsapp-logs')
  whatsappLogs() {
    return this.service.communicationLogs('WHATSAPP');
  }

  @Post('send-email')
  sendEmail(@Body() body: Record<string, unknown>) {
    return this.service.sendCommunication('EMAIL', body);
  }

  @Post('send-sms')
  sendSms(@Body() body: Record<string, unknown>) {
    return this.service.sendCommunication('SMS', body);
  }

  @Post('send-whatsapp')
  sendWhatsapp(@Body() body: Record<string, unknown>) {
    return this.service.sendCommunication('WHATSAPP', body);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: SaasService) {}

  @Get()
  notifications() {
    return this.service.notifications();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createNotification(body);
  }

  @Post(':id/read')
  read(@Param('id', ParseIntPipe) id: number) {
    return this.service.markNotificationRead(id);
  }

  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.service.archiveNotification(id);
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SaasService) {}

  @Get('company')
  company() {
    return this.service.companySettings();
  }

  @Post('company-files/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadCompanyFile(@Param('kind') kind: string, @UploadedFile() file: any) {
    return this.service.uploadCompanyFile(kind, file);
  }

  @Get('company-files/:kind')
  async companyFile(@Param('kind') kind: string, @Res({ passthrough: true }) response: any) {
    const file = await this.service.companyFile(kind);
    const downloadName = String(file.downloadName ?? 'document').replace(/"/g, '');
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    return file.buffer;
  }

  @Delete('company-files/:kind')
  deleteCompanyFile(@Param('kind') kind: string) {
    return this.service.deleteCompanyFile(kind);
  }

  @Patch('company')
  updateCompany(@Body() body: UpdateCompanySettingsDto) {
    return this.service.updateCompanySettings(body as Record<string, unknown>);
  }

  @Get('exchange-rate')
  exchangeRate() {
    return this.service.exchangeRate();
  }

  @Patch('exchange-rate')
  updateExchangeRate(@Body() body: UpdateExchangeRateDto) {
    return this.service.updateExchangeRate(body as Record<string, unknown>);
  }

  @Get('publisher-services')
  publisherServices() {
    return this.service.publisherServices();
  }

  @Get('restricted')
  restricted() {
    return this.service.restrictedSettings();
  }
}

@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly service: SaasService) {}

  @Get()
  list(@Query('type') type?: string) {
    return this.service.referenceData(type);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createReferenceData(body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateReferenceData(id, body);
  }

  @Delete(':id')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivateReferenceData(id);
  }
}

@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: SaasService) {}

  @Get()
  employees() {
    return this.service.employees();
  }

  @Get(':id')
  employee(@Param('id', ParseIntPipe) id: number) {
    return this.service.employeeDetail(id);
  }

  @Post()
  createEmployee(@Body() body: Record<string, unknown>) {
    return this.service.createEmployee(body);
  }

  @Put(':id')
  updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateEmployee(id, body);
  }

  @Post(':id/deactivate')
  deactivateEmployee(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivateEmployee(id);
  }

  @Delete(':id')
  deleteEmployee(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivateEmployee(id);
  }
}

@Controller('employee-contracts')
export class EmployeeContractsController {
  constructor(private readonly service: SaasService) {}

  @Get()
  contracts() {
    return this.service.employeeContracts();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createEmployeeContract(body);
  }
}

@Controller('employee-attendance')
export class EmployeeAttendanceController {
  constructor(private readonly service: SaasService) {}

  @Get()
  attendance(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('department') department?: string,
    @Query('employee_id') employeeId?: string,
  ) {
    return this.service.employeeAttendance({
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
      department: department || undefined,
      employeeId: employeeId ? Number(employeeId) : undefined,
    });
  }

  @Get('template')
  template(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('department') department?: string,
  ) {
    return this.service.employeeAttendanceTemplate(month ? Number(month) : undefined, year ? Number(year) : undefined, department || undefined);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createEmployeeAttendance(body);
  }

  @Post('bulk')
  createBulk(@Body() body: Record<string, unknown>) {
    return this.service.createEmployeeAttendanceBulk(body);
  }

  @Post(':id/validate')
  validate(@Param('id', ParseIntPipe) id: number) {
    return this.service.validateEmployeeAttendance(id);
  }

  @Post('validate-month')
  validateMonth(@Body() body: Record<string, unknown>) {
    return this.service.validateEmployeeAttendanceMonth(body);
  }
}

@Controller('salary-advances')
export class SalaryAdvancesController {
  constructor(private readonly service: SaasService) {}

  @Get()
  advances() {
    return this.service.salaryAdvances();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createSalaryAdvance(body);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.service.updateSalaryAdvanceStatus(id, 'APPROVED');
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.service.updateSalaryAdvanceStatus(id, 'REJECTED');
  }

  @Post(':id/pay')
  pay(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.paySalaryAdvance(id, body.reference ? String(body.reference) : undefined);
  }
}

@Controller('leaves')
export class LeavesController {
  constructor(private readonly service: SaasService) {}

  @Get()
  leaves(@Query('start') start?: string, @Query('end') end?: string) {
    return this.service.leaves(start, end);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createLeave(body);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateLeave(id, body);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.service.updateLeaveStatus(id, 'APPROVED');
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.service.updateLeaveStatus(id, 'REJECTED');
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.updateLeaveStatus(id, 'CANCELLED');
  }
}

@Controller('payrolls')
export class PayrollsController {
  constructor(private readonly service: SaasService) {}

  @Get()
  payrolls(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('employee_id') employeeId?: string,
  ) {
    return this.service.payrolls({
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
      department: department || undefined,
      status: status || undefined,
      employeeId: employeeId ? Number(employeeId) : undefined,
    });
  }

  @Get(':id')
  payroll(@Param('id', ParseIntPipe) id: number) {
    return this.service.payrollDetail(id);
  }

  @Post('generate')
  generate(@Body() body: Record<string, unknown>) {
    return this.service.generatePayroll(body);
  }

  @Post(':id/validate')
  validate(@Param('id', ParseIntPipe) id: number) {
    return this.service.updatePayrollStatus(id, 'VALIDATED');
  }

  @Post(':id/pay')
  pay(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.payPayroll(id, body.reference ? String(body.reference) : undefined);
  }
}

@Controller('hr')
export class HrController {
  constructor(private readonly service: SaasService) {}

  @Get('report')
  report(@Query('month') month?: string, @Query('year') year?: string) {
    return this.service.hrReport(month ? Number(month) : undefined, year ? Number(year) : undefined);
  }
}

@Controller('cash')
export class CashController {
  constructor(private readonly service: SaasService) {}

  @Get('sessions')
  sessions() {
    return this.service.findAll('cash_sessions', 'opened_at DESC');
  }

  @Post('open')
  open(@Body() body: Record<string, unknown>) {
    return this.service.openCash(body);
  }

  @Post('close')
  close(@Body() body: Record<string, unknown>) {
    return this.service.closeCash(Number(body.closing_balance ?? 0));
  }

  @Get('movements')
  movements() {
    return this.service.cashMovements();
  }

  @Get('movements/:id')
  movementDetail(@Param('id', ParseIntPipe) id: number) {
    return this.service.cashMovementDetail(id);
  }

  @Post('expenses')
  expense(@Body() body: Record<string, unknown>) {
    return this.service.createCashMovement({ ...body, type: 'OUT' });
  }

  @Post('movements')
  createMovement(@Body() body: Record<string, unknown>) {
    return this.service.createCashMovement(body);
  }

  @Get('report')
  report() {
    return this.service.cashReport();
  }
}

@Controller('stock')
export class StockController {
  constructor(private readonly service: SaasService) {}

  @Get('categories')
  categories() {
    return this.service.stockCategories();
  }

  @Post('categories')
  createCategory(@Body() body: Record<string, unknown>) {
    return this.service.createStockCategory(body);
  }

  @Get('items')
  items() {
    return this.service.stockItems();
  }

  @Get('items/:id')
  item(@Param('id', ParseIntPipe) id: number) {
    return this.service.stockItemDetail(id);
  }

  @Post('items')
  createItem(@Body() body: Record<string, unknown>) {
    return this.service.createStockItem(body);
  }

  @Patch('items/:id')
  patchItem(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateStockItem(id, body);
  }

  @Put('items/:id')
  updateItem(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateStockItem(id, body);
  }

  @Post('items/:id/deactivate')
  deactivateItem(@Param('id', ParseIntPipe) id: number) {
    return this.service.deactivateStockItem(id);
  }

  @Post('items/:id/reactivate')
  reactivateItem(@Param('id', ParseIntPipe) id: number) {
    return this.service.reactivateStockItem(id);
  }

  @Delete('items/:id')
  deleteItem(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteStockItem(id);
  }

  @Get('movements')
  movements() {
    return this.service.stockMovements();
  }

  @Get('purchases')
  purchases() {
    return this.service.stockPurchases();
  }

  @Get('purchases/:id')
  purchase(@Param('id', ParseIntPipe) id: number) {
    return this.service.stockPurchaseDetail(id);
  }

  @Post('purchases')
  createPurchase(@Body() body: Record<string, unknown>) {
    return this.service.createStockPurchase(body);
  }

  @Post('purchases/:id/receive')
  receivePurchase(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.receiveStockPurchase(id, body);
  }

  @Post('purchases/:id/pay')
  payPurchase(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.payStockPurchase(id, body);
  }

  @Get('movements/:id')
  movementDetail(@Param('id', ParseIntPipe) id: number) {
    return this.service.stockMovementDetail(id);
  }

  @Post('entries')
  entry(@Body() body: Record<string, unknown>) {
    return this.service.createStockEntry(body);
  }

  @Post('exits')
  exit(@Body() body: Record<string, unknown>) {
    return this.service.createStockExit(body);
  }

  @Post('movements')
  movement(@Body() body: Record<string, unknown>) {
    return this.service.createStockMovement(body);
  }

  @Get('inventories')
  inventories() {
    return this.service.stockInventories();
  }

  @Get('inventories/:id')
  inventory(@Param('id', ParseIntPipe) id: number) {
    return this.service.stockInventoryDetail(id);
  }

  @Get('inventory')
  inventoryLegacy() {
    return this.service.stockInventories();
  }

  @Post('inventories')
  createInventory(@Body() body: Record<string, unknown>) {
    return this.service.createStockInventory(body);
  }

  @Patch('inventories/:id')
  updateInventory(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateStockInventory(id, body);
  }

  @Post('inventories/:id/validate')
  validateInventory(@Param('id', ParseIntPipe) id: number) {
    return this.service.validateStockInventory(id);
  }

  @Get('alerts')
  alerts() {
    return this.service.stockAlerts();
  }

  @Get('report')
  report() {
    return this.service.stockReport();
  }
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly service: SaasService) {}

  @Get('categories')
  categories() {
    return this.service.maintenanceCategories();
  }

  @Get('requests')
  requests() {
    return this.service.maintenanceRequests();
  }

  @Get('requests/:id')
  request(@Param('id', ParseIntPipe) id: number) {
    return this.service.maintenanceRequestDetail(id);
  }

  @Post('requests')
  createRequest(@Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceRequest(body);
  }

  @Patch('requests/:id')
  updateRequest(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateMaintenanceRequest(id, body);
  }

  @Post('requests/:id/diagnosis')
  diagnosis(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.diagnoseMaintenanceRequest(id, body);
  }

  @Post('requests/:id/request-approval')
  requestApproval(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.requestMaintenanceApproval(id, body);
  }

  @Post('requests/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.service.transitionMaintenanceRequest(id, 'APPROVED', 'Validation', 'Demande approuvee');
  }

  @Post('requests/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.transitionMaintenanceRequest(id, 'DIAGNOSIS', 'Rejet', String(body.reason ?? 'Approbation rejetee'));
  }

  @Post('requests/:id/assign')
  assign(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.assignMaintenanceRequest(id, body);
  }

  @Post('requests/:id/start')
  start(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.startMaintenanceRequest(id, body);
  }

  @Post('requests/:id/pause')
  pause(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.transitionMaintenanceRequest(id, 'ON_HOLD', 'Pause', body.reason ? String(body.reason) : 'Intervention en pause');
  }

  @Post('requests/:id/resume')
  resume(@Param('id', ParseIntPipe) id: number) {
    return this.service.transitionMaintenanceRequest(id, 'IN_PROGRESS', 'Reprise', 'Intervention reprise');
  }

  @Post('requests/:id/resolve')
  resolve(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.resolveMaintenanceRequest(id, body);
  }

  @Post('requests/:id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.transitionMaintenanceRequest(id, 'IN_PROGRESS', 'Reouverture', String(body.reason ?? 'Intervention rouverte'));
  }

  @Post('requests/:id/validate')
  validate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.validateMaintenanceRequest(id, body);
  }

  @Post('requests/:id/close')
  close(@Param('id', ParseIntPipe) id: number) {
    return this.service.closeMaintenanceRequest(id);
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.transitionMaintenanceRequest(id, 'CANCELLED', 'Annulation', 'Demande annulee');
  }

  @Post('requests/:id/stock')
  consumeRequestStock(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceStockConsumption({ ...body, maintenance_request_id: id });
  }

  @Post('requests/:id/expenses')
  expense(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceExpense(id, body);
  }

  @Post('requests/:id/communicate/:channel')
  communicate(
    @Param('id', ParseIntPipe) id: number,
    @Param('channel') channel: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.sendMaintenanceCommunication(id, channel, body);
  }

  @Post('requests/:id/documents')
  document(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceDocument(id, body);
  }

  @Post('stock-consumption')
  consumeStock(@Body() body: Record<string, unknown>) {
    return this.service.createMaintenanceStockConsumption(body);
  }
}

@Controller('leases')
export class LeasesController {
  constructor(private readonly service: SaasService) {}

  @Get()
  leases() {
    return this.service.leases();
  }

  @Get('units/:id/history')
  unitHistory(@Param('id', ParseIntPipe) id: number) {
    return this.service.unitOccupationHistory(id);
  }

  @Get('tenants/:id')
  tenantLeases(@Param('id', ParseIntPipe) id: number) {
    return this.service.tenantLeases(id);
  }

  @Get('active-by-building')
  activeByBuilding(@Query('building_id') buildingId?: string) {
    return this.service.activeLeasesByBuilding(buildingId ? Number(buildingId) : undefined);
  }

  @Get('availability')
  availability() {
    return this.service.rentalUnitsAvailability();
  }

  @Get(':id')
  lease(@Param('id', ParseIntPipe) id: number) {
    return this.service.leaseDetail(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.createLease(body);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.updateLease(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteLease(id);
  }

  @Post(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.service.activateLease(id);
  }

  @Post(':id/terminate')
  terminate(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.terminateLease(id, String(body.reason ?? 'Resiliation'));
  }

  @Get(':id/guarantee')
  guarantee(@Param('id', ParseIntPipe) id: number) {
    return this.service.leaseGuarantee(id);
  }

  @Post(':id/guarantee/pay')
  payGuarantee(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.payLeaseGuarantee(id, Number(body.amount ?? 0), body.reference ? String(body.reference) : undefined);
  }

  @Post(':id/guarantee/refund')
  refundGuarantee(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.refundLeaseGuarantee(id, Number(body.amount ?? 0), body.reference ? String(body.reference) : undefined);
  }

  @Get(':id/documents')
  documents(@Param('id', ParseIntPipe) id: number) {
    return this.service.leaseDocuments(id);
  }

  @Get(':id/contracts/latest')
  latestContract(@Param('id', ParseIntPipe) id: number) {
    return this.service.latestLeaseContract(id);
  }

  @Get(':id/contracts/latest-docx')
  latestContractDocx(@Param('id', ParseIntPipe) id: number) {
    return this.service.latestLeaseContractDocx(id);
  }

  @Post(':id/contracts/generate')
  generateContract(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateLeaseContract(id);
  }

  @Post(':id/contracts/generate-docx')
  generateContractDocx(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateLeaseContractDocx(id);
  }

  @Get(':id/contracts/:contractId/download')
  async downloadGeneratedContract(
    @Param('id', ParseIntPipe) id: number,
    @Param('contractId', ParseIntPipe) contractId: number,
    @Res({ passthrough: true }) response: any,
  ) {
    const file = await this.service.downloadLeaseContractDocx(id, contractId);
    const downloadName = String(file.downloadName ?? 'contrat.docx').replace(/"/g, '');
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    response.setHeader('Cache-Control', 'no-store');
    return file.buffer;
  }

  @Post(':id/contracts/:contractId/printed')
  markPrinted(@Param('id', ParseIntPipe) id: number, @Param('contractId', ParseIntPipe) contractId: number) {
    return this.service.markLeaseContractPrinted(id, contractId);
  }

  @Post(':id/contracts/:contractId/sign')
  markSigned(@Param('id', ParseIntPipe) id: number, @Param('contractId', ParseIntPipe) contractId: number) {
    return this.service.markLeaseContractSigned(id, contractId);
  }

  @Post(':id/contracts/:contractId/upload-signed')
  uploadSigned(
    @Param('id', ParseIntPipe) id: number,
    @Param('contractId', ParseIntPipe) contractId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.uploadSignedLeaseContract(id, contractId, body);
  }

  @Post(':id/invoice')
  invoice(@Param('id', ParseIntPipe) id: number) {
    return this.service.createLeaseInvoice(id);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: SaasService) {}

  @Get('dashboard')
  dashboard() {
    return this.service.reportsDashboard();
  }

  @Get('buildings/:id')
  building(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('tenantId') tenantId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.service.buildingReport(id, {
      month,
      year,
      start,
      end,
      paymentStatus,
      tenantId: tenantId ? Number(tenantId) : undefined,
      unitId: unitId ? Number(unitId) : undefined,
    });
  }

  @Post('invoices/:id/remind')
  remindInvoice(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.remindInvoice(id, body);
  }

  @Get('payments')
  payments(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('building_id') buildingId?: string,
    @Query('tenant_id') tenantId?: string,
    @Query('status') status?: string,
    @Query('payment_method') paymentMethod?: string,
  ) {
    return this.service.paymentsReport({
      start,
      end,
      buildingId: buildingId ? Number(buildingId) : undefined,
      tenantId: tenantId ? Number(tenantId) : undefined,
      status,
      paymentMethod,
    });
  }

  @Get('tenants/:id')
  tenant(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('invoiceStatus') invoiceStatus?: string,
    @Query('buildingId') buildingId?: string,
    @Query('unitId') unitId?: string,
    @Query('leaseId') leaseId?: string,
  ) {
    return this.service.tenantReport(id, {
      month,
      year,
      start,
      end,
      invoiceStatus,
      buildingId: buildingId ? Number(buildingId) : undefined,
      unitId: unitId ? Number(unitId) : undefined,
      leaseId: leaseId ? Number(leaseId) : undefined,
    });
  }

  @Get('availability')
  availability() {
    return this.service.availabilityReport();
  }

  @Get('overdue')
  overdue(@Query('building_id') buildingId?: string, @Query('tenant_id') tenantId?: string) {
    return this.service.overdueReport(buildingId ? Number(buildingId) : undefined, tenantId ? Number(tenantId) : undefined);
  }

  @Get('export')
  export(@Query('type') type?: string, @Query('id') id?: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.service.exportReport(type ?? 'availability', id ? Number(id) : undefined, start, end);
  }

  @Get('cash')
  cash() {
    return this.service.cashReport();
  }

  @Get('stock')
  stock() {
    return this.service.stockReport();
  }

  @Get('staff')
  staff(@Query('start') start?: string, @Query('end') end?: string, @Query('month') month?: string, @Query('year') year?: string) {
    return this.service.staffReport(start, end, month ? Number(month) : undefined, year ? Number(year) : undefined);
  }

  @Get('maintenance')
  maintenance(@Query('start') start?: string, @Query('end') end?: string, @Query('building_id') buildingId?: string, @Query('employee_id') employeeId?: string) {
    return this.service.maintenanceReport({
      start,
      end,
      buildingId: buildingId ? Number(buildingId) : undefined,
      employeeId: employeeId ? Number(employeeId) : undefined,
    });
  }
}

@Controller('statements')
export class StatementsController {
  constructor(private readonly service: SaasService) {}

  @Get('tenants/:id')
  tenant(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    return this.service.tenantStatement(id, { month, year, start, end });
  }

  @Get('units/:id')
  unit(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    return this.service.unitStatement(id, { month, year, start, end });
  }

  @Get('buildings/:id')
  building(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    return this.service.buildingStatement(id, { month, year, start, end });
  }
}

@UseGuards(PlatformRoleGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly service: SaasService) {}

  @Get('overview')
  overview() {
    return this.service.platformOverview();
  }

  @Get('organizations')
  organizations(@Query('search') search?: string, @Query('status') status?: string) {
    return this.service.platformOrganizations({ search, status });
  }

  @Post('organizations')
  createOrganization(@Body() body: Record<string, unknown>) {
    return this.service.platformCreateOrganization(body);
  }

  @Patch('organizations/:id')
  updateOrganization(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.platformUpdateOrganization(id, body);
  }

  @Get('users')
  users(@Query('search') search?: string, @Query('status') status?: string) {
    return this.service.platformUsers({ search, status });
  }

  @Post('users')
  @UseGuards(SuperAdminOnlyGuard)
  @SuperAdminOnly('Seul le Super Administrateur peut créer un utilisateur.')
  createUser(@Body() body: Record<string, unknown>) {
    return this.service.platformCreateUser(body);
  }

  @Patch('users/:id')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.platformUpdateUser(id, body);
  }

  @Get('memberships')
  memberships(@Query('userId') userId?: string, @Query('organizationId') organizationId?: string) {
    return this.service.platformMemberships({
      userId: userId ? Number(userId) : undefined,
      organizationId: organizationId ? Number(organizationId) : undefined,
    });
  }

  @Post('memberships')
  @UseGuards(SuperAdminOnlyGuard)
  @SuperAdminOnly('Seul le Super Administrateur peut gérer les adhésions utilisateur.')
  upsertMembership(@Body() body: Record<string, unknown>) {
    return this.service.platformUpsertMembership(body);
  }

  @Patch('memberships/:id')
  @UseGuards(SuperAdminOnlyGuard)
  @SuperAdminOnly('Seul le Super Administrateur peut gérer les adhésions utilisateur.')
  updateMembership(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.platformUpdateMembership(id, body);
  }

  @Get('roles')
  roles() {
    return this.service.platformRoles();
  }

  @Get('activity')
  activity() {
    return this.service.platformActivity();
  }
}
