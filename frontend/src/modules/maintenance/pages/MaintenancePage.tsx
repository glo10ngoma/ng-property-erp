import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CirclePause,
  CircleX,
  Eye,
  FileSpreadsheet,
  Pencil,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  UserCog,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  expenses: Array<{ id: number; amount: number; expense_date: string; category: string; status: string; description?: string; supplier?: string; reference?: string; attachment_file_name?: string }>;
  stock_movements: Array<{ id: number; item_name: string; quantity: number; unit_price?: number; movement_date: string; reference?: string; notes?: string }>;
  maintenance_documents?: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>;
};

type BuildingOption = { id: number; name: string; city?: string; commune?: string };
type UnitOption = { id: number; number: string; building_id?: number; building_name?: string; tenant_id?: number | null; tenant_name?: string; monthly_rent?: number };
type EmployeeOption = { id: number; first_name: string; last_name: string; job_title?: string };

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

const MAINTENANCE_CATEGORIES = [
  'Electricite',
  'Plomberie',
  'Peinture',
  'Maconnerie',
  'Menuiserie',
  'Climatisation',
  'Serrurerie',
  'Nettoyage',
  'Autre',
];

const allowedReportStatuses = new Set(['NEW', 'DIAGNOSIS', 'WAITING_APPROVAL', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
const resolvedStatuses = new Set(['RESOLVED', 'VALIDATED', 'CLOSED']);

export function MaintenancePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const requests = useApiList<MaintenanceRequest>('/maintenance/requests');
  const employees = useApiList<EmployeeOption>('/employees');
  const buildings = useApiList<BuildingOption>('/buildings');
  const units = useApiList<UnitOption>('/units');
  const tenants = useApiList<TenantSearchOption>('/tenants');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ status: '', priority: '', category: '', building_id: '', employee_id: '', overdue: false, week: false });
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRequest | null>(null);
  const [assigning, setAssigning] = useState<MaintenanceRequest | null>(null);

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

  const kpis = useMemo(() => {
    const totalCost = requests.data.reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const monthCost = requests.data.filter((item) => String(item.reported_at ?? '').slice(0, 7) === month).reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0);
    return {
      total: requests.data.length,
      open: requests.data.filter((item) => !['CLOSED', 'CANCELLED'].includes(item.status)).length,
      urgent: requests.data.filter((item) => item.priority === 'URGENT').length,
      overdue: requests.data.filter((item) => item.is_overdue).length,
      inProgress: requests.data.filter((item) => ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(item.status)).length,
      finished: requests.data.filter((item) => resolvedStatuses.has(item.status)).length,
      totalCost,
      monthCost,
    };
  }, [requests.data]);

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
    if (editingId) await api.put(`/maintenance/requests/${editingId}`, payload);
    else await api.post('/maintenance/requests', payload);
    setSuccess(editingId ? 'Signalement modifié.' : 'Signalement créé.');
    setCreateOpen(false);
    setEditing(null);
    requests.reload();
  }

  async function assignRequest(requestId: number, body: Record<string, unknown>) {
    await api.post(`/maintenance/requests/${requestId}/assign`, body);
    setSuccess('Technicien affecté.');
    setAssigning(null);
    requests.reload();
  }

  async function postAction(path: string, message: string, body: Record<string, unknown> = {}) {
    await api.post(path, body);
    setSuccess(message);
    requests.reload();
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
      { name: 'Resume', rows: [{ total_demandes: rows.length, ouvertes: openRequests.length, urgentes: urgentRequests.length, en_retard: overdueRequests.length, terminees: finishedRequests.length, cout_total: money(rows.reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0)), cout_du_mois: money(rows.filter((item) => String(item.reported_at ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((sum, item) => sum + Number(item.total_cost ?? item.estimated_cost ?? 0), 0)) }] },
      { name: 'Demandes', rows: rows.map(exportRow) },
      { name: 'Ouvertes', rows: openRequests.map(exportRow) },
      { name: 'En retard', rows: overdueRequests.map(exportRow) },
      { name: 'Urgentes', rows: urgentRequests.map(exportRow) },
      { name: 'Terminees', rows: finishedRequests.map(exportRow) },
      { name: 'Couts', rows: costRows },
      { name: 'Techniciens', rows: technicianRows(rows) },
      { name: 'Documents', rows: documentRows(rows) },
      { name: 'Timeline', rows: timelineRows(rows) },
      { name: 'Audit', rows: timelineRows(rows) },
    ]);
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
      <div className="mini-stats maintenance-kpis">
        <div className="mini-stat"><span>Total demandes</span><strong>{kpis.total}</strong></div>
        <div className="mini-stat"><span>Ouvertes</span><strong>{kpis.open}</strong></div>
        <div className="mini-stat"><span>Urgentes</span><strong>{kpis.urgent}</strong></div>
        <div className="mini-stat"><span>En retard</span><strong>{kpis.overdue}</strong></div>
        <div className="mini-stat"><span>En cours</span><strong>{kpis.inProgress}</strong></div>
        <div className="mini-stat"><span>Terminées</span><strong>{kpis.finished}</strong></div>
        <div className="mini-stat"><span>Coût total</span><strong>{money(kpis.totalCost)}</strong></div>
        <div className="mini-stat"><span>Coût du mois</span><strong>{money(kpis.monthCost)}</strong></div>
      </div>

      <div className="maintenance-filter-bar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">Statut</option>
          {MAINTENANCE_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
          <option value="">Priorité</option>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">Catégorie</option>
          {MAINTENANCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <SearchableSelect
          options={buildingOptions(buildings.data)}
          value={filters.building_id ? Number(filters.building_id) : null}
          onChange={(value) => setFilters({ ...filters, building_id: value ? String(value) : '' })}
          placeholder="Immeuble"
          emptyMessage="Aucun immeuble trouve"
        />
        <SearchableSelect
          options={employeeOptions(employees.data)}
          value={filters.employee_id ? Number(filters.employee_id) : null}
          onChange={(value) => setFilters({ ...filters, employee_id: value ? String(value) : '' })}
          placeholder="Technicien"
          emptyMessage="Aucun technicien trouve"
        />
        <label className="checkbox-filter"><input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })} />En retard</label>
        <label className="checkbox-filter"><input type="checkbox" checked={filters.week} onChange={(event) => setFilters({ ...filters, week: event.target.checked })} />Cette semaine</label>
        <button type="button" className="secondary" onClick={() => setFilters({ status: '', priority: '', category: '', building_id: '', employee_id: '', overdue: false, week: false })}><RotateCcw size={15} />Réinitialiser</button>
        <button type="button" className="secondary" onClick={() => exportCsv('maintenance.csv', exportRows())}>CSV</button>
        <button type="button" className="secondary" onClick={() => exportWorkbook('maintenance.xlsx')}>Excel</button>
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
            {filtered.map((request) => (
              <tr key={request.id} className="clickable-row" onClick={() => navigate(`/maintenance/${request.id}`)}>
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
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/maintenance/${request.id}`)}><Eye size={16} /></button>
                  {can('maintenance.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(request)}><Pencil size={16} /></button>}
                  {can('maintenance.assign') && <button className="icon-btn" title="Affecter" onClick={() => setAssigning(request)}><UserCog size={16} /></button>}
                  {can('maintenance.close') && request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="icon-btn" title="Clôturer" onClick={() => postAction(`/maintenance/requests/${request.id}/close`, 'Demande clôturée.') }><CheckCircle2 size={16} /></button>}
                  {can('maintenance.close') && request.status !== 'CLOSED' && request.status !== 'CANCELLED' && <button className="icon-btn danger" title="Annuler" onClick={() => postAction(`/maintenance/requests/${request.id}/cancel`, 'Demande annulée.') }><CircleX size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>

      {createOpen && (
        <MaintenanceRequestModal
          title="Nouveau signalement"
          requestNumber={nextRequestNumber}
          buildings={buildings.data}
          units={units.data}
          tenants={tenants.data}
          employees={employees.data}
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
  const costBreakdown = useMemo(() => maintenanceCostBreakdown(request), [request]);
  const interventionTime = useMemo(() => maintenanceTimeSummary(request), [request]);

  if (loading || !request) return <div className="empty">Chargement de la demande...</div>;

  return (
    <section>
      <PageHeader
        title="Maintenance"
        action={
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/maintenance')}><ArrowLeft size={16} />Retour</button>
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
            {can('maintenance.update') && actionState.canResolve && <button onClick={() => action(`/maintenance/requests/${request.id}/resolve`, 'Intervention résolue.', { actual_hours: request.actual_hours ?? 0, resolution_comments: request.proposed_solution ?? 'Résolution' })}><CheckCircle2 size={16} />Marquer résolu</button>}
            {can('maintenance.update') && actionState.canReopen && <button onClick={() => action(`/maintenance/requests/${request.id}/reopen`, 'Intervention rouverte.')}>Rouvrir</button>}
            {can('maintenance.validate') && actionState.canValidate && <button onClick={() => {
              const technicianSignature = window.prompt('Nom du technicien signataire', request.assigned_employee_name ?? '') ?? '';
              const clientSignature = window.prompt('Nom du client signataire', request.tenant_name ?? '') ?? '';
              return action(`/maintenance/requests/${request.id}/validate`, 'Demande validée.', { comments: 'Validation finale', technician_signature_name: technicianSignature || null, client_signature_name: clientSignature || null });
            }}><CheckCircle2 size={16} />Valider</button>}
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

          <SectionBlock title="Dépenses">
            <SimpleTable
              headers={['Date', 'Catégorie', 'Description', 'Montant', 'Statut']}
              rows={request.expenses.map((expense) => [shortDate(expense.expense_date), expense.category, expense.description ?? '-', money(expense.amount), maintenanceStatusLabel(expense.status)])}
            />
            <div className="summary-band maintenance-cost-footer">
              <SummaryItem label="Main-d'œuvre" value={money(costBreakdown.labor)} />
              <SummaryItem label="Pièces" value={money(costBreakdown.parts)} />
              <SummaryItem label="Dépenses" value={money(costBreakdown.expenses)} />
              <SummaryItem label="Total" value={money(costBreakdown.total)} />
            </div>
          </SectionBlock>

          <SectionBlock title="Consommation de stock">
            {request.stock_movements.length ? (
              <SimpleTable
                headers={['Article', 'Quantité', 'Prix moyen', 'Total', 'Motif', 'Date']}
                rows={request.stock_movements.map((movement) => [movement.item_name, movement.quantity, money(movement.unit_price ?? 0), money(Number(movement.quantity) * Number(movement.unit_price ?? 0)), movement.notes ?? '-', shortDate(movement.movement_date)])}
              />
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

          <SectionBlock title="Validation">
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
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            await api.put(`/maintenance/requests/${request.id}`, Object.fromEntries(form));
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
  editing?: Partial<MaintenanceRequest> | null;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  const [buildingId, setBuildingId] = useState<number | null>(editing?.building_id ?? null);
  const [unitId, setUnitId] = useState<number | null>(editing?.unit_id ?? null);
  const [tenantId, setTenantId] = useState<number | null>(editing?.tenant_id ?? null);
  const [attachmentName, setAttachmentName] = useState(editing?.attachment_file_name ?? '');

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

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="maintenance-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const file = form.get('attachment_file');
          if (file instanceof File && file.name) {
            form.set('attachment_file_name', file.name);
          }
          form.delete('attachment_file');
          onSubmit(form);
          event.currentTarget.reset();
        }}
      >
        <div className="modal-section">
          <h3>Informations générales</h3>
          <div className="maintenance-grid maintenance-general-grid">
            <label>N° demande<input value={requestNumber} readOnly className="locked-field" /></label>
            <label>Titre *<input name="title" defaultValue={editing?.title ?? ''} required placeholder="Titre du signalement" /></label>
            <label>Catégorie *<select name="category" defaultValue={editing?.category ?? 'Autre'}>{MAINTENANCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
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
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
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
            <label className="wide-field">Type d’affectation
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
            <label className="wide-field">Notes d’affectation<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes affectation" /></label>
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
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('Main d’œuvre');
  const [amount, setAmount] = useState<number | string>(0);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [attachmentName, setAttachmentName] = useState('');

  return (
    <Modal title={`Ajouter une dépense à l’intervention ${request.request_number}`} onClose={onClose}>
      <form className="maintenance-modal-form" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ amount: Number(amount), expense_date: expenseDate, category, description: label, supplier, payment_method: paymentMethod || null, reference, observation: notes, attachment_file_name: attachmentName || null });
      }}>
        <div className="modal-section">
          <h3>Informations générales</h3>
          <p className="storage-note">Cette dépense sera rattachée à l’intervention et pourra alimenter la caisse si le workflow le permet.</p>
          <div className="maintenance-grid maintenance-cost-grid">
            <label>Nature du coût<select value={category} onChange={(event) => setCategory(event.target.value)}>{['Main d’œuvre', 'Transport', 'Sous-traitance', 'Achat local', 'Location matériel', 'Autre'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="wide-field">Libellé<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Libellé" required /></label>
            <label>Montant (USD)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Date<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
            <label className="wide-field">Fournisseur<input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Fournisseur" /></label>
            <label>Moyen de paiement<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Non précisé</option><option value="CASH">Espèces</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
            <label className="wide-field">Référence<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Référence" /></label>
            <label className="wide-field">Pièce jointe<input type="file" accept=".pdf,image/jpeg,image/png" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')} /></label>
            {attachmentName ? <div className="storage-note wide-field">Fichier sélectionné : {attachmentName}</div> : null}
            <label className="wide-field">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" /></label>
          </div>
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
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
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [stockItemId, setStockItemId] = useState<number | null>(stockItems[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState<number | string>(stockItems[0]?.average_purchase_price ?? stockItems[0]?.purchase_price ?? 0);
  const [notes, setNotes] = useState('');
  const selected = stockItems.find((item) => item.id === stockItemId);
  const total = Number(quantity || 0) * Number(unitPrice || 0);

  return (
    <Modal title={`Consommer stock pour intervention ${request.request_number}`} onClose={onClose}>
      <form className="maintenance-modal-form" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ stock_item_id: stockItemId, quantity: Number(quantity), unit_price: Number(unitPrice), comment: notes });
      }}>
        <div className="modal-section">
          <h3>Consommation stock</h3>
          <p className="storage-note">Cette action déduit les articles utilisés du stock et les rattache à cette intervention.</p>
          {stockItems.length ? (
            <div className="maintenance-grid maintenance-cost-grid">
              <label className="wide-field">Article<select value={stockItemId ?? ''} onChange={(event) => {
                const nextId = event.target.value ? Number(event.target.value) : null;
                setStockItemId(nextId);
                const next = stockItems.find((item) => item.id === nextId);
                setUnitPrice(next?.average_purchase_price ?? next?.purchase_price ?? 0);
              }}>{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.current_quantity})</option>)}</select></label>
              {selected ? <div className="storage-note wide-field">Disponible : {selected.current_quantity} {selected.unit}</div> : null}
              <label>Quantité<input type="number" min="0.01" max={selected?.current_quantity} step="0.01" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
              <label>Coût unitaire<input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></label>
              <label>Total<input value={`${money(total)} USD`} readOnly className="locked-field" /></label>
              <label className="wide-field">Motif<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Motif de la consommation" required /></label>
            </div>
          ) : (
            <div className="compact-empty">Aucun article disponible dans le stock.</div>
          )}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={!stockItems.length}>Consommer</button>
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
    { name: 'Resume', rows: [{ numero: request.request_number, statut: maintenanceStatusLabel(request.status), priorite: priorityLabel(request.priority), immeuble: request.building_name ?? '-', unite: request.unit_number ?? '-', locataire: request.tenant_name ?? '-', technicien: request.assigned_employee_name ?? '-', cout: money(request.total_cost ?? request.estimated_cost ?? 0) }] },
    { name: 'Demandes', rows },
    { name: 'Ouvertes', rows: request.status !== 'CLOSED' && request.status !== 'CANCELLED' ? rows : [] },
    { name: 'En retard', rows: request.is_overdue ? rows : [] },
    { name: 'Urgentes', rows: request.priority === 'URGENT' ? rows : [] },
    { name: 'Terminees', rows: resolvedStatuses.has(request.status) ? rows : [] },
    { name: 'Couts', rows: [{ demande: request.request_number, depenses: money(request.expenses_total ?? 0), stock: money(request.stock_cost_total ?? 0), total: money(request.total_cost ?? request.estimated_cost ?? 0) }] },
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
        details: [assignment.external_provider ? `Prestataire: ${assignment.external_provider}` : '', assignment.notes ?? ''].filter(Boolean).join(' · ') || undefined,
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

function maintenanceCostBreakdown(request: MaintenanceDetail | null) {
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
      meta: [unit.building_name, unit.tenant_name ? `Locataire: ${unit.tenant_name}` : '', unit.monthly_rent ? `${money(unit.monthly_rent)} USD` : ''].filter(Boolean).join(' - ') || '-',
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

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
