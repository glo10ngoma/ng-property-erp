import { useState } from 'react';
import { api, exportCsv, exportExcel, includesText, money, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../../../components';
import { useApiList } from '../../../hooks';

type MaintenanceRequest = {
  id: number;
  request_number: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  building_name?: string;
  unit_number?: string;
  tenant_name?: string;
  assigned_employee_name?: string;
  due_date?: string;
  estimated_cost: number;
  actual_hours?: number;
  is_overdue?: boolean;
};

type MaintenanceDetail = MaintenanceRequest & {
  description?: string;
  diagnostic?: string;
  cause?: string;
  proposed_solution?: string;
  timeline: Array<{ id: number; title: string; details?: string; created_at: string }>;
  assignments: Array<{ id: number; employee_name?: string; external_provider?: string; assigned_at: string; notes?: string }>;
  documents: Array<{ id: number; document_type: string; file_name: string }>;
  expenses: Array<{ id: number; amount: number; expense_date: string; category: string; status: string }>;
  stock_movements: Array<{ id: number; item_name: string; quantity: number; movement_date: string }>;
};

export function MaintenancePage() {
  const { can } = useAuth();
  const requests = useApiList<MaintenanceRequest>('/maintenance/requests');
  const employees = useApiList<{ id: number; first_name: string; last_name: string }>('/employees');
  const stockItems = useApiList<{ id: number; name: string; current_quantity: number; unit: string }>('/stock/items');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [viewing, setViewing] = useState<MaintenanceDetail | null>(null);
  const filtered = requests.data.filter((item) => includesText(item, query));

  async function create(form: FormData) {
    await api.post('/maintenance/requests', Object.fromEntries(form));
    setSuccess('Signalement créé.');
    requests.reload();
  }

  async function detail(id: number) {
    const response = await api.get<MaintenanceDetail>(`/maintenance/requests/${id}`);
    setViewing(response.data);
  }

  async function action(path: string, message: string, body: Record<string, unknown> = {}) {
    await api.post(path, body);
    setSuccess(message);
    requests.reload();
    if (viewing) detail(viewing.id);
  }

  return (
    <section>
      <PageHeader title="Maintenance" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Ouvertes</span><strong>{requests.data.filter((r) => !['CLOSED', 'CANCELLED'].includes(r.status)).length}</strong></div>
        <div className="mini-stat"><span>Urgentes</span><strong>{requests.data.filter((r) => r.priority === 'URGENT').length}</strong></div>
        <div className="mini-stat"><span>En retard</span><strong>{requests.data.filter((r) => r.is_overdue).length}</strong></div>
        <div className="mini-stat"><span>Terminées</span><strong>{requests.data.filter((r) => ['RESOLVED', 'VALIDATED', 'CLOSED'].includes(r.status)).length}</strong></div>
      </div>
      {can('maintenance.create') && <QuickMaintenanceForm onSubmit={create} />}
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('maintenance.csv', filtered)} />
      <div className="actions detail-section">
        <button className="secondary" onClick={() => exportExcel('maintenance.xls', filtered)}>Excel maintenance</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Numéro</th><th>Titre</th><th>Catégorie</th><th>Priorité</th><th>Statut</th><th>Lieu</th><th>Échéance</th><th>Technicien</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((request) => <tr key={request.id}><td>{request.request_number}</td><td>{request.title}</td><td>{request.category}</td><td>{priorityLabel(request.priority)}</td><td>{statusLabel(request.status)}</td><td>{request.building_name ?? '-'} {request.unit_number ? `/ ${request.unit_number}` : ''}</td><td>{request.due_date ? shortDate(request.due_date) : '-'}</td><td>{request.assigned_employee_name ?? '-'}</td><td className="actions"><button className="secondary" onClick={() => detail(request.id)}>Voir</button>{can('maintenance.validate') && request.status === 'WAITING_APPROVAL' && <button className="secondary" onClick={() => action(`/maintenance/requests/${request.id}/approve`, 'Demande approuvée.')}>Approuver</button>}{can('maintenance.update') && request.status === 'ASSIGNED' && <button className="secondary" onClick={() => action(`/maintenance/requests/${request.id}/start`, 'Intervention démarrée.')}>Démarrer</button>}{can('maintenance.close') && request.status === 'VALIDATED' && <button className="secondary" onClick={() => action(`/maintenance/requests/${request.id}/close`, 'Demande clôturée.')}>Clôturer</button>}</td></tr>)}</tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      {viewing && (
        <Modal title="Détail maintenance" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Numéro</span><strong>{viewing.request_number}</strong>
            <span>Titre</span><strong>{viewing.title}</strong>
            <span>Priorité</span><strong>{priorityLabel(viewing.priority)}</strong>
            <span>Statut</span><strong>{statusLabel(viewing.status)}</strong>
            <span>Diagnostic</span><strong>{viewing.diagnostic ?? '-'}</strong>
            <span>Solution</span><strong>{viewing.proposed_solution ?? '-'}</strong>
          </div>
          <div className="detail-section"><h4>Actions métier</h4><MaintenanceActions viewing={viewing} employees={employees.data} stockItems={stockItems.data} can={can} action={action} /></div>
          <div className="detail-section"><h4>Timeline</h4><div className="compact-list">{viewing.timeline.map((event) => <div className="compact-item" key={event.id}><span>{event.title} · {shortDate(event.created_at)}</span><strong>{event.details ?? '-'}</strong></div>)}</div></div>
          <div className="detail-section"><h4>Stock consommé</h4><SimpleTable headers={['Article', 'Quantité', 'Date']} rows={viewing.stock_movements.map((m) => [m.item_name, m.quantity, shortDate(m.movement_date)])} /></div>
          <div className="detail-section"><h4>Dépenses</h4><SimpleTable headers={['Date', 'Catégorie', 'Montant', 'Statut']} rows={viewing.expenses.map((e) => [shortDate(e.expense_date), e.category, money(e.amount), statusLabel(e.status)])} /></div>
          <div className="detail-section"><h4>Documents</h4><div className="compact-list">{viewing.documents.map((document) => <div className="compact-item" key={document.id}><span>{document.document_type}</span><strong>{document.file_name}</strong></div>)}</div></div>
        </Modal>
      )}
    </section>
  );
}

