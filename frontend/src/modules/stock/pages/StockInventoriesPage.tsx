import { ArrowLeft, Check, Eye, FileSpreadsheet, Plus, RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate, statusLabel } from '../../../api';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useAuth } from '../../../auth';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { InventoryLine, StockInventory } from '../stock.types';

export function StockInventoriesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useApiList<StockInventory>('/stock/inventories');
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [user, setUser] = useState('');
  const [onlyWithDiff, setOnlyWithDiff] = useState(false);

  async function create(form: FormData) {
    const values = Object.fromEntries(form);
    const response = await api.post<StockInventory>('/stock/inventories', values);
    setCreateOpen(false);
    setSuccess('Inventaire créé avec tous les articles actifs.');
    list.reload();
    navigate(`/stock/inventories/${response.data.id}`);
  }

  const userOptions = [...new Set(list.data.map((item) => item.user_name).filter(Boolean) as string[])].sort();
  const filtered = useMemo(() => list.data.filter((item) =>
    includesText(item, query)
      && (!status || item.status === status)
      && (!start || item.count_date >= start)
      && (!end || item.count_date <= end)
      && (!user || item.user_name === user)
      && (!onlyWithDiff || Number(item.positive_difference ?? 0) > 0 || Number(item.negative_difference ?? 0) > 0),
  ), [list.data, query, status, start, end, user, onlyWithDiff]);

  function exportRows(rows = filtered) {
    return rows.map((item) => ({
      numero: item.inventory_number,
      date: shortDate(item.count_date),
      statut: statusLabel(item.status),
      articles: item.line_count ?? 0,
      articles_comptes: item.counted_lines ?? 0,
      ecarts_positifs: item.positive_difference ?? 0,
      ecarts_negatifs: item.negative_difference ?? 0,
      valeur_ecart: item.difference_value ?? 0,
      utilisateur: item.user_name ?? '-',
    }));
  }

  return <section>
    <PageHeader title="Inventaires" />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar stock-filter-bar inventory-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="DRAFT">Brouillon</option><option value="IN_PROGRESS">En cours</option><option value="VALIDATED">Validé</option></select>
      <input type="date" value={start} onChange={(event) => setStart(event.target.value)} title="Date début" />
      <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} title="Date fin" />
      <select value={user} onChange={(event) => setUser(event.target.value)}><option value="">Utilisateur</option>{userOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <label className="checkbox-filter"><input type="checkbox" checked={onlyWithDiff} onChange={(event) => setOnlyWithDiff(event.target.checked)} />Avec écarts uniquement</label>
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); setStart(''); setEnd(''); setUser(''); setOnlyWithDiff(false); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('inventaires-stock.csv', exportRows())}>CSV</button>
      <button className="secondary" onClick={() => exportXlsxWorkbook('Inventaires_stock.xlsx', [{ name: 'Inventaires', rows: exportRows() }])}><FileSpreadsheet size={15} />Excel</button>
      <div className="toolbar-spacer" />
      {can('stock.create') && <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvel inventaire</button>}
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Numéro inventaire</th><th>Date</th><th>Statut</th><th className="right">Articles</th><th className="right">Articles comptés</th><th className="right">Écarts positifs</th><th className="right">Écarts négatifs</th><th className="right">Valeur écart</th><th>Utilisateur</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/inventories/${item.id}`)}>
        <td>{item.inventory_number}</td>
        <td>{shortDate(item.count_date)}</td>
        <td>{statusLabel(item.status)}</td>
        <td className="right">{item.line_count ?? 0}</td>
        <td className="right">{item.counted_lines ?? 0}</td>
        <td className="right">{item.positive_difference ?? 0}</td>
        <td className="right">{item.negative_difference ?? 0}</td>
        <td className="right">{money(item.difference_value ?? 0)}</td>
        <td>{item.user_name ?? '-'}</td>
        <td onClick={(event) => event.stopPropagation()}><button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/inventories/${item.id}`)}><Eye size={16} /></button></td>
      </tr>)}</tbody>
    </table>{!filtered.length && <EmptyState message="Aucun inventaire enregistré." />}</div>
    {createOpen && <Modal title="Nouvel inventaire" onClose={() => setCreateOpen(false)}><form onSubmit={(event) => { event.preventDefault(); void create(new FormData(event.currentTarget)); }}>
      <div className="form-grid"><label>Date *<input type="date" name="count_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label className="wide-field">Observation<textarea name="notes" /></label></div>
      <p className="storage-note">Tous les articles actifs seront ajoutés avec leur stock théorique actuel.</p>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>Annuler</button><button type="submit">Creer l'inventaire</button></div>
    </form></Modal>}
  </section>;
}

