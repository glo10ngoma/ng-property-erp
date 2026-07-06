import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, exportCsv, exportExcel, includesText, money, shortDate, statusLabel } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type User = { id: number; first_name: string; last_name: string; email: string; role: string; status: string };
type Employee = { id: number; first_name: string; last_name: string; phone: string; email: string; job_title: string; monthly_salary: number; hire_date: string; status: string };
type EmployeeDetail = Employee & {
  advances: Array<{ id: number; amount: number; advance_date: string; status: string; reason?: string }>;
  leaves: Array<{ id: number; start_date: string; end_date: string; leave_type: string; status: string; reason?: string }>;
  payrolls: Array<{ id: number; month: number; year: number; net_salary: number; status: string }>;
};
type SalaryAdvance = { id: number; employee_id: number; employee_name: string; amount: number; advance_date: string; reason?: string; status: string };
type LeaveRequest = { id: number; employee_id: number; employee_name: string; start_date: string; end_date: string; leave_type: string; reason?: string; status: string };
type Payroll = { id: number; employee_id: number; employee_name: string; month: number; year: number; gross_salary: number; advances_total: number; deductions_total: number; net_salary: number; status: string; payment_date?: string };
type CashMovement = { id: number; type: string; category: string; amount: number; movement_date: string; invoice_number?: string; tenant_name?: string; reference?: string };
type StockItem = { id: number; code?: string; name: string; category: string; unit: string; current_quantity: number; minimum_quantity: number; purchase_price: number; average_purchase_price?: number; description?: string; observations?: string; status: string; stock_alert?: string };
type StockMovement = { id: number; movement_number?: string; item_code?: string; item_name: string; type: string; quantity: number; movement_date: string; reference?: string; destination?: string; quantity_before?: number; quantity_after?: number; user_name?: string };
type StockInventory = { id: number; inventory_number?: string; count_date: string; status: string; line_count?: number; total_difference?: number };
type Lease = { id: number; tenant_id: number; unit_id: number; tenant_name: string; building_name: string; unit_number: string; start_date: string; end_date?: string; monthly_rent: number; rental_guarantee_amount: number; rental_guarantee_paid: number; rental_guarantee_status: string; guarantee_amount?: number; guarantee_paid?: number; guarantee_status?: string; contract_file_name?: string; status: string };
type LeaseDetail = Lease & { guarantee?: { amount: number; paid_amount: number; status: string; payment_date?: string }; documents: Array<{ id: number; document_type: string; file_name: string; file_url?: string }>; history: Lease[] };
type ReportFilterState = { building_id: string; tenant_id: string; start: string; end: string; status: string; payment_method: string };

export function UsersPage() {
  const { can } = useAuth();
  const { data, reload } = useApiList<User>('/users');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const filtered = data.filter((item) => includesText(item, query));

  async function create(form: FormData) {
    await api.post('/users', Object.fromEntries(form));
    setSuccess('Utilisateur créé avec succès.');
    reload();
  }

  return (
    <section>
      <PageHeader title="Utilisateurs & rôles" />
      <SuccessMessage message={success} />
      {can('users.create') && <QuickForm onSubmit={create} fields={['first_name:Prénom', 'last_name:Nom', 'email:Email', 'role:Rôle']} button="Créer utilisateur" />}
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('utilisateurs.csv', filtered)} />
      <Table headers={['Nom', 'Email', 'Rôle', 'Statut']} rows={filtered.map((u) => [`${u.first_name} ${u.last_name}`, u.email, roleLabel(u.role), statusLabel(u.status)])} />
    </section>
  );
}

