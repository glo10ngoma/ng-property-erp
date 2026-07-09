import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../../components';
import type { StockItem } from './stock.types';

type DocumentType = 'ENTRY' | 'EXIT';
type DocumentLine = { key: number; stock_item_id: string; quantity: number; unit_price: number };

export function StockDocumentModal({
  type,
  items,
  stores,
  onClose,
  onSubmit,
}: {
  type: DocumentType;
  items: StockItem[];
  stores: string[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [lines, setLines] = useState<DocumentLine[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [fileName, setFileName] = useState('');
  const errors = useMemo(() => lines.map((line) => {
    const item = items.find((candidate) => candidate.id === Number(line.stock_item_id));
    if (!item) return 'Sélectionnez un article.';
    if (line.quantity <= 0) return 'La quantité doit être supérieure à zéro.';
    if (type === 'EXIT' && line.quantity > Number(item.current_quantity ?? 0)) {
      return `Stock insuffisant : ${item.current_quantity ?? 0} ${item.unit ?? ''} disponible(s).`;
    }
    return '';
  }), [items, lines, type]);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

  function updateLine(index: number, patch: Partial<DocumentLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((candidate) => candidate.id === Number(itemId));
    updateLine(index, {
      stock_item_id: itemId,
      unit_price: Number(item?.average_purchase_price ?? item?.purchase_price ?? 0),
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (errors.some(Boolean)) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setApiError('');
    try {
      await onSubmit({
        document_date: form.get('document_date'),
        supplier: type === 'ENTRY' ? form.get('supplier') : undefined,
        supplier_reference: type === 'ENTRY' ? form.get('supplier_reference') : undefined,
        reference: type === 'EXIT' ? form.get('reference') : undefined,
        reason: type === 'EXIT' ? form.get('reason') : undefined,
        store: form.get('store'),
        observations: form.get('observations'),
        attachment_file_name: fileName || undefined,
        lines: lines.map((line) => ({
          stock_item_id: Number(line.stock_item_id),
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
        })),
      });
    } catch (error) {
      const response = (error as { response?: { data?: { message?: string | string[] } } }).response?.data;
      setApiError(Array.isArray(response?.message) ? response.message.join(' ') : response?.message ?? 'Impossible d’enregistrer le document.');
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal title={type === 'ENTRY' ? 'Document d’entrée de stock' : 'Document de sortie de stock'} onClose={onClose}>
    <form className="stock-document-form" onSubmit={(event) => void submit(event)}>
      <div className="modal-section">
        <h3>Informations du document</h3>
        <div className="form-grid">
          <label className="locked-field">N° document<input value={type === 'ENTRY' ? 'Automatique (ES-000001)' : 'Automatique (SO-000001)'} readOnly /></label>
          <label>Date *<input name="document_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          {type === 'ENTRY' ? <>
            <label>Fournisseur (optionnel)<input name="supplier" /></label>
            <label>Référence fournisseur<input name="supplier_reference" /></label>
          </> : <>
            <label>Référence<input name="reference" /></label>
            <label>Motif *<input name="reason" required /></label>
          </>}
          <label>Magasin<input name="store" list="stock-stores" /><datalist id="stock-stores">{stores.map((store) => <option key={store} value={store} />)}</datalist></label>
          <label>Pièce jointe<input type="file" accept=".pdf,image/jpeg,image/png" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')} /></label>
          <label className="wide-field">Observations<textarea name="observations" rows={2} /></label>
        </div>
      </div>

      <div className="modal-section">
        <div className="section-heading-row"><h3>Articles</h3><button type="button" className="secondary" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={15} />Ajouter un article</button></div>
        <div className="table-wrap stock-document-lines"><table>
          <thead><tr><th>Article</th><th className="right">Stock actuel</th><th className="right">Quantité</th><th className="right">Coût unitaire</th><th className="right">Total</th><th>Supprimer</th></tr></thead>
          <tbody>{lines.map((line, index) => {
            const item = items.find((candidate) => candidate.id === Number(line.stock_item_id));
            return <tr key={line.key} className={errors[index] ? 'row-error' : ''}>
              <td><select value={line.stock_item_id} onChange={(event) => selectItem(index, event.target.value)} required><option value="">Sélectionner</option>{items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} - {candidate.name}</option>)}</select>{errors[index] && <small className="field-error">{errors[index]}</small>}</td>
              <td className="right">{item?.current_quantity ?? 0} {item?.unit ?? ''}</td>
              <td className="right"><input className="compact-number" type="number" min="0.01" step="0.01" value={line.quantity || ''} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} required /></td>
              <td className="right"><input className="compact-number" type="number" min="0" step="0.01" value={line.unit_price || ''} onChange={(event) => updateLine(index, { unit_price: Number(event.target.value) })} /></td>
              <td className="right"><strong>{(line.quantity * line.unit_price).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} USD</strong></td>
              <td><button type="button" className="icon-btn danger" title="Supprimer" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={16} /></button></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="summary-band"><span>Total général</span><strong>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} USD</strong></div>
      </div>
      {fileName && <div className="storage-note">Fichier sélectionné : {fileName}</div>}
      {apiError && <div className="error-message">{apiError}</div>}
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={submitting || errors.some(Boolean)}>{submitting ? 'Enregistrement...' : 'Valider le document'}</button></div>
    </form>
  </Modal>;
}

let nextLineKey = 1;
function newLine(): DocumentLine {
  return { key: nextLineKey++, stock_item_id: '', quantity: 0, unit_price: 0 };
}
