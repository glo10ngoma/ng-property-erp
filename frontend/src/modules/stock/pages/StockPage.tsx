import { Eye, FileSpreadsheet, History, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportExcel, exportXlsxWorkbook, includesText, money, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage, TableToolbar } from '../../../components';
import { useApiList } from '../../../hooks';
import type { ReactNode } from 'react';

type StockItem = {
  id: number;
  code?: string;
  name: string;
  category?: string;
  store?: string;
  unit?: string;
  current_quantity?: number;
  minimum_quantity?: number;
  purchase_price?: number;
  average_purchase_price?: number;
  description?: string;
  observations?: string;
  barcode?: string;
  supplier_reference?: string;
  brand?: string;
  model?: string;
  photo_file_name?: string;
  attachment_file_name?: string;
  status: string;
  stock_alert?: string;
};

type StockMovement = {
  id: number;
  movement_number?: string;
  item_name: string;
  type: string;
  quantity: number;
  unit_price?: number;
  movement_date: string;
  reference?: string;
  destination?: string;
  quantity_before?: number;
  quantity_after?: number;
  user_name?: string;
  notes?: string;
};

type StockInventory = {
  id: number;
  inventory_number?: string;
  count_date: string;
  status: string;
  line_count?: number;
  total_difference?: number;
};

type StockItemDetail = StockItem & { movements: StockMovement[] };

const categories = ['Plomberie', 'Électricité', 'Peinture', 'Entretien', 'Bureau', 'Consommables', 'Autres'];
const statuses = ['ACTIVE', 'INACTIVE'];
const stores = ['Magasin principal', 'Annexe', 'Chantier', 'Réserve'];