export function StaffPage() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Employee>('/employees');
  const advances = useApiList<SalaryAdvance>('/salary-advances');
  const leaves = useApiList<LeaveRequest>('/leaves');
  const payrolls = useApiList<Payroll>('/payrolls');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<EmployeeDetail | null>(null);
  const filtered = data.filter((item) => includesText(item, query));

  async function create(form: FormData) {
    await api.post('/employees', { ...Object.fromEntries(form), status: 'ACTIVE' });
    setSuccess('Employé créé avec succès.');
    reload();
  }

  async function update(form: FormData) {
    if (!editing) return;
    await api.put(`/employees/${editing.id}`, Object.fromEntries(form));
    setSuccess('Employé modifié avec succès.');
    setEditing(null);
    reload();
  }

  async function deactivate(id: number) {
    await api.post(`/employees/${id}/deactivate`);
    setSuccess('Employé désactivé.');
    reload();
  }

  async function openDetail(id: number) {
    const response = await api.get<EmployeeDetail>(`/employees/${id}`);
    setViewing(response.data);
  }

  async function createAdvance(form: FormData) {
    await api.post('/salary-advances', Object.fromEntries(form));
    setSuccess('Demande avance créée.');
    advances.reload();
  }

  async function approveAdvance(id: number) {
    await api.post(`/salary-advances/${id}/approve`);
    setSuccess('Avance approuvée.');
    advances.reload();
  }

  async function payAdvance(id: number) {
    await api.post(`/salary-advances/${id}/pay`, {});
    setSuccess('Avance payée et sortie caisse créée.');
    advances.reload();
  }

  async function createLeave(form: FormData) {
    await api.post('/leaves', Object.fromEntries(form));
    setSuccess('Demande congé créée.');
    leaves.reload();
  }

  async function setLeaveStatus(id: number, action: 'approve' | 'reject' | 'cancel') {
    await api.post(`/leaves/${id}/${action}`);
    setSuccess('Statut congé mis à jour.');
    leaves.reload();
  }

  async function generatePayroll(form: FormData) {
    await api.post('/payrolls/generate', Object.fromEntries(form));
    setSuccess('Paie mensuelle générée.');
    payrolls.reload();
  }

  async function validatePayroll(id: number) {
    await api.post(`/payrolls/${id}/validate`);
    setSuccess('Paie validée.');
    payrolls.reload();
  }

  async function payPayroll(id: number) {
    await api.post(`/payrolls/${id}/pay`, {});
    setSuccess('Salaire payé et sortie caisse créée.');
    payrolls.reload();
  }

  return (
    <section>
      <PageHeader title="Personnel" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Employés actifs</span><strong>{data.filter((e) => e.status === 'ACTIVE').length}</strong></div>
        <div className="mini-stat"><span>Avances</span><strong>{advances.data.length}</strong></div>
        <div className="mini-stat"><span>Congés</span><strong>{leaves.data.length}</strong></div>
        <div className="mini-stat"><span>Paies</span><strong>{payrolls.data.length}</strong></div>
      </div>
      {can('staff.create') && <QuickForm onSubmit={create} fields={['first_name:Prénom', 'last_name:Nom', 'phone:Téléphone', 'email:Email', 'job_title:Fonction', 'monthly_salary:Salaire mensuel', 'hire_date:Date embauche']} button="Créer employé" />}
      {can('payroll.create') && <QuickForm onSubmit={createAdvance} fields={['employee_id:ID employé', 'amount:Montant avance', 'advance_date:Date avance', 'reason:Raison']} button="Créer avance" />}
      {can('payroll.create') && <QuickForm onSubmit={createLeave} fields={['employee_id:ID employé', 'start_date:Date début', 'end_date:Date fin', 'leave_type:Type congé', 'reason:Motif']} button="Créer congé" />}
      {can('payroll.create') && <QuickForm onSubmit={generatePayroll} fields={['employee_id:ID employé', 'month:Mois', 'year:Année', 'deductions_total:Retenues']} button="Générer paie" />}
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('personnel.csv', filtered)} />
      <div className="actions detail-section">
        <button className="secondary" onClick={() => exportExcel('personnel.xls', filtered)}>Excel employés</button>
        <button className="secondary" onClick={() => exportCsv('avances-salaire.csv', advances.data)}>CSV avances</button>
        <button className="secondary" onClick={() => exportExcel('conges.xls', leaves.data)}>Excel congés</button>
        <button className="secondary" onClick={() => exportExcel('paie.xls', payrolls.data)}>Excel paie</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Fonction</th><th>Téléphone</th><th>Email</th><th>Salaire</th><th>Embauche</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((e) => <tr key={e.id}><td>{e.first_name} {e.last_name}</td><td>{e.job_title}</td><td>{e.phone}</td><td>{e.email}</td><td className="right">{money(e.monthly_salary)}</td><td>{shortDate(e.hire_date)}</td><td>{statusLabel(e.status)}</td><td className="actions"><button className="secondary" onClick={() => openDetail(e.id)}>Voir</button>{can('staff.update') && <button className="secondary" onClick={() => setEditing(e)}>Modifier</button>}{can('staff.update') && e.status !== 'INACTIVE' && <button className="secondary" onClick={() => deactivate(e.id)}>Désactiver</button>}</td></tr>)}</tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      <div className="detail-section">
        <h4>Avances sur salaire</h4>
        <Table headers={['Employé', 'Date', 'Montant', 'Statut', 'Raison', 'Actions']} rows={advances.data.map((a) => [a.employee_name, shortDate(a.advance_date), money(a.amount), statusLabel(a.status), a.reason ?? '-', <span className="actions">{can('payroll.update') && a.status !== 'APPROVED' && a.status !== 'PAID' && <button className="secondary" onClick={() => approveAdvance(a.id)}>Approuver</button>}{can('payroll.update') && a.status !== 'PAID' && <button className="secondary" onClick={() => payAdvance(a.id)}>Payer</button>}</span>])} />
      </div>
      <div className="detail-section">
        <h4>Congés</h4>
        <Table headers={['Employé', 'Début', 'Fin', 'Type', 'Statut', 'Actions']} rows={leaves.data.map((l) => [l.employee_name, shortDate(l.start_date), shortDate(l.end_date), l.leave_type, statusLabel(l.status), <span className="actions">{can('payroll.update') && <button className="secondary" onClick={() => setLeaveStatus(l.id, 'approve')}>Approuver</button>}{can('payroll.update') && <button className="secondary" onClick={() => setLeaveStatus(l.id, 'reject')}>Rejeter</button>}{can('payroll.update') && <button className="secondary" onClick={() => setLeaveStatus(l.id, 'cancel')}>Annuler</button>}</span>])} />
      </div>
      <div className="detail-section">
        <h4>Paie mensuelle</h4>
        <Table headers={['Employé', 'Mois', 'Brut', 'Avances', 'Retenues', 'Net', 'Statut', 'Actions']} rows={payrolls.data.map((p) => [p.employee_name, `${p.month}/${p.year}`, money(p.gross_salary), money(p.advances_total), money(p.deductions_total), money(p.net_salary), statusLabel(p.status), <span className="actions">{can('payroll.update') && p.status === 'DRAFT' && <button className="secondary" onClick={() => validatePayroll(p.id)}>Valider</button>}{can('payroll.update') && p.status !== 'PAID' && <button className="secondary" onClick={() => payPayroll(p.id)}>Payer</button>}</span>])} />
      </div>
      {editing && (
        <Modal title="Modifier employé" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); update(new FormData(event.currentTarget)); }}>
            <input name="first_name" placeholder="Prénom" defaultValue={editing.first_name} required />
            <input name="last_name" placeholder="Nom" defaultValue={editing.last_name} required />
            <input name="phone" placeholder="Téléphone" defaultValue={editing.phone} />
            <input name="email" placeholder="Email" defaultValue={editing.email} />
            <input name="job_title" placeholder="Fonction" defaultValue={editing.job_title} required />
            <input name="monthly_salary" type="number" placeholder="Salaire mensuel" defaultValue={editing.monthly_salary} required />
            <input name="hire_date" type="date" defaultValue={editing.hire_date?.slice(0, 10)} required />
            <select name="status" defaultValue={editing.status}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Fiche employé" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Nom</span><strong>{viewing.first_name} {viewing.last_name}</strong>
            <span>Fonction</span><strong>{viewing.job_title}</strong>
            <span>Téléphone</span><strong>{viewing.phone ?? '-'}</strong>
            <span>Email</span><strong>{viewing.email ?? '-'}</strong>
            <span>Salaire</span><strong>{money(viewing.monthly_salary)}</strong>
            <span>Statut</span><strong>{statusLabel(viewing.status)}</strong>
          </div>
          <div className="detail-section"><h4>Historique avances</h4><Table headers={['Date', 'Montant', 'Statut']} rows={viewing.advances.map((a) => [shortDate(a.advance_date), money(a.amount), statusLabel(a.status)])} /></div>
          <div className="detail-section"><h4>Historique congés</h4><Table headers={['Début', 'Fin', 'Type', 'Statut']} rows={viewing.leaves.map((l) => [shortDate(l.start_date), shortDate(l.end_date), l.leave_type, statusLabel(l.status)])} /></div>
          <div className="detail-section"><h4>Historique paie</h4><Table headers={['Mois', 'Net', 'Statut']} rows={viewing.payrolls.map((p) => [`${p.month}/${p.year}`, money(p.net_salary), statusLabel(p.status)])} /></div>
        </Modal>
      )}
    </section>
  );
}

