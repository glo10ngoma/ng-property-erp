import { Eye, Pencil, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, includesText } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { StockItem } from '../stock.types';

const defaultCategories = ['Plomberie', 'Electricite', 'Peinture', 'Entretien', 'Bureau', 'Consommables', 'Autres'];
const defaultUnits = ['piece', 'boite', 'carton', 'paquet', 'sac', 'kg', 'g', 'litre', 'ml', 'bouteille', 'bidon', 'seau', 'metre', 'rouleau', 'paire', 'jeu', 'lot', 'service', 'autre'];

export function StockArticlesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useApiList<StockItem>('/stock/items');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<StockItem | null | undefined>(undefined);
  const [success, setSuccess] = useState('');

  const filtered = useMemo(
    () => list.data.filter((item) => includesText(item, query) && (!status || item.status === status)),
    [list.data, query, status],
  );

  async function save(form: FormData, current?: StockItem | null) {
    const values = Object.fromEntries(form);
    const presetUnit = String(values.unit_preset ?? resolveUnitPreset(current?.unit));
    const customUnit = String(values.unit_custom ?? '').trim();
    const unit = presetUnit === 'autre' ? customUnit : presetUnit;
    const payload: Record<string, unknown> = {
      name: String(values.name ?? '').trim(),
      category: values.category,
      unit,
      minimum_quantity: Number(values.minimum_quantity ?? 0),
      current_quantity: Number(values.current_quantity ?? 0),
      purchase_price: Number(values.purchase_price ?? 0),
      description: values.description || null,
      observations: values.observations || null,
      barcode: values.barcode || null,
      supplier_reference: values.supplier_reference || null,
      supplier_name: values.supplier_name || null,
      brand: values.brand || null,
      model: values.model || null,
      status: values.status || 'ACTIVE',
      attachment_file_name: form.get('attachment_file') instanceof File ? (form.get('attachment_file') as File).name : current?.attachment_file_name ?? undefined,
      photo_file_name: form.get('photo_file') instanceof File ? (form.get('photo_file') as File).name : undefined,
    };

    if (!payload.name) {
      throw new Error("Le nom de l'article est obligatoire.");
    }

    if (current?.id) {
      await api.patch(`/stock/items/${current.id}`, payload);
      setSuccess('Article modifie.');
    } else {
      await api.post('/stock/items', payload);
      setSuccess('Article cree.');
    }

    setEditing(undefined);
    await list.reload();
  }

  async function deactivate(item: StockItem) {
    await api.post(`/stock/items/${item.id}/deactivate`, {});
    setSuccess('Article desactive.');
    await list.reload();
  }

  async function reactivate(item: StockItem) {
    await api.post(`/stock/items/${item.id}/reactivate`, {});
    setSuccess('Article reactive.');
    await list.reload();
  }

  async function remove(item: StockItem) {
    if (!window.confirm(`Supprimer definitivement l'article ${item.name} ?`)) return;
    await api.delete(`/stock/items/${item.id}`);
    setSuccess('Article supprime.');
    await list.reload();
  }

  return (
    <section>
      <PageHeader title="Articles" />
      <StockNav />
      <SuccessMessage message={success} />
      <div className="maintenance-filter-bar stock-filter-bar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un article" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Statut</option>
          <option value="ACTIVE">Actif</option>
          <option value="INACTIVE">Inactif</option>
        </select>
        <button className="secondary" onClick={() => { setQuery(''); setStatus(''); }}><RotateCcw size={15} />Reinitialiser</button>
        <button className="secondary" onClick={() => exportCsv('articles-stock.csv', filtered.map(exportRow))}>CSV</button>
        <div className="toolbar-spacer" />
        {can('stock.create') && <button onClick={() => setEditing(null)}><Plus size={16} />Creer article</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Article</th>
              <th>Categorie</th>
              <th>Unite</th>
              <th>Marque</th>
              <th>Modele</th>
              <th>Fournisseur</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="clickable-row" onClick={() => navigate(`/stock/${item.id}`)}>
                <td>{normalizeAutoCode(item.code, 'ART', item.id)}</td>
                <td>{item.name}</td>
                <td>{item.category ?? '-'}</td>
                <td>{item.unit ?? '-'}</td>
                <td>{item.brand ?? '-'}</td>
                <td>{item.model ?? '-'}</td>
                <td>{item.supplier_name ?? item.supplier_reference ?? '-'}</td>
                <td>{item.status === 'ACTIVE' ? 'Actif' : 'Inactif'}</td>
                <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/${item.id}`)}><Eye size={16} /></button>
                  {can('stock.update') && <button className="icon-btn" title="Modifier" onClick={() => setEditing(item)}><Pencil size={16} /></button>}
                  {can('stock.update') && item.status === 'ACTIVE' && <button className="icon-btn" title="Desactiver" onClick={() => void deactivate(item)}><Power size={16} /></button>}
                  {can('stock.update') && item.status === 'INACTIVE' && <button className="icon-btn" title="Reactiver" onClick={() => void reactivate(item)}><Power size={16} /></button>}
                  {can('stock.delete') && <button className="icon-btn danger" title="Supprimer" onClick={() => void remove(item)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState message="Aucun article trouve." />}
      </div>
      {editing !== undefined && <ArticleModal item={editing} existingItems={list.data} onClose={() => setEditing(undefined)} onSubmit={save} />}
    </section>
  );
}

function ArticleModal({
  item,
  existingItems,
  onClose,
  onSubmit,
}: {
  item: StockItem | null;
  existingItems: StockItem[];
  onClose: () => void;
  onSubmit: (form: FormData, current?: StockItem | null) => Promise<void>;
}) {
  const [fileName, setFileName] = useState(item?.attachment_file_name ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const initialPreset = resolveUnitPreset(item?.unit);
  const [unitPreset, setUnitPreset] = useState(initialPreset);
  const nextCode = previewNextArticleCode(existingItems);

  async function submit(form: FormData) {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(form, item);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' | ') : message || "Impossible d'enregistrer l'article.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title={item ? 'Modifier article' : 'Nouvel article'} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
        <div className="modal-section">
          <h3>Informations generales</h3>
          <div className="form-grid">
            <label className="locked-field">Code auto<input value={item?.code ?? nextCode} readOnly /></label>
            <label>Nom *<input name="name" defaultValue={item?.name} required /></label>
            <label>Categorie *<select name="category" defaultValue={item?.category ?? 'Autres'}>{defaultCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Unite *<select name="unit_preset" value={unitPreset} onChange={(event) => setUnitPreset(event.target.value)}>{defaultUnits.map((value) => <option key={value} value={value}>{labelUnit(value)}</option>)}</select></label>
            {unitPreset === 'autre' && <label>Unite personnalisee *<input name="unit_custom" defaultValue={initialPreset === 'autre' ? item?.unit ?? '' : ''} required /></label>}
            <label>Seuil minimum<input name="minimum_quantity" type="number" min="0" step="0.01" defaultValue={item?.minimum_quantity ?? 0} /></label>
            {!item && <label>Stock initial<input name="current_quantity" type="number" min="0" step="0.01" defaultValue="0" /></label>}
            <label>Cout unitaire<input name="purchase_price" type="number" min="0" step="0.01" defaultValue={item?.average_purchase_price ?? item?.purchase_price ?? 0} /></label>
            <label className="wide-field">Description<textarea name="description" defaultValue={item?.description} /></label>
          </div>
        </div>
        <details className="advanced-options">
          <summary>Options avancees</summary>
          <div className="form-grid">
            <label>Code-barres<input name="barcode" defaultValue={item?.barcode} /></label>
            <label>Reference fournisseur<input name="supplier_reference" defaultValue={item?.supplier_reference} /></label>
            <label>Fournisseur<input name="supplier_name" defaultValue={item?.supplier_name} /></label>
            <label>Marque<input name="brand" defaultValue={item?.brand} /></label>
            <label>Modele<input name="model" defaultValue={item?.model} /></label>
            <label>Photo<input name="photo_file" type="file" accept="image/*" /></label>
            <label>Piece jointe<input name="attachment_file" type="file" accept=".pdf,image/*" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? item?.attachment_file_name ?? '')} /></label>
            {fileName && <div className="storage-note wide-field">{fileName}</div>}
            <label className="wide-field">Observations<textarea name="observations" defaultValue={item?.observations} /></label>
            <label>Statut<select name="status" defaultValue={item?.status ?? 'ACTIVE'}><option value="ACTIVE">Actif</option><option value="INACTIVE">Inactif</option></select></label>
          </div>
        </details>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function resolveUnitPreset(value?: string) {
  if (!value) return 'piece';
  return defaultUnits.includes(value) ? value : 'autre';
}

function labelUnit(value: string) {
  return ({
    piece: 'piece',
    boite: 'boite',
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
    metre: 'metre',
    rouleau: 'rouleau',
    paire: 'paire',
    jeu: 'jeu',
    lot: 'lot',
    service: 'service',
    autre: 'autre',
  } as Record<string, string>)[value] ?? value;
}

function previewNextArticleCode(items: StockItem[]) {
  const next = items.reduce((max, item) => {
    const match = String(item.code ?? '').match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0) + 1;
  return `ART-${String(next).padStart(5, '0')}`;
}

function normalizeAutoCode(value: string | undefined, prefix: string, id: number) {
  const code = String(value ?? '').trim();
  const match = code.match(/([A-Z]+-\d+)/i);
  if (match) return match[1].toUpperCase();
  return `${prefix}-${String(id).padStart(prefix === 'EMP' ? 6 : 5, '0')}`;
}

function exportRow(item: StockItem) {
  return {
    code: normalizeAutoCode(item.code, 'ART', item.id),
    article: item.name,
    categorie: item.category ?? '',
    unite: item.unit ?? '',
    marque: item.brand ?? '',
    modele: item.model ?? '',
    fournisseur: item.supplier_name ?? item.supplier_reference ?? '',
    statut: item.status === 'ACTIVE' ? 'Actif' : 'Inactif',
  };
}
