import { ArrowLeft, Eye, FileSpreadsheet, Pencil, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
import { ExpenseModal } from '../core/components/ExpenseModal';
import { useApiList } from '../hooks';
import { Trash2 } from 'lucide-react';
import { useCashExpenseCategories, type CashExpenseCategory } from '../modules/cash/hooks/useCashExpenseCategories';
import { ShareholderPayoutModal } from './ShareholderPayoutModal';

type CashMovement = {
  id: number;
  cash_session_id?: number;
  session_status?: string;
  piece_number?: string;
  type: string;
  label?: string;
  category: string;
  amount: number;
  currency?: string;
  exchange_rate_used?: number;
  exchange_rate_date?: string;
  equivalent_usd?: number;
  movement_date: string;
  invoice_number?: string;
  tenant_name?: string;
  supplier?: string;
  reference?: string;
  attachment_file_name?: string;
  attachment_file_url?: string;
  payment_id?: number | null;
  invoice_id?: number | null;
  stock_purchase_id?: number | null;
  shareholder_name?: string | null;
  shareholder_batch_id?: number | null;
  is_locked?: boolean;
  locked_reason?: string | null;
};

type CashMovementDetail = CashMovement & {
  description?: string;
  payment_method?: string;
  user_name?: string;
  employee_name?: string;
  building_name?: string;
  unit_number?: string;
  tenant_phone?: string;
  tenant_email?: string;
  opening_balance?: number;
  closing_balance?: number;
  expected_balance?: number;
  difference_amount?: number;
  opened_at?: string;
  closed_at?: string;
  timeline?: Array<Record<string, unknown>>;
  documents?: Array<{ name: string; exists: boolean; detail: string }>;
  history?: Array<Record<string, unknown>>;
};

type CashSession = {
  id: number;
  status: string;
  opening_balance: number;
  closing_balance?: number;
  opened_at: string;
  closed_at?: string;
  expected_balance?: number;
  difference_amount?: number;
};

function formatCashAmount(value: number | string | null | undefined, currency: string) {
  const amount = Number(value ?? 0);
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
  return `${formatted} ${String(currency ?? 'USD').toUpperCase() === 'CDF' ? 'CDF' : '$US'}`;
}

function debitCreditValues(movement: Pick<CashMovement, 'type' | 'amount' | 'currency'>) {
  const formattedAmount = formatCashAmount(movement.amount, movement.currency ?? 'USD');
  return movement.type === 'IN'
    ? { debit: formattedAmount, credit: '' }
    : { debit: '', credit: formattedAmount };
}

export function CashPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const movements = useApiList<CashMovement>('/cash/movements');
  const sessions = useApiList<CashSession>('/cash/sessions');
  const expenseCategories = useCashExpenseCategories();
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ type: '', category: '', period: '', currency: '' });
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [closeSessionModal, setCloseSessionModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CashMovement | null>(null);
  const [shareholderPayoutOpen, setShareholderPayoutOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const categoryNameMap = useMemo(
    () => Object.fromEntries(expenseCategories.data.map((category) => [category.code, category.name])),
    [expenseCategories.data],
  );

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...movements.data.map((movement) => movement.category).filter(Boolean),
          ...expenseCategories.data.map((category) => category.code),
        ]),
      ).sort((left, right) =>
        cashCategoryLabel(left, categoryNameMap).localeCompare(cashCategoryLabel(right, categoryNameMap), 'fr', {
          sensitivity: 'base',
        }),
      ),
    [categoryNameMap, expenseCategories.data, movements.data],
  );

  const filtered = useMemo(
    () =>
      movements.data.filter(
        (item) =>
          includesText(item, query) &&
          (!filters.type || item.type === filters.type) &&
          (!filters.category || item.category === filters.category) &&
          (!filters.period || String(item.movement_date).slice(0, 7) === filters.period) &&
          (!filters.currency || String(item.currency ?? 'USD') === filters.currency),
      ),
    [movements.data, query, filters],
  );

  const sortedMovements = useMemo(() => {
    if (!sortKey) return filtered;
    const direction = sortDirection === 'asc' ? 1 : -1;
    return filtered
      .map((movement, index) => ({ movement, index }))
      .sort((left, right) => {
        const a = sortValue(left.movement, sortKey);
        const b = sortValue(right.movement, sortKey);
        if (a === null && b === null) return left.index - right.index;
        if (a === null) return 1;
        if (b === null) return -1;
        let comparison = 0;
        if (typeof a === 'number' && typeof b === 'number') {
          comparison = a - b;
        } else {
          comparison = String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true });
        }
        if (comparison === 0) return left.index - right.index;
        return comparison * direction;
      })
      .map((row) => row.movement);
  }, [filtered, sortDirection, sortKey]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const inByCurrency = (currency: string, dateCheck?: (movement: CashMovement) => boolean) =>
      movements.data
        .filter((m) => m.type === 'IN' && String(m.currency ?? 'USD') === currency && (!dateCheck || dateCheck(m)))
        .reduce((sum, m) => sum + Number(m.amount), 0);
    const outByCurrency = (currency: string, dateCheck?: (movement: CashMovement) => boolean) =>
      movements.data
        .filter((m) => m.type === 'OUT' && String(m.currency ?? 'USD') === currency && (!dateCheck || dateCheck(m)))
        .reduce((sum, m) => sum + Number(m.amount), 0);
    return {
      usd: {
        balance: inByCurrency('USD') - outByCurrency('USD'),
        todayIn: inByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 10) === today),
        todayOut: outByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 10) === today),
        monthIn: inByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 7) === month),
        monthOut: outByCurrency('USD', (movement) => String(movement.movement_date).slice(0, 7) === month),
      },
      cdf: {
        balance: inByCurrency('CDF') - outByCurrency('CDF'),
        todayIn: inByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 10) === today),
        todayOut: outByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 10) === today),
        monthIn: inByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 7) === month),
        monthOut: outByCurrency('CDF', (movement) => String(movement.movement_date).slice(0, 7) === month),
      },
      count: movements.data.length,
    };
  }, [movements.data]);

  const openSession = useMemo(
    () => sessions.data.find((session) => session.status === 'OPEN') ?? null,
    [sessions.data],
  );

  const sessionMovements = useMemo(
    () => openSession ? movements.data.filter((movement) => Number(movement.cash_session_id) === Number(openSession.id)) : [],
    [movements.data, openSession],
  );

  const expectedClosingBalance = useMemo(() => {
    if (!openSession) return 0;
    const totalIn = sessionMovements
      .filter((movement) => movement.type === 'IN')
      .reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0);
    const totalOut = sessionMovements
      .filter((movement) => movement.type === 'OUT')
      .reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0);
    return Number(openSession.opening_balance ?? 0) + totalIn - totalOut;
  }, [openSession, sessionMovements]);

  const nextPieceNumber = useMemo(() => {
    const expenses = movements.data
      .map((movement) => movement.piece_number ?? '')
      .filter((value) => value.startsWith('D-'))
      .map((value) => Number(value.replace(/^D-/, '')))
      .filter((value) => Number.isFinite(value));
    const next = expenses.length ? Math.max(...expenses) + 1 : 1;
    return `D-${String(next).padStart(4, '0')}`;
  }, [movements.data]);

  async function expense(payload: Record<string, unknown>) {
    setError('');
    await api.post('/cash/expenses', payload);
    setSuccess('Mouvement de caisse enregistre.');
    await movements.reload();
    await sessions.reload();
  }

  async function createExpenseCategory(payload: { code: string; name: string; description?: string | null; status?: string }) {
    setError('');
    const response = await api.post<CashExpenseCategory>('/cash/expense-categories', payload);
    await expenseCategories.reload();
    setSuccess('Cat\u00e9gorie de d\u00e9pense cr\u00e9\u00e9e.');
    return response.data;
  }

  async function deleteMovement(movement: CashMovement) {
    setError('');
    if (movement.is_locked) {
      setError(movement.locked_reason || 'Ce mouvement ne peut pas etre supprime.');
      setDeleteTarget(null);
      return;
    }
    await api.delete(`/cash/movements/${movement.id}`);
    setDeleteTarget(null);
    setSuccess('Mouvement de caisse supprime.');
    await movements.reload();
    await sessions.reload();
  }

  async function openCashSession(payload: { opening_balance: number }) {
    setError('');
    await api.post('/cash/open', payload);
    setOpenSessionModal(false);
    setSuccess('Caisse ouverte avec succes.');
    await sessions.reload();
    await movements.reload();
  }

  async function closeCashSession(payload: { actual_closing_balance: number }) {
    setError('');
    await api.post('/cash/close', payload);
    setCloseSessionModal(false);
    setSuccess('Caisse fermee avec succes.');
    await sessions.reload();
    await movements.reload();
  }

  function exportRows() {
    return sortedMovements.map((movement) => ({
      date: shortDate(movement.movement_date),
      piece: movement.piece_number ?? '-',
      type: movementTypeLabel(movement.type),
      libelle: movement.label ?? movement.reference ?? '-',
      categorie: cashCategoryLabel(movement.category),
      debit: debitCreditValues(movement).debit,
      credit: debitCreditValues(movement).credit,
      devise: movement.currency ?? 'USD',
      taux: movement.exchange_rate_used ?? '-',
      equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
      facture: movement.invoice_number ?? '-',
      locataire_ou_fournisseur: movement.tenant_name ?? movement.supplier ?? movement.shareholder_name ?? '-',
      reference: movement.reference ?? '-',
      statut: movement.type === 'IN' ? 'Entree' : 'Depense',
    }));
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
      return;
    }
    if (sortDirection === 'asc') {
      setSortDirection('desc');
      return;
    }
    setSortKey(null);
    setSortDirection('asc');
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return '';
    return sortDirection === 'asc' ? '↑' : '↓';
  }

  return (
    <section>
      <PageHeader
        title="Caisse"
        action={
          <button type="button" className="secondary" onClick={() => navigate('/cash/categories')}>
            {'Cat\u00e9gories de d\u00e9penses'}
          </button>
        }
      />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}
      <div className="mini-stats cash-kpi-row cash-kpi-row-primary">
        <div className="mini-stat"><span>Solde USD</span><strong>{formatCashAmount(stats.usd.balance, 'USD')}</strong></div>
        <div className="mini-stat"><span>Entrees USD aujourd'hui</span><strong>{formatCashAmount(stats.usd.todayIn, 'USD')}</strong></div>
        <div className="mini-stat"><span>Depenses USD aujourd'hui</span><strong>{formatCashAmount(stats.usd.todayOut, 'USD')}</strong></div>
        <div className="mini-stat"><span>Entrees USD du mois</span><strong>{formatCashAmount(stats.usd.monthIn, 'USD')}</strong></div>
        <div className="mini-stat"><span>Depenses USD du mois</span><strong>{formatCashAmount(stats.usd.monthOut, 'USD')}</strong></div>
        <div className="mini-stat"><span>Solde CDF</span><strong>{formatCashAmount(stats.cdf.balance, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Entrees CDF aujourd'hui</span><strong>{formatCashAmount(stats.cdf.todayIn, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Depenses CDF aujourd'hui</span><strong>{formatCashAmount(stats.cdf.todayOut, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Entrees CDF du mois</span><strong>{formatCashAmount(stats.cdf.monthIn, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Depenses CDF du mois</span><strong>{formatCashAmount(stats.cdf.monthOut, 'CDF')}</strong></div>
        <div className="mini-stat"><span>Nombre de mouvements</span><strong>{stats.count}</strong></div>
        <div className="mini-stat">
          <span>Session caisse</span>
          <strong>{openSession ? 'Ouverte' : 'Aucune session ouverte'}</strong>
        </div>
        <div className="mini-stat">
          <span>Ouverture</span>
          <strong>{openSession ? formatCashAmount(openSession.opening_balance, 'USD') : '-'}</strong>
        </div>
        <div className="mini-stat">
          <span>Solde attendu</span>
          <strong>{openSession ? formatCashAmount(expectedClosingBalance, 'USD') : '-'}</strong>
        </div>
        <div className="mini-stat">
          <span>Ouverte le</span>
          <strong>{openSession ? shortDate(openSession.opened_at) : '-'}</strong>
        </div>
      </div>

      <div className="cash-session-panel">
        {expenseCategories.error ? <div className="error-message">{expenseCategories.error}</div> : null}
        {can('cash.create') ? (
          <div className="actions-row cash-action-row">
            <button type="button" onClick={() => setOpenSessionModal(true)} disabled={Boolean(openSession)}>
              Ouvrir la caisse
            </button>
            <button type="button" className="secondary" onClick={() => setCloseSessionModal(true)} disabled={!openSession}>
              Fermer la caisse
            </button>
            {can('shareholder_payouts.create') ? (
              <button type="button" className="secondary" onClick={() => setShareholderPayoutOpen(true)} disabled={!openSession}>
                Rembourser actionnaires
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={() => setExpenseOpen(true)} disabled={Boolean(!openSession)}>
              Enregistrer dépense
            </button>
          </div>
        ) : null}
      </div>

      <div className="quick-form compact-grid cash-filters-row cash-filter-bar">
        <div className="cash-filter-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        </div>
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
          <option value="">Type</option>
          <option value="IN">Entree</option>
          <option value="OUT">Depense</option>
        </select>
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">{'Cat\u00e9gorie'}</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {cashCategoryLabel(category, categoryNameMap)}
            </option>
          ))}
        </select>
        <input type="month" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} />
        <select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}>
          <option value="">Devise</option>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
        <div className="filter-actions cash-filter-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ type: '', category: '', period: '', currency: '' })}>{'R\u00e9initialiser'}</button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              exportXlsxWorkbook('Caisse.xlsx', [
                { name: 'Resume', rows: [{ solde_usd: formatCashAmount(stats.usd.balance, 'USD'), entrees_usd_aujourdhui: formatCashAmount(stats.usd.todayIn, 'USD'), depenses_usd_aujourdhui: formatCashAmount(stats.usd.todayOut, 'USD'), entrees_usd_du_mois: formatCashAmount(stats.usd.monthIn, 'USD'), depenses_usd_du_mois: formatCashAmount(stats.usd.monthOut, 'USD'), solde_cdf: formatCashAmount(stats.cdf.balance, 'CDF'), entrees_cdf_aujourdhui: formatCashAmount(stats.cdf.todayIn, 'CDF'), depenses_cdf_aujourdhui: formatCashAmount(stats.cdf.todayOut, 'CDF'), entrees_cdf_du_mois: formatCashAmount(stats.cdf.monthIn, 'CDF'), depenses_cdf_du_mois: formatCashAmount(stats.cdf.monthOut, 'CDF'), nombre_mouvements: stats.count }] },
                { name: 'Mouvements', rows: exportRows() },
                { name: 'Entrees', rows: filtered.filter((movement) => movement.type === 'IN').map(cashExportRow) },
                { name: 'Depenses', rows: filtered.filter((movement) => movement.type === 'OUT').map(cashExportRow) },
                { name: 'Categories', rows: Array.from(new Set(filtered.map((movement) => movement.category))).map((category) => ({ categorie: cashCategoryLabel(category, categoryNameMap), nombre: filtered.filter((movement) => movement.category === category).length })) },
                { name: 'Documents', rows: [] },
                { name: 'Timeline', rows: filtered.map((movement) => ({ date: shortDate(movement.movement_date), evenement: movementTypeLabel(movement.type), description: movement.label ?? movement.reference ?? '-', utilisateur: '-' })) },
                { name: 'Audit', rows: filtered.map((movement) => ({ piece: movement.piece_number ?? '-', reference: movement.reference ?? '-', statut: 'Disponible' })) },
              ])
            }
          >
            Export
          </button>
        </div>
      </div>
      {openSessionModal ? (
        <CashOpenSessionModal
          onClose={() => setOpenSessionModal(false)}
          onSubmit={openCashSession}
        />
      ) : null}
      {closeSessionModal && openSession ? (
        <CashCloseSessionModal
          session={openSession}
          expectedBalance={expectedClosingBalance}
          onClose={() => setCloseSessionModal(false)}
          onSubmit={closeCashSession}
        />
      ) : null}
      {deleteTarget ? (
        <CashDeleteMovementModal
          movement={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMovement(deleteTarget)}
        />
      ) : null}
      {shareholderPayoutOpen ? (
        <ShareholderPayoutModal
          endpoint="/cash/shareholder-payouts"
          sourceRegister="MAIN_CASH"
          onClose={() => setShareholderPayoutOpen(false)}
          onSuccess={async () => {
            await movements.reload();
            await sessions.reload();
            setSuccess('Remboursement actionnaires enregistré.');
          }}
        />
      ) : null}
      <ExpenseModal
        open={expenseOpen}
        sourceRegister="MAIN_CASH"
        categories={expenseCategories.data}
        nextPieceNumber={nextPieceNumber}
        onClose={() => setExpenseOpen(false)}
        onSubmit={expense}
        onCreateCategory={createExpenseCategory}
      />

      <div className="table-wrap cash-table-wrap">
        <table>
          <thead>
            <tr>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('movement_date')}>Date <span>{sortIndicator('movement_date')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('piece_number')}>N° piece <span>{sortIndicator('piece_number')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('type')}>Type <span>{sortIndicator('type')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('label')}>Libelle <span>{sortIndicator('label')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('category')}>Categorie <span>{sortIndicator('category')}</span></button></th>
              <th className="right"><button type="button" className="table-sort-button table-sort-button-right" onClick={() => toggleSort('debit')}>Débit <span>{sortIndicator('debit')}</span></button></th>
              <th className="right"><button type="button" className="table-sort-button table-sort-button-right" onClick={() => toggleSort('credit')}>Crédit <span>{sortIndicator('credit')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('currency')}>Devise <span>{sortIndicator('currency')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('exchange_rate_used')}>Taux <span>{sortIndicator('exchange_rate_used')}</span></button></th>
              <th className="right"><button type="button" className="table-sort-button table-sort-button-right" onClick={() => toggleSort('equivalent_usd')}>Eq. USD <span>{sortIndicator('equivalent_usd')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('invoice_number')}>Facture <span>{sortIndicator('invoice_number')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('counterparty')}>Locataire / Fournisseur <span>{sortIndicator('counterparty')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('reference')}>Reference <span>{sortIndicator('reference')}</span></button></th>
              <th><button type="button" className="table-sort-button" onClick={() => toggleSort('status')}>Statut <span>{sortIndicator('status')}</span></button></th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedMovements.map((movement) => {
              const amounts = debitCreditValues(movement);
              return (
              <tr key={movement.id} className="clickable-row" onClick={() => navigate(`/cash/${movement.id}`)}>
                <td>{shortDate(movement.movement_date)}</td>
                <td>{movement.piece_number ?? '-'}</td>
                <td>{movementTypeLabel(movement.type)}</td>
                <td>{movement.label ?? movement.reference ?? '-'}</td>
                <td>{cashCategoryLabel(movement.category, categoryNameMap)}</td>
                <td className="right">{amounts.debit}</td>
                <td className="right">{amounts.credit}</td>
                <td>{movement.currency ?? 'USD'}</td>
                <td>{movement.exchange_rate_used ? movement.exchange_rate_used.toLocaleString('fr-FR') : '-'}</td>
                <td className="right">{formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD')}</td>
                <td>{movement.invoice_number ?? '-'}</td>
                <td>{movement.tenant_name ?? movement.supplier ?? movement.shareholder_name ?? '-'}</td>
                <td>{movement.reference ?? '-'}</td>
                <td>
                  <span className={`badge ${movement.type === 'IN' ? 'paid' : 'unpaid'}`}>{movement.type === 'IN' ? 'Entree' : 'Depense'}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title="Voir"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/cash/${movement.id}`);
                      }}
                    >
                      <Eye size={16} />
                    </button>
                    {can('cash.update') ? (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Supprimer le mouvement"
                        aria-label="Supprimer le mouvement"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (movement.is_locked) {
                            setError(movement.locked_reason || 'Ce mouvement ne peut pas etre supprime.');
                            return;
                          }
                          setDeleteTarget(movement);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
    </section>
  );
}

function CashOpenSessionModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { opening_balance: number }) => Promise<void>;
}) {
  const [openingBalance, setOpeningBalance] = useState('0');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const amount = Number(openingBalance);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Le solde d'ouverture doit etre superieur ou egal a 0.");
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ opening_balance: amount });
    } catch (err: any) {
      setError(apiErrorMessage(err, "Impossible d'ouvrir la caisse."));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Ouvrir la caisse" onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-section">
          <h3>Session</h3>
          <div className="lease-section-grid">
            <label>
              Solde d'ouverture *
              <input type="number" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} required />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
          <button type="submit" disabled={submitting}>{submitting ? 'Ouverture...' : 'Ouvrir la caisse'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CashCloseSessionModal({
  session,
  expectedBalance,
  onClose,
  onSubmit,
}: {
  session: CashSession;
  expectedBalance: number;
  onClose: () => void;
  onSubmit: (payload: { actual_closing_balance: number }) => Promise<void>;
}) {
  const [actualBalance, setActualBalance] = useState(String(Number(expectedBalance.toFixed(2))));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const difference = Number(actualBalance || 0) - expectedBalance;

  async function submit() {
    const amount = Number(actualBalance);
    if (!Number.isFinite(amount)) {
      setError('Le solde reel est invalide.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ actual_closing_balance: amount });
    } catch (err: any) {
      setError(apiErrorMessage(err, "Impossible de fermer la caisse."));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Fermer la caisse" onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-section">
          <h3>Cloture</h3>
          <div className="mini-stats">
            <div className="mini-stat"><span>Ouverture</span><strong>{formatCashAmount(session.opening_balance, 'USD')}</strong></div>
            <div className="mini-stat"><span>Solde attendu</span><strong>{formatCashAmount(expectedBalance, 'USD')}</strong></div>
            <div className="mini-stat"><span>Ecart</span><strong>{formatCashAmount(difference, 'USD')}</strong></div>
          </div>
          <div className="lease-section-grid">
            <label>
              Solde reel *
              <input type="number" step="0.01" value={actualBalance} onChange={(event) => setActualBalance(event.target.value)} required />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
          <button type="submit" disabled={submitting}>{submitting ? 'Cloture...' : 'Fermer la caisse'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CashDeleteMovementModal({
  movement,
  onClose,
  onConfirm,
}: {
  movement: CashMovement;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      await onConfirm();
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Impossible de supprimer ce mouvement.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Supprimer le mouvement" onClose={onClose}>
      <div className="modal-section">
        <h3>Confirmation</h3>
        <p>Supprimer définitivement ce mouvement ?</p>
        <p>Cette opération est irréversible.</p>
        <div className="mini-stats">
          <div className="mini-stat">
            <span>Piece</span>
            <strong>{movement.piece_number ?? '-'}</strong>
          </div>
          <div className="mini-stat">
            <span>Montant</span>
            <strong>{formatCashAmount(movement.amount, movement.currency ?? 'USD')}</strong>
          </div>
          <div className="mini-stat">
            <span>Catégorie</span>
            <strong>{cashCategoryLabel(movement.category)}</strong>
          </div>
        </div>
        {error ? <div className="error-message">{error}</div> : null}
      </div>
      <div className="modal-footer-sticky">
        <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
          Annuler
        </button>
        <button type="button" className="danger" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Suppression...' : 'Supprimer'}
        </button>
      </div>
    </Modal>
  );
}

export function CashDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [movement, setMovement] = useState<CashMovementDetail | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<CashMovementDetail>(`/cash/movements/${id}`).then((response) => setMovement(response.data));
  }, [id]);

  if (!movement) return <div className="empty">Chargement du mouvement...</div>;

  const rows = [
    {
      piece: movement.piece_number ?? '-',
      date: shortDate(movement.movement_date),
      type: movementTypeLabel(movement.type),
      category: cashCategoryLabel(movement.category),
      amount: formatCashAmount(movement.amount, movement.currency ?? 'USD'),
      devise: movement.currency ?? 'USD',
      taux: movement.exchange_rate_used ?? '-',
      equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
      reference: movement.reference ?? '-',
      tenant: movement.tenant_name ?? '-',
      attachment: movement.attachment_file_name ?? '-',
    },
  ];

  return (
    <section>
      <div className="page-header no-print">
        <h2>Mouvement de caisse</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/cash')}>
            <ArrowLeft size={16} />
            Retour
          </button>
          {can('cash.update') && (
            <button>
              <Pencil size={16} />
              Modifier
            </button>
          )}
          {can('cash.update') ? (
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (movement.is_locked) {
                  window.alert(movement.locked_reason || 'Ce mouvement ne peut pas etre supprime.');
                  return;
                }
                setDeleteOpen(true);
              }}
            >
              Supprimer
            </button>
          ) : null}
          <button onClick={() => window.print()}>
            <Printer size={16} />
            Imprimer
          </button>
          <button
            className="secondary"
            onClick={() =>
              exportXlsxWorkbook(`Caisse_${movement.id}.xlsx`, [
                { name: 'Resume', rows },
                { name: 'Mouvements', rows },
                { name: 'Entrees', rows: movement.type === 'IN' ? rows : [] },
                { name: 'Depenses', rows: movement.type === 'OUT' ? rows : [] },
                { name: 'Categories', rows: [{ categorie: cashCategoryLabel(movement.category), nombre: 1 }] },
                { name: 'Documents', rows: movement.documents ?? [] },
                { name: 'Timeline', rows: movement.timeline ?? [] },
                { name: 'Audit', rows: movement.history ?? [] },
              ])
            }
          >
            <FileSpreadsheet size={16} />
            Exporter Excel
          </button>
        </div>
      </div>

      <article className="print-invoice">
        <header>
          <div className="invoice-logo">PE</div>
          <div>
            <h2>NG Property ERP</h2>
            <p>Reçu de mouvement de caisse</p>
            <p>Merci pour votre confiance.</p>
          </div>
          <div className="invoice-meta">
            <strong>
              {movement.type === 'IN' ? 'Entrée' : 'Dépense'} #{movement.id}
            </strong>
            <span>N° pièce: {movement.piece_number ?? '-'}</span>
            <span>Date: {shortDate(movement.movement_date)}</span>
            <span>Montant: {formatCashAmount(movement.amount, movement.currency ?? 'USD')}</span>
            <span>Référence: {movement.reference ?? '-'}</span>
          </div>
        </header>

        <div className="invoice-parties">
          <div>
            <span>Informations générales</span>
            <strong>{cashCategoryLabel(movement.category)}</strong>
            <p>Libellé: {movement.label ?? movement.description ?? '-'}</p>
            <p>Facture: {movement.invoice_number ?? '-'}</p>
            <p>Locataire: {movement.tenant_name ?? '-'}</p>
            <p>Téléphone: {movement.tenant_phone ?? '-'}</p>
            <p>Email: {movement.tenant_email ?? '-'}</p>
          </div>
          <div>
            <span>Détails</span>
            <strong>{movement.building_name ?? '-'}</strong>
            <p>Appartement: {movement.unit_number ?? '-'}</p>
            <p>Utilisateur: {movement.user_name ?? movement.employee_name ?? '-'}</p>
            <p>Mode de paiement: {movement.payment_method ?? '-'}</p>
            <p>Observations: {movement.description ?? '-'}</p>
          </div>
        </div>

            <div className="cash-summary-grid">
              <div className="mini-stat">
                <span>Type</span>
                <strong>{movementTypeLabel(movement.type)}</strong>
          </div>
          <div className="mini-stat">
                <span>Catégorie</span>
                <strong>{cashCategoryLabel(movement.category)}</strong>
          </div>
          <div className="mini-stat">
            <span>Montant</span>
            <strong>{formatCashAmount(movement.amount, movement.currency ?? 'USD')}</strong>
          </div>
              <div className="mini-stat">
                <span>Facture</span>
                <strong>{movement.invoice_number ?? '-'}</strong>
              </div>
            </div>

            <div className="detail-section no-print">
              <h4>Pièce jointe</h4>
              {movement.attachment_file_name ? (
                <div className="actions-row">
                  <span className="info-message">{movement.attachment_file_name}</span>
                  {movement.attachment_file_url ? (
                    <a className="secondary" href={movement.attachment_file_url} target="_blank" rel="noreferrer">
                      Voir / Télécharger
                    </a>
                  ) : (
                    <span className="compact-empty">Aucune URL de fichier disponible.</span>
                  )}
                </div>
              ) : (
                <div className="compact-empty">Aucune pièce jointe.</div>
              )}
            </div>
          </article>

      <div className="invoice-accordion-grid no-print">
        <details>
          <summary>Timeline ({movement.timeline?.length ?? 0})</summary>
          <SimpleBlock rows={movement.timeline ?? []} />
        </details>
        <details>
          <summary>Documents ({movement.documents?.length ?? 0})</summary>
          <SimpleBlock rows={movement.documents ?? []} />
        </details>
        <details>
          <summary>Historique ({movement.history?.length ?? 0})</summary>
          <SimpleBlock rows={movement.history ?? []} />
        </details>
      </div>
      {deleteOpen ? (
        <CashDeleteMovementModal
          movement={movement}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            await api.delete(`/cash/movements/${movement.id}`);
            navigate('/cash');
          }}
        />
      ) : null}
    </section>
  );
}

function CashExpenseForm({
  categories,
  onSubmit,
  onCreateCategory,
  nextPieceNumber,
}: {
  categories: CashExpenseCategory[];
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCreateCategory: (payload: { code: string; name: string; description?: string | null; status?: string }) => Promise<CashExpenseCategory>;
  nextPieceNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachmentName, setAttachmentName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  const activeCategories = useMemo(
    () => categories.filter((category) => category.status === 'ACTIVE'),
    [categories],
  );
  const [formState, setFormState] = useState({
    label: '',
    category: '',
    amount: '',
    movement_date: new Date().toISOString().slice(0, 10),
    supplier: '',
    payment_method: '',
    reference: '',
    description: '',
    notes: '',
  });

  function resetForm() {
    setFormState({
      label: '',
      category: '',
      amount: '',
      movement_date: new Date().toISOString().slice(0, 10),
      supplier: '',
      payment_method: '',
      reference: '',
      description: '',
      notes: '',
    });
    setAttachmentName('');
    setCurrency('USD');
    setFormError('');
    setCategoryModalOpen(false);
  }

  async function submit() {
    if (!formState.category) {
      setFormError('La cat\u00e9gorie est obligatoire.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await onSubmit({
        label: formState.label,
        category: formState.category,
        amount: formState.amount,
        movement_date: formState.movement_date,
        supplier: formState.supplier || null,
        payment_method: formState.payment_method || null,
        reference: formState.reference || null,
        description: formState.description || null,
        notes: formState.notes || null,
        attachment_file_name: attachmentName || null,
        currency,
      });
      resetForm();
      setOpen(false);
    } catch (err: any) {
      setFormError(apiErrorMessage(err, 'Impossible d enregistrer la d\u00e9pense.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <>
      <div className="actions-row">
        <button type="button" onClick={() => setOpen(true)}>
          {'Enregistrer d\u00e9pense'}
        </button>
      </div>
      {open && (
        <Modal title={'Enregistrer d\u00e9pense'} onClose={() => setOpen(false)}>
          <form
            className="cash-modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="modal-section">
              <h3>Informations principales</h3>
              <div className="lease-section-grid">
                <label>
                  N° piece
                  <input value={nextPieceNumber} readOnly className="locked-field" />
                </label>
                <label>
                  Libelle *
                  <input
                    name="label"
                    required
                    placeholder="Libelle"
                    value={formState.label}
                    onChange={(event) => setFormState((current) => ({ ...current, label: event.target.value }))}
                  />
                </label>
                <label className="lease-field-wide">
                  {'Cat\u00e9gorie *'}
                  <div className="cash-category-inline">
                    <select
                      name="category"
                      required
                      value={formState.category}
                      onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value }))}
                    >
                      <option value="">Selectionner</option>
                      {activeCategories.map((category) => (
                        <option key={category.id} value={category.code}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="secondary" onClick={() => setCategoryModalOpen(true)}>
                      {'+ Nouvelle cat\u00e9gorie'}
                    </button>
                  </div>
                </label>
                <label>
                  Montant *
                  <input
                    name="amount"
                    type="number"
                    required
                    step="0.01"
                    value={formState.amount}
                    onChange={(event) => setFormState((current) => ({ ...current, amount: event.target.value }))}
                  />
                </label>
                <label>
                  Date *
                  <input
                    name="movement_date"
                    type="date"
                    required
                    value={formState.movement_date}
                    onChange={(event) => setFormState((current) => ({ ...current, movement_date: event.target.value }))}
                  />
                </label>
                <label>
                  Devise
                  <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as 'USD' | 'CDF')}>
                    <option value="USD">USD</option>
                    <option value="CDF">CDF</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="modal-section">
              <h3>Paiement / fournisseur</h3>
              <div className="lease-section-grid">
                <label>
                  Fournisseur
                  <input
                    name="supplier"
                    placeholder="Fournisseur"
                    value={formState.supplier}
                    onChange={(event) => setFormState((current) => ({ ...current, supplier: event.target.value }))}
                  />
                </label>
                <label>
                  Moyen de paiement
                  <select
                    name="payment_method"
                    value={formState.payment_method}
                    onChange={(event) => setFormState((current) => ({ ...current, payment_method: event.target.value }))}
                  >
                    <option value="">-</option>
                    <option value="CASH">Especes</option>
                    <option value="BANK">Banque</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    name="reference"
                    placeholder="Reference"
                    value={formState.reference}
                    onChange={(event) => setFormState((current) => ({ ...current, reference: event.target.value }))}
                  />
                </label>
                <label>
                  Pièce jointe
                  <input
                    name="attachment_file"
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')}
                  />
                </label>
                <label>
                  Fichier sélectionné
                  <input value={attachmentName || '-'} readOnly className="locked-field" />
                </label>
              </div>
            </div>

            <div className="modal-section">
              <h3>Notes</h3>
              <div className="lease-section-grid">
                <label>
                  Description
                  <textarea
                    name="description"
                    rows={2}
                    placeholder="Description"
                    value={formState.description}
                    onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <label>
                  Observations internes
                  <textarea
                    name="notes"
                    rows={2}
                    placeholder="Observations internes"
                    value={formState.notes}
                    onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>
            </div>
            {formError ? <div className="error-message">{formError}</div> : null}

            <div className="modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => { resetForm(); setOpen(false); }} disabled={submitting}>
                Annuler
              </button>
              <button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
          {categoryModalOpen ? (
            <CashInlineCategoryModal
              onClose={() => setCategoryModalOpen(false)}
              onSubmit={async (payload) => {
                const created = await onCreateCategory(payload);
                setFormState((current) => ({ ...current, category: created.code }));
                setCategoryModalOpen(false);
              }}
            />
          ) : null}
        </Modal>
      )}
    </>
  );
}

function CashInlineCategoryModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { code: string; name: string; description?: string | null; status?: string }) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(form: HTMLFormElement) {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        code: String(new FormData(form).get('code') ?? '').trim(),
        name: String(new FormData(form).get('name') ?? '').trim(),
        description: String(new FormData(form).get('description') ?? '').trim() || null,
        status: 'ACTIVE',
      });
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Impossible de cr\u00e9er la cat\u00e9gorie.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title={'Nouvelle cat\u00e9gorie'} onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="modal-section">
          <h3>{'Cat\u00e9gorie de d\u00e9pense'}</h3>
          <div className="lease-section-grid">
            <label>
              Code
              <input name="code" placeholder="AUTRE_DEPENSE" />
            </label>
            <label>
              Nom *
              <input name="name" required placeholder={'Autre d\u00e9pense'} />
            </label>
            <label className="lease-field-full">
              Description
              <textarea name="description" rows={3} placeholder="Description" />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function cashExportRow(movement: CashMovement) {
  const amounts = debitCreditValues(movement);
  return {
    date: shortDate(movement.movement_date),
    piece: movement.piece_number ?? '-',
    type: movementTypeLabel(movement.type),
    libelle: movement.label ?? movement.reference ?? '-',
    categorie: cashCategoryLabel(movement.category),
    debit: amounts.debit,
    credit: amounts.credit,
    devise: movement.currency ?? 'USD',
    taux: movement.exchange_rate_used ?? '-',
    equivalent_usd: formatCashAmount(movement.equivalent_usd ?? movement.amount, 'USD'),
    facture: movement.invoice_number ?? '-',
    locataire_ou_fournisseur: movement.tenant_name ?? movement.supplier ?? movement.shareholder_name ?? '-',
    reference: movement.reference ?? '-',
    piece_jointe: movement.attachment_file_name ?? '-',
  };
}

function cashCategoryLabel(value: string, categories?: Record<string, string>) {
  if (categories?.[value]) return categories[value];
  return (
    {
      INVOICE_PAYMENT: 'Paiement facture',
      SALARY_ADVANCE: 'Avance salaire',
      OTHER_INCOME: 'Autre entree',
      OTHER_EXPENSE: 'Autre d\u00e9pense',
      LEASE_GUARANTEE: 'Garantie locative',
      LEASE_GUARANTEE_REFUND: 'Remboursement garantie',
      SALARY_PAYMENT: 'Paiement salaire',
      MAINTENANCE_EXPENSE: 'Depense maintenance',
      PAYMENT_REFUND: 'Remboursement paiement',
      STOCK_PURCHASE: 'Achat fournisseur',
      SHAREHOLDER_PAYOUT: 'Actionnaires',
    } as Record<string, string>
  )[value] ?? value;
}

function movementTypeLabel(value: string) {
  return ({ IN: 'Entree', OUT: 'Depense' } as Record<string, string>)[value] ?? value;
}

function sortValue(movement: CashMovement, key: string) {
  switch (key) {
    case 'movement_date':
      return movement.movement_date ? new Date(movement.movement_date).getTime() : null;
    case 'piece_number':
      return movement.piece_number ?? null;
    case 'type':
      return movementTypeLabel(movement.type);
    case 'label':
      return movement.label ?? movement.reference ?? null;
    case 'category':
      return cashCategoryLabel(movement.category);
    case 'debit':
      return movement.type === 'IN' ? Number(movement.amount ?? 0) : null;
    case 'credit':
      return movement.type === 'OUT' ? Number(movement.amount ?? 0) : null;
    case 'currency':
      return movement.currency ?? null;
    case 'exchange_rate_used':
      return movement.exchange_rate_used == null ? null : Number(movement.exchange_rate_used);
    case 'equivalent_usd':
      return movement.equivalent_usd == null ? Number(movement.amount ?? 0) : Number(movement.equivalent_usd);
    case 'invoice_number':
      return movement.invoice_number ?? null;
    case 'counterparty':
      return movement.tenant_name ?? movement.supplier ?? movement.shareholder_name ?? null;
    case 'reference':
      return movement.reference ?? null;
    case 'status':
      return movementTypeLabel(movement.type);
    default:
      return null;
  }
}

function apiErrorMessage(error: any, fallback: string) {
  const message = error?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

function SimpleBlock({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="compact-list">
      {rows.length ? rows.map((row, index) => <div className="compact-item" key={index}><span>{Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? '-')}`).join(' | ')}</span></div>) : <div className="empty-inline">Aucune donnee.</div>}
    </div>
  );
}
