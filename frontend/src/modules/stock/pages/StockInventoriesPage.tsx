import { Check, Eye, FileSpreadsheet, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, exportXlsxWorkbook, money, shortDate, statusLabel } from '../../../api';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useAuth } from '../../../auth';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { InventoryLine, StockInventory } from '../stock.types';

export function StockInventoriesPage() {
  const { can } = useAuth();
  const list = useApiList<StockInventory>('/stock/inventories');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [success, setSuccess] = useState('');

  async function create(form: FormData) {
    const values = Object.fromEntries(form);
    const response = await api.post<StockInventory>('/stock/inventories', values);
    setCreateOpen(false);
    setDetailId(response.data.id);
    setSuccess('Inventaire créé avec tous les articles actifs.');
    list.reload();
  }

  return <section>
    <PageHeader title="Inventaires" /><StockNav /><SuccessMessage message={success} />
    <div className="maintenance-filter-bar stock-filter-bar">
      <div className="toolbar-spacer" />
      {can('stock.create') && <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvel inventaire</button>}
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Numéro inventaire</th><th>Date</th><th>Statut</th><th className="right">Articles</th><th className="right">Écarts positifs</th><th className="right">Écarts négatifs</th><th className="right">Valeur écart</th><th>Utilisateur</th><th>Actions</th></tr></thead>
      <tbody>{list.data.map((item) => <tr key={item.id} className="clickable-row" onClick={() => setDetailId(item.id)}>
        <td>{item.inventory_number}</td><td>{shortDate(item.count_date)}</td><td>{statusLabel(item.status)}</td><td className="right">{item.line_count ?? 0}</td><td className="right">{item.positive_difference ?? 0}</td><td className="right">{item.negative_difference ?? 0}</td><td className="right">{money(item.difference_value ?? 0)}</td><td>{item.user_name ?? '—'}</td>
        <td onClick={(event) => event.stopPropagation()}><button className="icon-btn" title="Voir" onClick={() => setDetailId(item.id)}><Eye size={16} /></button></td>
      </tr>)}</tbody>
    </table>{!list.data.length && <EmptyState message="Aucun inventaire enregistré." />}</div>
    {createOpen && <Modal title="Nouvel inventaire" onClose={() => setCreateOpen(false)}><form onSubmit={(event) => { event.preventDefault(); void create(new FormData(event.currentTarget)); }}>
      <div className="form-grid"><label>Date *<input type="date" name="count_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label className="wide-field">Observation<textarea name="notes" /></label></div>
      <p className="storage-note">Tous les articles actifs seront ajoutés avec leur stock théorique actuel.</p>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>Annuler</button><button type="submit">Créer l'inventaire</button></div>
    </form></Modal>}
    {detailId && <InventoryDetail id={detailId} canWrite={can('stock.update')} onClose={() => setDetailId(null)} onChanged={() => { list.reload(); setSuccess('Inventaire mis à jour.'); }} />}
  </section>;
}

function InventoryDetail({ id, canWrite, onClose, onChanged }: { id: number; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const [inventory, setInventory] = useState<StockInventory | null>(null);
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const load = () => api.get<StockInventory>(`/stock/inventories/${id}`).then((response) => { setInventory(response.data); setLines(response.data.lines ?? []); });
  useEffect(() => { void load(); }, [id]);
  const locked = inventory?.status === 'VALIDATED' || inventory?.status === 'CANCELLED';
  const totals = useMemo(() => lines.reduce((acc, line) => {
    const difference = Number(line.physical_quantity) - Number(line.theoretical_quantity);
    acc.quantity += difference; acc.value += difference * Number(line.unit_cost); return acc;
  }, { quantity: 0, value: 0 }), [lines]);

  async function save() {
    await api.patch(`/stock/inventories/${id}`, { lines: lines.map((line) => ({ id: line.id, physical_quantity: line.physical_quantity, notes: line.notes })) });
    await load(); onChanged();
  }
  async function validate() {
    await save();
    await api.post(`/stock/inventories/${id}/validate`, {});
    await load(); onChanged();
  }
  function exportInventory() {
    exportXlsxWorkbook(`Inventaire_${inventory?.inventory_number}.xlsx`, [{ name: 'Inventaire', rows: lines.map((line) => ({
      code: line.item_code, article: line.item_name, stock_theorique: line.theoretical_quantity, stock_physique: line.physical_quantity,
      ecart: Number(line.physical_quantity) - Number(line.theoretical_quantity), cout_unitaire: line.unit_cost,
      cout_ecart: (Number(line.physical_quantity) - Number(line.theoretical_quantity)) * Number(line.unit_cost), observation: line.notes ?? '—',
    })) }]);
  }

  if (!inventory) return null;
  return <Modal title={`Inventaire ${inventory.inventory_number}`} onClose={onClose}>
    <div className="actions-row"><button className="secondary" onClick={exportInventory}><FileSpreadsheet size={15} />Excel</button></div>
    <div className="summary-band"><span>Date <strong>{shortDate(inventory.count_date)}</strong></span><span>Statut <strong>{statusLabel(inventory.status)}</strong></span><span>Écart <strong>{totals.quantity}</strong></span><span>Valeur écart <strong>{money(totals.value)} USD</strong></span></div>
    <div className="table-wrap inventory-lines"><table><thead><tr><th>Article</th><th className="right">Stock théorique</th><th className="right">Stock physique</th><th className="right">Écart</th><th className="right">Coût unitaire</th><th className="right">Coût écart</th><th>Observation</th></tr></thead>
      <tbody>{lines.map((line, index) => {
        const difference = Number(line.physical_quantity) - Number(line.theoretical_quantity);
        return <tr key={line.id}><td>{line.item_code} - {line.item_name}</td><td className="right">{line.theoretical_quantity}</td>
          <td className="right"><input className="compact-number" type="number" step="0.01" value={line.physical_quantity} disabled={locked || !canWrite} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, physical_quantity: Number(event.target.value) } : row))} /></td>
          <td className="right">{difference}</td><td className="right">{money(line.unit_cost)}</td><td className="right">{money(difference * Number(line.unit_cost))}</td>
          <td><input value={line.notes ?? ''} disabled={locked || !canWrite} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} /></td></tr>;
      })}</tbody>
    </table></div>
    <div className="modal-footer-sticky"><button className="secondary" onClick={onClose}>Fermer</button>{!locked && canWrite && <><button className="secondary" onClick={() => void save()}>Enregistrer</button><button onClick={() => void validate()}><Check size={15} />Valider l'inventaire</button></>}</div>
  </Modal>;
}
