import { ArrowLeft, CreditCard, Download, Eye, FilePlus, FileSpreadsheet, FileText, Printer, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, money, paymentMethodLabel, shortDate } from '../api';
import { EmptyState, PageHeader, StatusBadge } from '../components';
import { useAuth } from '../core/auth/AuthContext';

type ReportRow = Record<string, unknown>;
type SectionKey =
  | 'summary'
  | 'leases'
  | 'guarantees'
  | 'invoices'
  | 'payments'
  | 'documents'
  | 'profitability'
  | 'timeline';
type InvoiceCategoryKey = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';

type TenantReportData = {
  tenant: ReportRow;
  period: { start: string; end: string };
  leases: ReportRow[];
  total_lease_count?: number;
  active_lease_count?: number;
  active_unit_count?: number;
  total_active_rent_amount?: number;
  total_active_guarantee_amount?: number;
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

const sections: Array<{ key: SectionKey; label: string }> = [
  { key: 'summary', label: 'Synthese locataire' },
  { key: 'leases', label: 'Biens loues' },
  { key: 'guarantees', label: 'Garanties locatives' },
  { key: 'invoices', label: 'Factures' },
  { key: 'payments', label: 'Paiements' },
  { key: 'documents', label: 'Documents / contrats' },
  { key: 'profitability', label: 'Rentabilite' },
  { key: 'timeline', label: 'Timeline' },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [success, setSuccess] = useState('');
  const [activeSection, setActiveSection] = useState<SectionKey>('summary');
  const [invoiceCategory, setInvoiceCategory] = useState<InvoiceCategoryKey>('PAID');

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
    if (!id) {
      setReport(null);
      setError('Identifiant locataire manquant.');
      setHasLoadedOnce(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get<TenantReportData>(`/reports/tenants/${id}`, { params: queryParams });
      setReport(response.data);
    } catch (err) {
      setReport(null);
      setError(extractApiErrorMessage(err));
    } finally {
      setHasLoadedOnce(true);
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [id, queryParams]);

  const leases = report?.leases ?? [];
  const buildings = uniqueOptions(leases, 'building_name', 'building_id');
  const units = uniqueOptions(leases, 'unit_number', 'unit_id');
  const tenantLabel = report ? tenantDisplayName(report.tenant) : '';
  const synthesis = report ? tenantSynthesis(report) : null;
  const invoiceCategories = report
    ? {
        PAID: report.paid,
        PARTIAL: report.partial,
        UNPAID: report.unpaid,
        OVERDUE: report.overdue,
      }
    : { PAID: [], PARTIAL: [], UNPAID: [], OVERDUE: [] };
  const activeLeases = useMemo(() => {
    if (!report) return [];
    if ((report.active_leases ?? []).length) return report.active_leases;
    return (report.leases ?? []).filter(isCurrentActiveLease);
  }, [report]);
  const totalLeaseCount = report?.total_lease_count ?? report?.leases.length ?? 0;
  const activeLeaseCount = report?.active_lease_count ?? activeLeases.length ?? 0;
  const activeUnitCount = report?.active_unit_count ?? new Set(activeLeases.map((lease) => String(lease.unit_id ?? '')).filter(Boolean)).size;
  const totalActiveRentAmount =
    report?.total_active_rent_amount ??
    activeLeases.reduce((sum, lease) => sum + leaseRentAmount(lease), 0);
  const totalActiveGuaranteeAmount =
    report?.total_active_guarantee_amount ??
    activeLeases.reduce((sum, lease) => sum + activeGuaranteeAmount(lease), 0);

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
    void sendReminder(report.overdue[0], 'EMAIL');
  }

  return (
    <section>
      <PageHeader
        title="Situation locataire"
        action={
          <div className="page-actions">
            <button className="secondary" onClick={() => navigate('/tenants')}>
              <ArrowLeft size={16} />
              Retour
            </button>
            {can('documents.upload') && (
              <button className="secondary" onClick={() => navigate(`/leases/new?tenantId=${id}`)}>
                <FilePlus size={16} />
                Nouveau bail
              </button>
            )}
            {can('invoices.create') && (
              <button className="secondary" onClick={() => navigate(`/invoices?tenantId=${id}`)}>
                <FilePlus size={16} />
                Nouvelle facture
              </button>
            )}
            {can('payments.create') && (
              <button className="secondary" onClick={() => navigate(`/payments?tenantId=${id}`)}>
                <CreditCard size={16} />
                Enregistrer paiement
              </button>
            )}
            {can('communication.send') && (
              <button className="secondary" onClick={remindFirstOverdue}>
                <Send size={16} />
                Relancer
              </button>
            )}
            <button className="secondary" onClick={() => navigate(`/statements/tenant/${id}`)}>
              <FileText size={16} />
              Releve de compte
            </button>
            <button className="secondary" onClick={() => report && exportTenantSituationWorkbook(report)}>
              <FileSpreadsheet size={16} />
              Export Excel
            </button>
            <button className="secondary" onClick={() => window.print()}>
              <Printer size={16} />
              Imprimer
            </button>
          </div>
        }
      />
      {success && <div className="success-message">{success}</div>}

      {report && (
        <div className="mini-stats tenant-situation-kpis">
          <div className="mini-stat"><span>Total baux</span><strong>{totalLeaseCount}</strong></div>
          <div className="mini-stat"><span>Baux actifs</span><strong>{activeLeaseCount}</strong></div>
          <div className="mini-stat"><span>Unites louees</span><strong>{activeUnitCount}</strong></div>
          <div className="mini-stat"><span>Total loyers actifs</span><strong>{money(totalActiveRentAmount)}</strong></div>
          <div className="mini-stat"><span>Total garanties actives</span><strong>{money(totalActiveGuaranteeAmount)}</strong></div>
          <div className="mini-stat"><span>Factures payees</span><strong>{report.paid.length}</strong></div>
          <div className="mini-stat"><span>Factures en retard</span><strong>{report.overdue.length}</strong></div>
          <div className="mini-stat"><span>Total paye</span><strong>{money(report.total_paid)}</strong></div>
          <div className="mini-stat"><span>Solde impaye</span><strong>{money(report.remaining)}</strong></div>
        </div>
      )}

      <div className="quick-form tenant-situation-filters">
        <select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>
          <option value="">Mois</option>
          {months.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
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
          {buildings.map((building) => (
            <option key={building.value} value={building.value}>
              {building.label}
            </option>
          ))}
        </select>
        <select value={filters.unitId} onChange={(event) => setFilters({ ...filters, unitId: event.target.value })}>
          <option value="">Toutes les unites</option>
          {units.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
        <select value={filters.leaseId} onChange={(event) => setFilters({ ...filters, leaseId: event.target.value })}>
          <option value="">Tous les baux</option>
          {leases.map((lease) => (
            <option key={String(lease.id)} value={String(lease.id)}>
              Bail #{text(lease.id)} - {text(lease.status)}
            </option>
          ))}
        </select>
        <div className="filter-actions tenant-filter-actions">
          <button type="button" onClick={loadReport}>
            <RefreshCw size={16} />
            Actualiser
          </button>
          <button type="button" className="secondary" onClick={() => exportCsv('situation-locataire.csv', buildExportRows(report))}>
            <Download size={16} />
            CSV
          </button>
          <button type="button" className="secondary" onClick={() => report && exportTenantSituationWorkbook(report)}>
            <FileSpreadsheet size={16} />
            Excel
          </button>
          <button type="button" className="secondary" onClick={() => window.print()}>
            <Printer size={16} />
            Imprimer
          </button>
        </div>
      </div>

      {!report && (
        <EmptyState
          message={
            loading
              ? 'Chargement...'
              : error
                ? error
                : hasLoadedOnce
                  ? 'Aucune donnee.'
                  : 'Chargement...'
          }
        />
      )}
      {report && (
        <>
          <div className="tenant-situation-nav tenant-situation-tabs" role="tablist" aria-label="Rubriques situation locataire">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                className={activeSection === section.key ? 'tenant-situation-tab active' : 'tenant-situation-tab'}
                onClick={() => setActiveSection(section.key)}
              >
                {section.label}
              </button>
            ))}
          </div>

          {activeSection === 'summary' && (
            <>
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
              <TenantIdentitySection report={report} />
            </>
          )}

          {activeSection === 'leases' && <LeaseTable rows={activeLeases} />}
          {activeSection === 'guarantees' && <GuaranteeTable rows={report.guarantees} />}
          {activeSection === 'invoices' && (
            <>
              <div className="tenant-situation-subnav" role="tablist" aria-label="Categories de factures">
                {[
                  ['PAID', 'Factures payees'],
                  ['PARTIAL', 'Factures partiellement payees'],
                  ['UNPAID', 'Factures non payees'],
                  ['OVERDUE', 'Factures en retard'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={invoiceCategory === key ? 'tenant-situation-subtab active' : 'tenant-situation-subtab'}
                    onClick={() => setInvoiceCategory(key as InvoiceCategoryKey)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InvoiceTable
                title={
                  invoiceCategory === 'PAID'
                    ? 'Factures payees'
                    : invoiceCategory === 'PARTIAL'
                      ? 'Factures partiellement payees'
                      : invoiceCategory === 'UNPAID'
                        ? 'Factures non payees'
                        : 'Factures en retard'
                }
                rows={invoiceCategories[invoiceCategory]}
                navigate={navigate}
                onRemind={invoiceCategory === 'OVERDUE' && can('communication.send') ? sendReminder : undefined}
              />
            </>
          )}
          {activeSection === 'payments' && <PaymentTable rows={report.payments} />}
          {activeSection === 'documents' && <DocumentTable rows={report.documents} navigate={navigate} />}
          {activeSection === 'profitability' && (
            <ProfitabilityTable
              report={report}
              totalActiveRentAmount={totalActiveRentAmount}
              totalActiveSyndicAmount={activeLeases.reduce((sum, lease) => sum + Number(lease.monthly_syndic_amount ?? 0), 0)}
            />
          )}
          {activeSection === 'timeline' && <TimelineTable report={report} />}
        </>
      )}
    </section>
  );
}

function TenantIdentitySection({ report }: { report: TenantReportData }) {
  const tenant = report.tenant;
  const rows: Array<{ label: string; value: string }> =
    tenant.tenant_type === 'COMPANY'
      ? [
          { label: 'Type locataire', value: 'Societe' },
          { label: 'Societe', value: text(tenant.company_name) },
          { label: 'Representant', value: formattedRepresentative(tenant) },
          { label: 'Telephone', value: text(tenant.phone) },
          { label: 'Email', value: text(tenant.email) },
          { label: 'RCCM', value: text(tenant.rccm) },
          { label: 'Numero fiscal', value: text(tenant.tax_number) },
          { label: 'Adresse', value: text(tenant.address) },
          { label: 'Statut', value: text(tenant.status) },
          { label: 'Periode', value: `${shortDate(report.period.start)} - ${shortDate(report.period.end)}` },
        ]
      : [
          { label: 'Type locataire', value: 'Physique' },
          { label: 'Locataire', value: tenantDisplayName(tenant) },
          { label: 'Telephone', value: text(tenant.phone) },
          { label: 'Email', value: text(tenant.email) },
          { label: 'Profession', value: text(tenant.profession) },
          { label: 'Nationalite', value: text(tenant.nationality) },
          { label: 'Adresse', value: text(tenant.address) },
          { label: 'Statut', value: text(tenant.status) },
          { label: 'Periode', value: `${shortDate(report.period.start)} - ${shortDate(report.period.end)}` },
        ];
  return (
    <div className="detail-section report-section">
      <h4>Informations generales</h4>
      <div className="tenant-summary-grid">
        {rows.map((row) => (
          <div key={row.label} className="tenant-summary-field">
            <span className="tenant-summary-label">{row.label}</span>
            <span className="tenant-summary-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
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
      <h4>Biens loues</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Immeuble</th><th>Unite</th><th>Reference bail</th><th>Debut</th><th>Fin</th><th>Statut</th><th className="right">Loyer</th><th className="right">Syndic</th><th className="right">Total mensuel</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{leaseReference(row)}</td>
                <td>{date(row.start_date)}</td>
                <td>{date(row.end_date)}</td>
                <td><StatusBadge value={text(row.status)} /></td>
                <td className="right">{amount(leaseRentAmount(row))}</td>
                <td className="right">{amount(row.monthly_syndic_amount)}</td>
                <td className="right">{amount(leaseRentAmount(row) + Number(row.monthly_syndic_amount ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun bien loue actif." />}
      </div>
    </div>
  );
}

function isCurrentActiveLease(lease: ReportRow) {
  const startDate = normalizeDateOnly(lease.start_date);
  const endDate = normalizeDateOnly(lease.end_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const status = String(lease.status ?? '').toUpperCase();
  return Boolean(
    startDate &&
      startDate.getTime() <= today.getTime() &&
      (!endDate || endDate.getTime() >= today.getTime()) &&
      !['DRAFT', 'CANCELLED', 'TERMINATED', 'EXPIRED'].includes(status),
  );
}

function GuaranteeTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="detail-section report-section">
      <h4>Garanties locatives</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Reference bail</th><th>Bien</th><th className="right">Mois</th><th className="right">Garantie attendue</th><th className="right">Garantie payee</th><th className="right">Reste</th><th>Statut</th><th>Date paiement</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>#{text(row.lease_id)}</td>
                <td>{`${text(row.building_name)} - ${text(row.unit_number)}`}</td>
                <td className="right">{Number(row.guarantee_months ?? 0)}</td>
                <td className="right">{amount(row.amount)}</td>
                <td className="right">{amount(row.paid_amount)}</td>
                <td className="right">{amount(row.remaining_amount)}</td>
                <td><StatusBadge value={text(row.status)} /></td>
                <td>{date(row.payment_date)}</td>
              </tr>
            ))}
          </tbody>
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
          <thead><tr><th>Numero</th><th>Type</th><th>Periode</th><th>Date</th><th>Echeance</th><th>Immeuble</th><th>Unite</th><th className="right">Total</th><th className="right">Paye</th><th className="right">Reste</th><th>Statut</th>{showReminders && <th>Derniere relance</th>}{showReminders && <th className="right">Relances</th>}<th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.invoice_number)}</td>
                <td>{text(row.invoice_type)}</td>
                <td>{periodText(row.month, row.year)}</td>
                <td>{date(row.issue_date)}</td>
                <td>{date(row.due_date)}</td>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td className="right">{amount(row.total)}</td>
                <td className="right">{amount(row.paid_amount)}</td>
                <td className="right">{amount(row.remaining_amount)}</td>
                <td><StatusBadge value={invoiceCategoryLabel(row)} /></td>
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
          <thead><tr><th>Date</th><th>Reference</th><th>Facture</th><th>Immeuble</th><th>Unite</th><th>Devise</th><th className="right">Montant USD</th><th className="right">Montant CDF</th><th className="right">Taux</th><th>Mode paiement</th><th>Statut</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{date(row.payment_date)}</td>
                <td>{text(row.reference)}</td>
                <td>{text(row.invoice_number)}</td>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>{text(row.currency, 'USD')}</td>
                <td className="right">{amount(row.amount_usd ?? row.amount)}</td>
                <td className="right">{amount(row.amount_cdf)}</td>
                <td className="right">{amount(row.exchange_rate)}</td>
                <td>{paymentMethodLabel(text(row.payment_method))}</td>
                <td><StatusBadge value={text(row.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun paiement trouve." />}
      </div>
    </div>
  );
}

function DocumentTable({ rows, navigate }: { rows: ReportRow[]; navigate: (path: string) => void }) {
  return (
    <div className="detail-section report-section">
      <h4>Documents / contrats</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Document</th><th>Type</th><th>Immeuble</th><th>Unite</th><th>Bail</th><th>Date</th><th>Source</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{text(row.file_name ?? row.name)}</td>
                <td>{text(row.document_type)}</td>
                <td>{text(row.building_name)}</td>
                <td>{text(row.unit_number)}</td>
                <td>#{text(row.lease_id)}</td>
                <td>{date(row.document_date ?? row.uploaded_at)}</td>
                <td>{text(row.source_type, 'DOCUMENT')}</td>
                <td className="actions">
                  <button className="icon-btn" title="Voir le bail" onClick={() => navigate(`/leases/${String(row.lease_id)}`)}><Eye size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
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
          <thead><tr><th>Date</th><th>Evenement</th><th>Description</th><th>Utilisateur</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><td>{row.Date}</td><td>{row.Evenement}</td><td>{row.Description}</td><td>{row.Utilisateur}</td></tr>)}</tbody>
        </table>
        {!rows.length && <CompactEmpty message="Aucun evenement trouve." />}
      </div>
    </div>
  );
}

function ProfitabilityTable({
  report,
  totalActiveRentAmount,
  totalActiveSyndicAmount,
}: {
  report: TenantReportData;
  totalActiveRentAmount: number;
  totalActiveSyndicAmount: number;
}) {
  const totalMonthlyExpected = totalActiveRentAmount + totalActiveSyndicAmount;
  const collectionRate = Number(report.total_invoiced ?? 0) > 0 ? (Number(report.total_paid ?? 0) / Number(report.total_invoiced ?? 0)) * 100 : 0;
  return (
    <div className="detail-section report-section">
      <h4>Rentabilite</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Loyers actifs mensuels</th><th>Syndic mensuel</th><th>Total mensuel attendu</th><th>Total facture</th><th>Total encaisse</th><th>Reste a encaisser</th><th>Taux d'encaissement</th></tr></thead>
          <tbody>
            <tr>
              <td>{amount(totalActiveRentAmount)}</td>
              <td>{amount(totalActiveSyndicAmount)}</td>
              <td>{amount(totalMonthlyExpected)}</td>
              <td>{amount(report.total_invoiced)}</td>
              <td>{amount(report.total_paid)}</td>
              <td>{amount(report.remaining)}</td>
              <td>{collectionRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function tenantTimeline(report: TenantReportData) {
  return [
    ...report.leases.map((lease) => ({ Date: date(lease.start_date), Evenement: 'Bail cree', Description: leaseReference(lease), Utilisateur: '' })),
    ...report.invoices.map((invoice) => ({ Date: date(invoice.issue_date), Evenement: 'Facture creee', Description: text(invoice.invoice_number), Utilisateur: '' })),
    ...report.payments.map((payment) => ({ Date: date(payment.payment_date), Evenement: 'Paiement recu', Description: text(payment.reference ?? payment.invoice_number), Utilisateur: '' })),
    ...report.invoices.filter((invoice) => invoice.last_reminder_at).map((invoice) => ({ Date: date(invoice.last_reminder_at), Evenement: 'Relance', Description: text(invoice.invoice_number), Utilisateur: '' })),
    ...report.guarantees.filter((guarantee) => Number(guarantee.paid_amount ?? 0) > 0).map((guarantee) => ({ Date: date(guarantee.payment_date), Evenement: 'Garantie payee', Description: `Bail #${text(guarantee.lease_id)}`, Utilisateur: '' })),
    ...report.documents.map((document) => ({ Date: date(document.document_date ?? document.uploaded_at), Evenement: 'Document ajoute', Description: text(document.file_name), Utilisateur: '' })),
  ].sort((a, b) => new Date(String(b.Date)).getTime() - new Date(String(a.Date)).getTime());
}

function buildExportRows(report: TenantReportData | null) {
  if (!report) return [];
  return [...report.leases, ...report.guarantees, ...report.invoices, ...report.payments, ...report.documents];
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
      Statut: invoiceCategoryLabel(invoice),
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
    {
      name: 'Rentabilite',
      rows: [{
        total_loyers_actifs: amount(report.total_active_rent_amount),
        total_garanties_actives: amount(report.total_active_guarantee_amount),
        total_facture: amount(report.total_invoiced),
        total_encaisse: amount(report.total_paid),
        total_impayes: amount(report.remaining),
        total_baux: report.total_lease_count ?? report.leases.length,
        baux_actifs: report.active_lease_count ?? report.active_leases.length,
        unites_louees: report.active_unit_count ?? 0,
        nombre_relances: reminderRows.reduce((sum, row) => sum + Number(row['Nombre relances'] ?? 0), 0),
        date_dernier_paiement: latestDate(report.payments.map((payment) => String(payment.payment_date ?? ''))),
      }],
    },
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

function leaseRentAmount(lease: ReportRow) {
  return Number(lease.monthly_rent ?? lease.rent_amount ?? 0) + Number(lease.maintenance_fee_amount ?? 0);
}

function activeGuaranteeAmount(lease: ReportRow) {
  const persisted = lease.rental_guarantee_amount ?? lease.guarantee_amount ?? lease.amount;
  if (persisted != null && persisted !== '') return Number(persisted ?? 0);
  return leaseRentAmount(lease) * Number(lease.guarantee_months ?? 0);
}

function leaseReference(lease: ReportRow) {
  return text(lease.lease_number ?? `#${text(lease.id)}`);
}

function normalizeDateOnly(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0];
  if (isoDate) {
    const [year, month, day] = isoDate.split('-').map((part) => Number(part));
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      return new Date(year, month - 1, day);
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function extractApiErrorMessage(error: unknown) {
  const response = (error as { response?: { data?: unknown; status?: number } })?.response;
  const data = response?.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message;
    if (Array.isArray(message) && message.length) return String(message[0]);
    if (typeof message === 'string' && message.trim()) return message.trim();
    const label = (data as { error?: unknown }).error;
    if (typeof label === 'string' && label.trim()) return label.trim();
  }
  if (response?.status === 403) {
    return "Acces refuse a la situation du locataire pour l'organisation active.";
  }
  if (response?.status === 404) {
    return "Locataire introuvable dans l'organisation active.";
  }
  return (error as { message?: string })?.message || 'Impossible de charger la situation du locataire.';
}

function invoiceCategoryLabel(row: ReportRow) {
  const status = String(row.status ?? '').toUpperCase();
  const paidAmount = Number(row.paid_amount ?? 0);
  const remainingAmount = Number(row.remaining_amount ?? row.total ?? 0);
  const dueDate = row.due_date ? new Date(`${String(row.due_date).slice(0, 10)}T23:59:59`) : null;
  const now = new Date();
  if (status === 'PAID' || remainingAmount <= 0) return 'PAID';
  if (paidAmount > 0 && remainingAmount > 0) return 'PARTIAL';
  if (dueDate && dueDate.getTime() < now.getTime()) return 'OVERDUE';
  return 'UNPAID';
}