export function StockPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, reload } = useApiList<StockItem>('/stock/items');
  const movements = useApiList<StockMovement>('/stock/movements');
  const inventories = useApiList<StockInventory>('/stock/inventories');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [itemDetailOpen, setItemDetailOpen] = useState(false);
  const [itemDetail, setItemDetail] = useState<StockItemDetail | null>(null);

  const filtered = useMemo(() => data.filter((item) => {
    const matches = includesText(item, query)
      && (!categoryFilter || (item.category ?? '') === categoryFilter)
      && (!storeFilter || (item.store ?? '') === storeFilter)
      && (!statusFilter || item.status === statusFilter)
      && (!lowOnly || (item.stock_alert === 'LOW_STOCK' || item.stock_alert === 'OUT_OF_STOCK'));
    return matches;
  }), [data, query, categoryFilter, storeFilter, statusFilter, lowOnly]);

  const lowStock = data.filter((item) => item.stock_alert === 'LOW_STOCK').length;
  const outOfStock = data.filter((item) => item.stock_alert === 'OUT_OF_STOCK').length;
  const inactive = data.filter((item) => item.status !== 'ACTIVE').length;
  const totalValue = data.reduce((sum, item) => sum + Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0), 0);
  const entriesMonth = movements.data.filter((item) => item.type === 'IN' && String(item.movement_date ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  const exitsMonth = movements.data.filter((item) => item.type === 'OUT' && String(item.movement_date ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  const movementsValue = movements.data.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unit_price ?? 0), 0);
  const filteredValue = filtered.reduce((sum, item) => sum + Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0), 0);

  async function refreshList() {
    reload();
    movements.reload();
    inventories.reload();
  }

  async function create(form: FormData) {
    const payload = Object.fromEntries(form);
    await api.post('/stock/items', {
      ...payload,
      current_quantity: Number(payload.current_quantity ?? 0),
      minimum_quantity: Number(payload.minimum_quantity ?? 0),
      purchase_price: Number(payload.purchase_price ?? 0),
      average_purchase_price: Number(payload.average_purchase_price ?? payload.purchase_price ?? 0),
      status: 'ACTIVE',
    });
    setSuccess('Article créé avec succès.');
    setCreateOpen(false);
    refreshList();
  }

  async function update(form: FormData) {
    if (!editing) return;
    const payload = Object.fromEntries(form);
    await api.patch(`/stock/items/${editing.id}`, {
      ...payload,
      minimum_quantity: Number(payload.minimum_quantity ?? 0),
      purchase_price: Number(payload.purchase_price ?? 0),
      average_purchase_price: Number(payload.average_purchase_price ?? payload.purchase_price ?? 0),
    });
    setSuccess('Article modifié.');
    setEditing(null);
    refreshList();
  }

  async function deactivate(id: number) {
    await api.delete(`/stock/items/${id}`);
    setSuccess('Article désactivé.');
    refreshList();
  }

  async function openDetail(id: number) {
    const response = await api.get<StockItemDetail>(`/stock/items/${id}`);
    setItemDetail(response.data);
    setItemDetailOpen(true);
  }

  function exportSummary() {
    return exportXlsxWorkbook('stock-v1.xlsx', [
      { name: 'Résumé', rows: [{ total_articles: data.length, valeur_stock: money(totalValue), articles_rupture: outOfStock, articles_sous_seuil: lowStock, articles_inactifs: inactive, entrees_du_mois: entriesMonth, sorties_du_mois: exitsMonth, valeur_mouvements: money(movementsValue) }] },
      { name: 'Articles', rows: filtered.map(exportItemRow) },
      { name: 'Valeurs', rows: filtered.map((item) => ({ code: item.code ?? '-', article: item.name, valeur: money(Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0)) })) },
      { name: 'Sous seuil', rows: data.filter((item) => item.stock_alert === 'LOW_STOCK').map(exportItemRow) },
      { name: 'Ruptures', rows: data.filter((item) => item.stock_alert === 'OUT_OF_STOCK').map(exportItemRow) },
      { name: 'Historique', rows: movements.data.map((movement) => ({ numero: movement.movement_number ?? movement.reference ?? '-', article: movement.item_name, type: movement.type, quantite: movement.quantity, date: shortDate(movement.movement_date), utilisateur: movement.user_name ?? '-' })) },
    ]);
  }

  return (
    <section>
      <PageHeader title="Stock" />
      <SuccessMessage message={success} />
      <div className="mini-stats">
        <div className="mini-stat"><span>Total articles</span><strong>{data.length}</strong></div>
        <div className="mini-stat"><span>Valeur du stock</span><strong>{money(totalValue)}</strong></div>
        <div className="mini-stat"><span>Ruptures</span><strong>{outOfStock}</strong></div>
        <div className="mini-stat"><span>Sous seuil</span><strong>{lowStock}</strong></div>
        <div className="mini-stat"><span>Inactifs</span><strong>{inactive}</strong></div>
        <div className="mini-stat"><span>Entrées du mois</span><strong>{entriesMonth}</strong></div>
        <div className="mini-stat"><span>Sorties du mois</span><strong>{exitsMonth}</strong></div>
        <div className="mini-stat"><span>Valeur mouvements</span><strong>{money(movementsValue)}</strong></div>
      </div>

      <div className="maintenance-filter-bar stock-filter-bar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Catégorie</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
          <option value="">Magasin</option>
          {stores.map((store) => <option key={store} value={store}>{store}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Statut</option>
          {statuses.map((status) => <option key={status} value={status}>{status === 'ACTIVE' ? 'Actif' : 'Inactif'}</option>)}
        </select>
        <label className="checkbox-filter"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />Sous seuil uniquement</label>
        <button type="button" className="secondary" onClick={() => { setQuery(''); setCategoryFilter(''); setStoreFilter(''); setStatusFilter(''); setLowOnly(false); }}><RotateCcw size={15} />Réinitialiser</button>
        <button type="button" className="secondary" onClick={() => exportCsv('stock.csv', filtered.map(exportItemRow))}>CSV</button>
        <button type="button" className="secondary" onClick={exportSummary}>Excel</button>
        <div className="toolbar-spacer" />
        {can('stock.create') && <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvel article</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Article</th>
              <th>Catégorie</th>
              <th>Magasin</th>
              <th className="right">Stock actuel</th>
              <th className="right">Seuil mini</th>
              <th>Unité</th>
              <th className="right">Coût unitaire</th>
              <th className="right">Valeur stock</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/${item.id}`)}>
                <td>{item.code ?? '-'}</td>
                <td>{item.name}</td>
                <td>{item.category ?? '-'}</td>
                <td>{item.store ?? '-'}</td>
                <td className="right">{item.current_quantity ?? 0}</td>
                <td className="right">{item.minimum_quantity ?? 0}</td>
                <td>{item.unit ?? '-'}</td>
                <td className="right">{money(item.average_purchase_price ?? item.purchase_price ?? 0)}</td>
                <td className="right">{money(Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0))}</td>
                <td>{stockAlertLabel(item.stock_alert ?? item.status)}</td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/${item.id}`)}><Eye size={16} /></button>
                  {can('stock.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(item)}><Pencil size={16} /></button>}
                  <button className="icon-btn" title="Historique" onClick={() => navigate(`/stock/${item.id}#history`)}><History size={16} /></button>
                  {can('stock.delete') && item.status === 'ACTIVE' && <button className="icon-btn danger" title="Supprimer" onClick={() => deactivate(item.id)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState />}
      </div>
      <div className="summary-band maintenance-cost-footer">
        <SummaryItem label="Articles filtrés" value={filtered.length} />
        <SummaryItem label="Valeur filtrée" value={money(filteredValue)} />
      </div>

      <div className="detail-section">
        <h4>Mouvements récents</h4>
        <TableToolbar query="" onQueryChange={() => {}} onExport={() => exportCsv('stock-movements.csv', movements.data.map((movement) => ({
          numero: movement.movement_number ?? movement.reference ?? '-',
          article: movement.item_name,
          type: movement.type,
          quantite: movement.quantity,
          date: shortDate(movement.movement_date),
        })))} />
        <table>
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Article</th>
              <th>Type</th>
              <th className="right">Quantité</th>
              <th className="right">Avant</th>
              <th className="right">Après</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {movements.data.slice(0, 12).map((movement) => (
              <tr key={movement.id}>
                <td>{movement.movement_number ?? movement.reference ?? '-'}</td>
                <td>{movement.item_name}</td>
                <td>{movementTypeLabel(movement.type)}</td>
                <td className="right">{movement.quantity}</td>
                <td className="right">{movement.quantity_before ?? '-'}</td>
                <td className="right">{movement.quantity_after ?? '-'}</td>
                <td>{shortDate(movement.movement_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="detail-section">
        <h4>Inventaires</h4>
        <table>
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Date</th>
              <th className="right">Lignes</th>
              <th className="right">Écart</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventories.data.map((inventory) => (
              <tr key={inventory.id}>
                <td>{inventory.inventory_number ?? `#${inventory.id}`}</td>
                <td>{shortDate(inventory.count_date)}</td>
                <td className="right">{inventory.line_count ?? 0}</td>
                <td className="right">{inventory.total_difference ?? 0}</td>
                <td>{statusLabel(inventory.status)}</td>
                <td className="actions"><button className="secondary" onClick={() => refreshList()}>Voir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && <StockItemModal title="Nouvel article" onClose={() => setCreateOpen(false)} onSubmit={create} />}
      {editing && <StockItemModal title="Modifier article" item={editing} onClose={() => setEditing(null)} onSubmit={update} />}
      {itemDetailOpen && itemDetail && <StockDetailDrawer item={itemDetail} onClose={() => setItemDetailOpen(false)} onRefresh={refreshList} />}
    </section>
  );
}

function StockItemModal({ title, item, onClose, onSubmit }: { title: string; item?: StockItem | null; onClose: () => void; onSubmit: (form: FormData) => Promise<void> }) {
  const [fileName, setFileName] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="maintenance-modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (fileName) form.set('attachment_file_name', fileName); onSubmit(form); }}>
        <div className="modal-section">
          <h3>Informations générales</h3>
          <div className="maintenance-grid maintenance-cost-grid">
            <label className="locked-field">Code auto<input name="code" defaultValue={item?.code ?? ''} readOnly placeholder="Auto" /></label>
            <label>Nom<input name="name" defaultValue={item?.name ?? ''} required /></label>
            <label>Catégorie<select name="category" defaultValue={item?.category ?? 'Autres'}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label>Magasin<select name="store" defaultValue={item?.store ?? ''}><option value="">-</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
            <label>Unité<input name="unit" defaultValue={item?.unit ?? 'pièce'} required /></label>
            <label>Seuil minimum<input name="minimum_quantity" type="number" step="0.01" defaultValue={item?.minimum_quantity ?? 0} /></label>
            <label>Stock initial<input name="current_quantity" type="number" step="0.01" defaultValue={item?.current_quantity ?? 0} /></label>
            <label>Coût unitaire<input name="purchase_price" type="number" step="0.01" defaultValue={item?.purchase_price ?? item?.average_purchase_price ?? 0} /></label>
            <label className="locked-field">Devise<input value="USD" readOnly /></label>
            <label className="wide-field">Description<textarea name="description" defaultValue={item?.description ?? ''} /></label>
          </div>
        </div>
        <div className="modal-section">
          <h3>Options avancées</h3>
          <div className="maintenance-grid maintenance-cost-grid">
            <label>Code-barres<input name="barcode" defaultValue={item?.barcode ?? ''} /></label>
            <label>Référence fournisseur<input name="supplier_reference" defaultValue={item?.supplier_reference ?? ''} /></label>
            <label>Marque<input name="brand" defaultValue={item?.brand ?? ''} /></label>
            <label>Modèle<input name="model" defaultValue={item?.model ?? ''} /></label>
            <label>Photo<input type="file" name="photo_file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>
            <label>Pièce jointe<input type="file" name="attachment_file" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>
            {fileName ? <div className="storage-note wide-field">Fichier sélectionné : {fileName}</div> : null}
            <label className="wide-field">Observations<textarea name="observations" defaultValue={item?.observations ?? ''} /></label>
            <label className="wide-field">Statut<select name="status" defaultValue={item?.status ?? 'ACTIVE'}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
          </div>
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function StockDetailDrawer({ item, onClose, onRefresh }: { item: StockItemDetail; onClose: () => void; onRefresh: () => void }) {
  const navigate = useNavigate();
  const value = Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0);
  const movements = item.movements ?? [];
  return (
    <Modal title={`Fiche article - ${item.name}`} onClose={onClose}>
      <div className="detail-section">
        <div className="actions-row">
          <button className="secondary" onClick={() => navigate('/stock')}><RotateCcw size={16} />Retour</button>
          <button className="secondary" onClick={() => navigate(`/stock/${item.id}#history`)}><History size={16} />Historique</button>
          <button className="secondary" onClick={() => exportExcel(`article-${item.code ?? item.id}.xls`, [{ code: item.code ?? '-', article: item.name, categorie: item.category ?? '-', magasin: item.store ?? '-', stock_actuel: item.current_quantity ?? 0, seuil: item.minimum_quantity ?? 0, unite: item.unit ?? '-', cout: money(item.average_purchase_price ?? item.purchase_price ?? 0), valeur: money(value) }])}><FileSpreadsheet size={16} />Excel</button>
          <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        </div>
        <div className="mini-stats">
          <div className="mini-stat"><span>Stock actuel</span><strong>{item.current_quantity ?? 0}</strong></div>
          <div className="mini-stat"><span>Valeur</span><strong>{money(value)}</strong></div>
          <div className="mini-stat"><span>Seuil mini</span><strong>{item.minimum_quantity ?? 0}</strong></div>
        </div>
        <div className="detail-list">
          <span>Code</span><strong>{item.code ?? '-'}</strong>
          <span>Article</span><strong>{item.name}</strong>
          <span>Catégorie</span><strong>{item.category ?? '-'}</strong>
          <span>Magasin</span><strong>{item.store ?? '-'}</strong>
          <span>Unité</span><strong>{item.unit ?? '-'}</strong>
          <span>Coût unitaire</span><strong>{money(item.average_purchase_price ?? item.purchase_price ?? 0)}</strong>
          <span>Statut</span><strong>{statusLabel(item.status)}</strong>
          <span>Observations</span><strong>{item.observations ?? '-'}</strong>
        </div>
      </div>
      <div className="detail-section" id="history">
        <h4>Historique mouvements</h4>
        <table>
          <thead>
            <tr><th>Date</th><th>Type</th><th className="right">Quantité</th><th className="right">Avant</th><th className="right">Après</th><th>Référence</th></tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td>{shortDate(movement.movement_date)}</td>
                <td>{movementTypeLabel(movement.type)}</td>
                <td className="right">{movement.quantity}</td>
                <td className="right">{movement.quantity_before ?? '-'}</td>
                <td className="right">{movement.quantity_after ?? '-'}</td>
                <td>{movement.reference ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="detail-section">
        <h4>Dernières entrées / sorties</h4>
        <div className="compact-list">
          {movements.slice(0, 6).map((movement) => <div className="compact-item" key={movement.id}><span>{shortDate(movement.movement_date)} | {movementTypeLabel(movement.type)} | {movement.quantity}</span></div>)}
        </div>
      </div>
      <div className="detail-section">
        <h4>Maintenances ayant consommé cet article</h4>
        <div className="compact-empty">Aucune donnée disponible pour le moment.</div>
      </div>
      <div className="detail-section">
        <h4>Documents</h4>
        <div className="compact-empty">Aucun document enregistré.</div>
      </div>
      <div className="actions-row">
        <button className="secondary" onClick={onClose}>Retour</button>
        <button className="secondary" onClick={onRefresh}>Actualiser</button>
      </div>
    </Modal>
  );
}

function exportItemRow(item: StockItem) {
  return {
    code: item.code ?? '-',
    article: item.name,
    categorie: item.category ?? '-',
    magasin: item.store ?? '-',
    stock_actuel: item.current_quantity ?? 0,
    seuil_min: item.minimum_quantity ?? 0,
    unite: item.unit ?? '-',
    cout_unitaire: money(item.average_purchase_price ?? item.purchase_price ?? 0),
    valeur_stock: money(Number(item.current_quantity ?? 0) * Number(item.average_purchase_price ?? item.purchase_price ?? 0)),
    statut: statusLabel(item.status),
  };
}

function movementTypeLabel(value: string) {
  return ({ IN: 'Entrée', OUT: 'Sortie', INVENTORY: 'Inventaire', ADJUSTMENT: 'Correction' } as Record<string, string>)[value] ?? value;
}

function stockAlertLabel(value?: string) {
  return ({ OK: 'OK', LOW_STOCK: 'Sous seuil', OUT_OF_STOCK: 'Rupture', INACTIVE: 'Inactif' } as Record<string, string>)[value ?? ''] ?? value ?? '-';
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return <div className="summary-item"><span>{label}</span><strong>{String(value)}</strong></div>;
}
