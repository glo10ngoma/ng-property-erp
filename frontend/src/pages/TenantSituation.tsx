import { ArrowLeft, CreditCard, Download, Eye, FilePlus, FileSpreadsheet, FileText, Printer, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, invoiceDisplayStatus, money, paymentMethodLabel, shortDate } from '../api';
import { EmptyState, PageHeader, StatusBadge } from '../components';
import { useAuth } from '../core/auth/AuthContext';

type ReportRow = Record<string, unknown>;

type TenantReportData = {
  tenant: ReportRow;
  period: { start: string; end: string };
  leases: ReportRow[];
  active_leases: ReportRow[];
  old_leases: ReportRow[];
  guarantees: ReportRow[];
  invoices: ReportRow[];
  paid: ReportRow[];
  partial: ReportRow[];
  unpaid: ReportRow[];
  overdue: ReportRow[];
  payments: ReportRow[];
  documents: ReportRow[];
  total_invoiced: number;
  total_rent_invoiced: number;
  total_syndic_invoiced: number;
  total_paid: number;
  remaining: number;
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

export function TenantSituation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const now = new Date();
  const [filters, setFilters] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    start: '',
    end: '',
    invoiceStatus: '',
    buildingId: '',
    unitId: '',
    leaseId: '',
  });
  const [report, setReport] = useState<TenantReportData | null>(null);
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
    if (filters.invoiceStatus) params.invoiceStatus = filters.invoiceStatus;
    if (filters.buildingId) params.buildingId = filters.buildingId;
    if (filters.unitId) params.unitId = filters.unitId;
    if (filters.leaseId) params.leaseId = filters.leaseId;
    return params;
  }, [filters]);

  async function loadReport() {
    if (!id) return;
    setLoading(true);
    try {
      const response = await api.get<TenantReportData>(`/reports/tenants/${id}`, { params: queryParams });
      setReport(response.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [id, queryParams]);

  const leases = report?.leases ?? [];
  const buildings = uniqueOptions(leases, 'building_name', 'building_id');
  const units = uniqueOptions(leases, 'unit_number', 'unit_id');
  const exportRows = report ? [...report.leases, ...report.guarantees, ...report.invoices, ...report.payments, ...report.documents] : [];
  const tenantLabel = report ? tenantDisplayName(report.tenant) : '';
  const rentedUnitsCount = report ? new Set(report.leases.map((lease) => String(lease.unit_id ?? lease.unit_number ?? '')).filter(Boolean)).size : 0;
  const totalGuarantee = report ? totalGuaranteeAmount(report.leases) : 0;
  const totalLeases = report ? totalLeaseAmount(report.leases) : 0;
  const synthesis = report ? tenantSynthesis(report) : null;

  async function sendReminder(row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') {
    const invoiceId = Number(row.id ?? row.invoice_id);
    if (!invoiceId) return;
    const label = channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp';
    if (!window.confirm(`Envoyer une relance ${label} pour la facture ${text(row.invoice_number)} ?`)) return;
    await api.post(`/reports/invoices/${invoiceId}/remind`, { channel });
    setSuccess(`Relance ${label} envoyee.`);
    await loadReport();
  }

  function remindFirstOverdue() {
    if (!report?.overdue.length) {
      setSuccess('Aucune facture en retard a relancer.');
      return;
    }
    sendReminder(report.overdue[0], 'EMAIL');
  }

  return (
    <section>
      <PageHeader
        title="Situation locataire"
        action={(
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/tenants')}><ArrowLeft size={16} />Retour</button>
            {can('documents.upload') && <button className="secondary" onClick={() => navigate(`/leases/new?tenantId=${id}`)}><FilePlus size={16} />Nouveau bail</button>}
            {can('invoices.create') && <button className="secondary" onClick={() => navigate(`/invoices?tenantId=${id}`)}><FilePlus size={16} />Nouvelle facture</button>}
            {can('payments.create') && <button className="secondary" onClick={() => navigate(`/payments?tenantId=${id}`)}><CreditCard size={16} />Enregistrer paiement</button>}
            {can('communication.send') && <button className="secondary" onClick={remindFirstOverdue}><Send size={16} />Relancer</button>}
            <button className="secondary" onClick={() => navigate(`/statements/tenant/${id}`)}><FileText size={16} />Relevé de compte</button>
            <button className="secondary" onClick={() => report && exportTenantSituationWorkbook(report)}><FileSpreadsheet size={16} />Export Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          </div>
        )}
      />
      {success && <div className="success-message">{success}</div>}

      {report && (
        <div className="summary-band">
          {report.tenant.tenant_type === 'COMPANY' ? (
            <>
              <SummaryCard label="Type locataire" value="Societe" />
              <SummaryCard label="Société" value={tenantLabel} />
              <SummaryCard label="RCCM" value={text(report.tenant.rccm)} />
              <SummaryCard label="Représentant" value={formattedRepresentative(report.tenant)} />
              <SummaryCard label="Téléphone" value={text(report.tenant.phone)} />
              <SummaryCard label="Email" value={text(report.tenant.email)} />
              <SummaryCard label="Statut" value={text(report.tenant.status)} />
            </>
          ) : (
            <>
              <SummaryCard label="Type locataire" value="Physique" />
              <SummaryCard label="Locataire" value={tenantLabel} />
              <SummaryCard label="Téléphone" value={text(report.tenant.phone)} />
              <SummaryCard label="Email" value={text(report.tenant.email)} />
              <SummaryCard label="Statut" value={text(report.tenant.status)} />
            </>
          )}
          <SummaryCard label="Periode" value={`${shortDate(report.period.start)} - ${shortDate(report.period.end)}`} wide />
        </div>
      )}

      <div className="quick-form tenant-situation-filters">
        <select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>
          <option value="">Mois</option>
          {months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" min="2000" max="2100" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} placeholder="Annee" />
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, month: '', start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, month: '', end: event.target.value })} />
        <select value={filters.invoiceStatus} onChange={(event) => setFilters({ ...filters, invoiceStatus: event.target.value })}>
          <option value="">Statut facture</option>
          <option value="PAID">Payee</option>
          <option value="PARTIAL">Paiement partiel</option>
          <option value="UNPAID">Non payee</option>
          <option value="OVERDUE">En retard</option>
        </select>
        <select value={filters.buildingId} onChange={(event) => setFilters({ ...filters, buildingId: event.target.value })}>
          <option value="">Tous les immeubles</option>
          {buildings.map((building) => <option key={building.value} value={building.value}>{building.label}</option>)}
        </select>
        <select value={filters.unitId} onChange={(event) => setFilters({ ...filters, unitId: event.target.value })}>
          <option value="">Toutes les unites</option>
          {units.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </select>
        <select value={filters.leaseId} onChange={(event) => setFilters({ ...filters, leaseId: event.target.value })}>
          <option value="">Tous les baux</option>
          {leases.map((lease) => <option key={String(lease.id)} value={String(lease.id)}>Bail #{String(lease.id)} - {text(lease.status)}</option>)}
        </select>
        <div className="filter-actions tenant-filter-actions">
          <button type="button" onClick={loadReport}><RefreshCw size={16} />Actualiser</button>
          <button type="button" className="secondary" onClick={() => exportCsv('situation-locataire.csv', exportRows)}><Download size={16} />CSV</button>
          <button type="button" className="secondary" onClick={() => report && exportTenantSituationWorkbook(report)}><FileSpreadsheet size={16} />Excel</button>
          <button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        </div>
      </div>

      {!report && <EmptyState message={loading ? 'Chargement...' : 'Aucune donnee.'} />}
      {report && (
        <>
          <div className="mini-stats">
            <div className="mini-stat"><span>Baux actifs</span><strong>{report.active_leases.length}</strong></div>
            <div className="mini-stat"><span>Unites louees</span><strong>{rentedUnitsCount}</strong></div>
            <div className="mini-stat"><span>Total garantie</span><strong>{money(totalGuarantee)}</strong></div>
            <div className="mini-stat"><span>Total des baux</span><strong>{money(totalLeases)}</strong></div>
            <div className="mini-stat"><span>Factures payees</span><strong>{report.paid.length}</strong></div>
            <div className="mini-stat"><span>Factures partielles</span><strong>{report.partial.length}</strong></div>
            <div className="mini-stat"><span>Factures en retard</span><strong>{report.overdue.length}</strong></div>
            <div className="mini-stat"><span>Total facture</span><strong>{money(report.total_invoiced)}</strong></div>
            <div className="mini-stat"><span>Total paye</span><strong>{money(report.total_paid)}</strong></div>
            <div className="mini-stat"><span>Solde restant</span><strong>{money(report.remaining)}</strong></div>
          </div>

          {synthesis && (
            <div className="detail-section report-section tenant-synthesis">
              <h4>Synthese locataire</h4>
              <div className="summary-band">
                <SummaryCard label="Dernier paiement" value={synthesis.lastPayment} />
                <SummaryCard label="Derniere relance" value={synthesis.lastReminder} />
                <SummaryCard label="Prochaine echeance" value={synthesis.nextDueDate} />
                <SummaryCard label="Factures en retard" value={synthesis.overdueCount} />
                <SummaryCard label="Solde total" value={money(report.remaining)} />
                <SummaryCard label="Niveau de risque" value={synthesis.risk} />
              </div>
            </div>
          )}

          <LeaseTable rows={report.leases} />
          <GuaranteeTable rows={report.guarantees} />
          <InvoiceTable title="Factures payees" rows={report.paid} navigate={navigate} />
          <InvoiceTable title="Factures partiellement payees" rows={report.partial} navigate={navigate} />
          <InvoiceTable title="Factures non payees" rows={report.unpaid} navigate={navigate} />
          <InvoiceTable title="Factures en retard" rows={report.overdue} navigate={navigate} onRemind={can('communication.send') ? sendReminder : undefined} />
          <PaymentTable rows={report.payments} />
          <DocumentTable rows={report.documents} />
          <TimelineTable report={report} />
          <ProfitabilityTable report={report} />
        </>
      )}
    </section>
  );
}

function SummaryCard({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={wide ? 'summary-item summary-item-wide' : 'summary-item'}><span>{label}</span><strong>{String(value ?? '-')}</strong></div>;
}

function CompactEmpty({ message }: { message: string }) {
  return <div className="compact-empty">{message}</div>;
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

function LeaseTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Appartements / unites loues</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Immeuble</th><th>Unite</th><th>Bail</th><th>Date debut</th><th>Date fin</th><th className="right">Loyer</th><th className="right">Syndic</th><th className="right">Total mensuel</th><th>Devise</th><th>Statut bail</th><th className="right">Garantie</th><th>Devise</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>#{text(row.id)}</td>
                <td>{date(row.start_date)}</td>
                <td>{date(row.end_date)}</td>
                <td className="right">{amount(leaseRentAmount(row))}</td>
                <td className="right">{amount(row.monthly_syndic_amount)}</td>
                <td className="right">{amount(leaseRentAmount(row) + Number(row.monthly_syndic_amount ?? 0))}</td>
                <td>USD</td>
                <td><StatusBadge value={text(row.status)} /></td>
                <AmountCell value={row.guarantee_amount} />
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun bail trouve." />}
      </div>
    </div>
  );
}

function GuaranteeTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Garanties locatives</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Bail</th><th>Immeuble</th><th>Unite</th><th className="right">Montant</th><th>Devise</th><th className="right">Paye</th><th>Devise</th><th>Statut</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>#{text(row.lease_id)}</td><td>{text(row.building_name)}</td><td>{text(row.unit_number)}</td><AmountCell value={row.amount} /><AmountCell value={row.paid_amount} /><td><StatusBadge value={text(row.status)} /></td></tr>)}</tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucune garantie enregistree." />}
      </div>
    </div>
  );
}

