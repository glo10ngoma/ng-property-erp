import { ArrowLeft, Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportExcel, invoiceDisplayStatus, money, shortDate } from '../api';
import { EmptyState, PageHeader, StatusBadge } from '../components';

type ReportRow = Record<string, unknown>;

type BuildingReportData = {
  building: ReportRow;
  period: { start: string; end: string };
  finances: {
    invoices: number;
    paid_invoices: number;
    partial_invoices: number;
    unpaid_invoices: number;
    overdue_invoices: number;
    total_invoiced: number;
    total_paid: number;
    remaining: number;
  };
  units_total: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_rate: number;
  units: ReportRow[];
  tenant_situations: ReportRow[];
  tenants_paid: ReportRow[];
  tenants_unpaid: ReportRow[];
  payments: ReportRow[];
  paid_invoices: ReportRow[];
  partial_invoices: ReportRow[];
  unpaid_invoices: ReportRow[];
  overdue_invoices: ReportRow[];
};

const months = [
  ['1', 'Janvier'],
  ['2', 'Fevrier'],
  ['3', 'Mars'],
  ['4', 'Avril'],
  ['5', 'Mai'],
  ['6', 'Juin'],
  ['7', 'Juillet'],
  ['8', 'Aout'],
  ['9', 'Septembre'],
  ['10', 'Octobre'],
  ['11', 'Novembre'],
  ['12', 'Decembre'],
];

export function BuildingReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = new Date();
  const [filters, setFilters] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    start: '',
    end: '',
    paymentStatus: '',
    tenantId: '',
    unitId: '',
  });
  const [report, setReport] = useState<BuildingReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (filters.month && filters.year) {
      params.month = filters.month;
      params.year = filters.year;
    } else {
      if (filters.start) params.start = filters.start;
      if (filters.end) params.end = filters.end;
    }
    if (filters.paymentStatus) params.paymentStatus = filters.paymentStatus;
    if (filters.tenantId) params.tenantId = filters.tenantId;
    if (filters.unitId) params.unitId = filters.unitId;
    return params;
  }, [filters]);

  async function loadReport() {
    if (!id) return;
    setLoading(true);
    try {
      const response = await api.get<BuildingReportData>(`/reports/buildings/${id}`, { params: queryParams });
      setReport(response.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [id, queryParams]);

  const tenants = report?.tenant_situations ?? [];
  const units = report?.units ?? [];
  const occupiedUnits = units.filter((unit) => String(unit.status ?? '') === 'OCCUPIED');
  const invoices = [...(report?.paid_invoices ?? []), ...(report?.partial_invoices ?? []), ...(report?.unpaid_invoices ?? [])];
  const exportRows = [...tenants, ...invoices, ...(report?.payments ?? [])];

  return (
    <section>
      <PageHeader
        title="Rapport immeuble"
        action={<button className="secondary" onClick={() => navigate('/buildings')}><ArrowLeft size={16} />Retour</button>}
      />

      <div className="quick-form">
        <select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>
          <option value="">Mois</option>
          {months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" min="2000" max="2100" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} placeholder="Annee" />
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, month: '', start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, month: '', end: event.target.value })} />
        <select value={filters.paymentStatus} onChange={(event) => setFilters({ ...filters, paymentStatus: event.target.value })}>
          <option value="">Statut paiement</option>
          <option value="PAID">Payee</option>
          <option value="PARTIAL">Paiement partiel</option>
          <option value="UNPAID">Non payee</option>
          <option value="OVERDUE">En retard</option>
        </select>
        <select value={filters.tenantId} onChange={(event) => setFilters({ ...filters, tenantId: event.target.value })}>
          <option value="">Tous les locataires</option>
          {tenants.map((tenant) => <option key={String(tenant.id)} value={String(tenant.id)}>{String(tenant.tenant_name ?? '-')}</option>)}
        </select>
        <select value={filters.unitId} onChange={(event) => setFilters({ ...filters, unitId: event.target.value })}>
          <option value="">Toutes les unites</option>
          {units.map((unit) => <option key={String(unit.id)} value={String(unit.id)}>{String(unit.number ?? '-')}</option>)}
        </select>
        <button type="button" onClick={loadReport}><RefreshCw size={16} />Actualiser</button>
        <button type="button" className="secondary" onClick={() => exportCsv('rapport-immeuble.csv', exportRows)}><Download size={16} />CSV</button>
        <button type="button" className="secondary" onClick={() => exportExcel('rapport-immeuble.xls', exportRows)}><FileSpreadsheet size={16} />Excel</button>
        <button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
      </div>

      {!report && <EmptyState message={loading ? 'Chargement...' : 'Aucune donnee.'} />}
      {report && (
        <>
          <div className="detail-list">
            <span>Nom</span><strong>{text(report.building.name)}</strong>
            <span>Type d'immeuble</span><strong>{text(report.building.building_type, 'Residence')}</strong>
            <span>Adresse</span><strong>{text(report.building.address)}</strong>
            <span>Ville</span><strong>{text(report.building.city)}</strong>
            <span>Statut</span><strong>{text(report.building.status, 'Actif')}</strong>
            <span>Periode</span><strong>{shortDate(report.period.start)} - {shortDate(report.period.end)}</strong>
            <span>Total unites</span><strong>{report.units_total}</strong>
            <span>Unites occupees</span><strong>{report.occupied_units}</strong>
            <span>Unites libres</span><strong>{report.vacant_units}</strong>
            <span>Taux occupation</span><strong>{report.occupancy_rate}%</strong>
          </div>

          <div className="mini-stats">
            <div className="mini-stat"><span>Locataires ayant paye</span><strong>{report.tenants_paid.length}</strong></div>
            <div className="mini-stat"><span>Locataires non payeurs</span><strong>{report.tenants_unpaid.length}</strong></div>
            <div className="mini-stat"><span>Factures payees</span><strong>{report.paid_invoices.length}</strong></div>
            <div className="mini-stat"><span>Factures partielles</span><strong>{report.partial_invoices.length}</strong></div>
            <div className="mini-stat"><span>Factures en retard</span><strong>{report.overdue_invoices.length}</strong></div>
            <div className="mini-stat"><span>Total facture</span><strong>{money(report.finances.total_invoiced)}</strong></div>
            <div className="mini-stat"><span>Total encaisse</span><strong>{money(report.finances.total_paid)}</strong></div>
            <div className="mini-stat"><span>Reste a encaisser</span><strong>{money(report.finances.remaining)}</strong></div>
          </div>

          <TenantTable rows={tenants} />
          <UnitTable title="Unites / appartements occupes" rows={occupiedUnits} />
          <InvoiceTable title="Factures de la periode" rows={invoices} />
          <SummaryList title="Locataires ayant paye" rows={report.tenants_paid} />
          <SummaryList title="Locataires n'ayant pas paye" rows={report.tenants_unpaid} />
          <InvoiceTable title="Factures en retard" rows={report.overdue_invoices} />
        </>
      )}
    </section>
  );
}

function TenantTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section">
      <h4>Locataires de cet immeuble</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Locataire</th><th>Telephone</th><th>Unite</th><th>Bail actif</th><th className="right">Loyer</th><th>Devise</th><th>Statut paiement</th><th className="right">Total facture</th><th>Devise</th><th className="right">Total paye</th><th>Devise</th><th className="right">Reste</th><th>Devise</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.tenant_name)}</td>
                <td>{text(row.phone)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{text(row.lease_status)}</td>
                <AmountCell value={row.monthly_rent} />
                <td><StatusBadge value={String(row.payment_status ?? 'UNPAID')} /></td>
                <AmountCell value={row.total_invoiced} />
                <AmountCell value={row.total_paid} />
                <AmountCell value={row.remaining_amount} />
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function UnitTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Unite</th><th>Type</th><th>Statut</th><th className="right">Montant</th><th>Devise</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>{text(row.number)}</td><td>{text(row.type)}</td><td><StatusBadge value={text(row.status)} /></td><AmountCell value={row.monthly_rent} /></tr>)}</tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function InvoiceTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Locataire</th><th>Unite</th><th>Date</th><th>Echeance</th><th>Statut</th><th className="right">Montant</th><th>Devise</th><th className="right">Paye</th><th>Devise</th><th className="right">Reste</th><th>Devise</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.invoice_number)}</td>
                <td>{text(row.tenant_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{date(row.issue_date)}</td>
                <td>{date(row.due_date)}</td>
                <td><StatusBadge value={invoiceDisplayStatus(String(row.status ?? ''), String(row.due_date ?? ''))} /></td>
                <AmountCell value={row.total} />
                <AmountCell value={row.paid_amount} />
                <AmountCell value={row.remaining_amount} />
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function SummaryList({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div className="detail-section">
      <h4>{title}</h4>
      <div className="compact-list">
        {rows.length ? rows.map((row, index) => (
          <div className="compact-item" key={index}>
            <span>{text(row.tenant_name ?? row.invoice_number)}</span>
            <strong>{text(row.unit_number ?? row.status)}</strong>
          </div>
        )) : <span className="empty">Aucune donnee.</span>}
      </div>
    </div>
  );
}

function AmountCell({ value }: { value: unknown }) {
  return <><td className="right">{amount(value)}</td><td>USD</td></>;
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function date(value: unknown) {
  return value ? shortDate(String(value)) : '-';
}

function text(value: unknown, fallback = '-') {
  return value == null || value === '' ? fallback : String(value);
}
