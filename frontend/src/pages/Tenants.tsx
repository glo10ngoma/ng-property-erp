import { Eye, FilePlus, Pencil, Plus, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api, exportCsv, includesText, invoiceDisplayStatus, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Tenant = { id: number; first_name: string; last_name: string; phone: string; email?: string; unit_id: number; unit_number: string; building_name: string; monthly_rent: number; move_in_date?: string; status: string };
type Unit = { id: number; building_name: string; number: string };
type TenantDetail = Tenant & {
  situation: string;
  financial: {
    total_invoiced: number;
    total_paid: number;
    remaining: number;
    invoices: number;
    paid_invoices: number;
    unpaid_invoices: number;
    overdue_invoices: number;
  };
  invoices: Array<{ id: number; invoice_number: string; total: number; paid_amount: number; remaining_amount: number; due_date: string; status: string }>;
  payments: Array<{ id: number; invoice_number: string; payment_date: string; amount: number; payment_method: string; reference?: string }>;
};

export function Tenants() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Tenant>('/tenants');
  const units = useApiList<Unit>('/units');
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);
  const [viewing, setViewing] = useState<TenantDetail | null>(null);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const filtered = data.filter((tenant) => includesText(tenant, query));

  async function save(form: FormData) {
    const payload = {
      first_name: form.get('first_name'),
      last_name: form.get('last_name'),
      phone: form.get('phone'),
      email: form.get('email'),
      unit_id: Number(form.get('unit_id')),
      move_in_date: form.get('move_in_date'),
      status: 'ACTIVE',
    };
    if (editing?.id) await api.put(`/tenants/${editing.id}`, payload);
    else await api.post('/tenants', payload);
    setSuccess(editing?.id ? 'Locataire modifié avec succès.' : 'Locataire créé avec succès.');
    setEditing(null);
    reload();
  }

  async function createInvoice(tenant: Tenant) {
    const now = new Date();
    const response = await api.post('/invoices', {
      tenant_id: tenant.id,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      issue_date: now.toISOString().slice(0, 10),
      due_date: new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10),
      items: [{ description: 'Monthly rent', amount: Number(tenant.monthly_rent) }],
    });
    navigate(`/invoices/${response.data.id}`);
  }

  async function openDetail(tenant: Tenant) {
    const response = await api.get<TenantDetail>(`/tenants/${tenant.id}`);
    setViewing(response.data);
  }

  return (
    <section>
      <PageHeader title="Locataires" action={can('tenants.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouveau locataire</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        onExport={() => exportCsv('locataires.csv', filtered.map((tenant) => ({
          nom: `${tenant.first_name} ${tenant.last_name}`,
          telephone: tenant.phone,
          email: tenant.email ?? '',
          immeuble: tenant.building_name,
          appartement: tenant.unit_number,
          loyer: tenant.monthly_rent,
          statut: tenant.status,
        })))}
      />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Téléphone</th><th>Appartement</th><th>Immeuble</th><th>Loyer</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((tenant) => (
              <tr key={tenant.id}>
                <td>{tenant.first_name} {tenant.last_name}</td><td>{tenant.phone}</td><td>{tenant.unit_number}</td><td>{tenant.building_name}</td><td>{money(tenant.monthly_rent)}</td><td><StatusBadge value={tenant.status} /></td>
                <td className="actions">
                  <button className="icon-btn" title="Voir" onClick={() => openDetail(tenant)}><Eye size={16} /></button>
                  {can('tenants.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(tenant)}><Pencil size={16} /></button>}
                  {can('invoices.create') && <button className="icon-btn" title="Créer une facture" onClick={() => createInvoice(tenant)}><FilePlus size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>
      {editing && (
        <Modal title={editing.id ? 'Modifier le locataire' : 'Nouveau locataire'} onClose={() => setEditing(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              save(new FormData(event.currentTarget));
            }}
          >
            <input name="first_name" placeholder="Prénom" defaultValue={editing.first_name} required />
            <input name="last_name" placeholder="Nom" defaultValue={editing.last_name} required />
            <input name="phone" placeholder="Téléphone" defaultValue={editing.phone} required />
            <input name="email" placeholder="Email" type="email" defaultValue={editing.email} />
            <select name="unit_id" required defaultValue={editing.unit_id}>{units.data.map((u) => <option key={u.id} value={u.id}>{u.building_name} / {u.number}</option>)}</select>
            <input name="move_in_date" type="date" required defaultValue={editing.move_in_date?.slice(0, 10)} />
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <Modal title="Détail locataire" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Nom</span><strong>{viewing.first_name} {viewing.last_name}</strong>
            <span>Téléphone</span><strong>{viewing.phone}</strong>
            <span>Email</span><strong>{viewing.email || '-'}</strong>
            <span>Appartement</span><strong>{viewing.unit_number}</strong>
            <span>Immeuble</span><strong>{viewing.building_name}</strong>
            <span>Loyer mensuel</span><strong>{money(viewing.monthly_rent)}</strong>
            <span>Date d’entrée</span><strong>{viewing.move_in_date ? shortDate(viewing.move_in_date) : '-'}</strong>
            <span>Situation actuelle</span><strong>{viewing.situation}</strong>
          </div>
          <div className="detail-section">
            <h4>Situation financière</h4>
            <div className="mini-stats">
              <div className="mini-stat"><span>Total facturé</span><strong>{money(viewing.financial.total_invoiced)}</strong></div>
              <div className="mini-stat"><span>Total payé</span><strong>{money(viewing.financial.total_paid)}</strong></div>
              <div className="mini-stat"><span>Solde restant</span><strong>{money(viewing.financial.remaining)}</strong></div>
              <div className="mini-stat"><span>Retards</span><strong>{viewing.financial.overdue_invoices}</strong></div>
            </div>
          </div>
          <div className="detail-section">
            <h4>Historique factures</h4>
            <div className="compact-list">
              {viewing.invoices.map((invoice) => (
                <div className="compact-item" key={invoice.id}>
                  <span>{invoice.invoice_number} · {shortDate(invoice.due_date)} · <StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} /></span>
                  <strong>{money(invoice.remaining_amount)}</strong>
                  <button className="icon-btn" title="Voir facture" onClick={() => navigate(`/invoices/${invoice.id}`)}><Eye size={15} /></button>
                  <button className="icon-btn" title="Imprimer facture" onClick={() => window.open(`/invoices/${invoice.id}`, '_blank')}><Printer size={15} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-section">
            <h4>Historique paiements</h4>
            <div className="compact-list">
              {viewing.payments.map((payment) => (
                <div className="compact-item" key={payment.id}>
                  <span>{payment.invoice_number} · {shortDate(payment.payment_date)} · {paymentMethodLabel(payment.payment_method)}</span>
                  <strong>{money(payment.amount)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
