import { FileSpreadsheet, FileText, Printer, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, exportCsv, exportXlsxWorkbook, includesText, shortDate } from '../api';
import { EmptyState, PageHeader } from '../components';

type SyndicMovement = {
  id: number;
  movement_date: string;
  amount: number;
  equivalent_usd: number;
  currency: string;
  payment_method: string;
  treasury_location: 'MAIN_CASH' | 'BANK';
  invoice_number?: string | null;
  tenant_name?: string | null;
  reference?: string | null;
  user_name?: string | null;
};

type SyndicOverview = {
  balance_usd?: number;
  total_in?: number;
  total_out?: number;
  main_cash_total?: number;
  bank_total?: number;
  movement_count?: number;
  last_movement_date?: string | null;
};

export function SyndicCashPage() {
  const [overview, setOverview] = useState<SyndicOverview>({});
  const [movements, setMovements] = useState<SyndicMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', currency: '', payment_method: '', treasury_location: '' });
  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [overviewResponse, movementsResponse] = await Promise.all([
        api.get<SyndicOverview>('/syndic-cash/overview', { params }),
        api.get<SyndicMovement[]>('/syndic-cash/movements', { params }),
      ]);
      setOverview(overviewResponse.data);
      setMovements(movementsResponse.data);
    } catch {
      setError('Impossible de charger la caisse syndic.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params]);
  const filtered = useMemo(() => movements.filter((movement) => includesText(movement, query)), [movements, query]);
  const exportRows = () => filtered.map((movement) => ({
    date: shortDate(movement.movement_date),
    facture: movement.invoice_number ?? '',
    locataire: movement.tenant_name ?? '',
    montant: movement.amount,
    devise: movement.currency,
    equivalent_usd: movement.equivalent_usd,
    mode: movement.payment_method,
    emplacement: movement.treasury_location === 'BANK' ? 'Banque' : 'Caisse principale',
    reference: movement.reference ?? '',
  }));

  return (
    <section>
      <PageHeader title="Caisse syndic" />
      {error ? <div className="error-message">{error}</div> : null}
      <div className="mini-stats">
        <div className="mini-stat"><span>Solde ventilé</span><strong>{money(overview.balance_usd)} USD</strong></div>
        <div className="mini-stat"><span>En caisse</span><strong>{money(overview.main_cash_total)} USD</strong></div>
        <div className="mini-stat"><span>En banque</span><strong>{money(overview.bank_total)} USD</strong></div>
        <div className="mini-stat"><span>Mouvements</span><strong>{overview.movement_count ?? 0}</strong></div>
        <div className="mini-stat"><span>Dernier mouvement</span><strong>{overview.last_movement_date ? shortDate(overview.last_movement_date) : '-'}</strong></div>
      </div>
      <div className="guarantee-cash-toolbar">
        <div className="guarantee-cash-filters">
          <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
          <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
          <select value={filters.currency} onChange={(event) => setFilters({ ...filters, currency: event.target.value })}><option value="">Toutes devises</option><option value="USD">USD</option><option value="CDF">CDF</option></select>
          <select value={filters.payment_method} onChange={(event) => setFilters({ ...filters, payment_method: event.target.value })}><option value="">Tous les modes</option><option value="CASH">Espèces</option><option value="MOBILE_MONEY">Mobile Money</option><option value="BANK">Banque</option></select>
          <select value={filters.treasury_location} onChange={(event) => setFilters({ ...filters, treasury_location: event.target.value })}><option value="">Tous emplacements</option><option value="MAIN_CASH">Caisse</option><option value="BANK">Banque</option></select>
          <input placeholder="Recherche" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="filter-actions guarantee-cash-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ date_from: '', date_to: '', currency: '', payment_method: '', treasury_location: '' })}>Réinitialiser</button>
          <button type="button" className="secondary" onClick={() => void load()}><RefreshCcw size={15} />Actualiser</button>
          <button type="button" className="secondary" onClick={() => exportCsv('caisse-syndic.csv', exportRows())}><FileText size={15} />CSV</button>
          <button type="button" className="secondary" onClick={() => exportXlsxWorkbook('Caisse_syndic.xlsx', [{ name: 'Mouvements', rows: exportRows() }])}><FileSpreadsheet size={15} />Excel</button>
          <button type="button" className="secondary" onClick={() => window.print()}><Printer size={15} />PDF</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Facture</th><th>Locataire</th><th>Mode</th><th>Emplacement</th><th className="right">Montant</th><th>Devise</th><th className="right">Équiv. USD</th><th>Référence</th></tr></thead>
          <tbody>{filtered.map((movement) => <tr key={movement.id}><td>{shortDate(movement.movement_date)}</td><td>{movement.invoice_number ?? '-'}</td><td>{movement.tenant_name ?? '-'}</td><td>{paymentMethodLabel(movement.payment_method)}</td><td>{movement.treasury_location === 'BANK' ? 'Banque' : 'Caisse principale'}</td><td className="right">{money(movement.amount)}</td><td>{movement.currency}</td><td className="right">{money(movement.equivalent_usd)}</td><td>{movement.reference ?? '-'}</td></tr>)}</tbody>
        </table>
        {!loading && filtered.length === 0 ? <EmptyState title="Aucun mouvement syndic" message="Les parts syndic des paiements apparaîtront ici automatiquement." /> : null}
        {loading ? <p>Chargement...</p> : null}
      </div>
    </section>
  );
}

function money(value: number | undefined) { return Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function paymentMethodLabel(value: string) { return ({ CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money', BANK: 'Banque' } as Record<string, string>)[value] ?? value; }
