import {
  ArrowLeft,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CirclePause,
  CircleX,
  Clock3,
  DollarSign,
  Eye,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  Pencil,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  UserCog,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, SuccessMessage, TenantSearchSelect } from '../../../components';
import type { TenantSearchOption } from '../../../components';
import { useApiList } from '../../../hooks';

type MaintenanceRequest = {
  id: number;
  request_number: string;
  title: string;
  description?: string;
  category: string;
  priority: string;
  status: string;
  building_id?: number | null;
  unit_id?: number | null;
  tenant_id?: number | null;
  building_name?: string;
  unit_number?: string;
  tenant_name?: string;
  assigned_employee_id?: number | null;
  assigned_employee_name?: string;
  due_date?: string;
  reported_at?: string;
  resolved_at?: string;
  attachment_file_name?: string;
  attachment_file_url?: string;
  internal_notes?: string;
  estimated_cost?: number;
  expenses_total?: number;
  stock_cost_total?: number;
  total_cost?: number;
  actual_hours?: number;
  is_overdue?: boolean;
  technician_signature_name?: string;
  technician_signed_at?: string;
  client_signature_name?: string;
  client_signed_at?: string;
};

type MaintenanceDetail = MaintenanceRequest & {
  diagnostic?: string;
  cause?: string;
  proposed_solution?: string;
  timeline: Array<{ id: number; title: string; details?: string; created_at: string; event_type?: string }>;
  assignments: Array<{ id: number; employee_name?: string; external_provider?: string; assigned_at: string; notes?: string }>;
  documents: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>;
  expenses: Array<{ id: number; amount: number; expense_date: string; category: string; status: string; description?: string; supplier?: string; reference?: string; attachment_file_name?: string; observation?: string }>;
  stock_movements: Array<{ id: number; item_name: string; quantity: number; unit_price?: number; movement_date: string; reference?: string; notes?: string }>;
  communications?: Array<{ channel: string; recipient: string; message: string; status: string; sent_at?: string; created_by?: number }>;
  maintenance_documents?: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>;
};

type BuildingOption = { id: number; name: string; city?: string; commune?: string };
type UnitOption = { id: number; number: string; building_id?: number; building_name?: string; tenant_id?: number | null; tenant_name?: string; monthly_rent?: number };
type EmployeeOption = { id: number; first_name: string; last_name: string; job_title?: string };
type MaintenanceCategoryOption = { id: number; name: string; status?: string };
type MaintenanceDashboard = {
  filters?: { period?: string; start?: string | null; end?: string | null };
  kpis: Record<string, number | string | null>;
  by_status: Array<{ status: string; count: number }>;
  by_priority: Array<{ priority: string; count: number }>;
  monthly_interventions: Array<{ month: string; intervention_count: number }>;
  monthly_costs: Array<{ month: string; stock_cost: number; expenses_cost: number; total_cost: number }>;
  top_buildings: Array<{ building_name: string; intervention_count: number; total_cost: number }>;
  top_technicians: Array<{ technician_name: string; interventions_done: number; closed_interventions: number; average_resolution_hours: number }>;
  recent_interventions: Array<{ id: number; request_number: string; reported_at: string; title: string; priority: string; status: string; building_name: string; technician_name: string; total_cost: number }>;
  overdue_interventions: Array<{ id: number; request_number: string; title: string; priority: string; due_date: string; days_overdue: number; building_name: string; technician_name: string }>;
  generated_at?: string;
};

type MaintenanceRequestFilters = { status: string; priority: string; category: string; building_id: string; employee_id: string; overdue: boolean; week: boolean };

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Faible' },
  { value: 'NORMAL', label: 'Normale' },
  { value: 'HIGH', label: 'Haute' },
  { value: 'URGENT', label: 'Urgente' },
];

const MAINTENANCE_STATUSES = [
  { value: 'NEW', label: 'Nouveau' },
  { value: 'DIAGNOSIS', label: 'Diagnostic' },
  { value: 'WAITING_APPROVAL', label: 'En attente approbation' },
  { value: 'APPROVED', label: 'Approuvé' },
  { value: 'ASSIGNED', label: 'Affecté' },
  { value: 'IN_PROGRESS', label: 'En cours' },
  { value: 'ON_HOLD', label: 'En pause' },
  { value: 'RESOLVED', label: 'Résolu' },
  { value: 'VALIDATED', label: 'Validé' },
  { value: 'CLOSED', label: 'Clôturé' },
  { value: 'CANCELLED', label: 'Annulé' },
];

const allowedReportStatuses = new Set(['NEW', 'DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
const resolvedStatuses = new Set(['RESOLVED', 'VALIDATED', 'CLOSED']);

type MaintenancePageView = 'dashboard' | 'requests';

function defaultMaintenanceFilters(): MaintenanceRequestFilters {
  return { status: '', priority: '', category: '', building_id: '', employee_id: '', overdue: false, week: false };
}

function pickDefaultMaintenanceFilters(keys: Partial<MaintenanceRequestFilters>) {
  const defaults = defaultMaintenanceFilters();
  return Object.fromEntries(Object.keys(keys).map((key) => [key, defaults[key as keyof MaintenanceRequestFilters]])) as Partial<MaintenanceRequestFilters>;
}

export function MaintenancePage({ view = 'dashboard' }: { view?: MaintenancePageView }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const requests = useApiList<MaintenanceRequest>('/maintenance/requests');
  const employees = useApiList<EmployeeOption>('/employees');
  const buildings = useApiList<BuildingOption>('/buildings');
  const units = useApiList<UnitOption>('/units');
  const tenants = useApiList<TenantSearchOption>('/tenants');
  const categories = useApiList<MaintenanceCategoryOption>('/maintenance/categories');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<MaintenanceRequestFilters>(() => defaultMaintenanceFilters());
  const [dashboardFilters, setDashboardFilters] = useState({ period: '30d', start: '', end: '', building_id: '', employee_id: '', priority: '', status: '' });
  const [dashboard, setDashboard] = useState<MaintenanceDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRequest | null>(null);
  const [assigning, setAssigning] = useState<MaintenanceRequest | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const params = Object.fromEntries(Object.entries(dashboardFilters).filter(([, value]) => value !== ''));
      const response = await api.get<MaintenanceDashboard>('/maintenance/dashboard', { params });
      setDashboard(response.data);
    } catch (caught) {
      setDashboardError(extractApiMessage(caught, 'Impossible de charger le tableau de bord maintenance.'));
    } finally {
      setDashboardLoading(false);
    }
  }, [dashboardFilters]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const filtered = useMemo(() => requests.data.filter((item) => {
    const weekStart = startOfWeekISO();
    const weekEnd = endOfWeekISO();
    const reported = item.reported_at ? String(item.reported_at).slice(0, 10) : '';
    return (
      includesText(item, query) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.priority || item.priority === filters.priority) &&
      (!filters.category || item.category === filters.category) &&
      (!filters.building_id || String(item.building_id ?? '') === filters.building_id) &&
      (!filters.employee_id || String(item.assigned_employee_id ?? '') === filters.employee_id) &&
      (!filters.overdue || Boolean(item.is_overdue)) &&
      (!filters.week || (reported >= weekStart && reported <= weekEnd))
    );
  }), [requests.data, query, filters]);
  const requestKpis = useMemo(() => maintenanceRequestKpis(requests.data), [requests.data]);
  const filteredCostTotal = useMemo(() => filtered.reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0), [filtered]);

  const nextRequestNumber = useMemo(() => {
    const numbers = requests.data
      .map((item) => item.request_number ?? '')
      .filter((value) => value.startsWith('M-'))
      .map((value) => Number(value.replace(/^M-/, '')))
      .filter((value) => Number.isFinite(value));
    const next = numbers.length ? Math.max(...numbers) + 1 : 1;
    return `M-${String(next).padStart(4, '0')}`;
  }, [requests.data]);

  async function save(form: FormData, editingId?: number) {
    const file = form.get('attachment_file');
    if (file instanceof File && file.name) {
      form.set('attachment_file_name', file.name);
    }
    form.delete('attachment_file');
    const payload = Object.fromEntries(form);
    if (editingId) await api.patch(`/maintenance/requests/${editingId}`, payload);
    else await api.post('/maintenance/requests', payload);
    setSuccess(editingId ? 'Signalement modifié.' : 'Signalement créé.');
    setCreateOpen(false);
    setEditing(null);
    await requests.reload();
    await loadDashboard();
  }

  async function assignRequest(requestId: number, body: Record<string, unknown>) {
    await api.post(`/maintenance/requests/${requestId}/assign`, body);
    setSuccess('Technicien affecté.');
    setAssigning(null);
    requests.reload();
    void loadDashboard();
  }

  async function postAction(path: string, message: string, body: Record<string, unknown> = {}) {
    await api.post(path, body);
    setSuccess(message);
    requests.reload();
    void loadDashboard();
  }

  function exportRows() {
    return filtered.map((item) => exportRow(item));
  }

  function exportWorkbook(filename: string, rows = filtered) {
    const openRequests = rows.filter((item) => !['CLOSED', 'CANCELLED'].includes(item.status));
    const overdueRequests = rows.filter((item) => item.is_overdue);
    const urgentRequests = rows.filter((item) => item.priority === 'URGENT');
    const finishedRequests = rows.filter((item) => resolvedStatuses.has(item.status));
    const costRows = rows.map((item) => ({
      demande: item.request_number,
      titre: item.title,
      cout_estime: money(item.estimated_cost ?? 0),
      depenses: money(item.expenses_total ?? 0),
      stock: money(item.stock_cost_total ?? 0),
      total: money(item.total_cost ?? item.estimated_cost ?? 0),
    }));
    exportXlsxWorkbook(filename, [
      { name: 'Résumé', rows: [{ total_demandes: rows.length, ouvertes: openRequests.length, urgentes: urgentRequests.length, en_retard: overdueRequests.length, terminees: finishedRequests.length, cout_total: money(rows.reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0)), cout_du_mois: money(rows.filter((item) => String(item.reported_at ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0)) }] },
      { name: 'Demandes', rows: rows.map(exportRow) },
      { name: 'Ouvertes', rows: openRequests.map(exportRow) },
      { name: 'En retard', rows: overdueRequests.map(exportRow) },
      { name: 'Urgentes', rows: urgentRequests.map(exportRow) },
      { name: 'Terminées', rows: finishedRequests.map(exportRow) },
      { name: 'Coûts', rows: costRows },
      { name: 'Techniciens', rows: technicianRows(rows) },
      { name: 'Documents', rows: documentRows(rows) },
      { name: 'Timeline', rows: timelineRows(rows) },
      { name: 'Audit', rows: timelineRows(rows) },
    ]);
  }

  function exportDashboardWorkbook() {
    if (!dashboard) return;
    exportXlsxWorkbook('Dashboard_maintenance.xlsx', maintenanceDashboardWorkbook(dashboard));
  }

  return (
    <section>
      <PageHeader
        title="Maintenance"
        action={
          can('maintenance.create') ? (
            <button onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Nouveau signalement
            </button>
          ) : undefined
        }
      />
      <MaintenanceModuleNav />
      {view === 'dashboard' ? (
        <MaintenanceDashboardPanel
          dashboard={dashboard}
          filters={dashboardFilters}
          buildings={buildings.data}
          employees={employees.data}
          loading={dashboardLoading}
          error={dashboardError}
          onFiltersChange={setDashboardFilters}
          onExportExcel={exportDashboardWorkbook}
          onExportPdf={() => window.print()}
        />
      ) : (
        <MaintenanceRequestsSection
          canUpdate={can('maintenance.update')}
          canAssign={can('maintenance.assign')}
          canClose={can('maintenance.close')}
          query={query}
          filters={filters}
          requests={filtered}
          kpis={requestKpis}
          buildings={buildings.data}
          employees={employees.data}
          categories={categories.data}
          totalCost={filteredCostTotal}
          onQueryChange={setQuery}
          onFiltersChange={setFilters}
          onExportCsv={() => exportCsv('maintenance.csv', exportRows())}
          onExportExcel={() => exportWorkbook('maintenance.xlsx')}
          onView={(request) => navigate(`/maintenance/${request.id}`)}
          onEdit={setEditing}
          onAssign={setAssigning}
          onCloseRequest={(request) => postAction(`/maintenance/requests/${request.id}/close`, 'Demande clôturée.')}
          onCancelRequest={(request) => postAction(`/maintenance/requests/${request.id}/cancel`, 'Demande annulée.')}
        />
      )}

      {createOpen && (
        <MaintenanceRequestModal
          title="Nouveau signalement"
          requestNumber={nextRequestNumber}
          buildings={buildings.data}
          units={units.data}
          tenants={tenants.data}
          employees={employees.data}
          categories={categories.data}
          onClose={() => setCreateOpen(false)}
          onSubmit={(form) => save(form)}
        />
      )}

      {editing && (
        <MaintenanceRequestModal
          title="Modifier signalement"
          requestNumber={editing.request_number}
          editing={editing}
          buildings={buildings.data}
          units={units.data}
          tenants={tenants.data}
          employees={employees.data}
          categories={categories.data}
          onClose={() => setEditing(null)}
          onSubmit={(form) => save(form, editing.id)}
        />
      )}

      {assigning && (
        <AssignMaintenanceModal
          request={assigning}
          employees={employees.data}
          onClose={() => setAssigning(null)}
          onSubmit={(body) => assignRequest(assigning.id, body)}
        />
      )}
    </section>
  );
}