export function CashPage() {
  const { can } = useAuth();
  const movements = useApiList<CashMovement>('/cash/movements');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const filtered = movements.data.filter((item) => includesText(item, query));

  async function expense(form: FormData) {
    await api.post('/cash/expenses', Object.fromEntries(form));
    setSuccess('Mouvement de caisse enregistré.');
    movements.reload();
  }

  return (
    <section>
      <PageHeader title="Caisse" />
      <SuccessMessage message={success} />
      {can('cash.create') && <QuickForm onSubmit={expense} fields={['category:Catégorie', 'amount:Montant', 'movement_date:Date', 'description:Description', 'reference:Référence']} button="Enregistrer dépense" />}
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('caisse.csv', filtered)} />
      <Table headers={['Date', 'Type', 'Catégorie', 'Montant', 'Facture', 'Locataire', 'Référence']} rows={filtered.map((m) => [shortDate(m.movement_date), movementTypeLabel(m.type), cashCategoryLabel(m.category), money(m.amount), m.invoice_number ?? '-', m.tenant_name ?? '-', m.reference ?? '-'])} />
    </section>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const { data, reload } = useApiList<StockItem>('/stock/items');
  const categories = useApiList<{ id: number; name: string; status: string }>('/stock/categories');
  const movements = useApiList<StockMovement>('/stock/movements');
  const inventories = useApiList<StockInventory>('/stock/inventories');
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [viewing, setViewing] = useState<(StockItem & { movements: StockMovement[] }) | null>(null);
  const filtered = data.filter((item) => includesText(item, query));
  const lowStock = data.filter((item) => item.stock_alert === 'LOW_STOCK');
  const outOfStock = data.filter((item) => item.stock_alert === 'OUT_OF_STOCK');

  async function create(form: FormData) {
    await api.post('/stock/items', { ...Object.fromEntries(form), status: 'ACTIVE' });
    setSuccess('Article stock créé avec succès.');
    reload();
  }

  async function update(form: FormData) {
    if (!editing) return;
    await api.patch(`/stock/items/${editing.id}`, Object.fromEntries(form));
    setSuccess('Article stock modifié.');
    setEditing(null);
    reload();
  }

  async function deactivate(id: number) {
    await api.delete(`/stock/items/${id}`);
    setSuccess('Article stock désactivé.');
    reload();
  }

  async function entry(form: FormData) {
    await api.post('/stock/entries', Object.fromEntries(form));
    setSuccess('Entrée stock enregistrée.');
    reload();
    movements.reload();
  }

  async function exit(form: FormData) {
    await api.post('/stock/exits', Object.fromEntries(form));
    setSuccess('Sortie stock enregistrée.');
    reload();
    movements.reload();
  }

  async function inventory(form: FormData) {
    await api.post('/stock/inventories', {
      count_date: form.get('count_date'),
      notes: form.get('notes'),
      lines: [{ stock_item_id: Number(form.get('stock_item_id')), physical_quantity: Number(form.get('physical_quantity')), notes: form.get('notes') }],
    });
    setSuccess('Inventaire créé.');
    inventories.reload();
  }

  async function validateInventory(id: number) {
    await api.post(`/stock/inventories/${id}/validate`);
    setSuccess('Inventaire validé et ajustements créés.');
    reload();
    movements.reload();
    inventories.reload();
  }

  async function openDetail(id: number) {
    const response = await api.get<StockItem & { movements: StockMovement[] }>(`/stock/items/${id}`);
    setViewing(response.data);
  }

  return (
    <section>
      <PageHeader title="Stock" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Articles</span><strong>{data.length}</strong></div>
        <div className="mini-stat"><span>Sous seuil</span><strong>{lowStock.length}</strong></div>
        <div className="mini-stat"><span>Rupture</span><strong>{outOfStock.length}</strong></div>
        <div className="mini-stat"><span>Valorisation</span><strong>{money(data.reduce((sum, item) => sum + Number(item.current_quantity) * Number(item.average_purchase_price ?? item.purchase_price ?? 0), 0))}</strong></div>
      </div>
      {can('stock.create') && <QuickForm onSubmit={create} fields={['name:Article', 'description:Description', 'category:Catégorie', 'unit:Unité', 'current_quantity:Quantité initiale', 'minimum_quantity:Stock minimum', 'purchase_price:Prix achat', 'observations:Observations']} button="Créer article" />}
      {can('stock.create') && <QuickForm onSubmit={entry} fields={['stock_item_id:ID article', 'quantity:Quantité', 'unit_price:Prix unitaire', 'movement_date:Date', 'supplier:Fournisseur', 'comment:Commentaire']} button="Entrée stock" />}
      {can('stock.update') && <QuickForm onSubmit={exit} fields={['stock_item_id:ID article', 'quantity:Quantité', 'movement_date:Date', 'destination:Destination', 'comment:Commentaire']} button="Sortie stock" />}
      {can('stock.update') && <QuickForm onSubmit={inventory} fields={['count_date:Date inventaire', 'stock_item_id:ID article', 'physical_quantity:Quantité physique', 'notes:Notes']} button="Créer inventaire" />}
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('stock.csv', filtered)} />
      <div className="actions detail-section">
        <button className="secondary" onClick={() => exportExcel('stock.xls', filtered)}>Excel articles</button>
        <button className="secondary" onClick={() => exportCsv('mouvements-stock.csv', movements.data)}>CSV mouvements</button>
        <button className="secondary" onClick={() => exportExcel('inventaires-stock.xls', inventories.data)}>Excel inventaires</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Article</th><th>Catégorie</th><th>Quantité</th><th>Seuil</th><th>PMP</th><th>Alerte</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((i) => <tr key={i.id}><td>{i.code ?? '-'}</td><td>{i.name}</td><td>{i.category}</td><td className="right">{i.current_quantity} {i.unit}</td><td className="right">{i.minimum_quantity}</td><td className="right">{money(i.average_purchase_price ?? i.purchase_price)}</td><td>{stockAlertLabel(i.stock_alert)}</td><td>{statusLabel(i.status)}</td><td className="actions"><button className="secondary" onClick={() => openDetail(i.id)}>Voir</button>{can('stock.update') && <button className="secondary" onClick={() => setEditing(i)}>Modifier</button>}{can('stock.delete') && i.status !== 'INACTIVE' && <button className="secondary" onClick={() => deactivate(i.id)}>Désactiver</button>}</td></tr>)}</tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      <div className="detail-section">
        <h4>Mouvements récents</h4>
        <Table headers={['Numéro', 'Article', 'Type', 'Quantité', 'Avant', 'Après', 'Date', 'Destination']} rows={movements.data.map((m) => [m.movement_number ?? m.reference ?? '-', m.item_name, movementTypeLabel(m.type), m.quantity, m.quantity_before ?? '-', m.quantity_after ?? '-', shortDate(m.movement_date), m.destination ?? m.reference ?? '-'])} />
      </div>
      <div className="detail-section">
        <h4>Inventaires</h4>
        <Table headers={['Numéro', 'Date', 'Lignes', 'Écart', 'Statut', 'Actions']} rows={inventories.data.map((i) => [i.inventory_number ?? `#${i.id}`, shortDate(i.count_date), i.line_count ?? 0, i.total_difference ?? 0, statusLabel(i.status), <span className="actions">{can('stock.update') && i.status !== 'VALIDATED' && <button className="secondary" onClick={() => validateInventory(i.id)}>Valider</button>}</span>])} />
      </div>
      <div className="detail-section">
        <h4>Catégories</h4>
        <div className="compact-list">{categories.data.map((category) => <div className="compact-item" key={category.id}><span>{category.name}</span><strong>{statusLabel(category.status)}</strong></div>)}</div>
      </div>
      {editing && (
        <Modal title="Modifier article" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); update(new FormData(event.currentTarget)); }}>
            <input name="code" placeholder="Code article" defaultValue={editing.code ?? ''} />
            <input name="name" placeholder="Nom" defaultValue={editing.name} required />
            <input name="description" placeholder="Description" defaultValue={editing.description ?? ''} />
            <input name="category" placeholder="Catégorie" defaultValue={editing.category} required />
            <input name="unit" placeholder="Unité" defaultValue={editing.unit} required />
            <input name="minimum_quantity" type="number" placeholder="Stock minimum" defaultValue={editing.minimum_quantity} />
            <input name="purchase_price" type="number" placeholder="Prix achat" defaultValue={editing.purchase_price} />
            <input name="observations" placeholder="Observations" defaultValue={editing.observations ?? ''} />
            <select name="status" defaultValue={editing.status}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Détail article" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Code</span><strong>{viewing.code ?? '-'}</strong>
            <span>Article</span><strong>{viewing.name}</strong>
            <span>Catégorie</span><strong>{viewing.category}</strong>
            <span>Quantité</span><strong>{viewing.current_quantity} {viewing.unit}</strong>
            <span>Stock minimum</span><strong>{viewing.minimum_quantity}</strong>
            <span>Prix moyen</span><strong>{money(viewing.average_purchase_price ?? viewing.purchase_price)}</strong>
            <span>Observations</span><strong>{viewing.observations ?? '-'}</strong>
          </div>
          <div className="detail-section"><h4>Historique article</h4><Table headers={['Date', 'Type', 'Quantité', 'Avant', 'Après']} rows={viewing.movements.map((m) => [shortDate(m.movement_date), movementTypeLabel(m.type), m.quantity, m.quantity_before ?? '-', m.quantity_after ?? '-'])} /></div>
        </Modal>
      )}
    </section>
  );
}

