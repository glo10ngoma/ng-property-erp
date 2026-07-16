import { Eye, FileSpreadsheet, Plus, RotateCcw, WalletCards, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, SuccessMessage } from '../../../components';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { StockItem, StockPurchase, StockPurchaseDetail } from '../stock.types';
import { paymentStatusLabel, purchaseStatusLabel, receptionStatusLabel } from '../stock.utils';

type DraftLine = { rowId: number; stock_item_id: number | null; quantity: string; unit_price: string };

export function StockPurchasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const purchases = useApiList<StockPurchase>('/stock/purchases');
  const items = useApiList<StockItem>('/stock/items');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('');
  const [supplier, setSupplier] = useState('');
  const [receptionStatus, setReceptionStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<StockPurchaseDetail | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<StockPurchase | null>(null);
  const [success, setSuccess] = useState('');

  const filtered = useMemo(() => purchases.data.filter((purchase) =>
    includesText(purchase, query)
      && (!period || String(purchase.purchase_date).slice(0, 7) === period)
      && (!supplier || purchase.supplier_name === supplier)
      && (!receptionStatus || purchase.reception_status === receptionStatus)
      && (!paymentStatus || purchase.payment_status === paymentStatus),
  ), [purchases.data, query, period, supplier, receptionStatus, paymentStatus]);

  const supplierOptions = [...new Set(purchases.data.map((purchase) => purchase.supplier_name).filter(Boolean))].sort();
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthRows = purchases.data.filter((purchase) => String(purchase.purchase_date).slice(0, 7) === monthKey);
  const totalAmount = filtered.reduce((sum, purchase) => sum + Number(purchase.total_amount ?? 0), 0);
  const totalPaid = filtered.reduce((sum, purchase) => sum + Number(purchase.paid_amount ?? 0), 0);
  const totalOutstanding = filtered.reduce((sum, purchase) => sum + Number(purchase.outstanding_amount ?? 0), 0);

  async function openReceive(purchase: StockPurchase) {
    const response = await api.get<StockPurchaseDetail>(`/stock/purchases/${purchase.id}`);
    setReceiveTarget(response.data);
  }

  async function createPurchase(payload: Record<string, unknown>) {
    await api.post('/stock/purchases', payload);
    await purchases.reload();
    setCreateOpen(false);
    setSuccess('Achat fournisseur enregistre.');
  }

  async function receivePurchase(payload: Record<string, unknown>) {
    if (!receiveTarget) return;
    await api.post(`/stock/purchases/${receiveTarget.id}/receive`, payload);
    setReceiveTarget(null);
    setSuccess('Reception enregistree.');
    await purchases.reload();
    await items.reload();
  }

  async function registerPayment(payload: Record<string, unknown>) {
    if (!paymentTarget) return;
    await api.post(`/stock/purchases/${paymentTarget.id}/pay`, payload);
    setPaymentTarget(null);
    setSuccess('Paiement fournisseur enregistre.');
    await purchases.reload();
  }

  function exportWorkbook() {
    return exportXlsxWorkbook('Achats_fournisseurs.xlsx', [
      { name: 'Resume', rows: [{ achats: filtered.length, montant: totalAmount, paye: totalPaid, dette: totalOutstanding }] },
      { name: 'Achats', rows: filtered.map(exportPurchaseRow) },
      { name: 'Non receptionnes', rows: filtered.filter((item) => item.reception_status !== 'RECEIVED').map(exportPurchaseRow) },
      { name: 'Non payes', rows: filtered.filter((item) => item.payment_status !== 'PAID').map(exportPurchaseRow) },
    ]);
  }

  return <section>
    <PageHeader title="Achats fournisseurs" action={can('stock.create') ? <button onClick={() => setCreateOpen(true)}><Plus size={16} />Nouvel achat</button> : undefined} />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="mini-stats">
      <Kpi label="Nombre achats" value={filtered.length} />
      <Kpi label="Achats du mois" value={monthRows.length} />
      <Kpi label="Montant achats" value={`${money(totalAmount)} USD`} />
      <Kpi label="Montant paye" value={`${money(totalPaid)} USD`} />
      <Kpi label="Dette fournisseurs" value={`${money(totalOutstanding)} USD`} />
      <Kpi label="Non receptionnes" value={filtered.filter((purchase) => purchase.reception_status !== 'RECEIVED').length} />
    </div>
    <div className="maintenance-filter-bar stock-filter-bar stock-purchase-filter-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche" />
      <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} title="Periode" />
      <select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="">Fournisseur</option>{supplierOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select value={receptionStatus} onChange={(event) => setReceptionStatus(event.target.value)}><option value="">Reception</option><option value="PENDING">En attente</option><option value="PARTIAL">Partielle</option><option value="RECEIVED">Receptionnee</option></select>
      <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="">Paiement</option><option value="UNPAID">Non paye</option><option value="PARTIAL">Partiel</option><option value="PAID">Paye</option></select>
      <button className="secondary" onClick={() => { setQuery(''); setPeriod(''); setSupplier(''); setReceptionStatus(''); setPaymentStatus(''); }}><RotateCcw size={15} />Reinitialiser</button>
      <button className="secondary" onClick={() => exportCsv('achats-fournisseurs.csv', filtered.map(exportPurchaseRow))}>CSV</button>
      <button className="secondary" onClick={exportWorkbook}><FileSpreadsheet size={15} />Excel</button>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>N° achat</th><th>Date</th><th>Fournisseur</th><th className="right">Montant</th><th className="right">Paye</th><th className="right">Reste</th><th>Statut achat</th><th>Statut reception</th><th>Statut paiement</th><th>Utilisateur</th><th>Actions</th></tr></thead>
      <tbody>{filtered.map((purchase) => <tr key={purchase.id} className="clickable-row" onClick={() => navigate(`/stock/purchases/${purchase.id}`)}>
        <td><strong>{normalizeDisplayCode(purchase.purchase_number, 'PO', purchase.id, 6)}</strong></td>
        <td>{shortDate(purchase.purchase_date)}</td>
        <td>{purchase.supplier_name}</td>
        <td className="right">{money(purchase.total_amount)}</td>
        <td className="right">{money(purchase.paid_amount)}</td>
        <td className="right">{money(purchase.outstanding_amount)}</td>
        <td>{purchaseStatusLabel(purchase.purchase_status)}</td>
        <td>{receptionStatusLabel(purchase.reception_status)}</td>
        <td>{paymentStatusLabel(purchase.payment_status)}</td>
        <td>{purchase.user_name ?? '-'}</td>
        <td className="actions actions-compact" onClick={(event) => event.stopPropagation()}>
          <button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/purchases/${purchase.id}`)}><Eye size={16} /></button>
          {purchase.reception_status !== 'RECEIVED' && <button className="icon-btn" title="Recevoir marchandises" onClick={() => void openReceive(purchase)}><Plus size={16} /></button>}
          {Number(purchase.outstanding_amount ?? 0) > 0 && <button className="icon-btn" title="Enregistrer paiement fournisseur" onClick={() => setPaymentTarget(purchase)}><WalletCards size={16} /></button>}
        </td>
      </tr>)}</tbody>
    </table>{!filtered.length && <EmptyState message="Aucun achat fournisseur." />}</div>
    {createOpen && <PurchaseCreateModal purchases={purchases.data} items={items.data.filter((item) => item.status === 'ACTIVE')} onClose={() => setCreateOpen(false)} onSubmit={createPurchase} />}
    {receiveTarget && <PurchaseReceiveModal purchase={receiveTarget} onClose={() => setReceiveTarget(null)} onSubmit={receivePurchase} />}
    {paymentTarget && <PurchasePaymentModal purchase={paymentTarget} onClose={() => setPaymentTarget(null)} onSubmit={registerPayment} />}
  </section>;
}

export function PurchaseCreateModal({
  purchases,
  items,
  onClose,
  onSubmit,
}: {
  purchases: StockPurchase[];
  items: StockItem[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [lines, setLines] = useState<DraftLine[]>([{ rowId: 1, stock_item_id: null, quantity: '1', unit_price: '0' }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paymentType, setPaymentType] = useState<'CASH' | 'PARTIAL' | 'DEFERRED'>('DEFERRED');
  const [initialPaymentAmount, setInitialPaymentAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  const itemOptions = items.map((item) => ({
    value: item.id,
    label: `${normalizeDisplayCode(item.code, 'ART', item.id, 5)} - ${item.name}`,
    meta: `Stock: ${Number(item.current_quantity ?? 0)} | Cout moyen: ${money(Number(item.average_purchase_price ?? item.purchase_price ?? 0))} USD`,
  }));
  const totals = lines.reduce((acc, line) => {
    const total = Number(line.quantity || 0) * Number(line.unit_price || 0);
    return { subtotal: acc.subtotal + total };
  }, { subtotal: 0 });

  async function submit(form: FormData) {
    setError('');
    const payload = {
      purchase_date: String(form.get('purchase_date') ?? ''),
      supplier_name: String(form.get('supplier_name') ?? '').trim(),
      supplier_reference: String(form.get('supplier_reference') ?? ''),
      payment_terms: String(form.get('payment_terms') ?? ''),
      payment_method: paymentType === 'DEFERRED' ? '' : String(form.get('payment_method') ?? ''),
      payment_type: paymentType,
      due_date: paymentType === 'CASH' ? '' : dueDate,
      initial_payment_amount: paymentType === 'PARTIAL' ? Number(initialPaymentAmount || 0) : 0,
      observations: String(form.get('observations') ?? ''),
      lines: lines.map((line) => ({
        stock_item_id: line.stock_item_id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
      })),
    };

    if (!payload.supplier_name) {
      return setError('Renseignez le fournisseur.');
    }
    if (!payload.lines.length) {
      return setError('Ajoutez au moins un article.');
    }
    if (payload.lines.some((line) => !line.stock_item_id)) {
      return setError('Chaque ligne doit contenir un article selectionne.');
    }
    if (payload.lines.some((line) => line.quantity <= 0)) {
      return setError('Chaque ligne doit contenir une quantite strictement positive.');
    }
    if (payload.lines.some((line) => line.unit_price < 0)) {
      return setError('Le cout unitaire doit etre superieur ou egal a 0.');
    }
    if (paymentType !== 'DEFERRED' && !payload.payment_method) {
      return setError('Selectionnez un mode de paiement.');
    }
    if (paymentType === 'PARTIAL' && (!Number.isFinite(payload.initial_payment_amount) || payload.initial_payment_amount <= 0)) {
      return setError('Saisissez un montant initial strictement positif pour un paiement partiel.');
    }
    if (paymentType === 'PARTIAL' && payload.initial_payment_amount > totals.subtotal) {
      return setError("Le montant initial ne peut pas depasser le total de l'achat.");
    }

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' | ') : message || "Impossible d'enregistrer l'achat fournisseur.");
    } finally {
      setSubmitting(false);
    }
  }

  return <Modal title="Nouvel achat fournisseur" onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
      <div className="modal-section">
        <h3>Informations generales</h3>
        <div className="form-grid stock-purchase-grid">
          <label className="locked-field">N° achat<input value={previewNextPurchaseNumber(purchases)} readOnly /></label>
          <label>Date<input name="purchase_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <label>Fournisseur *<input name="supplier_name" required /></label>
          <label>Reference fournisseur<input name="supplier_reference" /></label>
          <label>Conditions de paiement<input name="payment_terms" /></label>
          <label>Mode paiement<select name="payment_method" defaultValue="" disabled={paymentType === 'DEFERRED'} required={paymentType !== 'DEFERRED'}><option value="">Selectionner</option><option value="CASH">Especes</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option><option value="OTHER">Autre</option></select></label>
          <label>Paiement<select name="payment_type" value={paymentType} onChange={(event) => setPaymentType(event.target.value as 'CASH' | 'PARTIAL' | 'DEFERRED')}><option value="CASH">Comptant</option><option value="PARTIAL">Partiel</option><option value="DEFERRED">Differe</option></select></label>
          <label>Date d'echeance<input name="due_date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={paymentType === 'CASH'} /></label>
          <label>Montant initial<input name="initial_payment_amount" type="number" min="0" step="0.01" value={initialPaymentAmount} onChange={(event) => setInitialPaymentAmount(event.target.value)} disabled={paymentType !== 'PARTIAL'} /></label>
          <label className="wide-field">Observations<textarea name="observations" rows={3} /></label>
        </div>
      </div>
      <div className="modal-section">
        <div className="section-heading-row"><h3>Lignes d'achat</h3><button type="button" className="secondary" onClick={() => setLines((current) => [...current, { rowId: Date.now(), stock_item_id: null, quantity: '1', unit_price: '0' }])}><Plus size={15} />Ajouter un article</button></div>
        {!lines.length && <div className="info-message">Ajoutez au moins un article.</div>}
        <div className="table-wrap stock-document-lines-wrap">
          <table className="stock-document-lines">
            <thead><tr><th>Article</th><th className="right">Quantite</th><th className="right">Cout unitaire</th><th className="right">Total ligne</th><th /></tr></thead>
            <tbody>{lines.map((line) => <tr key={line.rowId}>
              <td>
                <SearchableSelect
                  options={itemOptions}
                  value={line.stock_item_id}
                  onChange={(value) => setLines((current) => current.map((entry) => entry.rowId === line.rowId ? { ...entry, stock_item_id: value ? Number(value) : null, unit_price: value ? String(Number(items.find((item) => item.id === value)?.average_purchase_price ?? items.find((item) => item.id === value)?.purchase_price ?? 0)) : entry.unit_price } : entry))}
                  placeholder="Selectionner un article"
                  emptyMessage="Aucun article"
                />
              </td>
              <td><input className="right" type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.rowId === line.rowId ? { ...entry, quantity: event.target.value } : entry))} /></td>
              <td><input className="right" type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => setLines((current) => current.map((entry) => entry.rowId === line.rowId ? { ...entry, unit_price: event.target.value } : entry))} /></td>
              <td className="right">{money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td>
              <td className="actions actions-compact"><button type="button" className="icon-btn danger" title="Supprimer" onClick={() => setLines((current) => current.length > 1 ? current.filter((entry) => entry.rowId !== line.rowId) : current)}><X size={15} /></button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="stock-document-totals">
          <div><span>Total HT</span><strong>{money(totals.subtotal)} USD</strong></div>
          <div><span>Taxes</span><strong>0 USD</strong></div>
          <div><span>Remise</span><strong>0 USD</strong></div>
          <div><span>Total TTC</span><strong>{money(totals.subtotal)} USD</strong></div>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button></div>
    </form>
  </Modal>;
}

export function PurchaseReceiveModal({ purchase, onClose, onSubmit }: { purchase: StockPurchaseDetail; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [rows, setRows] = useState(() => purchase.lines.map((line) => ({
    stock_purchase_line_id: line.id,
    item_name: line.item_name ?? '-',
    quantity: Number(line.quantity ?? 0),
    received_quantity: Number(line.received_quantity ?? 0),
    remaining: Math.max(Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0), 0),
    quantity_to_receive: Math.max(Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0), 0).toString(),
  })).filter((line) => line.remaining > 0));
  const [error, setError] = useState('');

  async function submit(form: FormData) {
    const lines = rows.filter((row) => Number(row.quantity_to_receive) > 0).map((row) => ({
      stock_purchase_line_id: row.stock_purchase_line_id,
      quantity_received: Number(row.quantity_to_receive),
    }));
    if (!lines.length) return setError('Aucune ligne de reception saisie.');
    if (lines.some((line, index) => Number(line.quantity_received) > rows[index].remaining)) return setError('Une quantite recue depasse le reste a recevoir.');
    await onSubmit({
      receipt_date: String(form.get('receipt_date') ?? ''),
      receiver_name: String(form.get('receiver_name') ?? ''),
      store: String(form.get('store') ?? ''),
      notes: String(form.get('notes') ?? ''),
      lines,
    });
  }

  return <Modal title={`Recevoir marchandises - ${purchase.purchase_number}`} onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
      <div className="modal-section">
        <h3>Reception</h3>
        <div className="form-grid stock-purchase-grid">
          <label className="locked-field">N° reception<input value="BR-000001" readOnly /></label>
          <label>Date<input name="receipt_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <label>Receptionnaire<input name="receiver_name" /></label>
          <label>Magasin<input name="store" defaultValue={purchase.store ?? ''} /></label>
          <label className="wide-field">Notes<textarea name="notes" rows={3} /></label>
        </div>
      </div>
      <div className="modal-section">
        <div className="table-wrap stock-document-lines-wrap">
          <table className="stock-document-lines">
            <thead><tr><th>Article</th><th className="right">Commande</th><th className="right">Deja recu</th><th className="right">Reste</th><th className="right">Quantite recue</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.stock_purchase_line_id}>
              <td>{row.item_name}</td>
              <td className="right">{row.quantity}</td>
              <td className="right">{row.received_quantity}</td>
              <td className="right">{row.remaining}</td>
              <td><input className="right" type="number" min="0" max={row.remaining} step="0.01" value={row.quantity_to_receive} onChange={(event) => setRows((current) => current.map((entry) => entry.stock_purchase_line_id === row.stock_purchase_line_id ? { ...entry, quantity_to_receive: event.target.value } : entry))} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Valider la reception</button></div>
    </form>
  </Modal>;
}

export function PurchasePaymentModal({ purchase, onClose, onSubmit }: { purchase: StockPurchase; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [error, setError] = useState('');
  return <Modal title={`Paiement fournisseur - ${purchase.purchase_number}`} onClose={onClose}>
    <form className="stock-purchase-modal" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const amount = Number(form.get('amount') ?? 0);
      if (amount <= 0 || amount > Number(purchase.outstanding_amount ?? 0)) {
        setError(`Le montant doit etre compris entre 0 et ${money(Number(purchase.outstanding_amount ?? 0))} USD.`);
        return;
      }
      void onSubmit({
        payment_date: String(form.get('payment_date') ?? ''),
        amount,
        payment_method: String(form.get('payment_method') ?? ''),
        reference: String(form.get('reference') ?? ''),
        notes: String(form.get('notes') ?? ''),
      });
    }}>
      <div className="modal-section">
        <h3>Dette fournisseur</h3>
        <div className="mini-stats">
          <Kpi label="Montant achat" value={`${money(purchase.total_amount)} USD`} />
          <Kpi label="Paye" value={`${money(purchase.paid_amount)} USD`} />
          <Kpi label="Reste a payer" value={`${money(purchase.outstanding_amount)} USD`} />
        </div>
        <div className="form-grid stock-purchase-grid">
          <label>Date<input name="payment_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <label>Montant *<input name="amount" type="number" min="0" step="0.01" defaultValue={purchase.outstanding_amount} required /></label>
          <label>Mode paiement<select name="payment_method" defaultValue={purchase.payment_method ?? 'BANK'}><option value="CASH">Especes</option><option value="BANK">Banque</option><option value="MOBILE_MONEY">Mobile Money</option><option value="OTHER">Autre</option></select></label>
          <label>Reference<input name="reference" defaultValue={purchase.purchase_number} /></label>
          <label className="wide-field">Notes<textarea name="notes" rows={3} /></label>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
      <div className="modal-footer-sticky"><button type="button" className="secondary" onClick={onClose}>Annuler</button><button type="submit">Enregistrer paiement</button></div>
    </form>
  </Modal>;
}

function exportPurchaseRow(purchase: StockPurchase) {
  return {
    numero: normalizeDisplayCode(purchase.purchase_number, 'PO', purchase.id, 6),
    date: shortDate(purchase.purchase_date),
    fournisseur: purchase.supplier_name,
    montant: Number(purchase.total_amount ?? 0),
    paye: Number(purchase.paid_amount ?? 0),
    reste_a_payer: Number(purchase.outstanding_amount ?? 0),
    statut_achat: purchaseStatusLabel(purchase.purchase_status),
    statut_reception: receptionStatusLabel(purchase.reception_status),
    statut_paiement: paymentStatusLabel(purchase.payment_status),
    utilisateur: purchase.user_name ?? '-',
  };
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function normalizeDisplayCode(value: string | undefined, prefix: string, id: number, width: number) {
  const code = String(value ?? '').trim();
  const match = code.match(/([A-Z]+-\d+)/i);
  if (match) return match[1].toUpperCase();
  return `${prefix}-${String(id).padStart(width, '0')}`;
}

function previewNextPurchaseNumber(purchases: StockPurchase[]) {
  const next = purchases.reduce((max, purchase) => {
    const match = String(purchase.purchase_number ?? '').match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0) + 1;
  return `PO-${String(next).padStart(6, '0')}`;
}