function QuickMaintenanceForm({ onSubmit }: { onSubmit: (form: FormData) => void }) {
  return (
    <form className="quick-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
      <input name="title" placeholder="Titre signalement" required />
      <input name="description" placeholder="Description" />
      <select name="category" defaultValue="Autre"><option>Electricité</option><option>Plomberie</option><option>Peinture</option><option>Maçonnerie</option><option>Menuiserie</option><option>Climatisation</option><option>Serrurerie</option><option>Nettoyage</option><option>Autre</option></select>
      <select name="priority" defaultValue="NORMAL"><option value="LOW">Basse</option><option value="NORMAL">Normale</option><option value="HIGH">Haute</option><option value="URGENT">Urgente</option></select>
      <input name="building_id" placeholder="ID immeuble" type="number" />
      <input name="unit_id" placeholder="ID appartement" type="number" />
      <input name="tenant_id" placeholder="ID locataire" type="number" />
      <input name="due_date" type="datetime-local" />
      <button>Créer signalement</button>
    </form>
  );
}

function MaintenanceActions({
  viewing,
  employees,
  stockItems,
  can,
  action,
}: {
  viewing: MaintenanceDetail;
  employees: Array<{ id: number; first_name: string; last_name: string }>;
  stockItems: Array<{ id: number; name: string; current_quantity: number; unit: string }>;
  can: (permission: string) => boolean;
  action: (path: string, message: string, body?: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="form-grid">
      {can('maintenance.update') && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action(`/maintenance/requests/${viewing.id}/diagnosis`, 'Diagnostic enregistré.', Object.fromEntries(form)); }}><input name="diagnostic" placeholder="Diagnostic" required /><input name="cause" placeholder="Cause" /><input name="proposed_solution" placeholder="Solution proposée" /><input name="estimated_cost" type="number" placeholder="Coût estimé" /><input name="estimated_hours" type="number" placeholder="Temps estimé" /><input name="recommended_technician" placeholder="Technicien recommandé" /><button>Diagnostic</button></form>}
      {can('maintenance.assign') && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action(`/maintenance/requests/${viewing.id}/assign`, 'Technicien affecté.', Object.fromEntries(form)); }}><select name="employee_id"><option value="">Employé</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>)}</select><input name="external_provider" placeholder="Prestataire externe" /><input name="notes" placeholder="Notes affectation" /><button>Affecter</button></form>}
      {can('maintenance.update') && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action(`/maintenance/requests/${viewing.id}/stock`, 'Stock consommé.', Object.fromEntries(form)); }}><select name="stock_item_id">{stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.current_quantity} {item.unit}</option>)}</select><input name="quantity" type="number" placeholder="Quantité" required /><input name="comment" placeholder="Commentaire" /><button>Consommer stock</button></form>}
      {can('maintenance.update') && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action(`/maintenance/requests/${viewing.id}/expenses`, 'Dépense enregistrée.', Object.fromEntries(form)); }}><input name="amount" type="number" placeholder="Montant" required /><input name="category" placeholder="Catégorie dépense" /><input name="description" placeholder="Description" /><select name="status" defaultValue="APPROVED"><option value="APPROVED">Approuvée</option><option value="REJECTED">Rejetée</option></select><button>Dépense</button></form>}
      {can('maintenance.update') && <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action(`/maintenance/requests/${viewing.id}/resolve`, 'Intervention résolue.', Object.fromEntries(form)); }}><input name="actual_hours" type="number" placeholder="Temps réel" /><input name="resolution_comments" placeholder="Commentaires résolution" /><button>Résoudre</button></form>}
      {can('maintenance.validate') && <button onClick={() => action(`/maintenance/requests/${viewing.id}/validate`, 'Résolution validée.', { comments: 'Validation finale' })}>Validation finale</button>}
      {can('maintenance.close') && <button onClick={() => action(`/maintenance/requests/${viewing.id}/close`, 'Demande clôturée.')}>Clôturer</button>}
    </div>
  );
}

function priorityLabel(value: string) {
  return ({ LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgente' })[value] ?? value;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-wrap">
      <table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
      {!rows.length && <EmptyState />}
    </div>
  );
}