function MaintenanceModuleNav() {
  return (
    <nav className="module-subnav maintenance-subnav" aria-label="Navigation maintenance">
      <NavLink to="/maintenance/dashboard" className={({ isActive }) => isActive ? 'active' : undefined}>Dashboard</NavLink>
      <NavLink to="/maintenance/requests" className={({ isActive }) => isActive ? 'active' : undefined}>Demandes</NavLink>
    </nav>
  );
}

function maintenanceRequestKpis(requests: MaintenanceRequest[]) {
  return {
    total: requests.length,
    open: requests.filter((request) => request.status === 'NEW').length,
    inProgress: requests.filter((request) => request.status === 'IN_PROGRESS').length,
    pending: requests.filter((request) => request.status === 'WAITING_APPROVAL').length,
    resolved: requests.filter((request) => request.status === 'RESOLVED').length,
    closed: requests.filter((request) => request.status === 'CLOSED').length,
    critical: requests.filter((request) => request.priority === 'URGENT').length,
    overdue: requests.filter((request) => request.is_overdue).length,
  };
}

function maintenanceCategoryNames(categories: MaintenanceCategoryOption[], historicalCategory?: string | null) {
  const activeNames = categories
    .filter((category) => String(category.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE')
    .map((category) => category.name)
    .filter(Boolean);
  if (historicalCategory && !activeNames.some((name) => name.toLowerCase() === historicalCategory.toLowerCase())) {
    activeNames.push(historicalCategory);
  }
  return [...new Set(activeNames)].sort((left, right) => left.localeCompare(right));
}

type MaintenanceRequestsKpis = ReturnType<typeof maintenanceRequestKpis>;

function MaintenanceRequestsSection({
  canUpdate,
  canAssign,
  canClose,
  query,
  filters,
  requests,
  kpis,
  buildings,
  employees,
  categories,
  totalCost,
  onQueryChange,
  onFiltersChange,
  onExportCsv,
  onExportExcel,
  onView,
  onEdit,
  onAssign,
  onCloseRequest,
  onCancelRequest,
}: {
  canUpdate: boolean;
  canAssign: boolean;
  canClose: boolean;
  query: string;
  filters: MaintenanceRequestFilters;
  requests: MaintenanceRequest[];
  kpis: MaintenanceRequestsKpis;
  buildings: BuildingOption[];
  employees: EmployeeOption[];
  categories: MaintenanceCategoryOption[];
  totalCost: number;
  onQueryChange: (value: string) => void;
  onFiltersChange: (filters: MaintenanceRequestFilters) => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onView: (request: MaintenanceRequest) => void;
  onEdit: (request: MaintenanceRequest) => void;
  onAssign: (request: MaintenanceRequest) => void;
  onCloseRequest: (request: MaintenanceRequest) => void;
  onCancelRequest: (request: MaintenanceRequest) => void;
}) {
  const setQuickFilter = (next: Partial<MaintenanceRequestFilters>) => {
    const isSame = Object.entries(next).every(([key, value]) => filters[key as keyof MaintenanceRequestFilters] === value);
    if (isSame) {
      onFiltersChange({ ...filters, ...pickDefaultMaintenanceFilters(next) });
      return;
    }
    onFiltersChange({ ...filters, ...next });
  };
  const resetFilters = () => onFiltersChange(defaultMaintenanceFilters());
  const quickCards = [
    { key: 'total', label: 'Total demandes', value: kpis.total, icon: FileSpreadsheet, active: false, onClick: resetFilters },
    { key: 'open', label: 'Ouvertes', value: kpis.open, icon: Wrench, active: filters.status === 'NEW', onClick: () => setQuickFilter({ status: 'NEW' }) },
    { key: 'progress', label: 'En cours', value: kpis.inProgress, icon: CirclePause, active: filters.status === 'IN_PROGRESS', onClick: () => setQuickFilter({ status: 'IN_PROGRESS' }) },
    { key: 'pending', label: 'En attente', value: kpis.pending, icon: Clock3, active: filters.status === 'WAITING_APPROVAL', onClick: () => setQuickFilter({ status: 'WAITING_APPROVAL' }) },
    { key: 'resolved', label: 'Résolues', value: kpis.resolved, icon: CheckCircle2, active: filters.status === 'RESOLVED', onClick: () => setQuickFilter({ status: 'RESOLVED' }) },
    { key: 'closed', label: 'Clôturées', value: kpis.closed, icon: CheckCircle2, active: filters.status === 'CLOSED', onClick: () => setQuickFilter({ status: 'CLOSED' }) },
    { key: 'critical', label: 'Critiques', value: kpis.critical, icon: CircleAlert, active: filters.priority === 'URGENT', onClick: () => setQuickFilter({ priority: 'URGENT' }) },
    { key: 'overdue', label: 'En retard', value: kpis.overdue, icon: AlertTriangle, active: filters.overdue, onClick: () => setQuickFilter({ overdue: true }) },
  ];

  return (
    <section className="maintenance-requests-panel">
      <div className="page-header">
        <div>
          <h3>Demandes de maintenance</h3>
          <p className="dashboard-card-subtitle">Gestion opérationnelle des signalements, affectations et clôtures.</p>
        </div>
      </div>
      <div className="mini-stats maintenance-kpis maintenance-request-kpis">
        {quickCards.map(({ key, label, value, icon: Icon, active, onClick }) => (
          <button type="button" key={key} className={`mini-stat maintenance-kpi-button${active ? ' active' : ''}`} onClick={onClick}>
            <span><Icon size={15} />{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <div className="maintenance-filter-bar">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher" />
        <select value={filters.status} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}>
          <option value="">Statut</option>
          {MAINTENANCE_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value })}>
          <option value="">Priorité</option>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.category} onChange={(event) => onFiltersChange({ ...filters, category: event.target.value })}>
          <option value="">Catégorie</option>
          {maintenanceCategoryNames(categories).map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <SearchableSelect
          options={buildingOptions(buildings)}
          value={filters.building_id ? Number(filters.building_id) : null}
          onChange={(value) => onFiltersChange({ ...filters, building_id: value ? String(value) : '' })}
          placeholder="Immeuble"
          emptyMessage="Aucun immeuble trouvé"
        />
        <SearchableSelect
          options={employeeOptions(employees)}
          value={filters.employee_id ? Number(filters.employee_id) : null}
          onChange={(value) => onFiltersChange({ ...filters, employee_id: value ? String(value) : '' })}
          placeholder="Technicien"
          emptyMessage="Aucun technicien trouvé"
        />
        <label className="checkbox-filter"><input type="checkbox" checked={filters.overdue} onChange={(event) => onFiltersChange({ ...filters, overdue: event.target.checked })} />En retard</label>
        <label className="checkbox-filter"><input type="checkbox" checked={filters.week} onChange={(event) => onFiltersChange({ ...filters, week: event.target.checked })} />Cette semaine</label>
        <button type="button" className="secondary" onClick={resetFilters}><RotateCcw size={15} />Réinitialiser</button>
        <button type="button" className="secondary" onClick={onExportCsv}>CSV</button>
        <button type="button" className="secondary" onClick={onExportExcel}>Excel</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N° demande</th>
              <th>Titre</th>
              <th>Catégorie</th>
              <th>Priorité</th>
              <th>Statut</th>
              <th>Immeuble</th>
              <th>Unité</th>
              <th>Locataire</th>
              <th>Échéance</th>
              <th>Technicien</th>
              <th className="right">Coût</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="clickable-row" onClick={() => onView(request)}>
                <td>{request.request_number}</td>
                <td>{request.title}</td>
                <td>{request.category}</td>
                <td><span className={`badge ${priorityClass(request.priority)}`}>{priorityLabel(request.priority)}</span></td>
                <td><span className={`badge ${statusClass(request.status)}`}>{maintenanceStatusLabel(request.status)}</span></td>
                <td>{request.building_name ?? '-'}</td>
                <td>{request.unit_number ?? '-'}</td>
                <td>{request.tenant_name ?? '-'}</td>
                <td>{request.due_date ? shortDate(request.due_date) : '-'}</td>
                <td>{request.assigned_employee_name ?? '-'}</td>
                <td className="right">{money(request.total_cost ?? request.estimated_cost ?? 0)}</td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => onView(request)}><Eye size={16} /></button>
                  {canUpdate && <button className="icon-btn" title="Modifier" onClick={() => onEdit(request)}><Pencil size={16} /></button>}
                  {canAssign && <button className="icon-btn" title="Affecter" onClick={() => onAssign(request)}><UserCog size={16} /></button>}
                  {canClose && request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="icon-btn" title="Clôturer" onClick={() => onCloseRequest(request)}><CheckCircle2 size={16} /></button>}
                  {canClose && request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="icon-btn danger" title="Annuler" onClick={() => onCancelRequest(request)}><CircleX size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!requests.length && <EmptyState message="Aucune demande ne correspond aux filtres sélectionnés." />}
      </div>
      <div className="summary-band maintenance-cost-footer">
        <SummaryItem label="Demandes filtrées" value={requests.length} />
        <SummaryItem label="Total coût" value={money(totalCost)} />
      </div>
    </section>
  );
}

function MaintenanceDashboardPanel({
  dashboard,
  filters,
  buildings,
  employees,
  loading,
  error,
  onFiltersChange,
  onExportExcel,
  onExportPdf,
}: {
  dashboard: MaintenanceDashboard | null;
  filters: { period: string; start: string; end: string; building_id: string; employee_id: string; priority: string; status: string };
  buildings: BuildingOption[];
  employees: EmployeeOption[];
  loading: boolean;
  error: string;
  onFiltersChange: (filters: { period: string; start: string; end: string; building_id: string; employee_id: string; priority: string; status: string }) => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
}) {
  const kpis = dashboard?.kpis ?? {};
  const statusRows = normalizeStatusRows(dashboard?.by_status ?? []);
  const priorityRows = normalizePriorityRows(dashboard?.by_priority ?? []);
  const monthlyRows = dashboard?.monthly_interventions ?? [];
  const monthlyCostRows = dashboard?.monthly_costs ?? [];
  return (
    <section className="maintenance-dashboard">
      <div className="page-header">
        <div>
          <h3>Dashboard maintenance</h3>
          <p className="dashboard-card-subtitle">Pilotage opérationnel des interventions, coûts et retards.</p>
        </div>
        <div className="actions">
          <button className="secondary" onClick={onExportPdf}><Printer size={16} />Exporter PDF</button>
          <button className="secondary" onClick={onExportExcel} disabled={!dashboard}><FileSpreadsheet size={16} />Exporter Excel</button>
        </div>
      </div>

      <div className="maintenance-filter-bar">
        <select value={filters.period} onChange={(event) => onFiltersChange({ ...filters, period: event.target.value, start: event.target.value === 'custom' ? filters.start : '', end: event.target.value === 'custom' ? filters.end : '' })}>
          <option value="today">Aujourd'hui</option>
          <option value="7d">7 jours</option>
          <option value="30d">30 jours</option>
          <option value="year">Cette année</option>
          <option value="custom">Personnalisée</option>
        </select>
        {filters.period === 'custom' ? (
          <>
            <input type="date" value={filters.start} onChange={(event) => onFiltersChange({ ...filters, start: event.target.value })} />
            <input type="date" value={filters.end} onChange={(event) => onFiltersChange({ ...filters, end: event.target.value })} />
          </>
        ) : null}
        <SearchableSelect
          options={buildingOptions(buildings)}
          value={filters.building_id ? Number(filters.building_id) : null}
          onChange={(value) => onFiltersChange({ ...filters, building_id: value ? String(value) : '' })}
          placeholder="Immeuble"
          emptyMessage="Aucun immeuble trouvé"
        />
        <SearchableSelect
          options={employeeOptions(employees)}
          value={filters.employee_id ? Number(filters.employee_id) : null}
          onChange={(value) => onFiltersChange({ ...filters, employee_id: value ? String(value) : '' })}
          placeholder="Technicien"
          emptyMessage="Aucun technicien trouvé"
        />
        <select value={filters.priority} onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value })}>
          <option value="">Priorité</option>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}>
          <option value="">Statut</option>
          {MAINTENANCE_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" className="secondary" onClick={() => onFiltersChange({ period: '30d', start: '', end: '', building_id: '', employee_id: '', priority: '', status: '' })}><RotateCcw size={15} />Réinitialiser</button>
      </div>

      {error ? <div className="error-message dashboard-error-banner">{error}</div> : null}
      {loading ? <div className="compact-empty">Chargement du dashboard maintenance...</div> : null}

      <div className="mini-stats maintenance-kpis">
        <MaintenanceKpi icon={Wrench} title="Demandes ouvertes" value={dashboardNumber(kpis.open_requests)} />
        <MaintenanceKpi icon={CirclePause} title="En cours" value={dashboardNumber(kpis.in_progress)} />
        <MaintenanceKpi icon={CheckCircle2} title="Résolues" value={dashboardNumber(kpis.resolved)} />
        <MaintenanceKpi icon={CheckCircle2} title="Clôturées" value={dashboardNumber(kpis.closed)} />
        <MaintenanceKpi icon={CircleAlert} title="Priorité critique" value={dashboardNumber(kpis.critical_priority)} />
        <MaintenanceKpi icon={AlertTriangle} title="Priorité haute" value={dashboardNumber(kpis.high_priority)} />
        <MaintenanceKpi icon={CalendarDays} title="Interventions aujourd'hui" value={dashboardNumber(kpis.interventions_today)} />
        <MaintenanceKpi icon={CalendarDays} title="Interventions ce mois" value={dashboardNumber(kpis.interventions_this_month)} />
        <MaintenanceKpi icon={Clock3} title="Temps moyen résolution" value={`${Math.round(dashboardNumber(kpis.average_resolution_hours))} h`} />
        <MaintenanceKpi icon={DollarSign} title="Coût total interventions" value={money(dashboardNumber(kpis.total_cost))} />
        <MaintenanceKpi icon={Paperclip} title="Valeur stock consommé" value={money(dashboardNumber(kpis.stock_cost))} />
        <MaintenanceKpi icon={FileSpreadsheet} title="Valeur dépenses" value={money(dashboardNumber(kpis.expenses_cost))} />
      </div>

      <div className="chart-grid dashboard-chart-grid">
        <MaintenanceChartCard title="Répartition par statut">
          <MaintenanceHorizontalBars rows={statusRows.map((row) => ({ label: maintenanceStatusLabel(row.status), value: row.count }))} />
        </MaintenanceChartCard>
        <MaintenanceChartCard title="Répartition par priorité">
          <MaintenanceHorizontalBars rows={priorityRows.map((row) => ({ label: priorityLabel(row.priority), value: row.count }))} />
        </MaintenanceChartCard>
        <MaintenanceChartCard title="Évolution mensuelle">
          <MaintenanceVerticalBars rows={monthlyRows.map((row) => ({ label: monthLabel(row.month), value: Number(row.intervention_count ?? 0) }))} />
        </MaintenanceChartCard>
        <MaintenanceChartCard title="Coûts mensuels">
          <MaintenanceVerticalBars rows={monthlyCostRows.map((row) => ({ label: monthLabel(row.month), value: Number(row.total_cost ?? 0), secondary: Number(row.stock_cost ?? 0), tertiary: Number(row.expenses_cost ?? 0) }))} moneyValues />
        </MaintenanceChartCard>
      </div>

      <div className="chart-grid dashboard-chart-grid">
        <MaintenanceChartCard title="Top immeubles">
          <SimpleTable headers={['Immeuble', 'Interventions', 'Coût total']} rows={(dashboard?.top_buildings ?? []).map((row) => [row.building_name, row.intervention_count, money(row.total_cost)])} />
        </MaintenanceChartCard>
        <MaintenanceChartCard title="Top techniciens">
          <SimpleTable headers={['Technicien', 'Réalisées', 'Clôturées', 'Temps moyen']} rows={(dashboard?.top_technicians ?? []).map((row) => [row.technician_name, row.interventions_done, row.closed_interventions, `${Math.round(Number(row.average_resolution_hours ?? 0))} h`])} />
        </MaintenanceChartCard>
      </div>

      <div className="chart-grid dashboard-chart-grid">
        <MaintenanceChartCard title="Interventions récentes">
          <SimpleTable headers={['Date', 'Numéro', 'Immeuble', 'Titre', 'Priorité', 'Statut', 'Technicien', 'Coût']} rows={(dashboard?.recent_interventions ?? []).map((row) => [shortDate(row.reported_at), row.request_number, row.building_name, row.title, priorityLabel(row.priority), maintenanceStatusLabel(row.status), row.technician_name, money(row.total_cost)])} />
        </MaintenanceChartCard>
        <MaintenanceChartCard title="Interventions en retard">
          <SimpleTable headers={['Retard', 'Titre', 'Immeuble', 'Technicien', 'Priorité']} rows={(dashboard?.overdue_interventions ?? []).map((row) => [`${row.days_overdue} j`, row.title, row.building_name, row.technician_name, priorityLabel(row.priority)])} />
        </MaintenanceChartCard>
      </div>
    </section>
  );
}