export function LeasesPage() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Lease>('/leases');
  const tenants = useApiList<{ id: number; first_name: string; last_name: string }>('/tenants');
  const units = useApiList<{ id: number; building_name: string; number: string; monthly_rent: number; status: string }>('/units');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lease | null>(null);
  const [viewing, setViewing] = useState<LeaseDetail | null>(null);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const filtered = data.filter((item) => includesText(item, query));

  async function save(form: FormData) {
    const payload = {
      tenant_id: Number(form.get('tenant_id')),
      unit_id: Number(form.get('unit_id')),
      start_date: form.get('start_date'),
      end_date: form.get('end_date') || null,
      monthly_rent: Number(form.get('monthly_rent')),
      rental_guarantee_amount: Number(form.get('rental_guarantee_amount')),
      rental_guarantee_paid: Number(form.get('rental_guarantee_paid')),
      rental_guarantee_status: form.get('rental_guarantee_status'),
      contract_file_name: form.get('contract_file_name') || null,
      status: form.get('status') || 'DRAFT',
    };
    if (editing) {
      await api.put(`/leases/${editing.id}`, payload);
      setSuccess('Bail modifié avec succès.');
      setEditing(null);
    } else {
      await api.post('/leases', payload);
      setSuccess('Bail créé avec succès.');
      setCreating(false);
    }
    reload();
  }

  async function openDetail(id: number) {
    const response = await api.get<LeaseDetail>(`/leases/${id}`);
    setViewing(response.data);
  }

  async function activate(id: number) {
    await api.post(`/leases/${id}/activate`);
    setSuccess('Bail activé. L’appartement est maintenant occupé.');
    reload();
  }

  async function terminate(id: number) {
    await api.post(`/leases/${id}/terminate`, { reason: 'Résiliation depuis interface locale' });
    setSuccess('Bail résilié. L’appartement est libéré si aucun autre bail actif n’existe.');
    reload();
  }

  async function invoice(id: number) {
    const response = await api.post(`/leases/${id}/invoice`);
    setSuccess(`Facture ${response.data.invoice_number} créée depuis le bail.`);
  }

  return (
    <section>
      <PageHeader title="Baux & contrats" action={can('documents.upload') ? <button onClick={() => setCreating(true)}>Créer bail</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar query={query} onQueryChange={setQuery} onExport={() => exportCsv('baux.csv', filtered)} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Locataire</th><th>Immeuble</th><th>Appartement</th><th>Début</th><th>Loyer</th><th>Garantie</th><th>Payé</th><th>Contrat</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((l) => <tr key={l.id}><td>{l.tenant_name}</td><td>{l.building_name}</td><td>{l.unit_number}</td><td>{shortDate(l.start_date)}</td><td>{money(l.monthly_rent)}</td><td>{money(l.guarantee_amount ?? l.rental_guarantee_amount)}</td><td>{money(l.guarantee_paid ?? l.rental_guarantee_paid)}</td><td>{l.contract_file_name ?? 'Absent'}</td><td>{statusLabel(l.status)}</td><td className="actions"><button className="secondary" onClick={() => openDetail(l.id)}>Voir</button>{can('documents.upload') && <button className="secondary" onClick={() => setEditing(l)}>Modifier</button>}{can('documents.upload') && l.status !== 'ACTIVE' && <button className="secondary" onClick={() => activate(l.id)}>Activer</button>}{can('documents.upload') && l.status === 'ACTIVE' && <button className="secondary" onClick={() => terminate(l.id)}>Résilier</button>}{can('invoices.create') && <button className="secondary" onClick={() => invoice(l.id)}>Facturer</button>}</td></tr>)}</tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      {(creating || editing) && (
        <Modal title={editing ? 'Modifier bail' : 'Créer bail'} onClose={() => { setCreating(false); setEditing(null); }}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
            <select name="tenant_id" required defaultValue={editing?.tenant_id}>{tenants.data.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.first_name} {tenant.last_name}</option>)}</select>
            <select name="unit_id" required defaultValue={editing?.unit_id}>{units.data.map((unit) => <option key={unit.id} value={unit.id}>{unit.building_name} / {unit.number} - {statusLabel(unit.status)}</option>)}</select>
            <input name="start_date" type="date" required defaultValue={editing?.start_date?.slice(0, 10)} />
            <input name="end_date" type="date" defaultValue={editing?.end_date?.slice(0, 10)} />
            <input name="monthly_rent" type="number" placeholder="Loyer mensuel" required defaultValue={editing?.monthly_rent} />
            <input name="rental_guarantee_amount" type="number" placeholder="Garantie locative" defaultValue={editing?.rental_guarantee_amount ?? 0} />
            <input name="rental_guarantee_paid" type="number" placeholder="Garantie payée" defaultValue={editing?.rental_guarantee_paid ?? 0} />
            <select name="rental_guarantee_status" defaultValue={editing?.rental_guarantee_status ?? 'NOT_PAID'}><option value="NOT_PAID">Non payée</option><option value="PARTIAL">Paiement partiel</option><option value="PAID">Payée</option></select>
            <input name="contract_file_name" placeholder="Nom document contrat" defaultValue={editing?.contract_file_name ?? ''} />
            <select name="status" defaultValue={editing?.status ?? 'DRAFT'}><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Résilié</option></select>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Détail bail" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Locataire</span><strong>{viewing.tenant_name}</strong>
            <span>Appartement</span><strong>{viewing.building_name} / {viewing.unit_number}</strong>
            <span>Période</span><strong>{shortDate(viewing.start_date)} - {viewing.end_date ? shortDate(viewing.end_date) : 'En cours'}</strong>
            <span>Loyer</span><strong>{money(viewing.monthly_rent)}</strong>
            <span>Statut</span><strong>{statusLabel(viewing.status)}</strong>
          </div>
          <div className="detail-section"><h4>Garantie locative</h4><div className="compact-list"><div className="compact-item"><span>{statusLabel(viewing.guarantee?.status ?? viewing.rental_guarantee_status)}</span><strong>{money(viewing.guarantee?.paid_amount ?? viewing.rental_guarantee_paid)} / {money(viewing.guarantee?.amount ?? viewing.rental_guarantee_amount)}</strong></div></div></div>
          <div className="detail-section"><h4>Documents bail</h4><div className="compact-list">{viewing.documents.map((document) => <div className="compact-item" key={document.id}><span>{document.document_type}</span><strong>{document.file_name}</strong></div>)}</div></div>
          <div className="detail-section"><h4>Historique occupation unité</h4><div className="compact-list">{viewing.history.map((lease) => <div className="compact-item" key={lease.id}><span>{lease.tenant_name} · {shortDate(lease.start_date)}</span><strong>{statusLabel(lease.status)}</strong></div>)}</div></div>
        </Modal>
      )}
    </section>
  );
}

