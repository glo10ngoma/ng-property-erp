import { Download, Eye, FileSpreadsheet, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, exportCsv, exportXlsxWorkbook, includesText, invoiceDisplayStatus, itemLabel, money, shortDate, statusLabel } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, StatusBadge, SuccessMessage, TenantSearchSelect } from '../components';
import { useApiList } from '../hooks';

type Invoice = { id: number; invoice_number: string; tenant_name?: string; first_name: string; last_name: string; building_name: string; unit_number: string; lease_number?: number; issue_date: string; due_date: string; month: number; year: number; total: number; paid_amount: number; remaining_amount: number; discount_amount?: number; attachment_file_name?: string; public_notes?: string; internal_notes?: string; status: string };
type Tenant = { id: number; tenant_type?: string; company_name?: string; first_name: string; last_name: string; post_name?: string; phone?: string; monthly_rent: number; building_name: string; unit_number: string };
type Lease = { id: number; tenant_id: number; tenant_name: string; building_name: string; unit_number: string; monthly_rent: number; monthly_syndic_amount?: number; status: string };

const lineTypes = ['Water', 'Electricity', 'Maintenance', 'Parking', 'Internet', 'Common charges', 'Penalty', 'Other'];
const emptyFilters = { month: '', year: '', status: '', building: '', tenant: '' };

