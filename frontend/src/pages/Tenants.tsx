import { BarChart3, Eye, FilePlus, Pencil, Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportExcel, includesText, invoiceDisplayStatus, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, StatusBadge, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Tenant = {
  id: number; first_name: string; last_name: string; post_name?: string; phone: string; secondary_phone?: string; email?: string;
  profession?: string; address?: string; id_number?: string; id_document_file_name?: string; nationality?: string; emergency_contact_name?: string; emergency_contact_phone?: string; notes?: string;
  unit_id?: number; unit_number?: string; building_name?: string; monthly_rent?: number; move_in_date?: string; created_at?: string; status: string;
};
type TenantDetail = Tenant & {
  situation: string;
  financial: { total_invoiced: number; total_paid: number; remaining: number; invoices: number; paid_invoices: number; unpaid_invoices: number; overdue_invoices: number };
  invoices: Array<{ id: number; invoice_number: string; total: number; paid_amount: number; remaining_amount: number; due_date: string; status: string }>;
  payments: Array<{ id: number; invoice_number: string; payment_date: string; amount: number; payment_method: string; reference?: string }>;
};
type TenantReport = {
  leases: Array<Record<string, unknown>>;
  guarantees: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  paid: Array<Record<string, unknown>>;
  partial: Array<Record<string, unknown>>;
  unpaid: Array<Record<string, unknown>>;
  overdue: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  total_invoiced: number;
  total_paid: number;
  remaining: number;
};

const countryOptions = [
  'Republique democratique du Congo', 'Congo', 'Angola', 'Burundi', 'Rwanda', 'Ouganda', 'Tanzanie', 'Zambie',
  'Afrique du Sud', 'Cameroun', 'Cote d Ivoire', 'Senegal', 'Mali', 'France', 'Belgique', 'Canada', 'Etats-Unis',
].map((country) => ({ value: country, label: country }));

export function Tenants() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Tenant>('/tenants');
  const [editing, setEditing] = useState<Partial<Tenant> | null>(null);
  const [nationality, setNationality] = useState<string | null>(null);
  const [identityFileName, setIdentityFileName] = useState('');
  const [viewing, setViewing] = useState<TenantDetail | null>(null);
  const [situation, setSituation] = useState<Tenant | null>(null);
  const [tenantReport, setTenantReport] = useState<TenantReport | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ status: '', building: '', unit: '', start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) });
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const buildings = Array.from(new Set(data.map((tenant) => tenant.building_name).filter(Boolean)));
  const filtered = data
    .filter((tenant) => includesText(tenant, query))
    .filter((tenant) => !filters.status || tenant.status === filters.status)
    .filter((tenant) => !filters.building || tenant.building_name === filters.building)
    .filter((tenant) => !filters.unit || (tenant.unit_number ?? '').toLowerCase().includes(filters.unit.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));

  async function save(form: FormData) {
    const payload = {
      first_name: form.get('first_name'),
      last_name: form.get('last_name'),
      post_name: form.get('post_name') || null,
      phone: form.get('phone'),
      secondary_phone: form.get('secondary_phone') || null,
      email: form.get('email') || null,
      profession: form.get('profession') || null,
      address: form.get('address') || null,
      id_number: form.get('id_number') || null,
      id_document_file_name: identityFileName || null,
      id_document_file_url: null,
      nationality,
      emergency_contact_name: form.get('emergency_contact_name') || null,
      emergency_contact_phone: form.get('emergency_contact_phone') || null,
      notes: form.get('notes') || null,
      status: form.get('status') || 'ACTIVE',
    };
    if (editing?.id) await api.put(`/tenants/${editing.id}`, payload);
    else await api.post('/tenants', payload);
    setSuccess(editing?.id ? 'Locataire modifie avec succes.' : 'Locataire cree avec succes.');
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
      items: [{ description: 'Loyer mensuel', amount: Number(tenant.monthly_rent ?? 0) }],
    });
    navigate(`/invoices/${response.data.id}`);
  }

  async function openDetail(tenant: Tenant) {
    const response = await api.get<TenantDetail>(`/tenants/${tenant.id}`);
    setViewing(response.data);
  }

  async function openSituation(tenant: Tenant) {
    navigate(`/tenants/${tenant.id}/situation`);
  }

  return (
    <section>
      <PageHeader title="Locataires" action={can('tenants.create') ? <button onClick={() => { setNationality(null); setIdentityFileName(''); setEditing({}); }}><Plus size={16} />Nouveau locataire</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={(value) => { setQuery(value); }}
        onExport={() => exportCsv('locataires.csv', filtered.map((tenant) => ({
          nom: `${tenant.first_name} ${tenant.last_name}`,
          postnom: tenant.post_name ?? '',
          telephone: tenant.phone,
          telephone_secondaire: tenant.secondary_phone ?? '',
          email: tenant.email ?? '',
          profession: tenant.profession ?? '',
          immeuble: tenant.building_name,
          appartement: tenant.unit_number,
          loyer: tenant.monthly_rent,
          statut: tenant.status,
        })))}
      />
      <div className="quick-form">
        <select value={filters.status} onChange={(event) => { setFilters({ ...filters, status: event.target.value }); }}><option value="">Tous les statuts</option><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select>
        <select value={filters.building} onChange={(event) => { setFilters({ ...filters, building: event.target.value }); }}><option value="">Tous les immeubles</option>{buildings.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <input value={filters.unit} onChange={(event) => { setFilters({ ...filters, unit: event.target.value }); }} placeholder="Appartement" />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Telephone</th><th>Appartement</th><th>Immeuble</th><th className="right">Montant</th><th>Devise</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>
            {sorted.map((tenant) => (
              <tr key={tenant.id} className="clickable-row" onClick={() => openSituation(tenant)}>
                <td>{tenant.first_name} {tenant.last_name}{tenant.post_name ? ` ${tenant.post_name}` : ''}</td><td>{tenant.phone}</td><td>{tenant.unit_number ?? '-'}</td><td>{tenant.building_name ?? '-'}</td><td className="right">{amount(tenant.monthly_rent)}</td><td>USD</td><td><StatusBadge value={tenant.status} /></td>
                <td className="actions" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => openSituation(tenant)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Situation" onClick={() => openSituation(tenant)}><BarChart3 size={16} /></button>
                  {can('tenants.update') && <button className="icon-btn" title="Modifier" onClick={() => { setNationality(tenant.nationality ?? null); setIdentityFileName(tenant.id_document_file_name ?? ''); setEditing(tenant); }}><Pencil size={16} /></button>}
                  {can('invoices.create') && <button className="icon-btn" title="Creer une facture" onClick={() => createInvoice(tenant)}><FilePlus size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <EmptyState />}
      </div>
      <div className="pagination-bar"><span className="table-meta">{sorted.length} ligne(s) affichee(s)</span></div>

      {editing && (
        <Modal title={editing.id ? 'Modifier le locataire' : 'Nouveau locataire'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
            <div className="lease-section-grid">
              <label>Prenom<input name="first_name" defaultValue={editing.first_name} required /></label>
              <label>Nom<input name="last_name" defaultValue={editing.last_name} required /></label>
              <label>Post-nom<input name="post_name" defaultValue={editing.post_name} /></label>
              <label>Statut<select name="status" defaultValue={editing.status ?? 'ACTIVE'} required><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
              <label>Telephone<input name="phone" defaultValue={editing.phone} required /></label>
              <label>Telephone secondaire<input name="secondary_phone" defaultValue={editing.secondary_phone} /></label>
              <label>Email<input name="email" placeholder="Optionnel" type="email" defaultValue={editing.email} /></label>
              <label>Profession<input name="profession" defaultValue={editing.profession} /></label>
              <label className="lease-field-wide">Adresse<input name="address" defaultValue={editing.address} /></label>
              <label>Piece d'identite / numero ID<input name="id_number" defaultValue={editing.id_number} /></label>
              <label>Nationalite<SearchableSelect options={countryOptions} value={nationality} onChange={(value) => setNationality(value ? String(value) : null)} placeholder="Rechercher un pays" emptyMessage="Aucun pays trouve" /></label>
              <label className="lease-field-wide">Piece jointe identite<input type="file" accept="application/pdf,image/*" onChange={(event) => setIdentityFileName(event.target.files?.[0]?.name ?? '')} /></label>
              <label>Nom fichier identite<input value={identityFileName} onChange={(event) => setIdentityFileName(event.target.value)} placeholder="piece-identite.pdf" /></label>
              <label>Contact d'urgence<input name="emergency_contact_name" defaultValue={editing.emergency_contact_name} /></label>
              <label>Telephone contact d'urgence<input name="emergency_contact_phone" defaultValue={editing.emergency_contact_phone} /></label>
              <label className="lease-field-full">Observations<textarea name="notes" defaultValue={editing.notes} /></label>
            </div>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title="Detail locataire" onClose={() => setViewing(null)}>
          <div className="detail-list">
            <span>Nom</span><strong>{viewing.first_name} {viewing.last_name}{viewing.post_name ? ` ${viewing.post_name}` : ''}</strong>
            <span>Telephone</span><strong>{viewing.phone}</strong>
            <span>Telephone secondaire</span><strong>{viewing.secondary_phone || '-'}</strong>
            <span>Email</span><strong>{viewing.email || '-'}</strong>
            <span>Profession</span><strong>{viewing.profession || '-'}</strong>
            <span>Appartement</span><strong>{viewing.unit_number ?? '-'}</strong>
            <span>Immeuble</span><strong>{viewing.building_name ?? '-'}</strong>
            <span>Loyer mensuel</span><strong>{money(viewing.monthly_rent)}</strong>
            <span>Date d'entree dans le systeme</span><strong>{viewing.move_in_date ? shortDate(viewing.move_in_date) : shortDate(String(viewing.created_at ?? new Date().toISOString()))}</strong>
            <span>Situation actuelle</span><strong>{viewing.situation}</strong>
          </div>
          <div className="detail-section">
            <h4>Situation financiere</h4>
            <div className="mini-stats">
              <div className="mini-stat"><span>Total facture</span><strong>{money(viewing.financial.total_invoiced)}</strong></div>
              <div className="mini-stat"><span>Total paye</span><strong>{money(viewing.financial.total_paid)}</strong></div>
              <div className="mini-stat"><span>Solde restant</span><strong>{money(viewing.financial.remaining)}</strong></div>
              <div className="mini-stat"><span>Retards</span><strong>{viewing.financial.overdue_invoices}</strong></div>
            </div>
          </div>
          <ReportList title="Historique factures" rows={viewing.invoices} />
          <ReportList title="Historique paiements" rows={viewing.payments} />
        </Modal>
      )}

      {situation && (
        <Modal title={`Situation locataire - ${situation.first_name} ${situation.last_name}`} onClose={() => { setSituation(null); setTenantReport(null); }}>
          <div className="quick-form">
            <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
            <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
            <button type="button" onClick={() => openSituation(situation)}>Actualiser</button>
          </div>
          {tenantReport && (
            <>
              <div className="detail-list">
                <span>Nom</span><strong>{situation.first_name} {situation.last_name}</strong>
                <span>Telephone</span><strong>{situation.phone}</strong>
                <span>Email</span><strong>{situation.email ?? '-'}</strong>
                <span>Statut</span><strong>{situation.status}</strong>
              </div>
              <div className="mini-stats">
                <div className="mini-stat"><span>Total facture</span><strong>{money(tenantReport.total_invoiced)}</strong></div>
                <div className="mini-stat"><span>Total paye</span><strong>{money(tenantReport.total_paid)}</strong></div>
                <div className="mini-stat"><span>Solde restant</span><strong>{money(tenantReport.remaining)}</strong></div>
                <div className="mini-stat"><span>Retards</span><strong>{tenantReport.overdue.length}</strong></div>
              </div>
              <div className="actions detail-section">
                <button className="secondary" onClick={() => exportCsv('situation-locataire.csv', [...tenantReport.leases, ...tenantReport.invoices, ...tenantReport.payments])}>CSV</button>
                <button className="secondary" onClick={() => exportExcel('situation-locataire.xls', [...tenantReport.leases, ...tenantReport.invoices, ...tenantReport.payments])}>Excel</button>
              </div>
              <ReportList title="Appartements / baux" rows={tenantReport.leases} />
              <ReportList title="Garanties locatives" rows={tenantReport.guarantees} />
              <ReportList title="Factures payees" rows={tenantReport.paid} />
              <ReportList title="Factures partiellement payees" rows={tenantReport.partial} />
              <ReportList title="Factures non payees" rows={tenantReport.unpaid} />
              <ReportList title="Factures en retard" rows={tenantReport.overdue} />
              <ReportList title="Paiements" rows={tenantReport.payments} />
              <ReportList title="Documents / contrats" rows={tenantReport.documents} />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function Pagination({ page, totalPages, pageSize, total, onPage, onPageSize }: { page: number; totalPages: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  return <div className="pagination-bar"><span className="table-meta">{total} ligne(s) affichee(s)</span><div className="actions"><select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select><button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Precedent</button><span className="table-meta">{page} / {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Suivant</button></div></div>;
}

function ReportList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      <div className="compact-list">
        {rows.length ? rows.slice(0, 10).map((row, index) => (
          <div className="compact-item" key={index}>
            <span>{String(row.invoice_number ?? row.building_name ?? row.file_name ?? row.payment_method ?? row.tenant_name ?? row.id ?? '-')}</span>
            <strong>{formatReportValue(row)}</strong>
          </div>
        )) : <span className="empty">Aucune donnee.</span>}
      </div>
    </div>
  );
}

function formatReportValue(row: Record<string, unknown>) {
  const amount = row.remaining_amount ?? row.amount ?? row.total ?? row.paid_amount;
  if (typeof amount === 'number' || typeof amount === 'string') return money(Number(amount));
  return String(row.unit_number ?? row.status ?? row.document_type ?? '');
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