export function ReportsPage() {
  const location = useLocation();
  const reportKind = location.pathname.split('/').pop() ?? 'reports';
  const buildings = useApiList<{ id: number; name: string }>('/buildings');
  const tenants = useApiList<{ id: number; first_name: string; last_name: string }>('/tenants');
  const [filters, setFilters] = useState<ReportFilterState>({
    building_id: '',
    tenant_id: '',
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10),
    status: '',
    payment_method: '',
  });
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [buildingReport, setBuildingReport] = useState<Record<string, unknown> | null>(null);
  const [tenantReport, setTenantReport] = useState<Record<string, unknown> | null>(null);
  const [paymentsReport, setPaymentsReport] = useState<Record<string, unknown> | null>(null);
  const [availability, setAvailability] = useState<Record<string, unknown> | null>(null);
  const [overdue, setOverdue] = useState<Record<string, unknown> | null>(null);
  const [stockReport, setStockReport] = useState<Record<string, unknown> | null>(null);
  const [maintenanceReport, setMaintenanceReport] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('/reports/dashboard').then((res) => setDashboard(res.data));
    if (reportKind === 'buildings' && filters.building_id) {
      api.get(`/reports/buildings/${filters.building_id}`, { params }).then((res) => setBuildingReport(res.data));
    }
    if (reportKind === 'tenants' && filters.tenant_id) {
      api.get(`/reports/tenants/${filters.tenant_id}`).then((res) => setTenantReport(res.data));
    }
    if (reportKind === 'payments') {
      api.get('/reports/payments', { params }).then((res) => setPaymentsReport(res.data));
    }
    if (reportKind === 'availability' || reportKind === 'reports') {
      api.get('/reports/availability').then((res) => setAvailability(res.data));
    }
    if (reportKind === 'overdue') {
      api.get('/reports/overdue', { params }).then((res) => setOverdue(res.data));
    }
    if (reportKind === 'stock') {
      api.get('/reports/stock').then((res) => setStockReport(res.data));
    }
    if (reportKind === 'maintenance') {
      api.get('/reports/maintenance', { params }).then((res) => setMaintenanceReport(res.data));
    }
  }, [reportKind, filters]);

  const summaryRows = arrayOfRecords(dashboard?.revenue_by_building);
  const guaranteesRows = arrayOfRecords(dashboard?.guarantees);
  const paymentRows = arrayOfRecords(paymentsReport?.payments_received);
  const invoiceRows = arrayOfRecords(paymentsReport?.invoices);
  const buildingTenants = arrayOfRecords(buildingReport?.tenants);
  const buildingUnits = arrayOfRecords(buildingReport?.units);
  const tenantLeases = arrayOfRecords(tenantReport?.leases);
  const tenantPayments = arrayOfRecords(tenantReport?.payments);
  const availabilityRows = arrayOfRecords(availability?.buildings);
  const overdueRows = arrayOfRecords(overdue?.invoices);
  const stockRows = arrayOfRecords(stockReport?.items);
  const stockMovementRows = arrayOfRecords(stockReport?.movements);
  const stockInventoryRows = arrayOfRecords(stockReport?.inventories);
  const maintenanceRows = arrayOfRecords(maintenanceReport?.requests);

  return (
    <section>
      <PageHeader title="Rapports BI" />
      <div className="mini-stats">
        <div className="mini-stat"><span>Impayés</span><strong>{String((dashboard?.overdue as Record<string, unknown> | undefined)?.count ?? 0)}</strong></div>
        <div className="mini-stat"><span>Montant impayé</span><strong>{money((dashboard?.overdue as Record<string, unknown> | undefined)?.amount as number)}</strong></div>
        <div className="mini-stat"><span>Caisse nette</span><strong>{money((dashboard?.cash_summary as Record<string, unknown> | undefined)?.balance as number)}</strong></div>
        <div className="mini-stat"><span>Immeubles suivis</span><strong>{summaryRows.length}</strong></div>
      </div>
      <ReportFilters
        filters={filters}
        setFilters={setFilters}
        buildings={buildings.data}
        tenants={tenants.data}
        showBuilding={['buildings', 'payments', 'overdue', 'maintenance'].includes(reportKind)}
        showTenant={['tenants', 'payments', 'overdue'].includes(reportKind)}
        showPeriod={['buildings', 'payments', 'maintenance'].includes(reportKind)}
        showInvoiceStatus={reportKind === 'payments'}
        showPaymentMethod={reportKind === 'payments'}
      />
      {reportKind === 'reports' && <div className="chart-grid"><ReportBlock title="Revenus par immeuble" rows={summaryRows} filename="rapport-dashboard-revenus.csv" /><ReportBlock title="Garanties locatives" rows={guaranteesRows} filename="rapport-dashboard-garanties.csv" /></div>}
      {reportKind === 'buildings' && <><SummaryCards values={[['Unités', buildingReport?.units_total], ['Occupées', buildingReport?.occupied_units], ['Libres', buildingReport?.vacant_units], ['Taux occupation', `${buildingReport?.occupancy_rate ?? 0}%`], ['Total facturé', money((buildingReport?.finances as Record<string, unknown> | undefined)?.total_invoiced as number)], ['Reste à payer', money((buildingReport?.finances as Record<string, unknown> | undefined)?.remaining as number)]]} /><ReportBlock title="Locataires de l'immeuble" rows={buildingTenants} filename="rapport-immeuble-locataires.csv" /><ReportBlock title="Unités de l'immeuble" rows={buildingUnits} filename="rapport-immeuble-unites.csv" /></>}
      {reportKind === 'tenants' && <><SummaryCards values={[['Baux actifs', arrayOfRecords(tenantReport?.active_leases).length], ['Anciens baux', arrayOfRecords(tenantReport?.old_leases).length], ['Total facturé', money(tenantReport?.total_invoiced as number)], ['Total payé', money(tenantReport?.total_paid as number)], ['Solde restant', money(tenantReport?.remaining as number)], ['Paiements', tenantPayments.length]]} /><ReportBlock title="Baux du locataire" rows={tenantLeases} filename="rapport-locataire-baux.csv" /><ReportBlock title="Paiements du locataire" rows={tenantPayments} filename="rapport-locataire-paiements.csv" /></>}
      {reportKind === 'payments' && <><SummaryCards values={[['Paiements reçus', paymentRows.length], ['Locataires ayant payé', arrayOfRecords(paymentsReport?.tenants_paid).length], ['Locataires sans paiement', arrayOfRecords(paymentsReport?.tenants_unpaid).length], ['Total facturé', money(paymentsReport?.total_invoiced as number)], ['Total encaissé', money(paymentsReport?.total_paid as number)], ['Total restant', money(paymentsReport?.remaining as number)]]} /><ReportBlock title="Paiements reçus" rows={paymentRows} filename="rapport-paiements.csv" /><ReportBlock title="Factures de la période" rows={invoiceRows} filename="rapport-factures-periode.csv" /></>}
      {(reportKind === 'availability' || reportKind === 'reports') && <><SummaryCards values={[['Total unités', (availability?.totals as Record<string, unknown> | undefined)?.total_units], ['Occupées', (availability?.totals as Record<string, unknown> | undefined)?.occupied_units], ['Libres', (availability?.totals as Record<string, unknown> | undefined)?.vacant_units], ['Maintenance', (availability?.totals as Record<string, unknown> | undefined)?.maintenance_units], ['Bloquées', (availability?.totals as Record<string, unknown> | undefined)?.blocked_units], ['Loyer potentiel', money((availability?.totals as Record<string, unknown> | undefined)?.vacant_potential_rent as number)]]} /><ReportBlock title="Disponibilité par immeuble" rows={availabilityRows} filename="rapport-disponibilite.csv" /></>}
      {reportKind === 'overdue' && <><SummaryCards values={[['Factures en retard', overdue?.count], ['Total restant', money(overdue?.total_remaining as number)]]} /><ReportBlock title="Impayés et retards" rows={overdueRows} filename="rapport-impayes.csv" /></>}
      {reportKind === 'stock' && <><SummaryCards values={[['Articles', stockRows.length], ['Sous seuil', arrayOfRecords(stockReport?.under_minimum).length], ['Rupture', arrayOfRecords(stockReport?.out_of_stock).length], ['Inactifs', arrayOfRecords(stockReport?.inactive).length], ['Valorisation', money(stockReport?.valuation as number)]]} /><ReportBlock title="État stock" rows={stockRows} filename="rapport-stock-etat.csv" /><ReportBlock title="Historique mouvements" rows={stockMovementRows} filename="rapport-stock-mouvements.csv" /><ReportBlock title="Inventaires" rows={stockInventoryRows} filename="rapport-stock-inventaires.csv" /></>}
      {reportKind === 'maintenance' && <><SummaryCards values={[['Ouvertes', (maintenanceReport?.summary as Record<string, unknown> | undefined)?.open], ['Urgentes', (maintenanceReport?.summary as Record<string, unknown> | undefined)?.urgent], ['En retard', (maintenanceReport?.summary as Record<string, unknown> | undefined)?.overdue], ['Terminées', (maintenanceReport?.summary as Record<string, unknown> | undefined)?.completed], ['Coût total', money((maintenanceReport?.summary as Record<string, unknown> | undefined)?.total_cost as number)]]} /><ReportBlock title="Rapport maintenance période" rows={maintenanceRows} filename="rapport-maintenance.csv" /><ReportBlock title="Maintenance par immeuble" rows={arrayOfRecords(maintenanceReport?.by_building)} filename="rapport-maintenance-immeubles.csv" /><ReportBlock title="Maintenance par technicien" rows={arrayOfRecords(maintenanceReport?.by_technician)} filename="rapport-maintenance-techniciens.csv" /><ReportBlock title="Maintenance par catégorie" rows={arrayOfRecords(maintenanceReport?.by_category)} filename="rapport-maintenance-categories.csv" /></>}
    </section>
  );
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function ReportFilters({
  filters,
  setFilters,
  buildings,
  tenants,
  showBuilding,
  showTenant,
  showPeriod,
  showInvoiceStatus,
  showPaymentMethod,
}: {
  filters: ReportFilterState;
  setFilters: (value: ReportFilterState) => void;
  buildings: Array<{ id: number; name: string }>;
  tenants: Array<{ id: number; first_name: string; last_name: string }>;
  showBuilding: boolean;
  showTenant: boolean;
  showPeriod: boolean;
  showInvoiceStatus: boolean;
  showPaymentMethod: boolean;
}) {
  const update = (key: string, value: string) => setFilters({ ...filters, [key]: value });
  return (
    <div className="quick-form">
      {showBuilding && <select value={filters.building_id} onChange={(event) => update('building_id', event.target.value)}><option value="">Tous les immeubles</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select>}
      {showTenant && <select value={filters.tenant_id} onChange={(event) => update('tenant_id', event.target.value)}><option value="">Tous les locataires</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.first_name} {tenant.last_name}</option>)}</select>}
      {showPeriod && <input type="date" value={filters.start} onChange={(event) => update('start', event.target.value)} />}
      {showPeriod && <input type="date" value={filters.end} onChange={(event) => update('end', event.target.value)} />}
      {showInvoiceStatus && <select value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">Tous les statuts</option><option value="PAID">Payée</option><option value="PARTIAL">Paiement partiel</option><option value="UNPAID">Non payée</option><option value="OVERDUE">En retard</option></select>}
      {showPaymentMethod && <select value={filters.payment_method} onChange={(event) => update('payment_method', event.target.value)}><option value="">Tous modes</option><option value="CASH">Espèces</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option></select>}
    </div>
  );
}

