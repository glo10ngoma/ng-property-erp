import { ArrowLeft, Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, invoiceDisplayStatus, money, shortDate } from '../api';
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
  const [success, setSuccess] = useState('');

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

  async function sendReminder(row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') {
    const invoiceId = Number(row.invoice_id ?? row.id);
    if (!invoiceId) return;
    const label = channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp';
    if (!window.confirm(`Envoyer une relance ${label} pour la facture ${text(row.invoice_number)} ?`)) return;
    await api.post(`/reports/invoices/${invoiceId}/remind`, { channel });
    setSuccess(`Relance ${label} envoyée.`);
    await loadReport();
  }

  useEffect(() => {
    loadReport();
  }, [id, queryParams]);

  const tenants = report?.tenant_situations ?? [];
  const units = report?.units ?? [];
  const occupiedUnits = units.filter((unit) => String(unit.status ?? '') === 'OCCUPIED');
  const invoices = [...(report?.paid_invoices ?? []), ...(report?.partial_invoices ?? []), ...(report?.unpaid_invoices ?? [])];
  const exportData = report ? buildReportExport(report, tenants, occupiedUnits, invoices) : null;

  return (
    <section>
      <PageHeader
        title="Rapport immeuble"
        action={(
          <div className="actions">
            <button className="secondary" onClick={() => navigate('/buildings')}><ArrowLeft size={16} />Retour</button>
            <button type="button" className="secondary" onClick={() => exportData && exportReportCsv('rapport-immeuble.csv', exportData)}><Download size={16} />CSV</button>
            <button type="button" className="secondary" onClick={() => exportData && exportReportExcel('rapport-immeuble.xls', exportData)}><FileSpreadsheet size={16} />Excel</button>
            <button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          </div>
        )}
      />
      {success && <div className="success-message">{success}</div>}

      {report && (
        <section className="detail-section report-section">
          <h4>Informations immeuble</h4>
          <div className="summary-band">
            <SummaryCard label="Nom immeuble" value={text(report.building.name)} />
            <SummaryCard label="Type" value={text(report.building.building_type, 'Residence')} />
            <SummaryCard label="Ville" value={text(report.building.city)} />
            <SummaryCard label="Statut" value={text(report.building.status, 'Actif')} />
            <SummaryCard label="Unites" value={report.units_total} />
            <SummaryCard label="Occupees" value={report.occupied_units} />
            <SummaryCard label="Libres" value={report.vacant_units} />
            <SummaryCard label="Occupation" value={`${report.occupancy_rate}%`} />
            <SummaryCard label="Periode" value={`${shortDate(report.period.start)} - ${shortDate(report.period.end)}`} wide />
            <SummaryCard label="Adresse" value={text(report.building.address)} wide />
          </div>
        </section>
      )}

      <section className="detail-section report-section">
        <h4>Filtres</h4>
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
      </div>
      </section>

      {!report && <EmptyState message={loading ? 'Chargement...' : 'Aucune donnee.'} />}
      {report && (
        <>
          <section className="detail-section report-section">
          <h4>Resume financier</h4>
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
          </section>

          <TenantTable rows={tenants} />
          <UnitTable title="Unites / appartements occupes" rows={occupiedUnits} />
          <InvoiceTable title="Factures de la periode" rows={invoices} />
          <TenantContactTable title="Locataires ayant payé" rows={report.tenants_paid} />
          <TenantContactTable title="Locataires n'ayant pas payé" rows={report.tenants_unpaid} onRemind={sendReminder} />
          <InvoiceTable title="Factures en retard" rows={report.overdue_invoices} onRemind={sendReminder} />
        </>
      )}
    </section>
  );
}

