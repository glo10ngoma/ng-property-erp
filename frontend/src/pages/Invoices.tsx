import { Eye, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { api, exportCsv, includesText, invoiceDisplayStatus, itemLabel, money, shortDate, statusLabel } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Invoice = { id: number; invoice_number: string; first_name: string; last_name: string; building_name: string; unit_number: string; issue_date: string; due_date: string; month: number; year: number; total: number; paid_amount: number; remaining_amount: number; status: string };
type Tenant = { id: number; first_name: string; last_name: string; monthly_rent: number; building_name: string; unit_number: string };

const lineTypes = ['Water', 'Electricity', 'Maintenance', 'Parking', 'Internet', 'Common charges', 'Other'];

export function Invoices() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Invoice>('/invoices');
  const tenants = useApiList<Tenant>('/tenants');
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [extraLines, setExtraLines] = useState([{ description: 'Water', amount: 0 }]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ month: '', year: '', start: '', end: '', status: '', building: '', tenant: '', unit: '', min: '', max: '' });
  const [success, setSuccess] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tenant = tenants.data.find((item) => item.id === tenantId) ?? tenants.data[0];
  const total = Number(tenant?.monthly_rent ?? 0) + extraLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const buildingOptions = Array.from(new Set(data.map((invoice) => invoice.building_name).filter(Boolean)));
  const tenantOptions = Array.from(new Set(data.map((invoice) => `${invoice.first_name} ${invoice.last_name}`).filter(Boolean)));
  const filtered = data.filter((invoice) => {
    const displayStatus = invoiceDisplayStatus(invoice.status, invoice.due_date);
    if (params.get('filter') === 'impayes' && displayStatus === 'PAID') return false;
    const tenantName = `${invoice.first_name} ${invoice.last_name}`;
    return includesText({ ...invoice, displayStatus: statusLabel(displayStatus), tenant: tenantName }, query)
      && (!filters.month || Number(invoice.month) === Number(filters.month))
      && (!filters.year || Number(invoice.year) === Number(filters.year))
      && (!filters.start || invoice.issue_date.slice(0, 10) >= filters.start)
      && (!filters.end || invoice.issue_date.slice(0, 10) <= filters.end)
      && (!filters.status || displayStatus === filters.status)
      && (!filters.building || invoice.building_name === filters.building)
      && (!filters.tenant || tenantName === filters.tenant)
      && (!filters.unit || invoice.unit_number?.toLowerCase().includes(filters.unit.toLowerCase()))
      && (!filters.min || Number(invoice.total) >= Number(filters.min))
      && (!filters.max || Number(invoice.total) <= Number(filters.max));
  });

  async function save() {
    if (!tenant) return;
    const now = new Date();
    const response = await api.post('/invoices', {
      tenant_id: tenant.id,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      issue_date: now.toISOString().slice(0, 10),
      due_date: new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10),
      items: [
        { description: 'Monthly rent', amount: Number(tenant.monthly_rent) },
        ...extraLines.filter((line) => Number(line.amount) > 0),
      ],
    });
    navigate(`/invoices/${response.data.id}`);
  }

  async function remove(id: number) {
    await api.delete(`/invoices/${id}`);
    setSuccess('Facture supprimée avec succès.');
    reload();
  }

  return (
    <section>
      <PageHeader title="Factures" action={can('invoices.create') ? <button onClick={() => setOpen(true)}><Plus size={16} />Nouvelle facture</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        onExport={() => exportCsv('factures.csv', filtered.map((invoice) => ({
          numero: invoice.invoice_number,
          locataire: `${invoice.first_name} ${invoice.last_name}`,
          immeuble: invoice.building_name,
          appartement: invoice.unit_number,
          mois: invoice.month,
          annee: invoice.year,
          total: invoice.total,
          paye: invoice.paid_amount,
          restant: invoice.remaining_amount,
          statut: statusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)),
        })))}
      />
      <div className="quick-form">
        <input type="number" min="1" max="12" placeholder="Mois" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
        <input type="number" placeholder="Annee" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} />
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Tous les statuts</option><option value="PAID">Payee</option><option value="PARTIAL">Paiement partiel</option><option value="UNPAID">Non payee</option><option value="OVERDUE">En retard</option></select>
        <select value={filters.building} onChange={(event) => setFilters({ ...filters, building: event.target.value })}><option value="">Tous les immeubles</option>{buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <select value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })}><option value="">Tous les locataires</option>{tenantOptions.map((tenantName) => <option key={tenantName} value={tenantName}>{tenantName}</option>)}</select>
        <input placeholder="Unite" value={filters.unit} onChange={(event) => setFilters({ ...filters, unit: event.target.value })} />
        <input type="number" placeholder="Montant min." value={filters.min} onChange={(event) => setFilters({ ...filters, min: event.target.value })} />
        <input type="number" placeholder="Montant max." value={filters.max} onChange={(event) => setFilters({ ...filters, max: event.target.value })} />
        <button type="button" className="secondary" onClick={() => setFilters({ month: '', year: '', start: '', end: '', status: '', building: '', tenant: '', unit: '', min: '', max: '' })}>Reinitialiser filtres</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Numéro</th><th>Locataire</th><th>Immeuble</th><th>Date</th><th className="right">Total</th><th>Devise</th><th className="right">Paye</th><th>Devise</th><th className="right">Restant</th><th>Devise</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_number}</td><td>{invoice.first_name} {invoice.last_name}</td><td>{invoice.building_name} / {invoice.unit_number}</td><td>{shortDate(invoice.issue_date)}</td><td className="right">{amount(invoice.total)}</td><td>USD</td><td className="right">{amount(invoice.paid_amount)}</td><td>USD</td><td className="right">{amount(invoice.remaining_amount)}</td><td>USD</td><td><StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} /></td>
                <td className="actions"><Link className="icon-btn" title="Voir" to={`/invoices/${invoice.id}`}><Eye size={16} /></Link>{can('invoices.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(invoice.id)}><Trash2 size={16} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <EmptyState />}
      </div>
      {open && (
        <Modal title="Nouvelle facture" onClose={() => setOpen(false)}>
          <div className="form-grid">
            <select value={tenant?.id ?? ''} onChange={(event) => setTenantId(Number(event.target.value))}>
              {tenants.data.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name} - {t.building_name} / {t.unit_number}</option>)}
            </select>
            <div className="invoice-line fixed"><span>Loyer mensuel</span><strong>{money(tenant?.monthly_rent)}</strong></div>
            {extraLines.map((line, index) => (
              <div className="invoice-line" key={index}>
                <select value={line.description} onChange={(e) => setExtraLines((lines) => lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l))}>{lineTypes.map((type) => <option key={type} value={type}>{itemLabel(type)}</option>)}</select>
                <input type="number" value={line.amount} onChange={(e) => setExtraLines((lines) => lines.map((l, i) => i === index ? { ...l, amount: Number(e.target.value) } : l))} />
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => setExtraLines([...extraLines, { description: 'Other', amount: 0 }])}>Ajouter une ligne</button>
            <div className="total-row">Total <strong>{money(total)}</strong></div>
            <button onClick={save}>Créer la facture</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