function SummaryCards({ values }: { values: Array<[string, unknown]> }) {
  return <div className="mini-stats">{values.map(([label, value]) => <div className="mini-stat" key={label}><span>{label}</span><strong>{String(value ?? '-')}</strong></div>)}</div>;
}

function ReportBlock({ title, rows, filename }: { title: string; rows: Array<Record<string, unknown>>; filename: string }) {
  const headers = Object.keys(rows[0] ?? { information: 'Information' }).slice(0, 8);
  return (
    <article className="chart-card detail-section">
      <div className="page-header">
        <h3>{title}</h3>
        <div className="actions">
          <button className="secondary" onClick={() => exportCsv(filename, rows)}>CSV</button>
          <button className="secondary" onClick={() => exportExcel(filename.replace('.csv', '.xls'), rows)}>Excel</button>
        </div>
      </div>
      <Table headers={headers} rows={rows.map((row) => headers.map((header) => String(row[header] ?? '-')))} />
    </article>
  );
}

function roleLabel(value: string) {
  return ({
    ADMIN: 'Administrateur',
    ACCOUNTANT: 'Comptable',
    STAFF: 'Agent',
    DIRECTOR: 'Directeur',
  })[value] ?? value;
}

function movementTypeLabel(value: string) {
  return ({
    IN: 'Entrée',
    OUT: 'Sortie',
    INVENTORY: 'Inventaire',
    INVENTORY_GAIN: 'Gain inventaire',
    INVENTORY_LOSS: 'Perte inventaire',
  })[value] ?? value;
}