export function StockInventoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [inventory, setInventory] = useState<StockInventory | null>(null);
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const [success, setSuccess] = useState('');

  async function load() {
    if (!id) return;
    const response = await api.get<StockInventory>(`/stock/inventories/${id}`);
    setInventory(response.data);
    setLines(response.data.lines ?? []);
  }

  useEffect(() => { void load(); }, [id]);

  const locked = inventory?.status === 'VALIDATED' || inventory?.status === 'CANCELLED';
  const summary = useMemo(() => {
    let counted = 0;
    let positive = 0;
    let negative = 0;
    let value = 0;
    for (const line of lines) {
      if (line.physical_quantity === null || line.physical_quantity === undefined) continue;
      counted += 1;
      const difference = Number(line.physical_quantity) - Number(line.theoretical_quantity);
      if (difference > 0) positive += 1;
      if (difference < 0) negative += 1;
      value += difference * Number(line.unit_cost ?? 0);
    }
    return {
      total: lines.length,
      counted,
      uncounted: Math.max(lines.length - counted, 0),
      positive,
      negative,
      value,
    };
  }, [lines]);

  async function save() {
    if (!inventory) return;
    await api.patch(`/stock/inventories/${inventory.id}`, {
      lines: lines.map((line) => ({
        id: line.id,
        physical_quantity: line.physical_quantity === null || line.physical_quantity === undefined ? null : Number(line.physical_quantity),
        notes: line.notes ?? '',
      })),
    });
    setSuccess('Inventaire mis à jour.');
    await load();
  }

  async function validate() {
    if (summary.uncounted > 0) {
      setSuccess('');
      window.alert('Tous les articles doivent avoir un stock physique saisi avant validation.');
      return;
    }
    await save();
    await api.post(`/stock/inventories/${inventory?.id}/validate`, {});
    setSuccess('Inventaire validé.');
    await load();
  }

  function exportInventory() {
    if (!inventory) return;
    exportXlsxWorkbook(`Inventaire_${inventory.inventory_number}.xlsx`, [{
      name: 'Inventaire',
      rows: lines.map((line) => {
        const difference = line.physical_quantity === null || line.physical_quantity === undefined
          ? null
          : Number(line.physical_quantity) - Number(line.theoretical_quantity);
        return {
          code: line.item_code,
          article: line.item_name,
          stock_theorique: line.theoretical_quantity,
          stock_physique: line.physical_quantity ?? '',
          ecart: difference ?? '-',
          cout_unitaire: line.unit_cost,
          cout_ecart: difference === null ? '-' : difference * Number(line.unit_cost),
          observation: line.notes ?? '-',
        };
      }),
    }]);
  }

  if (!inventory) return <section><PageHeader title="Détail inventaire" /><StockNav /><EmptyState message="Chargement..." /></section>;

  return <section>
    <PageHeader title={`Inventaire ${inventory.inventory_number}`} />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="actions-row">
      <button className="secondary" onClick={() => navigate('/stock/inventories')}><ArrowLeft size={16} />Retour</button>
      <button className="secondary" onClick={exportInventory}><FileSpreadsheet size={15} />Excel</button>
      {!locked && can('stock.update') && <button className="secondary" onClick={() => void save()}>Enregistrer</button>}
      {!locked && can('stock.update') && <button onClick={() => void validate()}><Check size={15} />Valider l'inventaire</button>}
    </div>
    <div className="mini-stats">
      <Kpi label="Articles total" value={summary.total} />
      <Kpi label="Articles comptés" value={summary.counted} />
      <Kpi label="Articles non comptés" value={summary.uncounted} />
      <Kpi label="Écarts positifs" value={summary.positive} />
      <Kpi label="Écarts négatifs" value={summary.negative} />
      <Kpi label="Valeur écart" value={`${money(summary.value)} USD`} />
    </div>
    <div className="detail-section">
      <h4>Résumé inventaire</h4>
      <div className="detail-list">
        <span>Numéro</span><strong>{inventory.inventory_number}</strong>
        <span>Date</span><strong>{shortDate(inventory.count_date)}</strong>
        <span>Statut</span><strong>{statusLabel(inventory.status)}</strong>
        <span>Utilisateur</span><strong>{inventory.user_name ?? '-'}</strong>
        <span>Observation</span><strong>{inventory.notes ?? '-'}</strong>
      </div>
    </div>
    <Section title="Lignes inventaire">
      <div className="table-wrap inventory-lines"><table>
        <thead><tr><th>Article</th><th className="right">Stock théorique</th><th className="right">Stock physique</th><th className="right">Écart</th><th className="right">Coût unitaire</th><th className="right">Coût écart</th><th>Observation</th></tr></thead>
        <tbody>{lines.map((line, index) => {
          const isCounted = !(line.physical_quantity === null || line.physical_quantity === undefined);
          const difference = isCounted ? Number(line.physical_quantity) - Number(line.theoretical_quantity) : null;
          return <tr key={line.id}>
            <td>{line.item_code} - {line.item_name}</td>
            <td className="right">{line.theoretical_quantity}</td>
            <td className="right"><input className="compact-number" type="number" step="0.01" value={line.physical_quantity ?? ''} disabled={locked || !can('stock.update')} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, physical_quantity: event.target.value === '' ? null : Number(event.target.value) } : row))} /></td>
            <td className="right">{difference === null ? '-' : difference}</td>
            <td className="right">{money(line.unit_cost)}</td>
            <td className="right">{difference === null ? '-' : money(difference * Number(line.unit_cost))}</td>
            <td><input value={line.notes ?? ''} disabled={locked || !can('stock.update')} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} /></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!locked && summary.uncounted > 0 && <div className="info-message">Tous les articles doivent avoir un stock physique saisi avant validation.</div>}
    </Section>
  </section>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="detail-section"><h4>{title}</h4>{children}</div>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}
