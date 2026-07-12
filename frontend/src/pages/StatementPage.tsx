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
  const summaryRows = statement ? [{
    type_releve: title,
    entite: statement.entity.title,
    sous_titre: statement.entity.subtitle ?? '',
    periode: `${shortDate(statement.period.start)} - ${shortDate(statement.period.end)}`,
    solde_ouverture: money(statement.opening_balance),
    total_debits: money(statement.totals.debits),
    total_credits: money(statement.totals.credits),
    solde_cloture: money(statement.totals.closing_balance),
    nombre_factures: statement.totals.invoices_count,
    nombre_paiements: statement.totals.payments_count,
    devise: statement.currency,
  }] : [];

  function backPath() {
    if (kind === 'tenant') return `/tenants/${id}/situation`;
    if (kind === 'unit') return `/rental-units/${id}`;
    return `/buildings/${id}/report`;
  }

  function exportWorkbook() {
    if (!statement) return;
    exportXlsxWorkbook(
      `Releve_${safePart(statement.entity.title)}.xlsx`,
      [
        { name: 'Releve', rows: statement.movements },
        { name: 'Resume', rows: summaryRows },
        { name: 'Debits', rows: debitRows },
        { name: 'Credits', rows: creditRows },
        { name: 'Factures', rows: statement.invoices },
        { name: 'Paiements', rows: statement.payments },
      ],
    );
  }

  return (
    <section>
      <PageHeader
        title={title}
        action={(
          <div className="page-actions">
            <button type="button" className="secondary" onClick={() => navigate(backPath())}><ArrowLeft size={16} />Retour</button>
            <button type="button" className="secondary" onClick={exportWorkbook}><FileSpreadsheet size={16} />Excel</button>
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
          <button type="button" onClick={loadStatement}><RefreshCw size={16} />Actualiser</button>
          <button type="button" className="secondary" onClick={exportWorkbook}><Download size={16} />Excel</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {!statement && !error && <EmptyState message={loading ? 'Chargement...' : 'Aucune donnee.'} />}

      {statement && (
        <>
          <section className="detail-section report-section">
            <h4>{statement.entity.title}</h4>
            <div className="summary-band">
              <SummaryCard label="Contexte" value={statement.entity.subtitle ?? backLabel} wide />
              <SummaryCard label="Periode" value={`${shortDate(statement.period.start)} - ${shortDate(statement.period.end)}`} />
              <SummaryCard label="Solde d'ouverture" value={money(statement.opening_balance)} />
              <SummaryCard label="Debits" value={money(statement.totals.debits)} />
              <SummaryCard label="Credits" value={money(statement.totals.credits)} />
              <SummaryCard label="Solde de cloture" value={money(statement.totals.closing_balance)} />
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
                    <th>Reference</th>
                    <th>Type mouvement</th>
                    <th>Libelle</th>
                    <th className="right">Debit</th>
                    <th className="right">Credit</th>
                    <th>Devise</th>
                    <th className="right">Solde courant</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.movements.map((row, index) => (
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
