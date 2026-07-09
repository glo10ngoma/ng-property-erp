import { Eye, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, includesText } from '../../../api';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useAuth } from '../../../auth';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { StockItem } from '../stock.types';

const defaultCategories = ['Plomberie', 'Électricité', 'Peinture', 'Entretien', 'Bureau', 'Consommables', 'Autres'];
const defaultUnits = ['pièce', 'boîte', 'carton', 'paquet', 'sac', 'kg', 'g', 'litre', 'ml', 'bouteille', 'bidon', 'seau', 'mètre', 'rouleau', 'paire', 'jeu', 'lot', 'service', 'autre'];

export function StockArticlesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useApiList<StockItem>('/stock/items');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<StockItem | null | undefined>(undefined);
  const [success, setSuccess] = useState('');
  const filtered = useMemo(() => list.data.filter((item) => includesText(item, query) && (!status || item.status === status)), [list.data, query, status]);

  async function save(form: FormData) {
    const values = Object.fromEntries(form);
    const presetUnit = String(values.unit_preset ?? resolveUnitPreset(editing?.unit));
    const customUnit = String(values.unit_custom ?? '').trim();
    const unit = presetUnit === 'autre' ? customUnit : presetUnit;
    const payload: Record<string, unknown> = {
      ...values,
      unit,
      minimum_quantity: Number(values.minimum_quantity ?? 0),
      current_quantity: Number(values.current_quantity ?? 0),
      purchase_price: Number(values.purchase_price ?? 0),
      attachment_file_name: form.get('attachment_file') instanceof File ? (form.get('attachment_file') as File).name : undefined,
      photo_file_name: form.get('photo_file') instanceof File ? (form.get('photo_file') as File).name : undefined,
    };
    delete payload.unit_preset;
    delete payload.unit_custom;
    if (editing?.id) await api.patch(`/stock/items/${editing.id}`, payload);
    else await api.post('/stock/items', payload);
    setSuccess(editing?.id ? 'Article modifié.' : 'Article créé.');
    setEditing(undefined);
    list.reload();
  }

  async function deactivate(item: StockItem) {
    await api.delete(`/stock/items/${item.id}`);
    setSuccess('Article désactivé.');
    list.reload();
  }

  return <section>
    <PageHeader title="Articles" />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="maintenance-filter-bar stock-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un article" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Statut</option><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select>
      <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Réinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('articles-stock.csv', filtered)}>CSV</button>
      <div className="toolbar-spacer" />
      {can('stock.create') && <button onClick={() => setEditing(null)}><Plus size={16} />Créer article</button>}
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Code</th><th>Nom article</th><th>Catégorie</th><th>Unité</th><th>Marque</th><th>Modèle</th><th>Fournisseur</th><th>Statut</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((item) => <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/${item.id}`)}>
        <td>{item.code}</td><td>{item.name}</td><td>{item.category ?? '-'}</td><td>{item.unit ?? '-'}</td><td>{item.brand ?? '-'}</td><td>{item.model ?? '-'}</td><td>{item.supplier_name ?? item.supplier_reference ?? '-'}</td><td>{item.status === 'ACTIVE' ? 'Actif' : 'Inactif'}</td>
        <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
          <button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/${item.id}`)}><Eye size={16} /></button>
          {can('stock.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(item)}><Pencil size={16} /></button>}
          {can('stock.delete') && item.status === 'ACTIVE' && <button className="icon-btn danger" title="Désactiver" onClick={() => void deactivate(item)}><Trash2 size={16} /></button>}
        </td>
      </tr>)}</tbody>
    </table>{!filtered.length && <EmptyState message="Aucun article trouvé." />}</div>
    {editing !== undefined && <ArticleModal item={editing} onClose={() => setEditing(undefined)} onSubmit={save} />}
  </section>;
}

function ArticleModal({ item, onClose, onSubmit }: { item: StockItem | null; onClose: () => void; onSubmit: (form: FormData) => Promise<void> }) {
  const [fileName, setFileName] = useState('');
  const initialPreset = resolveUnitPreset(item?.unit);
  const [unitPreset, setUnitPreset] = useState(initialPreset);
  return <Modal title={item ? 'Modifier article' : 'Nouvel article'} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }}>
      <div className="modal-section"><h3>Informations générales</h3><div className="form-grid">
        <label className="locked-field">Code auto<input name="code" defaultValue={item?.code} readOnly placeholder="Automatique" /></label>
        <label>Nom *<input name="name" defaultValue={item?.name} required /></label>
        <label>Catégorie *<select name="category" defaultValue={item?.category ?? 'Autres'}>{defaultCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Magasin<input name="store" defaultValue={item?.store} /></label>
        <label>Unité *<select name="unit_preset" value={unitPreset} onChange={(event) => setUnitPreset(event.target.value)}>{defaultUnits.map((value) => <option key={value} value={value}>{labelUnit(value)}</option>)}</select></label>
        {unitPreset === 'autre' && <label>Unité personnalisée *<input name="unit_custom" defaultValue={initialPreset === 'autre' ? item?.unit ?? '' : ''} required /></label>}
        <label>Seuil minimum<input name="minimum_quantity" type="number" min="0" step="0.01" defaultValue={item?.minimum_quantity ?? 0} /></label>
        {!item && <label>Stock initial<input name="current_quantity" type="number" min="0" step="0.01" defaultValue="0" /></label>}
        <label>Coût unitaire<input name="purchase_price" type="number" min="0" step="0.01" defaultValue={item?.average_purchase_price ?? item?.purchase_price ?? 0} /></label>
        <label className="wide-field">Description<textarea name="description" defaultValue={item?.description} /></label>
      </div></div>
      <details className="advanced-options"><summary>Options avancées</summary><div className="form-grid">
        <label>Code-barres<input name="barcode" defaultValue={item?.barcode} /></label><label>Référence fournisseur<input name="supplier_reference" defaultValue={item?.supplier_reference} /></label>
        <label>Fournisseur<input name="supplier_name" defaultValue={item?.supplier_name} /></label><label>Marque<input name="brand" defaultValue={item?.brand} /></label><label>Modele<input name="model" defaultValue={item?.model} /></label>
        <label>Photo<input name="photo_file" type="file" accept="image/*" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>
        <label>Pièce jointe<input name="attachment_file" type="file" accept=".pdf,image/*" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>
        {fileName && <div className="storage-note wide-field">{fileName}</div>}<label className="wide-field">Observations<textarea name="observations" defaultValue={item?.observations} /></label>
        <label>Statut<select name="status" defaultValue={item?.status ?? 'ACTIVE'}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
      </div></details>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer</button></div>
    </form>
  </Modal>;
}

function resolveUnitPreset(value?: string) {
  if (!value) return 'pièce';
  return defaultUnits.includes(value) ? value : 'autre';
}

function labelUnit(value: string) {
  return ({
    'pièce': 'pièce',
    'boîte': 'boîte',
    carton: 'carton',
    paquet: 'paquet',
    sac: 'sac',
    kg: 'kg',
    g: 'g',
    litre: 'litre',
    ml: 'ml',
    bouteille: 'bouteille',
    bidon: 'bidon',
    seau: 'seau',
    'mètre': 'mètre',
    rouleau: 'rouleau',
    paire: 'paire',
    jeu: 'jeu',
    lot: 'lot',
    service: 'service',
    autre: 'autre',
  } as Record<string, string>)[value] ?? value;
}