function InvoiceTable({ title, rows, navigate, onRemind }: { title: string; rows: ReportRow[]; navigate: (path: string) => void; onRemind?: (row: ReportRow, channel: 'EMAIL' | 'SMS' | 'WHATSAPP') => void }) {
  const showReminders = Boolean(onRemind);
  return (
    <div className="detail-section report-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Immeuble</th><th>Unite</th><th>Periode</th><th>Date</th><th>Echeance</th><th>Statut</th><th className="right">Loyer</th><th className="right">Syndic</th><th className="right">Montant</th><th>Devise</th><th className="right">Paye</th><th>Devise</th><th className="right">Reste</th><th>Devise</th>{showReminders && <th>Derniere relance</th>}{showReminders && <th className="right">Relances</th>}<th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.invoice_number)}</td>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{periodText(row.month, row.year)}</td>
                <td>{date(row.issue_date)}</td>
                <td>{date(row.due_date)}</td>
                <td><StatusBadge value={invoiceDisplayStatus(String(row.status ?? ''), String(row.due_date ?? ''))} /></td>
                <td className="right">{amount(row.rent_amount)}</td>
                <td className="right">{amount(row.syndic_amount)}</td>
                <AmountCell value={row.total} />
                <AmountCell value={row.paid_amount} />
                <AmountCell value={row.remaining_amount} />
                {showReminders && <td>{reminderDate(row.last_reminder_at)}</td>}
                {showReminders && <td className="right">{Number(row.reminder_count ?? 0)}</td>}
                <td className="actions">
                  <button className="icon-btn" title="Voir facture" onClick={() => navigate(`/invoices/${String(row.id)}`)}><Eye size={16} /></button>
                  <button className="icon-btn" title="Imprimer facture" onClick={() => navigate(`/invoices/${String(row.id)}/print`)}><Printer size={16} /></button>
                  {onRemind && <ReminderActions row={row} onRemind={onRemind} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <CompactEmpty message={emptyInvoiceMessage(title)} />}
      </div>
    </div>
  );
}

function PaymentTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Paiements</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Facture</th><th>Immeuble</th><th>Unite</th><th className="right">Montant</th><th>Devise</th><th>Mode paiement</th><th>Reference</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>{date(row.payment_date)}</td><td>{text(row.invoice_number)}</td><td>{text(row.building_name)}</td><td>{text(row.unit_number)}</td><AmountCell value={row.amount} /><td>{paymentMethodLabel(text(row.payment_method))}</td><td>{text(row.reference)}</td></tr>)}</tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun paiement trouve." />}
      </div>
    </div>
  );
}

function DocumentTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Documents / contrats</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Document</th><th>Type</th><th>Immeuble</th><th>Unite</th><th>Bail</th><th>Date</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>{text(row.file_name ?? row.name)}</td><td>{text(row.document_type)}</td><td>{text(row.building_name)}</td><td>{text(row.unit_number)}</td><td>#{text(row.lease_id)}</td><td>{date(row.uploaded_at)}</td></tr>)}</tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun document trouve." />}
      </div>
    </div>
  );
}

function TimelineTable({ report }: { report: TenantReportData }) {
  const rows = tenantTimeline(report);
  return (
    <div className="detail-section report-section">
      <h4>Timeline</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Evènement</th><th>Description</th><th>Utilisateur</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>{row.Date}</td><td>{row.Evenement}</td><td>{row.Description}</td><td>{row.Utilisateur}</td></tr>)}</tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun evenement trouve." />}
      </div>
    </div>
  );
}

