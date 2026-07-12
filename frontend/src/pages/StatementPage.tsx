import { ArrowLeft, Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, money, paymentMethodLabel, shortDate } from '../api';
import { EmptyState, PageHeader } from '../components';

type StatementKind = 'tenant' | 'unit' | 'building';
type StatementRow = Record<string, unknown>;

type StatementResponse = {
  kind: string;
  entity: {
    id: number;
    entity_type: string;
    title: string;
    subtitle?: string | null;
    tenant?: StatementRow;
    unit?: StatementRow;
    building?: StatementRow;
  };
  period: { start: string; end: string };
  currency: string;
  opening_balance: number;
  totals: {
    debits: number;
    credits: number;
    closing_balance: number;
    invoices_count: number;
    payments_count: number;
  };
  movements: Array<StatementRow & { date: string; reference?: string; movement_type: string; label: string; debit: number; credit: number; currency: string; running_balance: number }>;
  invoices: StatementRow[];
  payments: StatementRow[];
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

export function TenantStatementPage() {
  return <StatementPage kind="tenant" title="Relevé de compte locataire" backLabel="Situation locataire" />;
}

export function UnitStatementPage() {
  return <StatementPage kind="unit" title="Relevé de compte appartement" backLabel="Fiche appartement" />;
}

export function BuildingStatementPage() {
  return <StatementPage kind="building" title="Relevé de compte immeuble" backLabel="Rapport immeuble" />;
}

function StatementPage({ kind, title, backLabel }: { kind: StatementKind; title: string; backLabel: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = new Date();
  const [filters, setFilters] = useState({
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    start: '',
    end: '',
  });
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');

  const endpoint = useMemo(() => `/statements/${kind === 'tenant' ? 'tenants' : kind === 'unit' ? 'units' : 'buildings'}/${id}`, [id, kind]);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (filters.month && filters.year) {
      params.month = filters.month;
      params.year = filters.year;
    } else {
      if (filters.start) params.start = filters.start;
      if (filters.end) params.end = filters.end;
    }
    return params;
  }, [filters]);

  async function loadStatement() {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get<StatementResponse>(endpoint, { params: queryParams });
      setStatement(response.data);
    } catch (exception: any) {
      setStatement(null);
      setError(exception?.response?.data?.message ?? 'Impossible de charger le relevé.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatement();
  }, [id, endpoint, queryParams]);

  const movementRows = statement?.movements ?? [];
  const debitRows = movementRows.filter((row) => Number(row.debit ?? 0) > 0);
  const creditRows = movementRows.filter((row) => Number(row.credit ?? 0) > 0);
  const invoiceRows = statement?.invoices ?? [];
  const paymentRows = statement?.payments ?? [];
  const fileBase = `Releve_compte_${statementKindLabel(kind)}_${safePart(statement?.entity.title ?? kind)}_${statement?.period.start ?? '0000-00-00'}_${statement?.period.end ?? '0000-00-00'}`;

  const summaryRows = statement
    ? [{
        releve: title,
        entite: statement.entity.title,
        sous_titre: statement.entity.subtitle ?? '',
        periode: `${shortDate(statement.period.start)} - ${shortDate(statement.period.end)}`,
        solde_ouverture: statement.opening_balance,
        total_debits: statement.totals.debits,
        total_credits: statement.totals.credits,
        solde_cloture: statement.totals.closing_balance,
        nombre_factures: statement.totals.invoices_count,
        nombre_paiements: statement.totals.payments_count,
        devise: statement.currency,
      }]
    : [];

  function backPath() {
    if (kind === 'tenant') return `/tenants/${id}/situation`;
    if (kind === 'unit') return `/rental-units/${id}`;
    return `/buildings/${id}/report`;
  }

  function statementExcelRows() {
    return [
      { date: '', reference: 'Solde d’ouverture', type: '', label: '', debit: 0, credit: 0, currency: statement?.currency ?? 'USD', balance: statement?.opening_balance ?? 0 },
      ...movementRows.map((row) => ({
        date: formatDate(row.date),
        reference: String(row.reference ?? '—'),
        type: movementLabel(String(row.movement_type)),
        label: String(row.label ?? '—'),
        debit: Number(row.debit ?? 0),
        credit: Number(row.credit ?? 0),
        currency: row.currency ?? statement?.currency ?? 'USD',
        balance: Number(row.running_balance ?? 0),
      })),
    ];
  }

  function invoiceExcelRows() {
    return invoiceRows.length ? invoiceRows.map((row) => ({
      number: String(row.invoice_number ?? '—'),
      period: `${String(row.month ?? '—')}/${String(row.year ?? '—')}`,
      issue_date: String(row.issue_date ?? '—'),
      due_date: String(row.due_date ?? '—'),
      tenant: String(row.tenant_name ?? '—'),
      unit: String(row.unit_number ?? '—'),
      total: Number(row.total ?? 0),
      paid: Number(row.paid_amount ?? 0),
      remaining: Number(row.remaining_amount ?? 0),
      currency: String(row.currency ?? statement?.currency ?? 'USD'),
      status: String(row.status ?? '—'),
    })) : [{ information: 'Aucune facture sur la période' }];
  }

  function paymentExcelRows() {
    return paymentRows.length ? paymentRows.map((row) => ({
      date: String(row.payment_date ?? '—'),
      receipt: String(row.receipt_number ?? row.reference ?? '—'),
      invoice: String(row.invoice_number ?? '—'),
      tenant: String(row.tenant_name ?? '—'),
      unit: String(row.unit_number ?? '—'),
      amount: Number(row.amount ?? 0),
      method: paymentMethodLabel(String(row.payment_method ?? '')),
      currency: String(row.currency ?? statement?.currency ?? 'USD'),
    })) : [{ information: 'Aucun paiement sur la période' }];
  }

  function byUnitRows() {
    const grouped = invoiceRows.reduce<Record<string, { appartement: string; total_debit: number; total_credit: number; solde: number }>>((acc, invoice) => {
      const key = String(invoice.unit_number ?? 'Sans appartement');
      acc[key] ??= { appartement: key, total_debit: 0, total_credit: 0, solde: 0 };
      acc[key].total_debit += Number(invoice.total ?? 0);
      acc[key].total_credit += Number(invoice.paid_amount ?? 0);
      acc[key].solde += Number(invoice.remaining_amount ?? 0);
      return acc;
    }, {});
    return Object.values(grouped).length ? Object.values(grouped) : [{ information: 'Aucune donnée par appartement' }];
  }

  function byTenantRows() {
    const grouped = invoiceRows.reduce<Record<string, { locataire: string; total_debit: number; total_credit: number; solde: number }>>((acc, invoice) => {
      const key = String(invoice.tenant_name ?? 'Sans locataire');
      acc[key] ??= { locataire: key, total_debit: 0, total_credit: 0, solde: 0 };
      acc[key].total_debit += Number(invoice.total ?? 0);
      acc[key].total_credit += Number(invoice.paid_amount ?? 0);
      acc[key].solde += Number(invoice.remaining_amount ?? 0);
      return acc;
    }, {});
    return Object.values(grouped).length ? Object.values(grouped) : [{ information: 'Aucune donnée par locataire' }];
  }

  function exportWorkbook() {
    if (!statement) return;
    setExportingExcel(true);
    try {
      exportXlsxWorkbook(
        `${fileBase}.xlsx`,
        [
          { name: 'Releve', rows: statementExcelRows() },
          { name: 'Resume', rows: summaryRows },
          { name: 'Debits', rows: debitRows.length ? debitRows.map((row) => ({
            date: formatDate(row.date),
            reference: String(row.reference ?? '—'),
            label: String(row.label ?? '—'),
            debit: Number(row.debit ?? 0),
            currency: String(row.currency ?? statement.currency),
            balance: Number(row.running_balance ?? 0),
          })) : [{ information: 'Aucun débit sur la période' }] },
          { name: 'Credits', rows: creditRows.length ? creditRows.map((row) => ({
            date: formatDate(row.date),
            reference: String(row.reference ?? '—'),
            label: String(row.label ?? '—'),
            credit: Number(row.credit ?? 0),
            currency: String(row.currency ?? statement.currency),
            balance: Number(row.running_balance ?? 0),
          })) : [{ information: 'Aucun crédit sur la période' }] },
          { name: 'Factures', rows: invoiceExcelRows() },
          { name: 'Paiements', rows: paymentExcelRows() },
          ...(kind === 'building'
            ? [
                { name: 'Par appartement', rows: byUnitRows() },
                { name: 'Par locataire', rows: byTenantRows() },
              ]
            : []),
        ],
      );
    } finally {
      setExportingExcel(false);
    }
  }

  async function exportPdf() {
    if (!statement) return;
    setExportingPdf(true);
    try {
      const [{ jsPDF }, autotableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const autoTable = (autotableModule as any).default ?? (autotableModule as any);
      const doc = new jsPDF({ orientation: movementRows.length > 8 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const margin = 36;
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('NG Property ERP', margin, 32);
      doc.setFontSize(12);
      doc.text('Relevé de compte', margin, 50);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Type : ${statementKindLabel(kind)}`, margin, 70);
      doc.text(`Entité : ${statement.entity.title}`, margin, 84);
      if (statement.entity.subtitle) doc.text(`Complément : ${statement.entity.subtitle}`, margin, 98);
      doc.text(`Période : ${shortDate(statement.period.start)} - ${shortDate(statement.period.end)}`, margin, 112);
      doc.text(`Généré le : ${shortDate(new Date().toISOString())}`, margin, 126);
      doc.text(`Devise : ${statement.currency}`, pageWidth - margin - 120, 70);
      doc.text(`Solde d'ouverture : ${money(statement.opening_balance)}`, pageWidth - margin - 180, 84);
      doc.text(`Total débit : ${money(statement.totals.debits)}`, pageWidth - margin - 180, 98);
      doc.text(`Total crédit : ${money(statement.totals.credits)}`, pageWidth - margin - 180, 112);
      doc.text(`Solde final : ${money(statement.totals.closing_balance)}`, pageWidth - margin - 180, 126);

      autoTable(doc, {
        startY: 144,
        head: [['Date', 'Référence', 'Libellé', 'Débit', 'Crédit', 'Solde']],
        body: movementRows.length
          ? movementRows.map((row) => [
              formatDate(row.date),
              String(row.reference ?? '—'),
              String(row.label ?? '—'),
              formatAmount(row.debit),
              formatAmount(row.credit),
              formatAmount(row.running_balance),
            ])
          : [['—', '—', 'Aucun mouvement sur la période', '0', '0', formatAmount(statement.opening_balance)]],
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [45, 56, 72] },
        alternateRowStyles: { fillColor: [247, 249, 252] },
        margin: { left: margin, right: margin },
      });

      const footerY = ((doc as any).lastAutoTable?.finalY ?? 180) + 16;
      doc.setFontSize(9);
      doc.text('Signature / cachet prévus en bas', margin, footerY);
      doc.save(`${fileBase}.pdf`);
    } catch (exception: any) {
      setError(exception?.message ?? 'Impossible de générer le PDF.');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <section>
      <PageHeader
        title={title}
        action={(
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => navigate(backPath())}><ArrowLeft size={16} />Retour</button>
            <button type="button" className="secondary" onClick={loadStatement} disabled={loading}><RefreshCw size={16} />Actualiser</button>
            <button type="button" className="secondary" onClick={exportPdf} disabled={exportingPdf || loading}><FileSpreadsheet size={16} />PDF</button>
            <button type="button" className="secondary" onClick={exportWorkbook} disabled={exportingExcel || loading}><Download size={16} />Excel</button>
            <button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
          </div>
        )}
      />

      <div className="quick-form statement-filters">
        <select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>
          <option value="">Mois</option>
          {months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="number" min="2000" max="2100" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} placeholder="Annee" />
        <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, month: '', start: event.target.value })} />
        <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, month: '', end: event.target.value })} />
        <div className="filter-actions">
          <button type="button" onClick={loadStatement} disabled={loading}><RefreshCw size={16} />Actualiser</button>
          <button type="button" className="secondary" onClick={exportPdf} disabled={exportingPdf || loading}><FileSpreadsheet size={16} />PDF</button>
          <button type="button" className="secondary" onClick={exportWorkbook} disabled={exportingExcel || loading}><Download size={16} />Excel</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {!statement && !error && <EmptyState message={loading ? 'Chargement...' : 'Aucune donnée.'} />}

      {statement && (
        <>
          <section className="detail-section report-section">
            <h4>{statement.entity.title}</h4>
            <div className="summary-band">
              <SummaryCard label="Contexte" value={statement.entity.subtitle ?? backLabel} wide />
              <SummaryCard label="Période" value={`${shortDate(statement.period.start)} - ${shortDate(statement.period.end)}`} />
              <SummaryCard label="Solde d'ouverture" value={money(statement.opening_balance)} />
              <SummaryCard label="Débits" value={money(statement.totals.debits)} />
              <SummaryCard label="Crédits" value={money(statement.totals.credits)} />
              <SummaryCard label="Solde de clôture" value={money(statement.totals.closing_balance)} />
              <SummaryCard label="Factures" value={statement.totals.invoices_count} />
              <SummaryCard label="Paiements" value={statement.totals.payments_count} />
              <SummaryCard label="Devise" value={statement.currency} />
            </div>
          </section>

          <section className="detail-section report-section">
            <h4>Relevé</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Référence</th>
                    <th>Type mouvement</th>
                    <th>Libellé</th>
                    <th className="right">Débit</th>
                    <th className="right">Crédit</th>
                    <th>Devise</th>
                    <th className="right">Solde courant</th>
                  </tr>
                </thead>
                <tbody>
                  {movementRows.map((row, index) => (
                    <tr key={`${row.movement_type}-${row.reference ?? index}-${index}`}>
                      <td>{formatDate(row.date)}</td>
                      <td>{String(row.reference ?? '—')}</td>
                      <td>{movementLabel(String(row.movement_type))}</td>
                      <td>{String(row.label ?? '—')}</td>
                      <td className="right">{formatAmount(row.debit)}</td>
                      <td className="right">{formatAmount(row.credit)}</td>
                      <td>{row.currency ?? statement.currency}</td>
                      <td className="right">{formatAmount(row.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function SummaryCard({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={wide ? 'summary-item summary-item-wide' : 'summary-item'}><span>{label}</span><strong>{String(value ?? '—')}</strong></div>;
}

function movementLabel(type: string) {
  if (type === 'OPENING') return 'Solde initial';
  if (type === 'INVOICE') return 'Facture';
  if (type === 'PAYMENT') return 'Paiement';
  return type;
}

function formatAmount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function formatDate(value: unknown) {
  return value ? shortDate(String(value)) : '-';
}

function safePart(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'releve';
}

function statementKindLabel(kind: StatementKind) {
  if (kind === 'tenant') return 'Locataire';
  if (kind === 'unit') return 'Appartement';
  return 'Immeuble';
}
