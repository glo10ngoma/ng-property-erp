import { FileSpreadsheet, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { EmptyState, PageHeader } from '../../../components';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { StockItem, StockMovement } from '../stock.types';
import { exportMovement, movementLabel } from '../stock.utils';

export function StockMovementsPage() {
  const navigate = useNavigate();
  const movements = useApiList<StockMovement>('/stock/movements');
  const items = useApiList<StockItem>('/stock/items');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [itemId, setItemId] = useState('');
  const [category, setCategory] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const filtered = useMemo(() => movements.data.filter((movement) => includesText(movement, query) &&
    (!type || movementType(movement) === type) && (!itemId || String(movement.item_code) === itemId) &&
    (!category || movement.category === category) && (!start || movement.movement_date >= start) && (!end || movement.movement_date <= end)),
  [movements.data, query, type, itemId, category, start, end]);
  const month = new Date().toISOString().slice(0, 7);
  const monthRows = movements.data.filter((item) => item.movement_date.slice(0, 7) === month);
  const value = filtered.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price ?? 0), 0);

  return <section>
    <PageHeader title="Mouvements de stock" /><StockNav />
    <div className="mini-stats">
      <Kpi label="Entrées du mois" value={monthRows.filter((item) => movementType(item) === 'ENTRY').length} />
      <Kpi label="Sorties du mois" value={monthRows.filter((item) => movementType(item) === 'EXIT').length} />
      <Kpi label="Ajustements" value={monthRows.filter((item) => movementType(item) === 'INVENTORY_ADJUSTMENT').length} />
      <Kpi label="Consommation maintenance" value={monthRows.filter((item) => item.source === 'MAINTENANCE').length} />
      <Kpi label="Valeur mouvements" value={`${money(value)} USD`} />
    </div>
    <div className="maintenance-filter-bar stock-filter-bar">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Recherche / référence" />
      <select value={type} onChange={(e) => setType(e.target.value)}><option value="">Type</option><option value="ENTRY">Entrée</option><option value="EXIT">Sortie</option><option value="MAINTENANCE_CONSUMPTION">Maintenance</option><option value="INVENTORY_ADJUSTMENT">Ajustement</option></select>
      <select value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Article</option>{items.data.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
      <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Catégorie</option>{[...new Set(items.data.map((item) => item.category).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select>
      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} title="Date début" /><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} title="Date fin" />
      <button className="secondary" onClick={() => { setQuery(''); setType(''); setItemId(''); setCategory(''); setStart(''); setEnd(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('mouvements-stock.csv', filtered.map(exportMovement))}>CSV</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('Mouvements_stock.xlsx', [{ name: 'Mouvements', rows: filtered.map(exportMovement) }])}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Article</th><th className="right">Quantité</th><th>Unité</th><th className="right">Coût unitaire</th><th className="right">Valeur</th><th>Référence</th><th>Source</th><th>Utilisateur</th><th>Observation</th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/movements/${item.id}`)}><td>{shortDate(item.movement_date)}</td><td>{movementLabel(item)}</td><td>{item.item_name}</td><td className="right">{item.quantity}</td><td>{item.unit ?? items.data.find((stock) => stock.code === item.item_code)?.unit ?? '—'}</td><td className="right">{money(item.unit_price ?? 0)}</td><td className="right">{money(Number(item.quantity) * Number(item.unit_price ?? 0))}</td><td>{item.document_number ?? item.reference ?? '—'}</td><td>{item.source ?? '—'}</td><td>{item.user_name ?? '—'}</td><td>{item.notes ?? '—'}</td></tr>)}</tbody>
    </table>{!filtered.length && <EmptyState message="Aucun mouvement trouvé." />}</div>
  </section>;
}

function movementType(item: StockMovement) {
  if (item.source === 'MAINTENANCE') return 'MAINTENANCE_CONSUMPTION';
  if (item.type.startsWith('INVENTORY_')) return 'INVENTORY_ADJUSTMENT';
  return ['IN', 'INVENTORY', 'RETURN'].includes(item.type) ? 'ENTRY' : 'EXIT';
}
function Kpi({ label, value }: { label: string; value: string | number }) { return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>; }
