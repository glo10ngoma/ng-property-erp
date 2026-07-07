import { Eye, Plus, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { api, exportCsv, includesText, invoiceDisplayStatus, itemLabel, money, shortDate, statusLabel } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, StatusBadge, SuccessMessage, TableToolbar, TenantSearchSelect } from '../components';
import { useApiList } from '../hooks';

type Invoice = { id: number; invoice_number: string; first_name: string; last_name: string; building_name: string; unit_number: string; issue_date: string; due_date: string; month: number; year: number; total: number; paid_amount: number; remaining_amount: number; status: string };
type Tenant = { id: number; first_name: string; last_name: string; phone?: string; monthly_rent: number; building_name: string; unit_number: string };
type Lease = { id: number; tenant_id: number; tenant_name: string; building_name: string; unit_number: string; monthly_rent: number; status: string };

const lineTypes = ['Water', 'Electricity', 'Maintenance', 'Parking', 'Internet', 'Common charges', 'Other'];

export function Invoices() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Invoice>('/invoices');
  const tenants = useApiList<Tenant>('/tenants');
  const leases = useApiList<Lease>('/leases');
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [leaseId, setLeaseId] = useState<number | null>(null);
  const [rent, setRent] = useState(0);
  const now = new Date();
  const [invoiceForm, setInvoiceForm] = useState({
    issue_date: now.toISOString().slice(0, 10),
    due_date: new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10),
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
  });
  const [extraLines, setExtraLines] = useState([{ description: 'Water', amount: 0 }]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ month: '', year: '', start: '', end: '', status: '', building: '', tenant: '', unit: '', min: '', max: '' });
  const [success, setSuccess] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tenant = tenants.data.find((item) => item.id === tenantId) ?? tenants.data[0];
  const selectedTenantId = tenantId ?? tenant?.id ?? null;
  const tenantLeases = leases.data.filter((lease) => Number(lease.tenant_id) === Number(selectedTenantId) && lease.status === 'ACTIVE');
  const selectedLease = tenantLeases.find((lease) => lease.id === leaseId) ?? tenantLeases[0];
  const invoiceRent = rent || Number(selectedLease?.monthly_rent ?? tenant?.monthly_rent ?? 0);
  const total = Number(invoiceRent ?? 0) + extraLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const leaseOptions = tenantLeases.map((lease) => ({ value: lease.id, label: `Bail #${lease.id}`, meta: `${lease.building_name} - ${lease.unit_number} - ${money(lease.monthly_rent)}` }));
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
    if (!selectedLease) {
      setSuccess('Selectionnez un bail actif avant de creer la facture.');
      return;
    }
    const response = await api.post('/invoices', {
      tenant_id: tenant.id,
      lease_id: selectedLease.id,
      month: Number(invoiceForm.month),
      year: Number(invoiceForm.year),
      issue_date: invoiceForm.issue_date,
      due_date: invoiceForm.due_date,
      items: [
        { description: 'Monthly rent', amount: Number(invoiceRent) },
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
            <label>Locataire<TenantSearchSelect tenants={tenants.data} value={selectedTenantId} onChange={(value) => { setTenantId(value); setLeaseId(null); setRent(0); }} required /></label>
            <label>Bail actif<SearchableSelect options={leaseOptions} value={selectedLease?.id ?? null} onChange={(value) => { setLeaseId(value ? Number(value) : null); const lease = leases.data.find((item) => item.id === value); if (lease) setRent(Number(lease.monthly_rent)); }} placeholder="Rechercher un bail" emptyMessage="Aucun bail actif trouve" /></label>
            {selectedLease && <div className="summary-band"><div className="summary-item"><span>Immeuble</span><strong>{selectedLease.building_name}</strong></div><div className="summary-item"><span>Unite</span><strong>{selectedLease.unit_number}</strong></div></div>}
            <div className="lease-section-grid">
              <label>Date de facture<input type="date" value={invoiceForm.issue_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, issue_date: event.target.value })} required /></label>
              <label>Date d'echeance<input type="date" value={invoiceForm.due_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, due_date: event.target.value })} required /></label>
              <label>Mois du loyer<input type="number" min="1" max="12" value={invoiceForm.month} onChange={(event) => setInvoiceForm({ ...invoiceForm, month: event.target.value })} required /></label>
              <label>Annee du loyer<input type="number" min="2000" max="2100" value={invoiceForm.year} onChange={(event) => setInvoiceForm({ ...invoiceForm, year: event.target.value })} required /></label>
              <label>Periode debut<input type="date" value={periodStart(invoiceForm.month, invoiceForm.year)} readOnly /></label>
              <label>Periode fin<input type="date" value={periodEnd(invoiceForm.month, invoiceForm.year)} readOnly /></label>
            </div>
            <label>Loyer contractuel<input type="number" value={invoiceRent} onChange={(event) => setRent(Number(event.target.value))} /></label>
            {extraLines.map((line, index) => (
              <div className="invoice-line" key={index}>
                <select value={line.description} onChange={(e) => setExtraLines((lines) => lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l))}>{lineTypes.map((type) => <option key={type} value={type}>{itemLabel(type)}</option>)}</select>
                <input type="number" value={line.amount} onChange={(e) => setExtraLines((lines) => lines.map((l, i) => i === index ? { ...l, amount: Number(e.target.value) } : l))} />
                <button type="button" className="icon-btn danger" onClick={() => setExtraLines((lines) => lines.filter((_, i) => i !== index))}><X size={16} /></button>
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

function periodStart(month: string, year: string) {
  if (!month || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function periodEnd(month: string, year: string) {
  if (!month || !year) return '';
  const date = new Date(Number(year), Number(month), 0);
  return date.toISOString().slice(0, 10);
}