function MaintenanceKpi({ icon: Icon, title, value }: { icon: LucideIcon; title: string; value: string | number }) {
  return <div className="mini-stat maintenance-dashboard-kpi"><span><Icon size={15} />{title}</span><strong>{value}</strong></div>;
}

function MaintenanceChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <article className="chart-card dashboard-analytics-card maintenance-dashboard-card"><h3>{title}</h3>{children}</article>;
}

function MaintenanceHorizontalBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="dashboard-horizontal-bars">
      {rows.map((row) => (
        <div className="bar-row dashboard-horizontal-bar" key={row.label}>
          <span>{row.label}</span>
          <div className="bar-track"><div style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} /></div>
          <strong>{row.value}</strong>
        </div>
      ))}
      {!rows.some((row) => row.value > 0) ? <EmptyState title="Aucune donnée sur la période." /> : null}
    </div>
  );
}

function MaintenanceVerticalBars({ rows, moneyValues = false }: { rows: Array<{ label: string; value: number; secondary?: number; tertiary?: number }>; moneyValues?: boolean }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="dashboard-vertical-chart">
      <div className="dashboard-vertical-bars" style={{ gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }}>
        {rows.map((row) => (
          <div className="dashboard-vertical-bar" key={row.label}>
            <span className="dashboard-vertical-bar-value">{moneyValues ? money(row.value) : row.value}</span>
            <div className="dashboard-vertical-bar-track">
              <div className="dashboard-vertical-bar-fill" style={{ height: `${Math.max(4, (row.value / max) * 100)}%` }} />
            </div>
            <small>{row.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MaintenanceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [request, setRequest] = useState<MaintenanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccessMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const buildings = useApiList<BuildingOption>('/buildings');
  const units = useApiList<UnitOption>('/units');
  const tenants = useApiList<TenantSearchOption>('/tenants');
  const employees = useApiList<EmployeeOption>('/employees');
  const categories = useApiList<MaintenanceCategoryOption>('/maintenance/categories');
  const stockItems = useApiList<{ id: number; name: string; current_quantity: number; unit: string; average_purchase_price?: number; purchase_price?: number }>('/stock/items');

  async function refresh() {
    if (!id) return;
    setLoading(true);
    const response = await api.get<MaintenanceDetail>(`/maintenance/requests/${id}`);
    setRequest(response.data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function action(path: string, message: string, body: Record<string, unknown> = {}) {
    await api.post(path, body);
    setSuccessMessage(message);
    await refresh();
  }

  const printable = request ? maintenanceWorkbook(request) : [];

  const actionState = useMemo(() => maintenanceDetailActions(request?.status ?? 'NEW'), [request?.status]);
  const timelineItems = useMemo(() => maintenanceTimelineItems(request), [request]);
  const attachmentItems = useMemo(() => maintenanceAttachmentItems(request), [request]);
  const costBreakdown = useMemo(() => maintenanceCoûtBreakdown(request), [request]);
  const interventionTime = useMemo(() => maintenanceTimeSummary(request), [request]);

  async function sendCommunication(channel: 'EMAIL' | 'SMS' | 'WHATSAPP', target: 'TENANT' | 'TECHNICIAN') {
    if (!request) return;
    await api.post(`/maintenance/requests/${request.id}/communicate/${channel.toLowerCase()}`, { target });
    setSuccessMessage(`Communication ${channel} envoyee.`);
    await refresh();
  }

  if (loading || !request) return <div className="empty">Chargement de la demande...</div>;

  return (
    <section>
      <PageHeader
        title="Maintenance"
        action={
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/maintenance/requests')}><ArrowLeft size={16} />Retour</button>
            {can('maintenance.update') && actionState.canEdit && <button onClick={() => setEditing(true)}><Pencil size={16} />Modifier</button>}
            {can('maintenance.update') && actionState.canDiagnose && <button onClick={() => action(`/maintenance/requests/${request.id}/diagnosis`, 'Diagnostic enregistré.', { diagnostic: request.diagnostic ?? request.description ?? 'Diagnostic à compléter' })}><CircleAlert size={16} />Diagnostic</button>}
            {can('maintenance.update') && actionState.canRequestApproval && <button onClick={() => action(`/maintenance/requests/${request.id}/request-approval`, 'Approbation demandée.')}>Demander approbation</button>}
            {can('maintenance.validate') && actionState.canApprove && <button onClick={() => action(`/maintenance/requests/${request.id}/approve`, 'Demande approuvée.')}>Approuver</button>}
{can('maintenance.validate') && actionState.canApprove && <button className="secondary" onClick={() => action(`/maintenance/requests/${request.id}/reject`, 'Demande rejetée.', { reason: 'Diagnostic à revoir' })}>Rejeter</button>}
{can('maintenance.assign') && actionState.canAssign && <button onClick={() => setAssigning(true)}><UserCog size={16} />{request.status === 'ASSIGNED' ? 'Réaffecter' : 'Affecter'}</button>}
            {can('maintenance.update') && actionState.canStart && <button onClick={() => action(`/maintenance/requests/${request.id}/start`, 'Intervention démarrée.', {})}><CirclePause size={16} />Démarrer intervention</button>}
            {can('maintenance.update') && actionState.canPause && <button onClick={() => action(`/maintenance/requests/${request.id}/pause`, 'Intervention mise en pause.')}>Mettre en pause</button>}
            {can('maintenance.update') && actionState.canResume && <button onClick={() => action(`/maintenance/requests/${request.id}/resume`, 'Intervention reprise.')}>Reprendre</button>}
            {can('maintenance.update') && actionState.canWork && <button onClick={() => setExpenseOpen(true)}><CircleAlert size={16} />Ajouter coût</button>}
            {can('maintenance.update') && actionState.canWork && <button onClick={() => setStockOpen(true)}><Paperclip size={16} />Consommer stock</button>}
            {request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="secondary" title="Email locataire" onClick={() => sendCommunication('EMAIL', 'TENANT')}><Mail size={16} />Email</button>}
            {request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="secondary" title="SMS locataire" onClick={() => sendCommunication('SMS', 'TENANT')}><MessageSquare size={16} />SMS</button>}
            {request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="secondary" title="WhatsApp locataire" onClick={() => sendCommunication('WHATSAPP', 'TENANT')}><MessageSquare size={16} />WhatsApp</button>}
{can('maintenance.update') && actionState.canResolve && <button onClick={() => action(`/maintenance/requests/${request.id}/resolve`, 'Intervention résolue.', { actual_hours: request.actual_hours ?? 0, resolution_comments: request.proposed_solution ?? 'Résolution' })}><CheckCircle2 size={16} />Marquer résolu</button>}
            {can('maintenance.update') && actionState.canReopen && <button onClick={() => action(`/maintenance/requests/${request.id}/reopen`, 'Intervention rouverte.')}>Rouvrir</button>}
            {can('maintenance.validate') && actionState.canValidate && <button onClick={() => {
              const technicianSignature = window.prompt('Nom du technicien signataire', request.assigned_employee_name ?? '') ?? '';
              const clientSignature = window.prompt('Nom du client signataire', request.tenant_name ?? '') ?? '';
              return action(`/maintenance/requests/${request.id}/validate`, 'Demande validée.', { comments: 'Validétion finale', technician_signature_name: technicianSignature || null, client_signature_name: clientSignature || null });
            }}><CheckCircle2 size={16} />Validér</button>}
            {can('maintenance.close') && actionState.canClose && <button onClick={() => action(`/maintenance/requests/${request.id}/close`, 'Demande clôturée.')}>Clôturer</button>}
            {can('maintenance.update') && actionState.canCancel && <button className="secondary" onClick={() => action(`/maintenance/requests/${request.id}/cancel`, 'Demande annulée.')}>Annuler</button>}
            <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
            <button className="secondary" onClick={() => exportXlsxWorkbook(`maintenance_${request.request_number}.xlsx`, printable)}><FileSpreadsheet size={16} />Excel</button>
          </div>
        }
      />
      <SuccessMessage message={success} />

      <div className="summary-band maintenance-summary">
        <SummaryItem label="N° demande" value={request.request_number} />
        <SummaryItem label="Titre" value={request.title} />
        <SummaryItem label="Statut" value={maintenanceStatusLabel(request.status)} />
        <SummaryItem label="Priorité" value={priorityLabel(request.priority)} />
        <SummaryItem label="Immeuble" value={request.building_name ?? '-'} />
        <SummaryItem label="Unité" value={request.unit_number ?? '-'} />
        <SummaryItem label="Locataire" value={request.tenant_name ?? '-'} />
        <SummaryItem label="Technicien" value={request.assigned_employee_name ?? '-'} />
        <SummaryItem label="Date" value={request.reported_at ? shortDate(request.reported_at) : '-'} />
        <SummaryItem label="Échéance" value={request.due_date ? shortDate(request.due_date) : '-'} />
        <SummaryItem label="Coût" value={money(costBreakdown.total)} />
      </div>

      <article className="maintenance-print">
        <header className="maintenance-detail-header">
          <div className="maintenance-detail-brand">
            <div className="maintenance-logo">PE</div>
            <div>
              <strong>NG Property ERP</strong>
              <span>Maintenance</span>
            </div>
          </div>
          <div className="maintenance-detail-title">
            <span className="maintenance-detail-number">{request.request_number}</span>
            <h2>{request.title}</h2>
            <div className="maintenance-detail-badges">
              <span className={`badge ${statusClass(request.status)}`}>{maintenanceStatusLabel(request.status)}</span>
              <span className={`badge ${priorityClass(request.priority)}`}>{priorityLabel(request.priority)}</span>
            </div>
          </div>
          <div className="invoice-meta maintenance-detail-meta">
            <strong>{request.building_name ?? 'Immeuble -'}</strong>
            <span>{request.unit_number ?? 'Unité -'}</span>
            <span>{request.tenant_name ?? 'Locataire -'}</span>
          </div>
        </header>

        <div className="maintenance-section-grid">
          <SectionBlock title="Informations générales">
            <div className="maintenance-detail-grid">
              <DetailLine label="Immeuble" value={request.building_name ?? '-'} />
              <DetailLine label="Unité" value={request.unit_number ?? '-'} />
              <DetailLine label="Locataire" value={request.tenant_name ?? '-'} />
              <DetailLine label="Technicien" value={request.assigned_employee_name ?? '-'} />
              <DetailLine label="Date signalement" value={request.reported_at ? shortDate(request.reported_at) : '-'} />
              <DetailLine label="Échéance" value={request.due_date ? shortDate(request.due_date) : '-'} />
              <DetailLine label="Coût estimé" value={money(request.estimated_cost ?? 0)} />
              <DetailLine label="Coût total" value={money(costBreakdown.total)} />
            </div>
          </SectionBlock>

          <SectionBlock title="Diagnostic">
            <div className="maintenance-detail-grid">
              <DetailLine label="Description" value={request.description ?? '-'} />
              <DetailLine label="Diagnostic" value={request.diagnostic ?? '-'} />
              <DetailLine label="Cause" value={request.cause ?? '-'} />
      <DetailLine label="Solution proposée" value={request.proposed_solution ?? '-'} />
              <DetailLine label="Observations internes" value={request.internal_notes ?? '-'} />
            </div>
          </SectionBlock>

          <SectionBlock title={`Pièces jointes (${attachmentItems.length})`}>
    {attachmentItems.length ? <div className="maintenance-gallery">{attachmentItems.map((item, index) => <AttachmentCard item={item} key={`${item.label}-${index}`} />)}</div> : <div className="compact-empty">Aucune pièce jointe.</div>}
          </SectionBlock>

          <SectionBlock title="Timeline">
            {timelineItems.length ? <div className="maintenance-timeline">{timelineItems.map((item, index) => <TimelineEntry item={item} key={`${item.title}-${index}`} />)}</div> : <div className="compact-empty">Aucun historique trouvé.</div>}
          </SectionBlock>

          <SectionBlock title={`Communications (${request.communications?.length ?? 0})`}>
            {(request.communications?.length ?? 0) ? (
              <SimpleTable
                headers={['Date', 'Canal', 'Destinataire', 'Statut', 'Message']}
                rows={(request.communications ?? []).map((item) => [item.sent_at ? shortDate(item.sent_at) : '-', item.channel, item.recipient, item.status, item.message])}
              />
            ) : (
              <div className="compact-empty">Aucune communication enregistrée.</div>
            )}
          </SectionBlock>

          <SectionBlock title="Dépenses">
            <SimpleTable
              headers={['Date', 'Catégorie', 'Description', 'Montant', 'Observation', 'Statut']}
              rows={request.expenses.map((expense) => [shortDate(expense.expense_date), expense.category, expense.description ?? '-', money(expense.amount), expense.observation ?? '-', maintenanceStatusLabel(expense.status)])}
            />
            <div className="summary-band maintenance-cost-footer">
              <SummaryItem label="Main-d'oeuvre" value={money(costBreakdown.labor)} />
              <SummaryItem label="Pièces" value={money(costBreakdown.parts)} />
              <SummaryItem label="Sous-total dépenses" value={money(costBreakdown.expenses)} />
              <SummaryItem label="Total" value={money(costBreakdown.total)} />
            </div>
          </SectionBlock>

          <SectionBlock title="Consommation de stock">
            {request.stock_movements.length ? (
              <>
                <SimpleTable
                  headers={['Article', 'Quantité', 'Prix unitaire', 'Total ligne', 'Observation', 'Date']}
                  rows={request.stock_movements.map((movement) => [movement.item_name, movement.quantity, money(movement.unit_price ?? 0), money(Number(movement.quantity) * Number(movement.unit_price ?? 0)), movement.notes ?? '-', shortDate(movement.movement_date)])}
                />
                <div className="summary-band maintenance-cost-footer">
                  <SummaryItem label="Sous-total stock" value={money(costBreakdown.parts)} />
                </div>
              </>
            ) : (
              <div className="compact-empty">Aucune consommation de stock.</div>
            )}
          </SectionBlock>

          <SectionBlock title="Temps d’intervention">
            <div className="maintenance-detail-grid">
              <DetailLine label="Temps estimé" value={interventionTime.estimated} />
              <DetailLine label="Temps réel" value={interventionTime.actual} />
              <DetailLine label="Date début" value={interventionTime.startedAt} />
              <DetailLine label="Date fin" value={interventionTime.endedAt} />
              <DetailLine label="Retard" value={interventionTime.overdue} />
              <DetailLine label="SLA" value={interventionTime.slaRespect} />
            </div>
          </SectionBlock>

          <SectionBlock title="Validétion">
            <div className="maintenance-signature-grid">
              <div className="signature-box"><span>Technicien</span><strong>{request.technician_signature_name ?? request.assigned_employee_name ?? 'À signer'}</strong><small>{request.technician_signed_at ? shortDate(request.technician_signed_at) : 'Signature prévue'}</small></div>
              <div className="signature-box"><span>Responsable</span><strong>À valider</strong><small>Signature prévue</small></div>
              <div className="signature-box"><span>Client</span><strong>{request.client_signature_name ?? request.tenant_name ?? 'À signer'}</strong><small>{request.client_signed_at ? shortDate(request.client_signed_at) : 'Signature prévue'}</small></div>
            </div>
          </SectionBlock>
        </div>
      </article>

      {editing && (
        <MaintenanceRequestModal
          title="Modifier signalement"
          requestNumber={request.request_number}
          editing={request}
          buildings={buildings.data}
          units={units.data}
          tenants={tenants.data}
          employees={employees.data}
          categories={categories.data}
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            await api.patch(`/maintenance/requests/${request.id}`, Object.fromEntries(form));
            setSuccessMessage('Signalement modifié.');
            setEditing(false);
            await refresh();
          }}
        />
      )}

      {assigning && (
        <AssignMaintenanceModal
          request={request}
          employees={employees.data}
          onClose={() => setAssigning(false)}
          onSubmit={async (body) => {
            await api.post(`/maintenance/requests/${request.id}/assign`, body);
            setSuccessMessage('Technicien affecté.');
            setAssigning(false);
            await refresh();
          }}
        />
      )}

      {expenseOpen && (
        <MaintenanceExpenseModal
          request={request}
          onClose={() => setExpenseOpen(false)}
          onSubmit={async (body) => {
            await api.post(`/maintenance/requests/${request.id}/expenses`, body);
            setSuccessMessage('Dépense enregistrée.');
            setExpenseOpen(false);
            await refresh();
          }}
        />
      )}

      {stockOpen && (
        <MaintenanceStockModal
          request={request}
          stockItems={stockItems.data}
          onClose={() => setStockOpen(false)}
          onSubmit={async (body) => {
            await api.post(`/maintenance/requests/${request.id}/stock`, body);
            setSuccessMessage('Stock consommé.');
            setStockOpen(false);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function MaintenanceRequestModal({
  title,
  requestNumber,
  buildings,
  units,
  tenants,
  employees,
  categories,
  editing,
  onClose,
  onSubmit,
}: {
  title: string;
  requestNumber: string;
  buildings: BuildingOption[];
  units: UnitOption[];
  tenants: TenantSearchOption[];
  employees: EmployeeOption[];
  categories: MaintenanceCategoryOption[];
  editing?: Partial<MaintenanceRequest> | null;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [buildingId, setBuildingId] = useState<number | null>(editing?.building_id ?? null);
  const [unitId, setUnitId] = useState<number | null>(editing?.unit_id ?? null);
  const [tenantId, setTenantId] = useState<number | null>(editing?.tenant_id ?? null);
  const [attachmentName, setAttachmentName] = useState(editing?.attachment_file_name ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!unitId) {
      if (!editing?.tenant_id) setTenantId(null);
      return;
    }
    const selectedUnit = units.find((unit) => Number(unit.id) === Number(unitId));
    if (selectedUnit?.tenant_id) {
      setTenantId(Number(selectedUnit.tenant_id));
    } else if (!editing?.tenant_id) {
      setTenantId(null);
    }
  }, [unitId, units, editing?.tenant_id]);

  const buildingOptionsData = useMemo(() => buildingOptions(buildings), [buildings]);
  const unitOptionsData = useMemo(() => unitOptions(units, buildingId), [units, buildingId]);
  const categoryOptions = useMemo(() => maintenanceCategoryNames(categories, editing?.category), [categories, editing?.category]);
  const hasSelectableCategory = categoryOptions.length > 0;
  const tenantOptionsData = useMemo(() => tenants.map((tenant) => ({
    id: Number(tenant.id),
    tenant_type: String(tenant.tenant_type ?? 'PHYSICAL'),
    company_name: tenant.company_name ? String(tenant.company_name) : undefined,
    first_name: String(tenant.first_name ?? ''),
    last_name: String(tenant.last_name ?? ''),
    post_name: tenant.post_name ? String(tenant.post_name) : undefined,
    phone: tenant.phone ? String(tenant.phone) : undefined,
    building_name: tenant.building_name ? String(tenant.building_name) : undefined,
    unit_number: tenant.unit_number ? String(tenant.unit_number) : undefined,
  })), [tenants]);
  const initialSnapshot = useMemo(
    () =>
      maintenanceFormSnapshot({
        title: editing?.title ?? '',
        description: editing?.description ?? '',
        category: editing?.category ?? 'Autre',
        priority: editing?.priority ?? 'NORMAL',
        reported_at: editing?.reported_at ? toDateTimeLocal(editing.reported_at) : toDateTimeLocal(new Date().toISOString()),
        due_date: editing?.due_date ? String(editing.due_date).slice(0, 10) : '',
        building_id: editing?.building_id ?? null,
        unit_id: editing?.unit_id ?? null,
        tenant_id: editing?.tenant_id ?? null,
        internal_notes: editing?.internal_notes ?? '',
        estimated_cost: editing?.estimated_cost ?? 0,
        attachment_file_name: editing?.attachment_file_name ?? '',
      }),
    [editing],
  );
  const buildPayload = useCallback(
    (form: HTMLFormElement) => {
      const payload = new FormData(form);
      const file = payload.get('attachment_file');
      if (file instanceof File && file.name) {
        payload.set('attachment_file_name', file.name);
      } else {
        payload.set('attachment_file_name', attachmentName);
      }
      payload.delete('attachment_file');
      return payload;
    },
    [attachmentName],
  );
  const currentSnapshot = useCallback(() => {
    if (!formRef.current) return initialSnapshot;
    const form = buildPayload(formRef.current);
    return maintenanceFormSnapshot({
      title: form.get('title'),
      description: form.get('description'),
      category: form.get('category'),
      priority: form.get('priority'),
      reported_at: form.get('reported_at'),
      due_date: form.get('due_date'),
      building_id: buildingId,
      unit_id: unitId,
      tenant_id: tenantId,
      internal_notes: form.get('internal_notes'),
      estimated_cost: form.get('estimated_cost'),
      attachment_file_name: form.get('attachment_file_name'),
    });
  }, [buildPayload, buildingId, initialSnapshot, tenantId, unitId]);
  const hasUnsavedChanges = useCallback(
    () => JSON.stringify(currentSnapshot()) !== JSON.stringify(initialSnapshot),
    [currentSnapshot, initialSnapshot],
  );
  const requestClose = useCallback(() => {
    if (submitting) return;
    if (hasUnsavedChanges()) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose, submitting]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [requestClose]);

  return (
    <Modal title={title} onClose={requestClose}>
      <form
        ref={formRef}
        className="maintenance-modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting || !hasSelectableCategory) return;
          setSubmitting(true);
          setError('');
          setConfirmDiscard(false);
          try {
            await onSubmit(buildPayload(event.currentTarget));
            event.currentTarget.reset();
          } catch (caught) {
            setError(extractApiMessage(caught, 'Impossible d’enregistrer la demande de maintenance.'));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {error ? <div className="error-message">{error}</div> : null}
        {confirmDiscard ? (
          <div className="info-message maintenance-discard-confirmation">
            <strong>Annuler les modifications ?</strong>
            <span>Les modifications non enregistrées seront perdues.</span>
            <div className="maintenance-discard-actions">
              <button type="button" className="secondary" onClick={() => setConfirmDiscard(false)} disabled={submitting}>
                Continuer la modification
              </button>
              <button type="button" className="danger" onClick={onClose} disabled={submitting}>
                Abandonner les modifications
              </button>
            </div>
          </div>
        ) : null}
        {!hasSelectableCategory ? (
          <div className="info-message">
            Aucune catégorie de maintenance n'est disponible. Veuillez d'abord créer une catégorie.
          </div>
        ) : null}
        <div className="modal-section">
          <h3>Informations générales</h3>
          <div className="maintenance-grid maintenance-general-grid">
            <label>N° demande<input value={requestNumber} readOnly className="locked-field" /></label>
            <label>Titre *<input name="title" defaultValue={editing?.title ?? ''} required placeholder="Titre du signalement" /></label>
            <label>Catégorie *<select name="category" defaultValue={editing?.category ?? categoryOptions[0] ?? ''} disabled={!hasSelectableCategory}>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label>Priorité *<select name="priority" defaultValue={editing?.priority ?? 'NORMAL'}>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Date signalement<input name="reported_at" type="datetime-local" defaultValue={editing?.reported_at ? toDateTimeLocal(editing.reported_at) : toDateTimeLocal(new Date().toISOString())} /></label>
            <label>Échéance / SLA<input name="due_date" type="date" defaultValue={editing?.due_date ? String(editing.due_date).slice(0, 10) : ''} /></label>
          </div>
        </div>

        <div className="modal-section">
          <h3>Lieu concerné</h3>
          <div className="maintenance-grid maintenance-triplet-grid">
            <label className="wide-field">Immeuble
              <SearchableSelect
                options={buildingOptionsData}
                value={buildingId}
                onChange={(value) => {
                  setBuildingId(value ? Number(value) : null);
                  if (value && unitId && !unitOptions(units, Number(value)).some((option) => option.value === unitId)) {
                    setUnitId(null);
                  }
                }}
                placeholder="Rechercher un immeuble"
                emptyMessage="Aucun immeuble trouvé"
              />
              <input name="building_id" value={buildingId ?? ''} readOnly type="hidden" />
            </label>
            <label className="wide-field">Appartement
              <SearchableSelect
                options={unitOptionsData}
                value={unitId}
                onChange={(value) => setUnitId(value ? Number(value) : null)}
    placeholder="Rechercher une unité"
                emptyMessage="Aucune unité trouvée"
              />
              <input name="unit_id" value={unitId ?? ''} readOnly type="hidden" />
            </label>
            <label className="wide-field">Locataire
              <TenantSearchSelect
                tenants={tenantOptionsData}
                value={tenantId}
                onChange={setTenantId}
              />
            </label>
          </div>
        </div>

        <div className="modal-section">
          <h3>Description</h3>
          <div className="maintenance-grid maintenance-notes-grid">
            <label className="wide-field maintenance-textarea-full">Description *<textarea name="description" defaultValue={editing?.description ?? ""} required placeholder="Décrire le signalement" /></label>
            <label className="wide-field maintenance-textarea-full">Observations internes<textarea name="internal_notes" defaultValue={editing?.internal_notes ?? ""} placeholder="Notes internes" /></label>
            <label>Pièce jointe / photo<input name="attachment_file" type="file" accept=".pdf,image/jpeg,image/png" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? "")} /></label>
            {attachmentName ? <div className="storage-note wide-field">Fichier sélectionné : {attachmentName}</div> : null}
          </div>
        </div>

        <div className="modal-section">
          <h3>Calculs</h3>
          <div className="maintenance-grid maintenance-cost-grid">
            <label>Coût estimé<input name="estimated_cost" type="number" step="0.01" defaultValue={editing?.estimated_cost ?? 0} /></label>
            <label>Montant affiché<input value={`${Number(editing?.estimated_cost ?? 0) || 0} USD`} readOnly className="locked-field" /></label>
          </div>
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={requestClose} disabled={submitting}>Annuler</button>
          <button type="submit" disabled={submitting || !hasSelectableCategory}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignMaintenanceModal({
  request,
  employees,
  onClose,
  onSubmit,
}: {
  request: MaintenanceRequest;
  employees: EmployeeOption[];
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const hasInternalTechnician = Boolean(request.assigned_employee_id);
  const [assignmentType, setAssignmentType] = useState<'INTERNAL' | 'EXTERNAL'>(hasInternalTechnician ? 'INTERNAL' : 'EXTERNAL');
  const [employeeId, setEmployeeId] = useState<number | null>(request.assigned_employee_id ?? null);
  const [technicianName, setTechnicianName] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [plannedTime, setPlannedTime] = useState('');
  const [notes, setNotes] = useState('');
  const [externalProvider, setExternalProvider] = useState('');

  return (
    <Modal title={`Affecter - ${request.request_number}`} onClose={onClose}>
      <form
        className="maintenance-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            employee_id: assignmentType === 'INTERNAL' ? employeeId : null,
            employee_name: assignmentType === 'INTERNAL' ? technicianName || null : null,
            external_provider: assignmentType === 'EXTERNAL' ? externalProvider : null,
            planned_date: plannedDate || null,
            planned_time: plannedTime || null,
            notes,
          });
        }}
      >
        <div className="modal-section">
          <h3>Affectation</h3>
          <p className="storage-note">Choisissez si la mission est confiée à un technicien interne ou à un prestataire externe.</p>
          <div className="maintenance-grid maintenance-assignment-grid">
            <label className="wide-field">Type d'affectation
              <select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value as 'INTERNAL' | 'EXTERNAL')}>
                <option value="INTERNAL">Technicien interne</option>
                <option value="EXTERNAL">Prestataire externe</option>
              </select>
            </label>
            {assignmentType === 'INTERNAL' ? (
              employees.length ? (
                <label className="wide-field">Technicien
                  <SearchableSelect
                    options={employeeOptions(employees)}
                    value={employeeId}
                    onChange={(value) => {
                      const next = value ? Number(value) : null;
                      setEmployeeId(next);
                      const employee = employees.find((item) => Number(item.id) === next);
                      setTechnicianName(employee ? `${employee.first_name} ${employee.last_name}`.trim() : '');
                    }}
                    placeholder="Rechercher un technicien"
                    emptyMessage="Aucun technicien trouvé"
                  />
                </label>
              ) : (
                <label className="wide-field">Technicien<input value={technicianName} onChange={(event) => setTechnicianName(event.target.value)} placeholder="Nom du technicien" /></label>
              )
            ) : (
              <label className="wide-field">Prestataire externe<input value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Prestataire externe" /></label>
            )}
            <label>Date prévue d’intervention<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
            <label>Heure prévue<input type="time" value={plannedTime} onChange={(event) => setPlannedTime(event.target.value)} /></label>
            <label className="wide-field">Notes d’affectation<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes d’affectation" /></label>
          </div>
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Affecter</button>
        </div>
      </form>
    </Modal>
  );
}

function MaintenanceExpenseModal({
  request,
  onClose,
  onSubmit,
}: {
  request: MaintenanceDetail;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('');
  const [globalNotes, setGlobalNotes] = useState('');
  const [lines, setLines] = useState([{ category: "Main d'oeuvre", label: '', amount: '0', observation: '', supplier: '', reference: '', attachmentName: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const totalAmount = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);

  return (
    <Modal title={`Ajouter une dépense à l'intervention ${request.request_number}`} onClose={onClose}>
      <form className="maintenance-modal-form" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const invalidLine = lines.find((line) => !line.category || Number(line.amount || 0) <= 0);
        if (invalidLine) {
          setError('Chaque ligne de dépense doit avoir une catégorie et un montant positif.');
          return;
        }
        try {
          setSubmitting(true);
          await onSubmit({
            expense_date: expenseDate,
            payment_method: paymentMethod || null,
            notes: globalNotes || null,
            lines: lines.map((line) => ({
              category: line.category,
              description: line.label || null,
              amount: Number(line.amount),
              observation: line.observation || null,
              supplier: line.supplier || null,
              reference: line.reference || null,
              attachment_file_name: line.attachmentName || null,
            })),
          });
        } catch (caught) {
          setError(extractApiMessage(caught, 'Impossible d’enregistrer les dépenses.'));
        } finally {
          setSubmitting(false);
        }
      }}>
        <div className="modal-section">
          <h3>Informations générales</h3>
          <p className="storage-note">Cette dépense sera rattachée à l'intervention et pourra alimenter la caisse si le workflow le permet.</p>
          <div className="maintenance-grid maintenance-cost-grid">
            <label>Date<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
            <label>Moyen de paiement<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Non précisé</option><option value="CASH">Espèces</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
    <label>Total dépenses (USD)<input value={money(totalAmount)} readOnly className="locked-field" /></label>
          </div>
          <div className="maintenance-line-list">
            {lines.map((line, index) => (
              <div className="maintenance-line-item" key={index}>
                <div className="maintenance-grid maintenance-cost-grid">
                  <label>Nature du coût<select value={line.category} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, category: event.target.value } : entry))}>{["Main d'oeuvre", 'Transport', 'Sous-traitance', 'Achat local', 'Location matériel', 'Autre'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                  <label className="wide-field">Description<input value={line.label} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))} placeholder="Description facultative" /></label>
                  <label>Montant<input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: event.target.value } : entry))} required /></label>
                  <label className="wide-field">Observation<input value={line.observation} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, observation: event.target.value } : entry))} placeholder="Observation facultative" /></label>
                  <label>Fournisseur<input value={line.supplier} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, supplier: event.target.value } : entry))} placeholder="Fournisseur" /></label>
                  <label>Référence<input value={line.reference} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reference: event.target.value } : entry))} placeholder="Référence" /></label>
                  <label>Pièce jointe<input type="file" accept=".pdf,image/jpeg,image/png" onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, attachmentName: event.target.files?.[0]?.name ?? '' } : entry))} /></label>
                  <label>Total ligne<input value={money(Number(line.amount || 0))} readOnly className="locked-field" /></label>
                  <button type="button" className="secondary" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, entryIndex) => entryIndex !== index) : current)}>Supprimer</button>
                </div>
                {line.attachmentName ? <div className="storage-note">Fichier sélectionné : {line.attachmentName}</div> : null}
              </div>
            ))}
          </div>
          <button type="button" className="secondary" onClick={() => setLines((current) => [...current, { category: 'Autre', label: '', amount: '0', observation: '', supplier: '', reference: '', attachmentName: '' }])}><Plus size={16} />Ajouter ligne de coût</button>
          <label className="wide-field">Observations<textarea value={globalNotes} onChange={(event) => setGlobalNotes(event.target.value)} placeholder="Observations internes" /></label>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
          <button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MaintenanceStockModal({
  request,
  stockItems,
  onClose,
  onSubmit,
}: {
  request: MaintenanceDetail;
  stockItems: Array<{ id: number; name: string; current_quantity: number; unit: string; average_purchase_price?: number; purchase_price?: number }>;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [lines, setLines] = useState<Array<{ stockItemId: number | null; quantity: string; unitPrice: string; reason: string }>>([{ stockItemId: stockItems[0]?.id ?? null, quantity: '1', unitPrice: String(stockItems[0]?.average_purchase_price ?? stockItems[0]?.purchase_price ?? 0), reason: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);

  return (
    <Modal title={`Consommer stock pour intervention ${request.request_number}`} onClose={onClose}>
      <form className="maintenance-modal-form" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const invalidLine = lines.find((line) => {
          const selected = stockItems.find((item) => item.id === line.stockItemId);
          const quantity = Number(line.quantity || 0);
          return !selected || quantity <= 0 || quantity > Number(selected.current_quantity ?? 0);
        });
        if (invalidLine) {
          setError('Chaque ligne doit avoir un article actif, une quantité positive et un stock suffisant.');
          return;
        }
        try {
          setSubmitting(true);
          await onSubmit({
            lines: lines.map((line) => ({
              stock_item_id: line.stockItemId,
              quantity: Number(line.quantity),
              unit_price: Number(line.unitPrice || 0),
              observation: line.reason || null,
              comment: line.reason || null,
            })),
          });
        } catch (caught) {
          setError(extractApiMessage(caught, 'Impossible d’enregistrer la consommation de stock.'));
        } finally {
          setSubmitting(false);
        }
      }}>
        <div className="modal-section">
          <h3>Consommation stock</h3>
          <p className="storage-note">Cette action déduit les articles utilisés du stock et les rattache à cette intervention.</p>
          {stockItems.length ? (
            <>
              <div className="maintenance-line-list">
                {lines.map((line, index) => {
                  const selected = stockItems.find((item) => item.id === line.stockItemId);
                  const lineTotal = Number(line.quantity || 0) * Number(line.unitPrice || 0);
                  return (
                    <div className="maintenance-line-item" key={index}>
                      <div className="maintenance-grid maintenance-cost-grid">
                        <label className="wide-field">Article<select value={line.stockItemId ?? ''} onChange={(event) => { const nextId = event.target.value ? Number(event.target.value) : null; const next = stockItems.find((item) => item.id === nextId); setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, stockItemId: nextId, unitPrice: String(next?.average_purchase_price ?? next?.purchase_price ?? 0) } : entry)); }}>{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.current_quantity} {item.unit})</option>)}</select></label>
                        <label>Stock disponible<input value={selected ? `${selected.current_quantity} ${selected.unit}` : '-'} readOnly className="locked-field" /></label>
                        <label>Quantité<input type="number" min="0.01" max={selected?.current_quantity} step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry))} required /></label>
                        <label>Coût unitaire<input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, unitPrice: event.target.value } : entry))} /></label>
                        <label>Total<input value={money(lineTotal)} readOnly className="locked-field" /></label>
                        <label className="wide-field">Observation<input value={line.reason} onChange={(event) => setLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reason: event.target.value } : entry))} placeholder="Observation facultative" /></label>
                        <button type="button" className="secondary" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, entryIndex) => entryIndex !== index) : current)}>Supprimer</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="summary-band maintenance-cost-footer">
                <SummaryItem label="Total général" value={`${money(total)} USD`} />
              </div>
              <button type="button" className="secondary" onClick={() => setLines((current) => [...current, { stockItemId: stockItems[0]?.id ?? null, quantity: '1', unitPrice: String(stockItems[0]?.average_purchase_price ?? stockItems[0]?.purchase_price ?? 0), reason: '' }])}><Plus size={16} />Ajouter article</button>
            </>
          ) : (
            <div className="compact-empty">Aucun article disponible dans le stock.</div>
          )}
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
          <button type="submit" disabled={!stockItems.length || submitting}>{submitting ? 'Enregistrement...' : 'Consommer'}</button>
        </div>
      </form>
    </Modal>
  );
}
function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return <section className="maintenance-section"><h3>{title}</h3>{children}</section>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="summary-item"><span>{label}</span><strong>{value}</strong></div>;
}

function CompactRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  return <div className="compact-list">{rows.length ? rows.map((row, index) => <div className="compact-item" key={index}><span>{Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? '-')}`).join(' | ')}</span></div>) : <div className="compact-empty">Aucun historique trouvé.</div>}</div>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
      {!rows.length && <EmptyState />}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return <div className="summary-item"><span>{label}</span><strong>{String(value)}</strong></div>;
}

function dashboardNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatusRows(rows: Array<{ status: string; count: number }>) {
  return ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((status) => ({
    status,
    count: Number(rows.find((row) => row.status === status)?.count ?? 0),
  }));
}

function normalizePriorityRows(rows: Array<{ priority: string; count: number }>) {
  return ['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((priority) => ({
    priority,
    count: Number(rows.find((row) => row.priority === priority)?.count ?? 0),
  }));
}

function monthLabel(month: string) {
  if (!month) return '-';
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function maintenanceDashboardWorkbook(dashboard: MaintenanceDashboard) {
  return [
    { name: 'KPI', rows: [dashboard.kpis] },
    { name: 'Statuts', rows: dashboard.by_status.map((row) => ({ statut: maintenanceStatusLabel(row.status), total: row.count })) },
    { name: 'Priorités', rows: dashboard.by_priority.map((row) => ({ priorite: priorityLabel(row.priority), total: row.count })) },
    { name: 'Mensuel', rows: dashboard.monthly_interventions },
    { name: 'Coûts mensuels', rows: dashboard.monthly_costs.map((row) => ({ mois: row.month, stock: money(row.stock_cost), depenses: money(row.expenses_cost), total: money(row.total_cost) })) },
    { name: 'Top immeubles', rows: dashboard.top_buildings.map((row) => ({ immeuble: row.building_name, interventions: row.intervention_count, cout_total: money(row.total_cost) })) },
    { name: 'Top techniciens', rows: dashboard.top_technicians.map((row) => ({ technicien: row.technician_name, interventions: row.interventions_done, cloturees: row.closed_interventions, temps_moyen_h: Math.round(Number(row.average_resolution_hours ?? 0)) })) },
    { name: 'Récentes', rows: dashboard.recent_interventions.map((row) => ({ date: shortDate(row.reported_at), numero: row.request_number, immeuble: row.building_name, titre: row.title, priorite: priorityLabel(row.priority), statut: maintenanceStatusLabel(row.status), technicien: row.technician_name, cout: money(row.total_cost) })) },
    { name: 'Retards', rows: dashboard.overdue_interventions.map((row) => ({ retard_jours: row.days_overdue, numero: row.request_number, titre: row.title, immeuble: row.building_name, technicien: row.technician_name, priorite: priorityLabel(row.priority) })) },
  ];
}

function exportRow(item: MaintenanceRequest) {
  return {
    numero: item.request_number,
    titre: item.title,
    categorie: item.category,
    priorite: priorityLabel(item.priority),
    statut: maintenanceStatusLabel(item.status),
    immeuble: item.building_name ?? '-',
    unite: item.unit_number ?? '-',
    locataire: item.tenant_name ?? '-',
    echeance: item.due_date ? shortDate(item.due_date) : '-',
    technicien: item.assigned_employee_name ?? '-',
    cout: money(item.total_cost ?? item.estimated_cost ?? 0),
    piece_jointe: item.attachment_file_name ?? '-',
  };
}

function technicianRows(rows: MaintenanceRequest[]) {
  return rows
    .filter((row) => row.assigned_employee_name)
    .map((row) => ({
      technicien: row.assigned_employee_name ?? '-',
      demandes: rows.filter((current) => current.assigned_employee_name === row.assigned_employee_name).length,
      cout: money(rows.filter((current) => current.assigned_employee_name === row.assigned_employee_name).reduce((sum, current) => sum + Number(current.total_cost ?? current.estimated_cost ?? 0), 0)),
    }));
}

function documentRows(rows: MaintenanceRequest[]) {
  return rows.map((row) => ({
    demande: row.request_number,
    fichier: row.attachment_file_name ?? '-',
    statut: maintenanceStatusLabel(row.status),
  }));
}

function timelineRows(rows: MaintenanceRequest[]) {
  return rows.map((row) => ({
    date: row.reported_at ? shortDate(row.reported_at) : '-',
    demande: row.request_number,
    evenement: maintenanceStatusLabel(row.status),
    description: row.title,
  }));
}

function maintenanceWorkbook(request: MaintenanceDetail) {
  const rows = [exportRow(request)];
  return [
    { name: 'Résumé', rows: [{ numero: request.request_number, statut: maintenanceStatusLabel(request.status), priorite: priorityLabel(request.priority), immeuble: request.building_name ?? '-', unite: request.unit_number ?? '-', locataire: request.tenant_name ?? '-', technicien: request.assigned_employee_name ?? '-', cout: money(request.total_cost ?? request.estimated_cost ?? 0) }] },
    { name: 'Demandes', rows },
    { name: 'Ouvertes', rows: request.status !== 'CLOSED' && request.status !== 'CANCELLED' ? rows : [] },
    { name: 'En retard', rows: request.is_overdue ? rows : [] },
    { name: 'Urgentes', rows: request.priority === 'URGENT' ? rows : [] },
    { name: 'Terminées', rows: resolvedStatuses.has(request.status) ? rows : [] },
    { name: 'Coûts', rows: [{ demande: request.request_number, depenses: money(request.expenses_total ?? 0), stock: money(request.stock_cost_total ?? 0), total: money(request.total_cost ?? request.estimated_cost ?? 0) }] },
    { name: 'Techniciens', rows: technicianRows([request]) },
    { name: 'Documents', rows: documentRows([request]) },
    { name: 'Timeline', rows: timelineRows([request]) },
    { name: 'Audit', rows: timelineRows([request]) },
  ];
}

type MaintenanceActionState = {
  canEdit: boolean;
  canDiagnose: boolean;
  canRequestApproval: boolean;
  canApprove: boolean;
  canAssign: boolean;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canWork: boolean;
  canResolve: boolean;
  canReopen: boolean;
  canValidate: boolean;
  canClose: boolean;
  canCancel: boolean;
};

type MaintenanceTimelineView = {
  date: string;
  title: string;
  details?: string;
  status?: string;
};

type MaintenanceAttachmentView = {
  label: string;
  fileName: string;
  fileUrl?: string;
  kind: string;
};

function maintenanceDetailActions(status: string): MaintenanceActionState {
  const final = new Set(['CLOSED', 'CANCELLED']);
  return {
    canEdit: !final.has(status),
    canDiagnose: status === 'NEW',
    canRequestApproval: status === 'DIAGNOSIS',
    canApprove: status === 'WAITING_APPROVAL',
    canAssign: new Set(['NEW', 'DIAGNOSIS', 'APPROVED', 'ASSIGNED']).has(status),
    canStart: status === 'ASSIGNED',
    canPause: status === 'IN_PROGRESS',
    canResume: status === 'ON_HOLD',
    canWork: status === 'IN_PROGRESS',
    canResolve: status === 'IN_PROGRESS',
    canReopen: status === 'RESOLVED',
    canValidate: status === 'RESOLVED',
    canClose: status === 'VALIDATED',
    canCancel: new Set(['NEW', 'DIAGNOSIS', 'ON_HOLD']).has(status),
  };
}

function maintenanceTimelineItems(request: MaintenanceDetail | null): MaintenanceTimelineView[] {
  if (!request) return [];
  const items: MaintenanceTimelineView[] = [];
  if (request.reported_at) {
    items.push({ date: request.reported_at, title: 'Signalement créé', details: request.description ?? '-' });
  }
  if (request.assignments?.length) {
    request.assignments.forEach((assignment) => {
      items.push({
        date: assignment.assigned_at,
      title: assignment.employee_name ? `Affectation à ${assignment.employee_name}` : 'Affectation',
      details: [assignment.external_provider ? `Prestataire: ${assignment.external_provider}` : '', assignment.notes ?? ''].filter(Boolean).join(' • ') || undefined,
      });
    });
  }
  if (request.timeline?.length) {
    request.timeline.forEach((event) => {
      items.push({
        date: event.created_at,
        title: event.title,
        details: event.details?.trim() || undefined,
        status: event.event_type ? event.event_type.replace(/_/g, ' ') : undefined,
      });
    });
  }
  if (request.resolved_at) {
    items.push({ date: request.resolved_at, title: 'Intervention résolue', details: request.proposed_solution ?? undefined });
  }
  return items
    .filter((item) => item.title)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function maintenanceAttachmentItems(request: MaintenanceDetail | null): MaintenanceAttachmentView[] {
  if (!request) return [];
  const items: MaintenanceAttachmentView[] = [];
  if (request.attachment_file_name) {
    items.push({
      label: 'Signalement',
      fileName: request.attachment_file_name,
      fileUrl: request.attachment_file_url ?? undefined,
      kind: 'main',
    });
  }
  request.documents.forEach((document) => {
    items.push({
      label: document.document_type,
      fileName: document.file_name,
      fileUrl: document.file_url,
      kind: 'document',
    });
  });
  request.expenses.filter((expense) => expense.attachment_file_name).forEach((expense) => {
    items.push({
      label: 'Justificatif de coût',
      fileName: expense.attachment_file_name!,
      kind: 'expense',
    });
  });
  return items;
}

function maintenanceCoûtBreakdown(request: MaintenanceDetail | null) {
  const labor = Number(request?.estimated_cost ?? 0);
  const parts = Number(request?.stock_cost_total ?? 0);
  const expenses = Number(request?.expenses_total ?? 0);
  const total = Number(request?.total_cost ?? labor + parts + expenses);
  return { labor, parts, expenses, total };
}

function maintenanceTimeSummary(request: MaintenanceDetail | null) {
  const reportedAt = request?.reported_at ? new Date(request.reported_at) : null;
  const resolvedAt = request?.resolved_at ? new Date(request.resolved_at) : null;
  const now = new Date();
  const elapsed = reportedAt ? (resolvedAt ?? now).getTime() - reportedAt.getTime() : 0;
  const hours = Math.max(0, Math.round(elapsed / 36e5));
  return {
    estimated: request?.actual_hours ? `${request.actual_hours} h` : `${hours || 0} h`,
    actual: request?.actual_hours ? `${request.actual_hours} h` : 'Non disponible',
    startedAt: reportedAt ? shortDate(reportedAt.toISOString()) : '-',
    endedAt: resolvedAt ? shortDate(resolvedAt.toISOString()) : 'Non résolu',
    overdue: request?.is_overdue ? 'Oui' : 'Non',
    slaRespect: request?.is_overdue ? 'Non' : 'Oui',
  };
}

function isImageAttachment(fileName?: string, fileUrl?: string) {
  const candidate = `${fileName ?? ''} ${fileUrl ?? ''}`.toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some((extension) => candidate.includes(extension));
}

function AttachmentCard({ item }: { item: MaintenanceAttachmentView }) {
  const preview = isImageAttachment(item.fileName, item.fileUrl) && item.fileUrl;
  return (
    <article className="maintenance-attachment-card">
      <div className="maintenance-attachment-head">
        <span>{item.label}</span>
        <strong>{item.fileName}</strong>
      </div>
      {preview ? <img src={item.fileUrl} alt={item.fileName} className="maintenance-attachment-preview" /> : <div className="maintenance-attachment-placeholder">Aperçu non disponible</div>}
      {item.fileUrl ? <a href={item.fileUrl} target="_blank" rel="noreferrer">Voir le fichier</a> : <span className="storage-note">Aucune URL disponible</span>}
    </article>
  );
}

function TimelineEntry({ item }: { item: MaintenanceTimelineView }) {
  return (
    <div className="maintenance-timeline-item">
      <div className="maintenance-timeline-date">{shortDate(item.date)}</div>
      <div className="maintenance-timeline-body">
        <strong>{item.title}</strong>
        {item.details ? <span>{item.details}</span> : null}
        {item.status ? <small>{item.status}</small> : null}
      </div>
    </div>
  );
}

function buildingOptions(buildings: BuildingOption[]) {
  return buildings.map((building) => ({
    value: building.id,
    label: building.name,
    meta: [building.city, building.commune].filter(Boolean).join(' - ') || '-',
  }));
}

function unitOptions(units: UnitOption[], buildingId: number | null) {
  return units
    .filter((unit) => !buildingId || Number(unit.building_id ?? 0) === buildingId)
    .map((unit) => ({
      value: unit.id,
      label: unit.number,
      meta: [unit.building_name, unit.tenant_name ? `Locataire : ${unit.tenant_name}` : '', unit.monthly_rent ? `${money(unit.monthly_rent)} USD` : ''].filter(Boolean).join(' - ') || '-',
    }));
}

function employeeOptions(employees: EmployeeOption[]) {
  return employees.map((employee) => ({
    value: employee.id,
    label: `${employee.first_name} ${employee.last_name}`.trim(),
    meta: employee.job_title ?? '-',
  }));
}

function priorityLabel(value: string) {
  return ({ LOW: 'Faible', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgente' } as Record<string, string>)[value] ?? value;
}

function maintenanceStatusLabel(value: string) {
  return ({
    NEW: 'Nouveau',
    DIAGNOSIS: 'Diagnostic',
    WAITING_APPROVAL: 'En attente approbation',
    APPROVED: 'Approuvé',
    ASSIGNED: 'Affecté',
    IN_PROGRESS: 'En cours',
    ON_HOLD: 'En pause',
    RESOLVED: 'Résolu',
    VALIDATED: 'Validé',
    CLOSED: 'Clôturé',
    CANCELLED: 'Annulé',
  } as Record<string, string>)[value] ?? value;
}

function priorityClass(value: string) {
  return ({ LOW: 'partial', NORMAL: 'active', HIGH: 'maintenance', URGENT: 'overdue' } as Record<string, string>)[value] ?? 'partial';
}

function statusClass(value: string) {
  return ({
    NEW: 'not_invoiced',
    DIAGNOSIS: 'maintenance',
    WAITING_APPROVAL: 'partial',
    APPROVED: 'active',
    ASSIGNED: 'partial',
    IN_PROGRESS: 'active',
    ON_HOLD: 'maintenance',
    RESOLVED: 'paid',
    VALIDATED: 'paid',
    CLOSED: 'paid',
    CANCELLED: 'overdue',
  } as Record<string, string>)[value] ?? 'not_invoiced';
}

function startOfWeekISO() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function endOfWeekISO() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}

function maintenanceFormSnapshot(input: Record<string, unknown>) {
  return {
    title: normalizeMaintenanceText(input.title),
    description: normalizeMaintenanceText(input.description),
    category: normalizeMaintenanceText(input.category),
    priority: normalizeMaintenanceText(input.priority || 'NORMAL'),
    reported_at: normalizeMaintenanceText(input.reported_at),
    due_date: normalizeMaintenanceText(input.due_date),
    building_id: normalizeMaintenanceNumber(input.building_id),
    unit_id: normalizeMaintenanceNumber(input.unit_id),
    tenant_id: normalizeMaintenanceNumber(input.tenant_id),
    internal_notes: normalizeMaintenanceText(input.internal_notes),
    estimated_cost: normalizeMaintenanceAmount(input.estimated_cost),
    attachment_file_name: normalizeMaintenanceText(input.attachment_file_name),
  };
}

function normalizeMaintenanceText(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeMaintenanceNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function normalizeMaintenanceAmount(value: unknown) {
  if (value === undefined || value === null || value === '') return '0';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : '0';
}

function extractApiMessage(error: unknown, fallback: string) {
  const maybeError = error as { response?: { data?: { message?: unknown; error?: unknown } }; message?: unknown };
  const data = maybeError?.response?.data;
  if (Array.isArray(data?.message)) return data.message.join(' ');
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof maybeError?.message === 'string' && maybeError.message.trim()) return maybeError.message;
  return fallback;
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
