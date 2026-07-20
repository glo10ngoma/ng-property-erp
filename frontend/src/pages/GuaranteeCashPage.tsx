import { FileSpreadsheet, FileText, Plus, Printer, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';

type GuaranteeCashMovement = {
  id: number;
  movement_type: string;
  type: 'IN' | 'OUT';
  amount: number;
  currency: string;
  equivalent_usd?: number;
  movement_date: string;
  lease_id?: number | null;
  lease_number?: number | null;
  tenant_id?: number | null;
  tenant_name?: string | null;
  reference?: string | null;
  reason?: string | null;
  notes?: string | null;
  user_name?: string | null;
};

type GuaranteeCashOverview = {
  total_in?: number;
  total_out?: number;
  balance_usd?: number;
  movement_count?: number;
  last_movement_date?: string | null;
  last_movement?: GuaranteeCashMovement | null;
};

const movementTypes = [
  { value: '', label: 'Tous les types' },
  { value: 'GARANTY_PAYMENT_IN', label: 'Paiement garantie' },
  { value: 'GARANTY_REFUND', label: 'Remboursement garantie' },
  { value: 'GARANTY_EXPENSE', label: 'Sortie garantie' },
  { value: 'GARANTY_TRANSFER', label: 'Transfert garantie' },
];

export function GuaranteeCashPage() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const [overview, setOverview] = useState<GuaranteeCashOverview | null>(null);
  const [movements, setMovements] = useState<GuaranteeCashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', currency: '', type: '', payment_id: searchParams.get('payment_id') ?? '' });
  const [expenseOpen, setExpenseOpen] = useState(false);

  const params = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
    [filters],
  );

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [overviewResponse, movementsResponse] = await Promise.all([
        api.get<GuaranteeCashOverview>('/guarantee-cash/overview', { params }),
        api.get<GuaranteeCashMovement[]>('/guarantee-cash/movements', { params }),
      ]);
      setOverview(overviewResponse.data);
      setMovements(movementsResponse.data);
    } catch (nextError) {
      setError(apiErrorMessage(nextError, 'Impossible de charger la caisse des garanties locatives.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [params]);

  const filtered = useMemo(
    () => movements.filter((movement) => includesText(movement, query)),
    [movements, query],
  );

  async function createExpense(form: FormData) {
    setError('');
    try {
      await api.post('/guarantee-cash/expenses', {
        movement_date: String(form.get('movement_date') ?? ''),
        amount: Number(form.get('amount') ?? 0),
        currency: String(form.get('currency') ?? 'USD'),
        reason: String(form.get('reason') ?? '').trim(),
        reference: String(form.get('reference') ?? '').trim() || null,
        notes: String(form.get('notes') ?? '').trim() || null,
      });
      setSuccess('Sortie de garantie enregistree.');
      setExpenseOpen(false);
      await load();
    } catch (nextError) {
      setError(apiErrorMessage(nextError, 'Impossible d enregistrer la sortie.'));
    }
  }

  function exportRows() {
    return filtered.map((movement) => ({
      date: shortDate(movement.movement_date),
      type: movementTypeLabel(movement.movement_type),
      bail: movement.lease_number ? `B-${String(movement.lease_number).padStart(5, '0')}` : '',
      locataire: movement.tenant_name ?? '',
      debit: movement.type === 'IN' ? movement.amount : '',
      credit: movement.type === 'OUT' ? movement.amount : '',
      devise: movement.currency,
      equivalent_usd: movement.equivalent_usd ?? movement.amount,
      reference: movement.reference ?? '',
      motif: movement.reason ?? '',
      utilisateur: movement.user_name ?? '',
    }));
  }

  return (
    <section>
      <PageHeader
        title="Caisse garanties locatives"
        action={can('guarantee_cash.expense') ? <button onClick={() => setExpenseOpen(true)}><Plus size={16} />Nouvelle sortie</button> : undefined}
      />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}

      <div className="mini-stats">
        <div className="mini-stat"><span>Solde actuel</span><strong>{money(overview?.balance_usd ?? 0)} USD</strong></div>
        <div className="mini-stat"><span>Total entrees</span><strong>{money(overview?.total_in ?? 0)} USD</strong></div>
        <div className="mini-stat"><span>Total sorties</span><strong>{money(overview?.total_out ?? 0)} USD</strong></div>
        <div className="mini-stat"><span>Mouvements</span><strong>{overview?.movement_count ?? 0}</strong></div>
        <div className="mini-stat"><span>Dernier mouvement</span><strong>{overview?.last_movement_date ? shortDate(overview.last_movement_date) : '-'}</strong></div>
      </div>

      <div className="quick-form">
        <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}>
          <option value="">Toutes devises</option>
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
          {movementTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ date_from: '', date_to: '', currency: '', type: '', payment_id: '' })}>Reinitialiser</button>
          <button type="button" className="secondary" onClick={() => void load()}><RefreshCcw size={15} />Actualiser</button>
          {can('guarantee_cash.export') ? <button type="button" className="secondary" onClick={() => exportCsv('caisse-garanties.csv', exportRows())}><FileText size={15} />CSV</button> : null}
          {can('guarantee_cash.export') ? <button type="button" className="secondary" onClick={() => exportXlsxWorkbook('Caisse_garanties.xlsx', [{ name: 'Mouvements', rows: exportRows() }])}><FileSpreadsheet size={15} />Excel</button> : null}
          {can('guarantee_cash.export') ? <button type="button" className="secondary" onClick={() => window.print()}><Printer size={15} />PDF</button> : null}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Bail</th>
              <th>Locataire</th>
              <th className="right">Debit</th>
              <th className="right">Credit</th>
              <th>Devise</th>
              <th>Reference</th>
              <th>Motif</th>
              <th>Utilisateur</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((movement) => (
              <tr key={movement.id}>
                <td>{shortDate(movement.movement_date)}</td>
                <td>{movementTypeLabel(movement.movement_type)}</td>
                <td>{movement.lease_number ? `B-${String(movement.lease_number).padStart(5, '0')}` : '-'}</td>
                <td>{movement.tenant_name || '-'}</td>
                <td className="right">{movement.type === 'IN' ? `${money(movement.amount)} ${movement.currency}` : ''}</td>
                <td className="right">{movement.type === 'OUT' ? `${money(movement.amount)} ${movement.currency}` : ''}</td>
                <td>{movement.currency}</td>
                <td>{movement.reference || '-'}</td>
                <td>{movement.reason || '-'}</td>
                <td>{movement.user_name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length ? <EmptyState title={loading ? 'Chargement...' : 'Aucun mouvement'} /> : null}
      </div>

      {expenseOpen ? (
        <Modal title="Nouvelle sortie de garantie" onClose={() => setExpenseOpen(false)}>
          <form className="quick-form" onSubmit={(event) => { event.preventDefault(); void createExpense(new FormData(event.currentTarget)); }}>
            <label>Date<input name="movement_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Devise<select name="currency" defaultValue="USD"><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
            <label className="form-field-full">Motif <em>*</em><input name="reason" required /></label>
            <label>Reference<input name="reference" /></label>
            <label className="form-field-full">Observation<textarea name="notes" rows={3} /></label>
            <button type="submit">Enregistrer</button>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function movementTypeLabel(value: string) {
  return ({
    GARANTY_PAYMENT_IN: 'Paiement garantie',
    GARANTY_REFUND: 'Remboursement garantie',
    GARANTY_EXPENSE: 'Sortie garantie',
    GARANTY_TRANSFER: 'Transfert garantie',
  } as Record<string, string>)[value] ?? value;
}

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}