function ProfitabilityTable({ report }: { report: TenantReportData }) {
  const reminders = report.invoices.reduce((sum, invoice) => sum + Number(invoice.reminder_count ?? 0), 0);
  return (
    <div className="detail-section report-section">
      <h4>Rentabilité</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Total loyers facturés</th><th>Total encaissé</th><th>Total impayés</th><th>Nombre de baux</th><th>Nombre de relances</th><th>Date dernier paiement</th><th>Solde restant</th></tr></thead>
          <tbody><tr><td>{amount(report.total_invoiced)}</td><td>{amount(report.total_paid)}</td><td>{amount(report.remaining)}</td><td>{report.leases.length}</td><td>{reminders}</td><td>{latestDate(report.payments.map((payment) => String(payment.payment_date ?? '')))}</td><td>{amount(report.remaining)}</td></tr></tbody>
        </table>
      </div>
    </div>
  );
}

function tenantTimeline(report: TenantReportData) {
  return [
    ...report.leases.map((lease) => ({ Date: date(lease.start_date), Evenement: 'Bail cree', Description: `Bail #${text(lease.id)}`, Utilisateur: '' })),
    ...report.invoices.map((invoice) => ({ Date: date(invoice.issue_date), Evenement: 'Facture creee', Description: text(invoice.invoice_number), Utilisateur: '' })),
    ...report.payments.map((payment) => ({ Date: date(payment.payment_date), Evenement: 'Paiement recu', Description: text(payment.reference ?? payment.invoice_number), Utilisateur: '' })),
    ...report.invoices.filter((invoice) => invoice.last_reminder_at).map((invoice) => ({ Date: date(invoice.last_reminder_at), Evenement: 'Relance', Description: text(invoice.invoice_number), Utilisateur: '' })),
  ].sort((a, b) => new Date(String(b.Date)).getTime() - new Date(String(a.Date)).getTime());
}