export function Invoices() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Invoice>('/invoices');
  const tenants = useApiList<Tenant>('/tenants');
  const leases = useApiList<Lease>('/leases');
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [leaseId, setLeaseId] = useState<number | null>(null);
  const [rent, setRent] = useState(0);
  const [syndicAmount, setSyndicAmount] = useState(0);
  const now = new Date();
  const [invoiceForm, setInvoiceForm] = useState({
    issue_date: now.toISOString().slice(0, 10),
    due_date: new Date(now.getFullYear(), now.getMonth(), 10).toISOString().slice(0, 10),
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
  });
  const [extraLines, setExtraLines] = useState([{ item_type: 'Water', amount: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [publicNotes, setPublicNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [success, setSuccess] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const tenant = tenants.data.find((item) => item.id === tenantId) ?? tenants.data[0];
  const selectedTenantId = tenantId ?? tenant?.id ?? null;
  const tenantLeases = leases.data.filter((lease) => Number(lease.tenant_id) === Number(selectedTenantId) && lease.status === 'ACTIVE');
  const selectedLease = tenantLeases.find((lease) => lease.id === leaseId) ?? tenantLeases[0];
  const invoiceRent = Number(rent ?? 0);
  const invoiceSyndic = Number(syndicAmount ?? 0);
  const subtotal = Number(invoiceRent ?? 0) + Number(invoiceSyndic ?? 0) + extraLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const total = Math.max(0, subtotal - Number(discount || 0));
  const leaseOptions = tenantLeases.map((lease) => ({ value: lease.id, label: `Bail #${lease.id}`, meta: `${lease.building_name} - ${lease.unit_number} - Loyer ${money(lease.monthly_rent)} - Syndic ${money(lease.monthly_syndic_amount ?? 0)}` }));
  const buildingOptions = Array.from(new Set(data.map((invoice) => invoice.building_name).filter(Boolean)));
  const tenantOptions = Array.from(new Set(data.map(invoiceTenantName).filter(Boolean)));

  useEffect(() => {
    if (selectedLease) {
      setRent(Number(selectedLease.monthly_rent ?? 0));
      setSyndicAmount(Number(selectedLease.monthly_syndic_amount ?? 0));
      if (!leaseId) setLeaseId(selectedLease.id);
    }
  }, [selectedLease?.id]);

  const filtered = data.filter((invoice) => {
    const displayStatus = invoiceDisplayStatus(invoice.status, invoice.due_date);
    if (params.get('filter') === 'impayes' && displayStatus === 'PAID') return false;
    const tenantName = invoiceTenantName(invoice);
    return includesText({ ...invoice, displayStatus: statusLabel(displayStatus), tenant: tenantName }, query)
      && (!filters.month || Number(invoice.month) === Number(filters.month))
      && (!filters.year || Number(invoice.year) === Number(filters.year))
      && (!filters.status || displayStatus === filters.status)
      && (!filters.building || invoice.building_name === filters.building)
      && (!filters.tenant || tenantName === filters.tenant);
  });

  const kpis = {
    total: data.length,
    draft: data.filter((invoice) => invoice.status === 'DRAFT').length,
    paid: data.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'PAID').length,
    partial: data.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'PARTIAL').length,
    unpaid: data.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'UNPAID').length,
    overdue: data.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'OVERDUE').length,
    totalAmount: data.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0),
    remaining: data.reduce((sum, invoice) => sum + Number(invoice.remaining_amount ?? 0), 0),
  };
  const exportRows = filtered.map(invoiceExportRow);

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
      discount_amount: Number(discount || 0),
      public_notes: publicNotes || null,
      internal_notes: internalNotes || null,
      attachment_file_name: attachmentName || null,
      attachment_file_url: null,
      items: buildInvoiceItems(invoiceForm.month, invoiceForm.year, invoiceRent, invoiceSyndic, extraLines),
    });
    navigate(`/invoices/${response.data.id}`);
  }

  async function remove(id: number) {
    if (!window.confirm('Supprimer cette facture ?')) return;
    await api.delete(`/invoices/${id}`);
    setSuccess('Facture supprimee avec succes.');
    reload();
  }

  return (
    <section>
      <PageHeader title="Factures" action={can('invoices.create') ? <button onClick={() => setOpen(true)}><Plus size={16} />Nouvelle facture</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="mini-stats">
        <div className="mini-stat"><span>Total factures</span><strong>{kpis.total}</strong></div>
        <div className="mini-stat"><span>Brouillons</span><strong>{kpis.draft}</strong></div>
        <div className="mini-stat"><span>Payees</span><strong>{kpis.paid}</strong></div>
        <div className="mini-stat"><span>Partielles</span><strong>{kpis.partial}</strong></div>
        <div className="mini-stat"><span>Non payees</span><strong>{kpis.unpaid}</strong></div>
        <div className="mini-stat"><span>En retard</span><strong>{kpis.overdue}</strong></div>
        <div className="mini-stat"><span>Total facture</span><strong>{money(kpis.totalAmount)}</strong></div>
        <div className="mini-stat"><span>Restant du</span><strong>{money(kpis.remaining)}</strong></div>
      </div>

      <div className="quick-form invoices-filter-bar">
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <input type="number" min="1" max="12" placeholder="Mois" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
        <input type="number" placeholder="Annee" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Statut</option><option value="PAID">Payee</option><option value="PARTIAL">Paiement partiel</option><option value="UNPAID">Non payee</option><option value="OVERDUE">En retard</option></select>
        <select value={filters.building} onChange={(event) => setFilters({ ...filters, building: event.target.value })}><option value="">Immeuble</option>{buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <select value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })}><option value="">Locataire</option>{tenantOptions.map((tenantName) => <option key={tenantName} value={tenantName}>{tenantName}</option>)}</select>
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setQuery(''); setFilters(emptyFilters); }}>Reinitialiser</button>
          <button type="button" className="secondary" onClick={() => exportCsv('factures.csv', exportRows)}><Download size={16} />CSV</button>
          <button type="button" className="secondary" onClick={() => exportInvoicesExcel(filtered)}><FileSpreadsheet size={16} />Excel</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Numero</th><th>Locataire</th><th>Bail</th><th>Immeuble</th><th>Unite</th><th>Emission</th><th>Echeance</th><th>Periode</th><th className="right">Total</th><th className="right">Paye</th><th className="right">Restant</th><th>Devise</th><th>Piece</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((invoice) => (
              <tr key={invoice.id} className="clickable-row" onClick={() => navigate(`/invoices/${invoice.id}`)}>
                <td>{invoice.invoice_number}</td>
                <td>{invoiceTenantName(invoice)}</td>
                <td>{invoice.lease_number ? `B-${invoice.lease_number}` : '-'}</td>
                <td>{invoice.building_name}</td>
                <td>{invoice.unit_number}</td>
                <td>{shortDate(invoice.issue_date)}</td>
                <td>{shortDate(invoice.due_date)}</td>
                <td>{periodLabel(invoice.month, invoice.year)}</td>
                <td className="right">{amount(invoice.total)}</td>
                <td className="right">{amount(invoice.paid_amount)}</td>
                <td className="right">{amount(invoice.remaining_amount)}</td>
                <td>USD</td>
                <td><span className={invoice.attachment_file_name ? 'badge active' : 'badge'}>{invoice.attachment_file_name ? 'Presente' : 'Absente'}</span></td>
                <td><StatusBadge value={invoiceDisplayStatus(invoice.status, invoice.due_date)} /></td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <Link className="icon-btn" title="Voir" to={`/invoices/${invoice.id}`}><Eye size={16} /></Link>
                  {can('invoices.update') && <Link className="icon-btn" title="Modifier" to={`/invoices/${invoice.id}?edit=1`}><Pencil size={16} /></Link>}
                  <Link className="icon-btn" title="Imprimer" to={`/invoices/${invoice.id}/print`}><Printer size={16} /></Link>
                  {can('invoices.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(invoice.id)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>

      {open && (
        <Modal title="Nouvelle facture" onClose={() => setOpen(false)}>
          <div className="invoice-modal-body">
            <div className="form-grid invoice-form-grid">
              <label className="invoice-field-full">Locataire<TenantSearchSelect tenants={tenants.data} value={selectedTenantId} onChange={(value) => { setTenantId(value); setLeaseId(null); setRent(0); setSyndicAmount(0); }} required /></label>
              <label className="invoice-field-full">Bail actif<SearchableSelect options={leaseOptions} value={selectedLease?.id ?? null} onChange={(value) => { setLeaseId(value ? Number(value) : null); const lease = leases.data.find((item) => item.id === value); if (lease) { setRent(Number(lease.monthly_rent)); setSyndicAmount(Number(lease.monthly_syndic_amount ?? 0)); } }} placeholder="Rechercher un bail" emptyMessage="Aucun bail actif trouve" /></label>
              {selectedLease && <div className="summary-band invoice-field-full"><div className="summary-item"><span>Immeuble</span><strong>{selectedLease.building_name}</strong></div><div className="summary-item"><span>Unite</span><strong>{selectedLease.unit_number}</strong></div><div className="summary-item"><span>Loyer bail</span><strong>{money(selectedLease.monthly_rent)}</strong></div><div className="summary-item"><span>Syndic bail</span><strong>{money(selectedLease.monthly_syndic_amount ?? 0)}</strong></div><div className="summary-item"><span>Total mensuel</span><strong>{money(Number(selectedLease.monthly_rent ?? 0) + Number(selectedLease.monthly_syndic_amount ?? 0))}</strong></div></div>}
              <div className="invoice-compact-grid invoice-field-full">
                <label>Date de facture<input type="date" value={invoiceForm.issue_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, issue_date: event.target.value })} required /></label>
                <label>Date d'echeance<input type="date" value={invoiceForm.due_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, due_date: event.target.value })} required /></label>
                <label>Mois du loyer<input type="number" min="1" max="12" value={invoiceForm.month} onChange={(event) => setInvoiceForm({ ...invoiceForm, month: event.target.value })} required /></label>
                <label>Annee du loyer<input type="number" min="2000" max="2100" value={invoiceForm.year} onChange={(event) => setInvoiceForm({ ...invoiceForm, year: event.target.value })} required /></label>
                <label>Periode debut<input className="locked-field" type="date" value={periodStart(invoiceForm.month, invoiceForm.year)} readOnly /></label>
                <label>Periode fin<input className="locked-field" type="date" value={periodEnd(invoiceForm.month, invoiceForm.year)} readOnly /></label>
                <label>Loyer contractuel<input type="number" value={invoiceRent} onChange={(event) => setRent(Number(event.target.value))} /></label>
                <label>Syndic mensuel<input type="number" min="0" value={invoiceSyndic} onChange={(event) => setSyndicAmount(Number(event.target.value))} /></label>
                <label>Total mensuel<input className="locked-field" value={money(Number(invoiceRent ?? 0) + Number(invoiceSyndic ?? 0))} readOnly /></label>
                <label>Remise<input type="number" min="0" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label>
              </div>
              <div className="invoice-lines invoice-field-full">
                {extraLines.map((line, index) => (
                  <div className="invoice-line" key={index}>
                    <select aria-label="Description charge" value={line.item_type} onChange={(event) => setExtraLines((lines) => lines.map((item, i) => i === index ? { ...item, item_type: event.target.value } : item))}>{lineTypes.map((type) => <option key={type} value={type}>{itemLabel(type)}</option>)}</select>
                    <input aria-label="Montant charge" type="number" value={line.amount} onChange={(event) => setExtraLines((lines) => lines.map((item, i) => i === index ? { ...item, amount: Number(event.target.value) } : item))} />
                    <button type="button" className="icon-btn danger" aria-label="Supprimer la charge" onClick={() => setExtraLines((lines) => lines.filter((_, i) => i !== index))}><X size={16} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary invoice-add-line" onClick={() => setExtraLines([...extraLines, { item_type: 'Other', amount: 0 }])}>Ajouter une charge</button>
              <details className="invoice-advanced invoice-field-full">
                <summary>Options avancees</summary>
                <div className="invoice-two-col">
                  <label>Notes visibles<textarea rows={2} value={publicNotes} onChange={(event) => setPublicNotes(event.target.value)} placeholder="Texte affiche sur la facture" /></label>
                  <label>Notes internes<textarea rows={2} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} placeholder="Note non imprimee" /></label>
                </div>
                <div className="invoice-two-col">
                  <label>Piece jointe prevue<input type="file" accept="application/pdf,image/*" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')} /></label>
                  <label>Nom fichier<input className="locked-field" value={attachmentName} readOnly placeholder="Aucun fichier selectionne" /></label>
                </div>
              </details>
              <div className="total-row invoice-field-full"><span>Sous-total {money(subtotal)}</span><span>Remise {money(discount)}</span><strong>Total {money(total)}</strong></div>
            </div>
          </div>
          <div className="modal-sticky-actions">
            <button onClick={save}>Creer la facture</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function invoiceTenantName(invoice: Pick<Invoice, 'tenant_name' | 'first_name' | 'last_name'>) {
  return invoice.tenant_name || `${invoice.first_name ?? ''} ${invoice.last_name ?? ''}`.trim();
}

function invoiceExportRow(invoice: Invoice) {
  return {
    numero: invoice.invoice_number,
    locataire: invoiceTenantName(invoice),
    bail: invoice.lease_number ? `B-${invoice.lease_number}` : '',
    immeuble: invoice.building_name,
    unite: invoice.unit_number,
    emission: shortDate(invoice.issue_date),
    echeance: shortDate(invoice.due_date),
    periode: periodLabel(invoice.month, invoice.year),
    total: amount(invoice.total),
    paye: amount(invoice.paid_amount),
    restant: amount(invoice.remaining_amount),
    devise: 'USD',
    piece_jointe: invoice.attachment_file_name ? 'Presente' : 'Absente',
    statut: statusLabel(invoiceDisplayStatus(invoice.status, invoice.due_date)),
  };
}

function exportInvoicesExcel(rows: Invoice[]) {
  exportXlsxWorkbook('Factures.xlsx', [
    { name: 'Liste factures', rows: rows.map(invoiceExportRow) },
    { name: 'Factures payees', rows: rows.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'PAID').map(invoiceExportRow) },
    { name: 'Factures partielles', rows: rows.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'PARTIAL').map(invoiceExportRow) },
    { name: 'Factures non payees', rows: rows.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'UNPAID').map(invoiceExportRow) },
    { name: 'Factures en retard', rows: rows.filter((invoice) => invoiceDisplayStatus(invoice.status, invoice.due_date) === 'OVERDUE').map(invoiceExportRow) },
  ]);
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function periodLabel(month: number, year: number) {
  if (!month || !year) return '-';
  return `${monthName(Number(month))} ${year}`;
}

function monthName(month: number) {
  return ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][month - 1] ?? String(month);
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

function buildInvoiceItems(
  month: string,
  year: string,
  rentAmount: number,
  syndicAmount: number,
  extraLines: Array<{ item_type: string; amount: number }>,
) {
  const period = periodDescription(month, year);
  return [
    ...(Number(rentAmount) > 0 ? [{ item_type: 'Monthly rent', description: `Loyer ${period}`, amount: Number(rentAmount) }] : []),
    ...(Number(syndicAmount) > 0 ? [{ item_type: 'Syndic', description: `Syndic ${period}`, amount: Number(syndicAmount) }] : []),
    ...extraLines
      .filter((line) => Number(line.amount) > 0)
      .map((line) => ({ item_type: line.item_type, description: itemLabel(line.item_type), amount: Number(line.amount) })),
  ];
}

function periodDescription(month: string, year: string) {
  return `${monthName(Number(month)).toLowerCase()} ${year}`;
}
