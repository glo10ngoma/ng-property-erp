import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../core/layout/AppLayout';
import { PermissionGuard } from '../core/auth/PermissionGuard';
import { ProtectedRoute } from '../core/auth/ProtectedRoute';
import { Login } from '../pages/Login';
import { BuildingReport } from '../pages/BuildingReport';
import { TenantSituation } from '../pages/TenantSituation';
import { LeaseNew } from '../pages/LeaseNew';
import { DashboardPage } from '../modules/dashboard/pages/DashboardPage';
import { ActivityPage } from '../modules/activity/pages/ActivityPage';
import { BuildingsPage } from '../modules/buildings/pages/BuildingsPage';
import { RentalUnitsPage } from '../modules/rental-units/pages/RentalUnitsPage';
import { TenantsPage } from '../modules/tenants/pages/TenantsPage';
import { LeasesPage } from '../modules/leases/pages/LeasesPage';
import { InvoicesPage } from '../modules/invoices/pages/InvoicesPage';
import { InvoiceDetailPage } from '../modules/invoices/pages/InvoiceDetailPage';
import { InvoicePrintPage } from '../modules/invoices/pages/InvoicePrintPage';
import { PaymentsPage } from '../modules/payments/pages/PaymentsPage';
import { CashPage } from '../modules/cash/pages/CashPage';
import { StaffPage } from '../modules/staff/pages/StaffPage';
import { StockPage } from '../modules/stock/pages/StockPage';
import { ReportsPage } from '../modules/reports/pages/ReportsPage';
import { UsersPage } from '../modules/users/pages/UsersPage';
import { MaintenancePage } from '../modules/maintenance/pages/MaintenancePage';
import { DocumentsPage } from '../modules/documents/pages/DocumentsPage';
import { CommunicationsPage } from '../modules/communications/pages/CommunicationsPage';
import { WorkflowsPage } from '../modules/workflows/pages/WorkflowsPage';
import { SettingsPage } from '../modules/settings/pages/SettingsPage';
import { ModulePlaceholder } from '../modules/shared/ModulePlaceholder';

const guarded = (permission: string, element: JSX.Element) => (
  <PermissionGuard permission={permission}>{element}</PermissionGuard>
);

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/activity" replace />} />
          <Route path="/dashboard" element={guarded('dashboard.read', <DashboardPage />)} />
          <Route path="/activity" element={guarded('activity.read', <ActivityPage />)} />
          <Route path="/buildings" element={guarded('buildings.read', <BuildingsPage />)} />
          <Route path="/buildings/:id/report" element={guarded('buildings.read', <BuildingReport />)} />
          <Route path="/buildings/:id" element={guarded('buildings.read', <ModulePlaceholder title="Détail immeuble" />)} />
          <Route path="/rental-units" element={guarded('units.read', <RentalUnitsPage />)} />
          <Route path="/rental-units/:id" element={guarded('units.read', <ModulePlaceholder title="Détail appartement" />)} />
          <Route path="/units" element={<Navigate to="/rental-units" replace />} />
          <Route path="/units/:id" element={<Navigate to="/rental-units" replace />} />
          <Route path="/tenants" element={guarded('tenants.read', <TenantsPage />)} />
          <Route path="/tenants/:id/situation" element={guarded('tenants.read', <TenantSituation />)} />
          <Route path="/tenants/:id" element={guarded('tenants.read', <ModulePlaceholder title="Détail locataire" />)} />
          <Route path="/leases" element={guarded('documents.read', <LeasesPage />)} />
          <Route path="/leases/new" element={guarded('documents.upload', <LeaseNew />)} />
          <Route path="/leases/:id" element={guarded('documents.read', <ModulePlaceholder title="Détail bail" />)} />
          <Route path="/invoices" element={guarded('invoices.read', <InvoicesPage />)} />
          <Route path="/invoices/:id" element={guarded('invoices.read', <InvoiceDetailPage />)} />
          <Route path="/invoices/:id/print" element={guarded('invoices.read', <InvoicePrintPage />)} />
          <Route path="/payments" element={guarded('payments.read', <PaymentsPage />)} />
          <Route path="/cash" element={guarded('cash.read', <CashPage />)} />
          <Route path="/staff" element={guarded('staff.read', <StaffPage />)} />
          <Route path="/staff/:id" element={guarded('staff.read', <ModulePlaceholder title="Détail employé" />)} />
          <Route path="/stock" element={guarded('stock.read', <StockPage />)} />
          <Route path="/maintenance" element={guarded('maintenance.read', <MaintenancePage />)} />
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
      <Route path="*" element={<Navigate to="/activity" replace />} />
    </Routes>
  );
}