function emptyInvoiceMessage(title: string) {
  if (title.includes('payees')) return 'Aucune facture payee sur cette periode.';
  if (title.includes('partiellement')) return 'Aucune facture partiellement payee sur cette periode.';
  if (title.includes('non payees')) return 'Aucune facture non payee sur cette periode.';
  if (title.includes('retard')) return 'Aucune facture en retard sur cette periode.';
  return 'Aucune facture sur cette periode.';
}

function physicalInfoRow(tenant: ReportRow) {
  return { Type: 'Physique', Civilite: civilityLabel(tenant.civility), Nom: text(tenant.last_name), 'Post-nom': text(tenant.post_name), Prenom: text(tenant.first_name), Telephone: text(tenant.phone), 'Telephone secondaire': text(tenant.secondary_phone), Email: text(tenant.email), Profession: text(tenant.profession), Nationalite: text(tenant.nationality), Adresse: text(tenant.address), Statut: text(tenant.status) };
}

function companyInfoRow(tenant: ReportRow) {
  return { Type: 'Societe', Societe: text(tenant.company_name), RCCM: text(tenant.rccm), 'ID Nat / Numero fiscal': text(tenant.tax_number), 'Secteur activite': text(tenant.business_sector), Telephone: text(tenant.phone), Email: text(tenant.email), Adresse: text(tenant.address), Representant: formattedRepresentative(tenant), Fonction: text(tenant.legal_representative_role), 'Telephone representant': text(tenant.legal_representative_phone), 'Email representant': text(tenant.legal_representative_email), Document: text(tenant.company_document_name), Statut: text(tenant.status) };
}

function AmountCell({ value }: { value: unknown }) {
  return <><td className="right">{amount(value)}</td><td>USD</td></>;
}

