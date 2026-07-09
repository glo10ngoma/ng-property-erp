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
  attachment_file_name?: string;
  attachment_file_url?: string;
  internal_notes?: string;
  estimated_cost?: number;
  expenses_total?: number;
  stock_cost_total?: number;
  total_cost?: number;
  actual_hours?: number;
  is_overdue?: boolean;
};

type MaintenanceDetail = MaintenanceRequest & {
  diagnostic?: string;
  cause?: string;
  proposed_solution?: string;
  timeline: Array<{ id: number; title: string; details?: string; created_at: string; event_type?: string }>;
  assignments: Array<{ id: number; employee_name?: string; external_provider?: string; assigned_at: string; notes?: string }>;
  documents: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>;
  expenses: Array<{ id: number; amount: number; expense_date: string; category: string; status: string; description?: string }>;
  stock_movements: Array<{ id: number; item_name: string; quantity: number; movement_date: string; reference?: string }>;
  maintenance_documents?: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>;
};

type BuildingOption = { id: number; name: string; city?: string; commune?: string };
type UnitOption = { id: number; number: string; building_id?: number; building_name?: string };
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
  const buildings = useApiList<BuildingOption>('/buildings');
  const units = useApiList<UnitOption>('/units');
  const tenants = useApiList<TenantSearchOption>('/tenants');
  const employees = useApiList<EmployeeOption>('/employees');
  const stockItems = useApiList<{ id: number; name: string; current_quantity: number; unit: string }>('/stock/items');

  async function refresh() {
    if (!id) return;
    setLoading(true);
    const response = await api.get<MaintenanceDetail>(`/maintenance/requests/${id}`);
    setRequest(response.data);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [id]);

  async function action(path: string, message: string, body: Record<string, unknown> = {}) {
    await api.post(path, body);
    setSuccessMessage(message);
    await refresh();
  }

  const printable = request ? maintenanceWorkbook(request) : [];

  if (loading || !request) return <div className="empty">Chargement de la demande...</div>;

  return (
    <section>
      <PageHeader
        title="Maintenance"
        action={
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/maintenance')}><ArrowLeft size={16} />Retour</button>
            {can('maintenance.update') && <button onClick={() => setEditing(true)}><Pencil size={16} />Modifier</button>}
            {can('maintenance.assign') && <button onClick={() => setAssigning(true)}><UserCog size={16} />Affecter technicien</button>}
            {can('maintenance.update') && <button onClick={() => action(`/maintenance/requests/${request.id}/start`, 'Intervention démarrée.', {})}><CirclePause size={16} />Démarrer intervention</button>}
            {can('maintenance.update') && <button onClick={() => action(`/maintenance/requests/${request.id}/expenses`, 'Dépense enregistrée.', { amount: request.estimated_cost ?? 0, category: request.category, description: 'Dépense maintenance' })}><CircleAlert size={16} />Ajouter dépense</button>}
            {can('maintenance.update') && <button onClick={() => action(`/maintenance/requests/${request.id}/stock`, 'Stock consommé.', { stock_item_id: stockItems.data[0]?.id ?? null, quantity: 1, comment: 'Consommation maintenance' })}><Paperclip size={16} />Consommer stock</button>}
            {can('maintenance.update') && <button onClick={() => action(`/maintenance/requests/${request.id}/resolve`, 'Intervention résolue.', { actual_hours: request.actual_hours ?? 0, resolution_comments: request.proposed_solution ?? 'Résolution' })}><CheckCircle2 size={16} />Marquer résolu</button>}
            {can('maintenance.validate') && <button onClick={() => action(`/maintenance/requests/${request.id}/validate`, 'Demande validée.', { comments: 'Validation finale' })}><CheckCircle2 size={16} />Valider</button>}
            {can('maintenance.close') && <button onClick={() => action(`/maintenance/requests/${request.id}/close`, 'Demande clôturée.')}>Clôturer</button>}
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
        <SummaryItem label="Coût" value={money(request.total_cost ?? request.estimated_cost ?? 0)} />
      </div>

      <article className="maintenance-print">
        <header>
          <div className="maintenance-logo">PE</div>
          <div>
            <h2>NG Property ERP</h2>
            <p>Fiche intervention</p>
            <p>Merci pour votre confiance.</p>
          </div>
          <div className="invoice-meta">
            <strong>{request.request_number}</strong>
            <span>{maintenanceStatusLabel(request.status)}</span>
            <span>{priorityLabel(request.priority)}</span>
          </div>
        </header>

        <div className="maintenance-section-grid">
          <SectionBlock title="Informations générales">
            <DetailLine label="Immeuble" value={request.building_name ?? '-'} />
            <DetailLine label="Unité" value={request.unit_number ?? '-'} />
            <DetailLine label="Locataire" value={request.tenant_name ?? '-'} />
            <DetailLine label="Technicien" value={request.assigned_employee_name ?? '-'} />
            <DetailLine label="Date signalement" value={request.reported_at ? shortDate(request.reported_at) : '-'} />
            <DetailLine label="Échéance" value={request.due_date ? shortDate(request.due_date) : '-'} />
            <DetailLine label="Coût" value={money(request.total_cost ?? request.estimated_cost ?? 0)} />
          </SectionBlock>
          <SectionBlock title="Diagnostic">
            <DetailLine label="Description" value={request.description ?? '-'} />
            <DetailLine label="Diagnostic" value={request.diagnostic ?? '-'} />
            <DetailLine label="Cause" value={request.cause ?? '-'} />
            <DetailLine label="Solution proposée" value={request.proposed_solution ?? '-'} />
            <DetailLine label="Observations internes" value={request.internal_notes ?? '-'} />
          </SectionBlock>
        </div>

        <SectionBlock title={`Pièces jointes (${request.documents.length + (request.attachment_file_name ? 1 : 0)})`}>
          <div className="compact-list">
            {request.attachment_file_name ? (
              <div className="compact-item"><span>Signalement</span><strong>{request.attachment_file_name}</strong></div>
            ) : null}
            {request.documents.map((document) => (
              <div className="compact-item" key={document.id}><span>{document.document_type}</span><strong>{document.file_name}</strong></div>
            ))}
            {!request.attachment_file_name && !request.documents.length && <div className="compact-empty">Aucune pièce jointe.</div>}
          </div>
        </SectionBlock>

        <SectionBlock title="Timeline">
          <CompactRows rows={request.timeline} />
        </SectionBlock>

        <SectionBlock title="Dépenses">
          <SimpleTable headers={['Date', 'Catégorie', 'Montant', 'Statut']} rows={request.expenses.map((expense) => [shortDate(expense.expense_date), expense.category, money(expense.amount), maintenanceStatusLabel(expense.status)])} />
        </SectionBlock>

        <SectionBlock title="Consommation stock">
          <SimpleTable headers={['Article', 'Quantité', 'Date']} rows={request.stock_movements.map((movement) => [movement.item_name, movement.quantity, shortDate(movement.movement_date)])} />
        </SectionBlock>
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
          <h3>Informations principales</h3>
          <div className="maintenance-grid">
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
          <div className="maintenance-grid">
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
            <label className="wide-field">Appartement / unité
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
          <div className="maintenance-grid">
            <label className="wide-field">Description *<textarea name="description" defaultValue={editing?.description ?? ''} required placeholder="Décrire le signalement" /></label>
            <label>Observations internes<textarea name="internal_notes" defaultValue={editing?.internal_notes ?? ''} placeholder="Notes internes" /></label>
            <label>Pièce jointe / photo<input name="attachment_file" type="file" accept=".pdf,image/jpeg,image/png" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')} /></label>
            <label>Nom du fichier<input value={attachmentName || '-'} readOnly className="locked-field" /></label>
          </div>
        </div>

        <div className="modal-section">
          <h3>Calculs</h3>
          <div className="maintenance-grid">
            <label>Coût estimé<input name="estimated_cost" type="number" step="0.01" defaultValue={editing?.estimated_cost ?? 0} /></label>
            <label>Devise<input value="USD" readOnly className="locked-field" /></label>
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
  const [employeeId, setEmployeeId] = useState<number | null>(request.assigned_employee_id ?? null);
  const [notes, setNotes] = useState('');
  const [externalProvider, setExternalProvider] = useState('');

  return (
    <Modal title={`Affecter - ${request.request_number}`} onClose={onClose}>
      <form
        className="maintenance-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ employee_id: employeeId, external_provider: externalProvider, notes });
        }}
      >
        <div className="modal-section">
          <h3>Affectation</h3>
          <div className="maintenance-grid">
            <label className="wide-field">Technicien
              <SearchableSelect
                options={employeeOptions(employees)}
                value={employeeId}
                onChange={(value) => setEmployeeId(value ? Number(value) : null)}
                placeholder="Rechercher un technicien"
                emptyMessage="Aucun technicien trouvé"
              />
            </label>
            <label>Prestataire externe<input value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Prestataire externe" /></label>
            <label className="wide-field">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes affectation" /></label>
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
      meta: unit.building_name ?? '-',
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
