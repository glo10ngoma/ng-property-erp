import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../core/layout/AppLayout';
import { PermissionGuard } from '../core/auth/PermissionGuard';
import { ProtectedRoute } from '../core/auth/ProtectedRoute';
import { PlatformRoute } from '../core/auth/PlatformRoute';
import { ActivityPage } from '../modules/activity/pages/ActivityPage';
import { BuildingsPage } from '../modules/buildings/pages/BuildingsPage';
import { CashPage } from '../modules/cash/pages/CashPage';
import { CommunicationsPage } from '../modules/communications/pages/CommunicationsPage';
import { DashboardPage } from '../modules/dashboard/pages/DashboardPage';
import { DocumentsPage } from '../modules/documents/pages/DocumentsPage';
import { InvoicesPage } from '../modules/invoices/pages/InvoicesPage';
import { LeasesPage } from '../modules/leases/pages/LeasesPage';
import { MaintenanceDetailPage, MaintenancePage } from '../modules/maintenance/pages/MaintenancePage';
import { PaymentsPage } from '../modules/payments/pages/PaymentsPage';
import { RentalUnitsPage } from '../modules/rental-units/pages/RentalUnitsPage';
import { ReportsPage } from '../modules/reports/pages/ReportsPage';
import { ModulePlaceholder } from '../modules/shared/ModulePlaceholder';
import { SettingsPage } from '../modules/settings/pages/SettingsPage';
import { AdvancesPage, AttendanceMonthlyEntryPage, AttendancePage, ContractsPage, EmployeeDetailPage, EmployeesPage, HrReportsPage, LeavesPage, PayrollDetailPage, PayrollPage, StaffPage } from '../modules/staff/pages/StaffPage';
import { StockArticlesPage } from '../modules/stock/pages/StockArticlesPage';
import { StockInventoriesPage, StockInventoryDetailPage } from '../modules/stock/pages/StockInventoriesPage';
import { StockMovementDetailPage } from '../modules/stock/pages/StockMovementDetailPage';
import { StockMovementsPage } from '../modules/stock/pages/StockMovementsPage';
import { StockPage } from '../modules/stock/pages/StockPage';
import { StockPurchaseDetailPage } from '../modules/stock/pages/StockPurchaseDetailPage';
import { StockPurchasesPage } from '../modules/stock/pages/StockPurchasesPage';
import { StockReportPage } from '../modules/stock/pages/StockReportPage';
import { TenantsPage } from '../modules/tenants/pages/TenantsPage';
import { UsersPage } from '../modules/users/pages/UsersPage';
import { WorkflowsPage } from '../modules/workflows/pages/WorkflowsPage';
import { PlatformLayout } from '../core/layout/PlatformLayout';
import { BuildingReport } from '../pages/BuildingReport';
import { CashDetailPage } from '../pages/CashEnterprise';
import { LeaseDetail } from '../pages/LeaseDetail';
import { LeaseNew } from '../pages/LeaseNew';
import { Login } from '../pages/Login';
import { PaymentDetail } from '../pages/PaymentDetail';
import { ProfilePage } from '../pages/ProfilePage';
import { SelectOrganization } from '../pages/SelectOrganization';
import { BuildingStatementPage, TenantStatementPage, UnitStatementPage } from '../pages/StatementPage';
import { StockDetailPage } from '../pages/StockDetailPage';
import { TenantSituation } from '../pages/TenantSituation';
import { UnitDetail } from '../pages/UnitDetail';
import { InvoiceDetailPage } from '../modules/invoices/pages/InvoiceDetailPage';
import { InvoicePrintPage } from '../modules/invoices/pages/InvoicePrintPage';
import {
  PlatformActivityPage,
  PlatformMembershipsPage,
  PlatformOrganizationsPage,
  PlatformOverviewPage,
  PlatformRolesPage,
  PlatformSettingsPage,
  PlatformUsersPage,
} from '../modules/platform/pages/PlatformPages';