function stockAlertLabel(value?: string) {
  return ({
    OK: 'OK',
    LOW_STOCK: 'Sous minimum',
    OUT_OF_STOCK: 'Rupture',
    INACTIVE: 'Inactif',
  })[value ?? 'OK'] ?? value ?? 'OK';
}

function cashCategoryLabel(value: string) {
  return ({
    INVOICE_PAYMENT: 'Paiement facture',
    SALARY_ADVANCE: 'Avance salaire',
    OTHER_INCOME: 'Autre entrée',
    OTHER_EXPENSE: 'Autre dépense',
    LEASE_GUARANTEE: 'Garantie locative',
    LEASE_GUARANTEE_REFUND: 'Remboursement garantie',
    SALARY_PAYMENT: 'Paiement salaire',
    MAINTENANCE_EXPENSE: 'Dépense maintenance',
  })[value] ?? value;
}

function QuickForm({ fields, button, onSubmit }: { fields: string[]; button: string; onSubmit: (form: FormData) => void }) {
  return (
    <form className="quick-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
      {fields.map((field) => {
        const [name, label] = field.split(':');
        const type = name.includes('date') ? 'date' : name.includes('amount') || name.includes('salary') || name.includes('quantity') || name.includes('price') ? 'number' : 'text';
        return <input key={name} name={name} placeholder={label} type={type} required={['first_name', 'last_name', 'name', 'amount'].includes(name)} />;
      })}
      <button>{button}</button>
    </form>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
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
