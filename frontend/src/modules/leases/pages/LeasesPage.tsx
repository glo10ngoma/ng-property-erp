import { Download, Eye, FileDown, FilePlus, Pencil, Receipt, ScrollText, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, StatusBadge, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';
import { openOrDownloadDocument } from '../../../core/utils/documentActions';

type Lease = {
  id: number;
  tenant_id: number;
  unit_id: number;
  tenant_name: string;
  building_name: string;
  unit_number: string;
  start_date: string;
  end_date?: string;
  monthly_rent: number;
  rental_guarantee_amount: number;
  rental_guarantee_paid: number;
  rental_guarantee_status: string;
  guarantee_amount?: number;
  guarantee_paid?: number;
  guarantee_status?: string;
  contract_file_name?: string;
  contract_file_url?: string;
  status: string;
};

const emptyFilters = { building: '', unit: '', tenant: '', status: '', guarantee: '', start: '', end: '', contract: '', expiring: '' };

export function LeasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<Lease>('/leases');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const [editing, setEditing] = useState<Lease | null>(null);
  const [success, setSuccess] = useState('');

  const buildingOptions = useMemo(() => Array.from(new Set(data.map((lease) => lease.building_name).filter(Boolean))).sort(), [data]);
  const filtered = data
    .filter((lease) => includesText(lease, query))
    .filter((lease) => !filters.building || lease.building_name === filters.building)
    .filter((lease) => !filters.unit || String(lease.unit_number ?? '').toLowerCase().includes(filters.unit.toLowerCase()))
    .filter((lease) => !filters.tenant || String(lease.tenant_name ?? '').toLowerCase().includes(filters.tenant.toLowerCase()))
    .filter((lease) => !filters.status || lease.status === filters.status)
    .filter((lease) => !filters.guarantee || guaranteeStatus(lease) === filters.guarantee)
    .filter((lease) => !filters.start || String(lease.start_date).slice(0, 10) >= filters.start)
    .filter((lease) => !filters.end || String(lease.end_date ?? lease.start_date).slice(0, 10) <= filters.end)
    .filter((lease) => !filters.contract || (filters.contract === 'PRESENT' ? Boolean(lease.contract_file_name) : !lease.contract_file_name))
    .filter((lease) => !filters.expiring || leaseExpiringSoon(lease));

  const kpis = {
    total: data.length,
    active: data.filter((lease) => lease.status === 'ACTIVE').length,
    expired: data.filter((lease) => lease.status === 'EXPIRED' || leaseExpired(lease)).length,
    terminated: data.filter((lease) => lease.status === 'TERMINATED').length,
    guaranteePaid: data.filter((lease) => guaranteeStatus(lease) === 'PAID').length,
    guaranteeUnpaid: data.filter((lease) => guaranteeStatus(lease) !== 'PAID').length,
    missingContracts: data.filter((lease) => !lease.contract_file_name).length,
  };

  async function saveEdit(form: FormData) {
    if (!editing) return;
    await api.put(`/leases/${editing.id}`, {
      start_date: form.get('start_date'),
      end_date: form.get('end_date') || null,
      monthly_rent: Number(form.get('monthly_rent')),
      rental_guarantee_amount: Number(form.get('rental_guarantee_amount')),
      rental_guarantee_paid: Number(form.get('rental_guarantee_paid')),
      rental_guarantee_status: form.get('rental_guarantee_status'),
      contract_file_name: form.get('contract_file_name') || null,
      status: form.get('status') || 'DRAFT',
    });
    setSuccess('Bail modifie avec succes.');
    setEditing(null);
    reload();
  }

  async function terminate(id: number) {
    if (!window.confirm('Resilier ce bail ?')) return;
    await api.post(`/leases/${id}/terminate`, { reason: 'Resiliation depuis interface' });
    setSuccess('Bail resilie avec succes.');
    reload();
  }

  async function invoice(id: number) {
    const response = await api.post(`/leases/${id}/invoice`);
    setSuccess(`Facture ${response.data.invoice_number} creee depuis le bail.`);
  }

  function exportExcel() {
    exportXlsxWorkbook('Baux_contrats.xlsx', [
      { name: 'Liste baux', rows: filtered.map(leaseExportRow) },
      { name: 'Garanties', rows: filtered.map((lease) => ({ reference: leaseReference(lease), locataire: lease.tenant_name, garantie: amount(guaranteeAmount(lease)), paye: amount(guaranteePaid(lease)), devise: 'USD', statut: statusLabel(guaranteeStatus(lease)) })) },
      { name: 'Contrats absents', rows: filtered.filter((lease) => !lease.contract_file_name).map(leaseExportRow) },
      { name: 'Baux expirant bientot', rows: filtered.filter(leaseExpiringSoon).map(leaseExportRow) },
      { name: 'Baux resilies', rows: filtered.filter((lease) => lease.status === 'TERMINATED').map(leaseExportRow) },
    ]);
  }

  return (
    <section>
      <PageHeader title="Baux & contrats" action={can('documents.upload') ? <button onClick={() => navigate('/leases/new')}><FilePlus size={16} />Creer bail</button> : undefined} />
      <SuccessMessage message={success} />

      <div className="mini-stats">
        <div className="mini-stat"><span>Total baux</span><strong>{kpis.total}</strong></div>
        <div className="mini-stat"><span>Baux actifs</span><strong>{kpis.active}</strong></div>
        <div className="mini-stat"><span>Baux expires</span><strong>{kpis.expired}</strong></div>
        <div className="mini-stat"><span>Baux resilies</span><strong>{kpis.terminated}</strong></div>
        <div className="mini-stat"><span>Garanties payees</span><strong>{kpis.guaranteePaid}</strong></div>
        <div className="mini-stat"><span>Garanties non payees</span><strong>{kpis.guaranteeUnpaid}</strong></div>
        <div className="mini-stat"><span>Sans contrat scanne</span><strong>{kpis.missingContracts}</strong></div>
      </div>

      <div className="quick-form leases-filter-bar">
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={filters.building} onChange={(event) => setFilters({ ...filters, building: event.target.value })}><option value="">Immeuble</option>{buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}</select>
        <input placeholder="Unite" value={filters.unit} onChange={(event) => setFilters({ ...filters, unit: event.target.value })} />
        <input placeholder="Locataire" value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option><option value="EXPIRED">Expire</option></select>
        <select value={filters.guarantee} onChange={(event) => setFilters({ ...filters, guarantee: event.target.value })}><option value="">Garantie</option><option value="PAID">Payee</option><option value="PARTIAL">Partielle</option><option value="NOT_PAID">Non payee</option></select>
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
        <select value={filters.contract} onChange={(event) => setFilters({ ...filters, contract: event.target.value })}><option value="">Contrat</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option></select>
        <select value={filters.expiring} onChange={(event) => setFilters({ ...filters, expiring: event.target.value })}><option value="">Echeance</option><option value="SOON">Expire bientot</option></select>
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => { setQuery(''); setFilters(emptyFilters); }}>Reinitialiser</button>
          <button type="button" className="secondary" onClick={() => exportCsv('baux.csv', filtered)}><Download size={16} />CSV</button>
          <button type="button" className="secondary" onClick={exportExcel}><FileDown size={16} />Exporter</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Reference bail</th><th>Locataire</th><th>Immeuble</th><th>Unite</th><th>Debut</th><th>Fin</th><th>Duree</th><th className="right">Loyer</th><th>Devise</th><th className="right">Garantie</th><th className="right">Paye</th><th>Devise</th><th>Contrat</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map((lease) => (
              <tr key={lease.id} className="clickable-row" onClick={() => navigate(`/leases/${lease.id}`)}>
                <td>{leaseReference(lease)}</td>
                <td>{lease.tenant_name}</td>
                <td>{lease.building_name}</td>
                <td>{lease.unit_number}</td>
                <td>{shortDate(lease.start_date)}</td>
                <td>{lease.end_date ? shortDate(lease.end_date) : '-'}</td>
                <td>{leaseDurationLabel(lease)}</td>
                <td className="right">{amount(lease.monthly_rent)}</td>
                <td>USD</td>
                <td className="right">{amount(guaranteeAmount(lease))}</td>
                <td className="right">{amount(guaranteePaid(lease))}</td>
                <td>USD</td>
                <td><span className={lease.contract_file_name ? 'badge active' : 'badge'}>{lease.contract_file_name ? 'Present' : 'Absent'}</span></td>
                <td><StatusBadge value={leaseDeadlineStatus(lease)} /></td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/leases/${lease.id}`)}><Eye size={16} /></button>
                  {can('documents.upload') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(lease)}><Pencil size={16} /></button>}
                  {can('documents.upload') && lease.status === 'ACTIVE' && <button className="icon-btn danger" title="Resilier" onClick={() => terminate(lease.id)}><Trash2 size={16} /></button>}
                  {can('invoices.create') && <button className="icon-btn" title="Facturer" onClick={() => invoice(lease.id)}><Receipt size={16} /></button>}
                  {lease.contract_file_name && <button className="icon-btn" title="Telecharger contrat" onClick={() => downloadContract(lease)}><ScrollText size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>

      {editing && (
        <Modal title="Modifier bail" onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); saveEdit(new FormData(event.currentTarget)); }}>
            <input name="start_date" type="date" required defaultValue={editing.start_date?.slice(0, 10)} />
            <input name="end_date" type="date" defaultValue={editing.end_date?.slice(0, 10)} />
            <input name="monthly_rent" type="number" placeholder="Loyer mensuel" required defaultValue={editing.monthly_rent} />
            <input name="rental_guarantee_amount" type="number" placeholder="Garantie locative" defaultValue={guaranteeAmount(editing)} />
            <input name="rental_guarantee_paid" type="number" placeholder="Garantie payee" defaultValue={guaranteePaid(editing)} />
            <select name="rental_guarantee_status" defaultValue={guaranteeStatus(editing)}><option value="NOT_PAID">Non payee</option><option value="PARTIAL">Paiement partiel</option><option value="PAID">Payee</option></select>
            <input name="contract_file_name" placeholder="Nom document contrat" defaultValue={editing.contract_file_name ?? ''} />
            <select name="status" defaultValue={editing.status ?? 'DRAFT'}><option value="DRAFT">Brouillon</option><option value="ACTIVE">Actif</option><option value="TERMINATED">Resilie</option></select>
            <button>Enregistrer</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function leaseReference(lease: Lease) {
  return `B-${String(lease.id).padStart(4, '0')}`;
}

function guaranteeStatus(lease: Lease) {
  return String(lease.guarantee_status ?? lease.rental_guarantee_status ?? 'NOT_PAID');
}

function guaranteeAmount(lease: Lease) {
  return Number(lease.guarantee_amount ?? lease.rental_guarantee_amount ?? 0);
}

function guaranteePaid(lease: Lease) {
  return Number(lease.guarantee_paid ?? lease.rental_guarantee_paid ?? 0);
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function leaseExpired(lease: Lease) {
  return Boolean(lease.end_date && new Date(lease.end_date).getTime() < startOfToday());
}

function leaseExpiringSoon(lease: Lease) {
  if (!lease.end_date || lease.status !== 'ACTIVE') return false;
  const days = daysUntil(lease.end_date);
  return days >= 0 && days <= 60;
}

function leaseDeadlineStatus(lease: Lease) {
  if (lease.status === 'TERMINATED') return 'Resilie';
  if (leaseExpired(lease) || lease.status === 'EXPIRED') return 'Expire';
  if (leaseExpiringSoon(lease)) return 'Expire bientot';
  return statusLabel(lease.status);
}

function leaseDurationLabel(lease: Lease) {
  if (!lease.start_date || !lease.end_date) return '-';
  const start = new Date(lease.start_date);
  const end = new Date(lease.end_date);
  const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
  return `${months} mois`;
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - startOfToday()) / 86400000);
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function leaseExportRow(lease: Lease) {
  return {
    reference: leaseReference(lease),
    locataire: lease.tenant_name,
    immeuble: lease.building_name,
    unite: lease.unit_number,
    debut: shortDate(lease.start_date),
    fin: lease.end_date ? shortDate(lease.end_date) : '',
    duree: leaseDurationLabel(lease),
    loyer: amount(lease.monthly_rent),
    devise: 'USD',
    garantie: amount(guaranteeAmount(lease)),
    paye: amount(guaranteePaid(lease)),
    contrat: lease.contract_file_name ? 'Present' : 'Absent',
    statut: leaseDeadlineStatus(lease),
  };
}

function downloadContract(lease: Lease) {
  openOrDownloadDocument({
    fileName: lease.contract_file_name,
    fileUrl: lease.contract_file_url,
    title: 'Contrat de bail',
    context: `Bail ${leaseReference(lease)}`,
  });
}