function uniqueOptions(rows: ReportRow[], labelKey: string, valueKey: string) {
  const options = new Map<string, string>();
  rows.forEach((row) => {
    const value = String(row[valueKey] ?? '');
    const label = String(row[labelKey] ?? '');
    if (value && label) options.set(value, label);
  });
  return Array.from(options, ([value, label]) => ({ value, label }));
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function date(value: unknown) {
  return value ? shortDate(String(value)) : '-';
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

function tenantDisplayName(tenant: ReportRow) {
  if (tenant.tenant_type === 'COMPANY') return text(tenant.company_name);
  return formatPersonWithCivility(tenant.civility, `${text(tenant.first_name, '')} ${text(tenant.last_name, '')} ${text(tenant.post_name, '')}`.trim()) || '-';
}

function tenantSynthesis(report: TenantReportData) {
  const lastPayment = latestDate(report.payments.map((payment) => String(payment.payment_date ?? '')));
  const lastReminder = latestDate(report.invoices.map((invoice) => String(invoice.last_reminder_at ?? '')));
  const nextDueDate = nextDate(report.invoices.filter((invoice) => Number(invoice.remaining_amount ?? 0) > 0).map((invoice) => String(invoice.due_date ?? '')));
  const overdueCount = report.overdue.length;
  const remaining = Number(report.remaining ?? 0);
  const risk = overdueCount >= 3 || remaining >= 2000 ? 'Eleve' : overdueCount > 0 || remaining > 0 ? 'Moyen' : 'Faible';
  return { lastPayment, lastReminder, nextDueDate, overdueCount, risk };
}

function nextDate(values: string[]) {
  const valid = values.filter(Boolean).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return valid.length ? date(valid[0]) : 'Non disponible';
}

function reminderDate(value: unknown) {
  return value ? shortDate(String(value)) : 'Jamais relance';
}

function exportTenantSituationWorkbook(report: TenantReportData) {
  const isCompany = report.tenant.tenant_type === 'COMPANY';
  const tenantName = isCompany ? text(report.tenant.company_name, 'societe') : `${text(report.tenant.first_name, '')} ${text(report.tenant.last_name, '')}`.trim();
  const reminderRows = report.invoices
    .filter((invoice) => invoice.last_reminder_at || invoice.reminder_count)
    .map((invoice) => ({
      Facture: text(invoice.invoice_number),
      'Derniere relance': date(invoice.last_reminder_at),
      'Nombre relances': text(invoice.reminder_count, '0'),
      Statut: text(invoice.status),
    }));
  const timeline = tenantTimeline(report);
  exportXlsxWorkbook(`Situation_${safeFilePart(tenantName || 'locataire')}.xlsx`, [
    { name: 'Informations', rows: [isCompany ? companyInfoRow(report.tenant) : physicalInfoRow(report.tenant)] },
    { name: 'Baux', rows: report.leases },
    { name: 'Factures', rows: report.invoices },
    { name: 'Paiements', rows: report.payments },
    { name: 'Garanties', rows: report.guarantees },
    { name: 'Relances', rows: reminderRows },
    { name: 'Documents', rows: report.documents },
    { name: 'Timeline', rows: timeline },
    { name: 'Rentabilite', rows: [{ 'Total loyers factures': amount(report.total_rent_invoiced), 'Total syndic facture': amount(report.total_syndic_invoiced), 'Total facture': amount(report.total_invoiced), 'Total encaisse': amount(report.total_paid), 'Total impayes': amount(report.remaining), 'Total garantie': amount(totalGuaranteeAmount(report.leases)), 'Total des baux': amount(totalLeaseAmount(report.leases)), 'Nombre de baux': report.leases.length, 'Nombre de relances': reminderRows.reduce((sum, row) => sum + Number(row['Nombre relances'] ?? 0), 0), 'Date dernier paiement': latestDate(report.payments.map((payment) => String(payment.payment_date ?? ''))), 'Solde restant': amount(report.remaining) }] },
  ]);
}

function latestDate(values: string[]) {
  const valid = values.filter(Boolean);
  if (!valid.length) return 'Non disponible';
  return date(valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]);
}

function safeFilePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'locataire';
}

function civilityLabel(value: unknown) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'MR') return 'Monsieur';
  if (normalized === 'MRS') return 'Madame';
  return '—';
}

function formatPersonWithCivility(civility: unknown, name: string) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return '';
  const label = civilityLabel(civility);
  return label !== '—' ? `${label} ${cleanName}` : cleanName;
}

function formattedRepresentative(tenant: ReportRow) {
  return formatPersonWithCivility(
    tenant.legal_representative_civility,
    text(tenant.legal_representative_name, ''),
  ) || '—';
}

function totalGuaranteeAmount(leases: ReportRow[]) {
  return leases.reduce((sum, lease) => {
    const value = lease.rental_guarantee_amount ?? lease.guarantee_amount ?? lease.deposit_amount ?? lease.amount;
    return sum + Number(value ?? 0);
  }, 0);
}

function totalLeaseAmount(leases: ReportRow[]) {
  return leases.reduce((sum, lease) => {
    const duration = leaseDurationMonths(lease.start_date, lease.end_date);
    const rent = leaseRentAmount(lease);
    const syndic = Number(lease.monthly_syndic_amount ?? lease.syndic_amount ?? 0);
    return sum + duration * (rent + syndic);
  }, 0);
}

function leaseRentAmount(lease: ReportRow) {
  return Number(lease.monthly_rent ?? lease.rent_amount ?? 0) + Number(lease.maintenance_fee_amount ?? 0);
}

function leaseDurationMonths(startValue: unknown, endValue: unknown) {
  if (!startValue) return 0;
  const start = new Date(String(startValue));
  const end = endValue ? new Date(String(endValue)) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const yearMonths = (end.getFullYear() - start.getFullYear()) * 12;
  const monthDiff = end.getMonth() - start.getMonth();
  const total = yearMonths + monthDiff + 1;
  return Math.max(0, total);
}
