import { ArrowDownToLine, ArrowUpFromLine, Eye, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { EmptyState, PageHeader, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import { StockDocumentModal } from '../StockDocumentModal';
import type { StockItem, StockMovement } from '../stock.types';
import { exportStockItem, stockStatusLabel } from '../stock.utils';

export function StockPage() {
  const navigate = useNavigate();
  const items = useApiList<StockItem>('/stock/items');
  const movements = useApiList<StockMovement>('/stock/movements');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [store, setStore] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [movement, setMovement] = useState<'ENTRY' | 'EXIT' | null>(null);
  const [success, setSuccess] = useState('');
  const categories = unique(items.data.map((item) => item.category));
  const stores = unique(items.data.map((item) => item.store));
  const filtered = useMemo(() => items.data.filter((item) =>
    includesText(item, query) && (!category || item.category === category) &&
    (!store || item.store === store) && (!lowOnly || ['LOW_STOCK', 'OUT_OF_STOCK'].includes(item.stock_alert ?? ''))),
  [items.data, query, category, store, lowOnly]);
  const available = items.data.filter((item) => item.status === 'ACTIVE' && Number(item.current_quantity) > Number(item.minimum_quantity)).length;
  const out = items.data.filter((item) => item.stock_alert === 'OUT_OF_STOCK').length;
  const low = items.data.filter((item) => item.stock_alert === 'LOW_STOCK').length;
  const value = items.data.reduce(itemValue, 0);
  const lowValue = items.data.filter((item) => item.stock_alert === 'LOW_STOCK').reduce(itemValue, 0);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthExits = movements.data.filter((item) =>
    item.movement_date.slice(0, 7) === currentMonth && (item.type === 'OUT' || item.type === 'INVENTORY_LOSS')).length;

  async function saveMovement(payload: Record<string, unknown>) {
    await api.post(movement === 'ENTRY' ? '/stock/entries' : '/stock/exits', payload);
    setSuccess(movement === 'ENTRY' ? 'Entrée enregistrée.' : 'Sortie enregistrée.');
    setMovement(null);
    items.reload();
    movements.reload();
  }

  function exportWorkbook() {
    return exportXlsxWorkbook('Etat_stock.xlsx', [
      { name: 'Résumé', rows: [{ valeur_totale: value, articles_disponibles: available, ruptures: out, sous_seuil: low, valeur_sous_seuil: lowValue }] },
      { name: 'État stock', rows: filtered.map(exportStockItem) },
      { name: 'Ruptures', rows: items.data.filter((item) => item.stock_alert === 'OUT_OF_STOCK').map(exportStockItem) },
      { name: 'Sous seuil', rows: items.data.filter((item) => item.stock_alert === 'LOW_STOCK').map(exportStockItem) },
      { name: 'Valorisation', rows: filtered.map(exportStockItem) },
    ]);
  }

  return <section>
    <PageHeader title="Stock" />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Valeur totale stock" value={`${money(value)} USD`} />
      <Kpi label="Articles disponibles" value={available} />
      <Kpi label="Ruptures" value={out} />
      <Kpi label="Sous seuil" value={low} />
      <Kpi label="Valeur sous seuil" value={`${money(lowValue)} USD`} />
      <Kpi label="Sorties du mois" value={monthExits} />
    </div>
    <div className="maintenance-filter-bar stock-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
      <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Catégorie</option>{categories.map(option)}</select>
      <select value={store} onChange={(event) => setStore(event.target.value)}><option value="">Magasin</option>{stores.map(option)}</select>
      <label className="checkbox-filter"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />Sous seuil</label>
      <button className="secondary" onClick={() => { setQuery(''); setCategory(''); setStore(''); setLowOnly(false); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('etat-stock.csv', filtered.map(exportStockItem))}>CSV</button>
      <button className="secondary" onClick={exportWorkbook}><FileSpreadsheet size={15} />Excel</button>
      <div className="toolbar-spacer" />
      <button className="secondary" onClick={() => setMovement('ENTRY')}><ArrowDownToLine size={15} />Entrée</button>
      <button onClick={() => setMovement('EXIT')}><ArrowUpFromLine size={15} />Sortie</button>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Article</th><th>Catégorie</th><th>Magasin</th><th className="right">Stock actuel</th><th className="right">Seuil sécurité</th><th>Unité</th><th className="right">Coût moyen</th><th className="right">Valeur stock</th><th>Statut stock</th><th>Dernière entrée</th><th>Dernière sortie</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/${item.id}`)}>
        <td><div className="stock-article-cell"><strong>{item.name}</strong>{item.code ? <span className="stock-article-code">{item.code}</span> : null}</div></td><td>{item.category ?? '—'}</td><td>{item.store ?? '—'}</td>
        <td className="right">{item.current_quantity ?? 0}</td><td className="right">{item.minimum_quantity ?? 0}</td><td>{item.unit ?? '—'}</td>
        <td className="right">{money(price(item))}</td><td className="right">{money(itemValue(0, item))}</td><td>{stockStatusLabel(item)}</td>
        <td>{item.last_entry_date ? shortDate(item.last_entry_date) : '—'}</td><td>{item.last_exit_date ? shortDate(item.last_exit_date) : '—'}</td>
        <td onClick={(event) => event.stopPropagation()}><button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/${item.id}`)}><Eye size={16} /></button></td>
      </tr>)}</tbody>
    </table>{!filtered.length && <EmptyState message="Aucun article correspondant." />}</div>
    {movement && <StockDocumentModal type={movement} items={items.data.filter((item) => item.status === 'ACTIVE')} stores={stores} onClose={() => setMovement(null)} onSubmit={saveMovement} />}
  </section>;
}

function price(item?: StockItem) { return Number(item?.average_purchase_price ?? item?.purchase_price ?? 0); }
function itemValue(sum: number, item: StockItem) { return sum + Number(item.current_quantity ?? 0) * price(item); }
function unique(values: Array<string | undefined>) { return [...new Set(values.filter(Boolean) as string[])].sort(); }
function option(value: string) { return <option key={value} value={value}>{value}</option>; }
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>; }