function SummaryCard({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={wide ? 'summary-item summary-item-wide' : 'summary-item'}><span>{label}</span><strong>{String(value ?? '-')}</strong></div>;
}

function TenantTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Locataires de cet immeuble</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Locataire</th><th>Telephone</th><th>Unite</th><th>Bail actif</th><th className="right">Loyer</th><th>Statut paiement</th><th className="right">Total facture</th><th className="right">Total paye</th><th className="right">Reste</th><th>Devise</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.tenant_name)}</td>
                <td>{text(row.phone)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{text(row.lease_status)}</td>
                <td className="right">{amount(row.monthly_rent)}</td>
                <td><StatusBadge value={String(row.payment_status ?? 'UNPAID')} /></td>
                <td className="right">{amount(row.total_invoiced)}</td>
                <td className="right">{amount(row.total_paid)}</td>
                <td className="right">{amount(row.remaining_amount)}</td>
                <td>USD</td>
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
    <div className="detail-section report-section">
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

function InvoiceTable({ title, rows, onRemind }: { title: string; rows: ReportRow[]; onRemind?: (row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') => void }) {
  return (
    <div className="detail-section report-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Locataire</th><th>Téléphone</th><th>Email</th><th>Unite</th><th>Periode</th><th>Date</th><th>Echeance</th><th>Statut</th><th className="right">Montant</th><th className="right">Paye</th><th className="right">Reste</th><th>Devise</th><th>Dernière relance</th><th className="right">Relances</th>{onRemind && <th>Action</th>}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.invoice_number)}</td>
                <td>{text(row.tenant_name)}</td>
                <td>{text(row.phone)}</td>
                <td>{text(row.email)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{periodText(row.month, row.year)}</td>
                <td>{date(row.issue_date)}</td>
                <td>{date(row.due_date)}</td>
                <td><StatusBadge value={invoiceDisplayStatus(String(row.status ?? ''), String(row.due_date ?? ''))} /></td>
                <td className="right">{amount(row.total)}</td>
                <td className="right">{amount(row.paid_amount)}</td>
                <td className="right">{amount(row.remaining_amount)}</td>
                <td>USD</td>
                <td>{reminderDate(row.last_reminder_at)}</td>
                <td className="right">{Number(row.reminder_count ?? 0)}</td>
                {onRemind && <td><ReminderActions row={row} onRemind={onRemind} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function TenantContactTable({ title, rows, onRemind }: { title: string; rows: ReportRow[]; onRemind?: (row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') => void }) {
  return (
    <div className="detail-section report-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Locataire</th><th>Téléphone</th><th>Email</th><th>Unité</th><th>Facture</th><th className="right">Reste</th><th>Devise</th><th>Dernière relance</th><th className="right">Relances</th>{onRemind && <th>Action</th>}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.tenant_name)}</td>
                <td>{text(row.phone)}</td>
                <td>{text(row.email)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{text(row.invoice_number)}</td>
                <td className="right">{row.remaining_amount == null ? '-' : amount(row.remaining_amount)}</td>
                <td>{row.remaining_amount == null ? '-' : 'USD'}</td>
                <td>{reminderDate(row.last_reminder_at)}</td>
                <td className="right">{Number(row.reminder_count ?? 0)}</td>
                {onRemind && <td><ReminderActions row={row} onRemind={onRemind} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </div>
  );
}

function ReminderActions({ row, onRemind }: { row: ReportRow; onRemind: (row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') => void }) {
  return (
    <div className="reminder-actions">
      <button type="button" className="secondary" onClick={() => onRemind(row, 'EMAIL')}>Email</button>
      <button type="button" className="secondary" onClick={() => onRemind(row, 'SMS')}>SMS</button>
      <button type="button" className="secondary" onClick={() => onRemind(row, 'WHATSAPP')}>WhatsApp</button>
    </div>
  );
}

function AmountCell({ value }: { value: unknown }) {
  return <><td className="right">{amount(value)}</td><td>USD</td></>;
}

type ExportSheet = { name: string; rows: ReportRow[] };

function buildReportExport(report: BuildingReportData, tenants: ReportRow[], occupiedUnits: ReportRow[], invoices: ReportRow[]): ExportSheet[] {
  return [
    {
      name: 'Résumé financier',
      rows: [
        { indicateur: 'Période', valeur: `${date(report.period.start)} - ${date(report.period.end)}` },
        { indicateur: 'Immeuble', valeur: text(report.building.name) },
        { indicateur: 'Unités totales', valeur: report.units_total },
        { indicateur: 'Unités occupées', valeur: report.occupied_units },
        { indicateur: 'Unités libres', valeur: report.vacant_units },
        { indicateur: 'Taux occupation', valeur: `${report.occupancy_rate}%` },
        { indicateur: 'Factures période', valeur: report.finances.invoices },
        { indicateur: 'Factures payées', valeur: report.finances.paid_invoices },
        { indicateur: 'Factures partielles', valeur: report.finances.partial_invoices },
        { indicateur: 'Factures non payées', valeur: report.finances.unpaid_invoices },
        { indicateur: 'Factures en retard', valeur: report.finances.overdue_invoices },
        { indicateur: 'Total facturé', montant: report.finances.total_invoiced, devise: 'USD' },
        { indicateur: 'Total encaissé', montant: report.finances.total_paid, devise: 'USD' },
        { indicateur: 'Reste à encaisser', montant: report.finances.remaining, devise: 'USD' },
      ],
    },
    { name: 'Locataires', rows: tenants.map(tenantExportRow) },
    { name: 'Unités occupées', rows: occupiedUnits.map(unitExportRow) },
    { name: 'Factures période', rows: invoices.map(invoiceExportRow) },
    { name: 'Locataires payés', rows: report.tenants_paid.map(simpleTenantExportRow) },
    { name: 'Locataires non payés', rows: report.tenants_unpaid.map(simpleTenantExportRow) },
    { name: 'Factures en retard', rows: report.overdue_invoices.map(invoiceExportRow) },
  ];
}

function tenantExportRow(row: ReportRow) {
  return {
    locataire: text(row.tenant_name),
    telephone: text(row.phone),
    unite: text(row.unit_number),
    bail_actif: text(row.lease_status),
    loyer: amount(row.monthly_rent),
    statut_paiement: text(row.payment_status),
    total_facture: amount(row.total_invoiced),
    total_paye: amount(row.total_paid),
    reste: amount(row.remaining_amount),
    devise: 'USD',
  };
}

function unitExportRow(row: ReportRow) {
  return {
    unite: text(row.number),
    type: text(row.type),
    statut: text(row.status),
    montant: amount(row.monthly_rent),
    devise: 'USD',
  };
}

function invoiceExportRow(row: ReportRow) {
  return {
    facture: text(row.invoice_number),
    locataire: text(row.tenant_name),
    telephone: text(row.phone),
    email: text(row.email),
    unite: text(row.unit_number),
    periode: periodText(row.month, row.year),
    date_facture: date(row.issue_date),
    echeance: date(row.due_date),
    statut: invoiceDisplayStatus(String(row.status ?? ''), String(row.due_date ?? '')),
    montant: amount(row.total),
    paye: amount(row.paid_amount),
    reste: amount(row.remaining_amount),
    devise: 'USD',
    derniere_relance: reminderDate(row.last_reminder_at),
    nombre_relances: Number(row.reminder_count ?? 0),
  };
}

function simpleTenantExportRow(row: ReportRow) {
  return {
    locataire: text(row.tenant_name),
    telephone: text(row.phone),
    email: text(row.email),
    unite: text(row.unit_number),
    facture: text(row.invoice_number),
    reste: row.remaining_amount == null ? '' : amount(row.remaining_amount),
    devise: row.remaining_amount == null ? '' : 'USD',
    derniere_relance: reminderDate(row.last_reminder_at),
    nombre_relances: Number(row.reminder_count ?? 0),
  };
}

function exportReportExcel(filename: string, sheets: ExportSheet[]) {
  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 ${sheets.map(sheetToXml).join('')}
</Workbook>`;
  downloadBlob(filename.endsWith('.xls') ? filename : `${filename}.xls`, new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' }));
}

function sheetToXml(sheet: ExportSheet) {
  const rows = sheet.rows.length ? sheet.rows : [{ Information: 'Aucune donnée' }];
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  return `<Worksheet ss:Name="${xml(sheet.name.slice(0, 31))}"><Table>
    <Row>${headers.map((header) => `<Cell><Data ss:Type="String">${xml(header)}</Data></Cell>`).join('')}</Row>
    ${rows.map((row) => `<Row>${headers.map((header) => `<Cell><Data ss:Type="String">${xml(row[header])}</Data></Cell>`).join('')}</Row>`).join('')}
  </Table></Worksheet>`;
}

function exportReportCsv(filename: string, sheets: ExportSheet[]) {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = sheets.flatMap((sheet) => {
    const rows = sheet.rows.length ? sheet.rows : [{ Information: 'Aucune donnée' }];
    const headers = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    return [
      escape(sheet.name),
      headers.map(escape).join(';'),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(';')),
      '',
    ];
  });
  downloadBlob(filename, new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function xml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function date(value: unknown) {
  return value ? shortDate(String(value)) : '-';
}

function reminderDate(value: unknown) {
  return value ? shortDate(String(value)) : 'Jamais relancé';
}

function periodText(month: unknown, year: unknown) {
  if (!month || !year) return '-';
  return `${monthName(Number(month))} ${year}`;
}

function monthName(month: number) {
  return ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][month - 1] ?? String(month);
}

function text(value: unknown, fallback = '-') {
  return value == null || value === '' ? fallback : String(value);
}
