import { BarChart3, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, exportCsv, exportExcel, includesText, money } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../components';
import { useApiList } from '../hooks';

type Building = { id: number; name: string; address: string; city: string; unit_count: number; description?: string; status?: string };
type BuildingReport = {
  building: Record<string, unknown>;
  finances: { invoices: number; paid_invoices: number; unpaid_invoices: number; overdue_invoices: number; total_invoiced: number; total_paid: number; remaining: number };
  units_total: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_rate: number;
  units: Array<Record<string, unknown>>;
  tenant_situations: Array<Record<string, unknown>>;
  tenants_paid: Array<Record<string, unknown>>;
  tenants_unpaid: Array<Record<string, unknown>>;
  paid_invoices: Array<Record<string, unknown>>;
  unpaid_invoices: Array<Record<string, unknown>>;
  overdue_invoices: Array<Record<string, unknown>>;
};

export function Buildings() {
  const { can } = useAuth();
  const { data, reload } = useApiList<Building>('/buildings');
  const [editing, setEditing] = useState<Partial<Building> | null>(null);
  const [reporting, setReporting] = useState<Building | null>(null);
  const [report, setReport] = useState<BuildingReport | null>(null);
  const [filters, setFilters] = useState({ city: '', occupation: '', start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) });
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');

  const cities = Array.from(new Set(data.map((building) => building.city).filter(Boolean)));
  const filtered = data
    .filter((building) => includesText(building, query))
    .filter((building) => !filters.city || building.city === filters.city)
    .filter((building) => !filters.occupation || (filters.occupation === 'WITH_UNITS' ? Number(building.unit_count) > 0 : Number(building.unit_count) === 0));
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  async function save(form: FormData) {
    const payload = Object.fromEntries(form) as Record<string, string>;
    if (editing?.id) await api.put(`/buildings/${editing.id}`, payload);
    else await api.post('/buildings', payload);
    setSuccess(editing?.id ? 'Immeuble modifie avec succes.' : 'Immeuble cree avec succes.');
    setEditing(null);
    reload();
  }

  async function remove(id: number) {
    await api.delete(`/buildings/${id}`);
    setSuccess('Immeuble supprime avec succes.');
    reload();
  }

  async function openReport(building: Building) {
    setReporting(building);
    const response = await api.get<BuildingReport>(`/reports/buildings/${building.id}`, { params: { start: filters.start, end: filters.end } });
    setReport(response.data);
  }

  return (
    <section>
      <PageHeader title="Immeubles" action={can('buildings.create') ? <button onClick={() => setEditing({})}><Plus size={16} />Nouvel immeuble</button> : undefined} />
      <SuccessMessage message={success} />
      <TableToolbar
        query={query}
        onQueryChange={(value) => { setQuery(value); setPage(1); }}
        onExport={() => exportCsv('immeubles.csv', filtered.map(({ id, name, address, city, unit_count }) => ({ id, nom: name, adresse: address, ville: city, appartements: unit_count })))}
      />
      <div className="quick-form">
        <select value={filters.city} onChange={(event) => { setFilters({ ...filters, city: event.target.value }); setPage(1); }}><option value="">Toutes les villes</option>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select>
        <select value={filters.occupation} onChange={(event) => { setFilters({ ...filters, occupation: event.target.value }); setPage(1); }}><option value="">Occupation</option><option value="WITH_UNITS">Avec appartements</option><option value="NO_UNITS">Sans appartement</option></select>
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Adresse</th><th>Ville</th><th className="right">Appartements</th><th>Actions</th></tr></thead>
          <tbody>
            {paged.map((building) => (
              <tr key={building.id} className="clickable-row" onClick={() => openReport(building)}>
                <td>{building.name}</td><td>{building.address}</td><td>{building.city}</td><td className="right">{building.unit_count}</td>
                <td className="actions" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => openReport(building)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Rapport" onClick={() => openReport(building)}><BarChart3 size={16} /></button>
                  {can('buildings.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(building)}><Pencil size={16} /></button>}
                  {can('buildings.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(building.id)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <EmptyState />}
      </div>
      <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={sorted.length} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />

      {editing && (
        <Modal title={editing.id ? 'Modifier immeuble' : 'Nouvel immeuble'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
            <input name="name" placeholder="Nom" defaultValue={editing.name} required />
            <input name="address" placeholder="Adresse" defaultValue={editing.address} required />
            <input name="city" placeholder="Ville" defaultValue={editing.city} required />
            <textarea name="description" placeholder="Description" defaultValue={editing.description} />
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}

      {reporting && (
        <Modal title={`Rapport immeuble - ${reporting.name}`} onClose={() => { setReporting(null); setReport(null); }}>
          <div className="quick-form">
            <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
            <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
            <button type="button" onClick={() => openReport(reporting)}>Actualiser</button>
            {report && <button type="button" className="secondary" onClick={() => exportCsv('rapport-immeuble.csv', [...report.tenant_situations, ...report.paid_invoices, ...report.unpaid_invoices])}>CSV</button>}
            {report && <button type="button" className="secondary" onClick={() => exportExcel('rapport-immeuble.xls', [...report.tenant_situations, ...report.paid_invoices, ...report.unpaid_invoices])}>Excel</button>}
            <button type="button" className="secondary" onClick={() => window.print()}>Imprimer</button>
          </div>
          {report && (
            <>
              <div className="detail-list">
                <span>Nom</span><strong>{String(report.building.name ?? reporting.name)}</strong>
                <span>Adresse</span><strong>{String(report.building.address ?? reporting.address)}</strong>
                <span>Ville</span><strong>{String(report.building.city ?? reporting.city)}</strong>
                <span>Statut</span><strong>{String(report.building.status ?? reporting.status ?? 'Actif')}</strong>
                <span>Total unites</span><strong>{report.units_total}</strong>
                <span>Occupees</span><strong>{report.occupied_units}</strong>
                <span>Libres</span><strong>{report.vacant_units}</strong>
                <span>Taux occupation</span><strong>{report.occupancy_rate}%</strong>
              </div>
              <div className="mini-stats">
                <div className="mini-stat"><span>Locataires payeurs</span><strong>{report.tenants_paid.length}</strong></div>
                <div className="mini-stat"><span>Non payeurs</span><strong>{report.tenants_unpaid.length}</strong></div>
                <div className="mini-stat"><span>Total facture</span><strong>{money(report.finances.total_invoiced)}</strong></div>
                <div className="mini-stat"><span>Total encaisse</span><strong>{money(report.finances.total_paid)}</strong></div>
                <div className="mini-stat"><span>Reste a encaisser</span><strong>{money(report.finances.remaining)}</strong></div>
                <div className="mini-stat"><span>Retards</span><strong>{report.overdue_invoices.length}</strong></div>
              </div>
              <TenantFinancialTable rows={report.tenant_situations} />
              <ReportList title="Locataires ayant paye" rows={report.tenants_paid} />
              <ReportList title="Locataires n'ayant pas paye" rows={report.tenants_unpaid} />
              <ReportList title="Factures payees" rows={report.paid_invoices} />
              <ReportList title="Factures partiellement / non payees" rows={report.unpaid_invoices} />
              <ReportList title="Factures en retard" rows={report.overdue_invoices} />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function TenantFinancialTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="detail-section">
      <h4>Locataires de cet immeuble</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Locataire</th><th>Telephone</th><th>Unite</th><th>Bail actif</th><th className="right">Loyer</th><th>Statut paiement</th><th className="right">Facture</th><th className="right">Paye</th><th className="right">Reste</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{String(row.tenant_name ?? '-')}</td>
                <td>{String(row.phone ?? '-')}</td>
                <td>{String(row.unit_number ?? '-')}</td>
                <td>{String(row.lease_status ?? '-')}</td>
                <td className="right">{money(Number(row.monthly_rent ?? 0))}</td>
                <td>{paymentStatus(String(row.payment_status ?? 'UNPAID'))}</td>
                <td className="right">{money(Number(row.total_invoiced ?? 0))}</td>
                <td className="right">{money(Number(row.total_paid ?? 0))}</td>
                <td className="right">{money(Number(row.remaining_amount ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, pageSize, total, onPage, onPageSize }: { page: number; totalPages: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  return <div className="pagination-bar"><span className="table-meta">{total} ligne(s) affichee(s)</span><div className="actions"><select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select><button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Precedent</button><span className="table-meta">{page} / {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Suivant</button></div></div>;
}

function ReportList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return <div className="detail-section"><h4>{title}</h4><div className="compact-list">{rows.length ? rows.slice(0, 10).map((row, index) => <div className="compact-item" key={index}><span>{String(row.tenant_name ?? row.invoice_number ?? row.number ?? row.id ?? '-')}</span><strong>{formatValue(row)}</strong></div>) : <span className="empty">Aucune donnee.</span>}</div></div>;
}

function formatValue(row: Record<string, unknown>) {
  const amount = row.remaining_amount ?? row.total ?? row.paid_amount ?? row.amount;
  if (typeof amount === 'number' || typeof amount === 'string') return money(Number(amount));
  return String(row.unit_number ?? row.status ?? '');
}

function paymentStatus(value: string) {
  return ({ PAID: 'Payee', PARTIAL: 'Partiel', UNPAID: 'Non payee' } as Record<string, string>)[value] ?? value;
}