const guarded = (permission: string, element: JSX.Element) => (
  <PermissionGuard permission={permission}>{element}</PermissionGuard>
);

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/select-organization" element={<SelectOrganization />} />
        <Route element={<PlatformRoute />}>
          <Route path="/platform" element={<PlatformLayout />}>
            <Route index element={<Navigate to="/platform/overview" replace />} />
            <Route path="overview" element={<PlatformOverviewPage />} />
            <Route path="organizations" element={<PlatformOrganizationsPage />} />
            <Route path="users" element={<PlatformUsersPage />} />
            <Route path="memberships" element={<PlatformMembershipsPage />} />
            <Route path="roles" element={<PlatformRolesPage />} />
            <Route path="activity" element={<PlatformActivityPage />} />
            <Route path="settings" element={<PlatformSettingsPage />} />
          </Route>
        </Route>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/activity" replace />} />
          <Route path="/dashboard" element={guarded('dashboard.read', <DashboardPage />)} />
          <Route path="/activity" element={guarded('activity.read', <ActivityPage />)} />
          <Route path="/buildings" element={guarded('buildings.read', <BuildingsPage />)} />
          <Route path="/buildings/:id/report" element={guarded('buildings.read', <BuildingReport />)} />
          <Route path="/statements/building/:id" element={guarded('buildings.read', <BuildingStatementPage />)} />
          <Route path="/buildings/:id" element={guarded('buildings.read', <ModulePlaceholder title="Détail immeuble" />)} />
          <Route path="/rental-units" element={guarded('units.read', <RentalUnitsPage />)} />
          <Route path="/rental-units/:id" element={guarded('units.read', <UnitDetail />)} />
          <Route path="/statements/unit/:id" element={guarded('units.read', <UnitStatementPage />)} />
          <Route path="/units" element={<Navigate to="/rental-units" replace />} />
          <Route path="/units/:id" element={guarded('units.read', <UnitDetail />)} />
          <Route path="/tenants" element={guarded('tenants.read', <TenantsPage />)} />
          <Route path="/tenants/:id/situation" element={guarded('tenants.read', <TenantSituation />)} />
          <Route path="/statements/tenant/:id" element={guarded('tenants.read', <TenantStatementPage />)} />
          <Route path="/tenants/:id" element={guarded('tenants.read', <ModulePlaceholder title="Détail locataire" />)} />
          <Route path="/leases" element={guarded('documents.read', <LeasesPage />)} />
          <Route path="/leases/new" element={guarded('documents.upload', <LeaseNew />)} />
          <Route path="/leases/:id" element={guarded('documents.read', <LeaseDetail />)} />
          <Route path="/invoices" element={guarded('invoices.read', <InvoicesPage />)} />
          <Route path="/invoices/:id" element={guarded('invoices.read', <InvoiceDetailPage />)} />
          <Route path="/invoices/:id/print" element={guarded('invoices.read', <InvoicePrintPage />)} />
          <Route path="/payments" element={guarded('payments.read', <PaymentsPage />)} />
          <Route path="/payments/:id" element={guarded('payments.read', <PaymentDetail />)} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/cash" element={guarded('cash.read', <CashPage />)} />
          <Route path="/cash/:id" element={guarded('cash.read', <CashDetailPage />)} />
          <Route path="/staff" element={guarded('staff.read', <StaffPage />)} />
          <Route path="/staff/:id" element={guarded('staff.read', <Navigate to="/personnel/employees" replace />)} />
          <Route path="/personnel" element={guarded('staff.read', <Navigate to="/personnel/employees" replace />)} />
          <Route path="/personnel/employees" element={guarded('staff.read', <EmployeesPage />)} />
          <Route path="/personnel/employees/:id" element={guarded('staff.read', <EmployeeDetailPage />)} />
          <Route path="/personnel/contracts" element={guarded('staff.read', <ContractsPage />)} />
          <Route path="/personnel/attendance" element={guarded('staff.read', <AttendancePage />)} />
          <Route path="/personnel/attendance/monthly-entry" element={guarded('staff.read', <AttendanceMonthlyEntryPage />)} />
          <Route path="/personnel/advances" element={guarded('staff.read', <AdvancesPage />)} />
          <Route path="/personnel/leaves" element={guarded('staff.read', <LeavesPage />)} />
          <Route path="/personnel/payroll" element={guarded('staff.read', <PayrollPage />)} />
          <Route path="/personnel/payroll/:id" element={guarded('staff.read', <PayrollDetailPage />)} />
          <Route path="/personnel/reports" element={guarded('staff.read', <HrReportsPage />)} />
          <Route path="/stock" element={guarded('stock.read', <StockPage />)} />
          <Route path="/stock/articles" element={guarded('stock.read', <StockArticlesPage />)} />
          <Route path="/stock/movements" element={guarded('stock.read', <StockMovementsPage />)} />
          <Route path="/stock/movements/:id" element={guarded('stock.read', <StockMovementDetailPage />)} />
          <Route path="/stock/inventories" element={guarded('stock.read', <StockInventoriesPage />)} />
          <Route path="/stock/inventories/:id" element={guarded('stock.read', <StockInventoryDetailPage />)} />
          <Route path="/stock/purchases" element={guarded('stock.read', <StockPurchasesPage />)} />
          <Route path="/stock/purchases/:id" element={guarded('stock.read', <StockPurchaseDetailPage />)} />
          <Route path="/stock/report" element={guarded('reports.read', <StockReportPage />)} />
          <Route path="/stock/:id" element={guarded('stock.read', <StockDetailPage />)} />
          <Route path="/maintenance" element={guarded('maintenance.read', <MaintenancePage />)} />
          <Route path="/maintenance/:id" element={guarded('maintenance.read', <MaintenanceDetailPage />)} />
          <Route path="/reports" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/buildings" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/tenants" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/payments" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/availability" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/overdue" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/cash" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/stock" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/reports/maintenance" element={guarded('reports.read', <ReportsPage />)} />
          <Route path="/documents" element={guarded('documents.read', <DocumentsPage />)} />
          <Route path="/communications" element={guarded('communication.read', <CommunicationsPage />)} />
          <Route path="/workflows" element={guarded('workflow.read', <WorkflowsPage />)} />
          <Route path="/users" element={guarded('users.read', <UsersPage />)} />
          <Route path="/settings" element={guarded('settings.read', <SettingsPage />)} />
        </Route>
      </Route>
      <Route path="/app/*" element={<ClientAppRedirect />} />
      <Route path="*" element={<Navigate to="/activity" replace />} />
    </Routes>
  );
}

function ClientAppRedirect() {
  const path = window.location.pathname.replace(/^\/app/, '') || '/activity';
  const search = window.location.search;
  const hash = window.location.hash;
  return <Navigate to={`${path}${search}${hash}`} replace />;
}
