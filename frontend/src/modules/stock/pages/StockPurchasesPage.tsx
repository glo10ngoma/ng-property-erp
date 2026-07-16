import { Eye, FileSpreadsheet, Plus, RotateCcw, Upload, WalletCards, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportCsv, exportXlsxWorkbook, includesText, money, shortDate } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, Modal, PageHeader, SearchableSelect, SuccessMessage } from '../../../components';
import type { SearchableSelectOption } from '../../../components';
import { useApiList } from '../../../hooks';
import { StockNav } from '../StockNav';
import type { StockItem, StockPurchase, StockPurchaseDetail, Supplier } from '../stock.types';
import { paymentStatusLabel, purchaseStatusLabel, receptionStatusLabel } from '../stock.utils';

type DraftLine = { rowId: number; stock_item_id: number | null; quantity: string; unit_price: string };

const PURCHASE_ATTACHMENT_ACCEPT = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

export function StockPurchasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const purchases = useApiList<StockPurchase>('/stock/purchases');
  const items = useApiList<StockItem>('/stock/items');
  const suppliers = useApiList<Supplier>('/suppliers');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('');
  const [supplier, setSupplier] = useState('');
  const [receptionStatus, setReceptionStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<StockPurchaseDetail | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<StockPurchase | null>(null);
  const [success, setSuccess] = useState('');

  const filtered = useMemo(
    () =>
      purchases.data.filter(
        (purchase) =>
          includesText(purchase, query) &&
          (!period || String(purchase.purchase_date).slice(0, 7) === period) &&
          (!supplier || purchase.supplier_name === supplier) &&
          (!receptionStatus || purchase.reception_status === receptionStatus) &&
          (!paymentStatus || purchase.payment_status === paymentStatus),
      ),
    [purchases.data, query, period, supplier, receptionStatus, paymentStatus],
  );

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

  async function createPurchase(payload: Record<string, unknown>, attachments: File[]) {
    const response = await api.post<StockPurchaseDetail>('/stock/purchases', payload);
    const createdPurchase = response.data;
    let failedUploads = 0;

    for (const file of attachments) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        await api.post(`/stock/purchases/${createdPurchase.id}/attachments`, formData);
      } catch (error) {
        failedUploads += 1;
        console.error('Purchase attachment upload failed', { purchaseId: createdPurchase.id, fileName: file.name, error });
      }
    }

    await Promise.all([purchases.reload(), items.reload()]);
    setCreateOpen(false);
    setSuccess(
      failedUploads
        ? "Achat enregistre, mais certaines pieces jointes n'ont pas pu etre envoyees."
        : 'Achat fournisseur enregistre.',
    );
  }

  async function receivePurchase(payload: Record<string, unknown>) {
    if (!receiveTarget) return;
    await api.post(`/stock/purchases/${receiveTarget.id}/receive`, payload);
    setReceiveTarget(null);
    setSuccess('Reception enregistree.');
    await Promise.all([purchases.reload(), items.reload()]);
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

  return (
    <section>
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
        <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
          <option value="">Fournisseur</option>
          {supplierOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select value={receptionStatus} onChange={(event) => setReceptionStatus(event.target.value)}>
          <option value="">Reception</option>
          <option value="PENDING">En attente</option>
          <option value="PARTIAL">Partielle</option>
          <option value="RECEIVED">Receptionnee</option>
        </select>
        <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
          <option value="">Paiement</option>
          <option value="UNPAID">Non paye</option>
          <option value="PARTIAL">Partiel</option>
          <option value="PAID">Paye</option>
        </select>
        <button className="secondary" onClick={() => { setQuery(''); setPeriod(''); setSupplier(''); setReceptionStatus(''); setPaymentStatus(''); }}>
          <RotateCcw size={15} />
          Reinitialiser
        </button>
        <button className="secondary" onClick={() => exportCsv('achats-fournisseurs.csv', filtered.map(exportPurchaseRow))}>CSV</button>
        <button className="secondary" onClick={exportWorkbook}>
          <FileSpreadsheet size={15} />
          Excel
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N° achat</th>
              <th>Date</th>
              <th>Fournisseur</th>
              <th className="right">Montant</th>
              <th className="right">Paye</th>
              <th className="right">Reste</th>
              <th>Statut achat</th>
              <th>Statut reception</th>
              <th>Statut paiement</th>
              <th>Utilisateur</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((purchase) => (
              <tr key={purchase.id} className="clickable-row" onClick={() => navigate(`/stock/purchases/${purchase.id}`)}>
                <td>
                  <strong>{normalizeDisplayCode(purchase.purchase_number, 'PO', purchase.id, 6)}</strong>
                </td>
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
                  <button className="icon-btn" title="Voir" onClick={() => navigate(`/stock/purchases/${purchase.id}`)}>
                    <Eye size={16} />
                  </button>
                  {purchase.reception_status !== 'RECEIVED' && (
                    <button className="icon-btn" title="Recevoir marchandises" onClick={() => void openReceive(purchase)}>
                      <Plus size={16} />
                    </button>
                  )}
                  {Number(purchase.outstanding_amount ?? 0) > 0 && (
                    <button className="icon-btn" title="Enregistrer paiement fournisseur" onClick={() => setPaymentTarget(purchase)}>
                      <WalletCards size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState message="Aucun achat fournisseur." />}
      </div>
      {createOpen && (
        <PurchaseCreateModal
          purchases={purchases.data}
          items={items.data.filter((item) => item.status === 'ACTIVE')}
          suppliers={suppliers.data.filter((entry) => entry.status === 'ACTIVE')}
          onClose={() => setCreateOpen(false)}
          onCreateSupplier={async (payload) => {
            const response = await api.post<Supplier>('/suppliers', payload);
            await suppliers.reload();
            return response.data;
          }}
          onSubmit={createPurchase}
        />
      )}
      {receiveTarget && <PurchaseReceiveModal purchase={receiveTarget} onClose={() => setReceiveTarget(null)} onSubmit={receivePurchase} />}
      {paymentTarget && <PurchasePaymentModal purchase={paymentTarget} onClose={() => setPaymentTarget(null)} onSubmit={registerPayment} />}
    </section>
  );
}

export function PurchaseCreateModal({
  purchases,
  items,
  suppliers,
  onClose,
  onCreateSupplier,
  onSubmit,
}: {
  purchases: StockPurchase[];
  items: StockItem[];
  suppliers: Supplier[];
  onClose: () => void;
  onCreateSupplier: (payload: Record<string, unknown>) => Promise<Supplier>;
  onSubmit: (payload: Record<string, unknown>, attachments: File[]) => Promise<void>;
}) {
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierReference, setSupplierReference] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [paymentType, setPaymentType] = useState<'CASH' | 'DEFERRED'>('DEFERRED');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [receiptStatus, setReceiptStatus] = useState<'PENDING' | 'RECEIVED'>('PENDING');
  const [observations, setObservations] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([{ rowId: 1, stock_item_id: null, quantity: '1', unit_price: '0' }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);

  const selectedSupplier = suppliers.find((entry) => entry.id === supplierId) ?? null;
  const supplierOptions: SearchableSelectOption<number>[] = suppliers.map((entry) => ({
    value: entry.id,
    label: entry.name,
    meta: [entry.supplier_code, entry.phone, entry.email].filter(Boolean).join(' • '),
  }));
  const itemOptions: SearchableSelectOption<number>[] = items.map((item) => ({
    value: item.id,
    label: item.name,
    meta: [
      normalizeDisplayCode(item.code, 'ART', item.id, 5),
      item.unit || null,
      item.category || null,
      `Stock: ${Number(item.current_quantity ?? 0)}`,
    ]
      .filter(Boolean)
      .join(' • '),
  }));

  const totals = lines.reduce(
    (acc, line) => {
      const total = Number(line.quantity || 0) * Number(line.unit_price || 0);
      return { subtotal: acc.subtotal + total };
    },
    { subtotal: 0 },
  );
  const duplicateInfo = findDuplicateLine(lines);
  const blockingReason =
    !supplierId
      ? 'Selectionnez un fournisseur.'
      : !purchaseDate
        ? "Renseignez la date d'achat."
        : !lines.length
          ? 'Ajoutez au moins un article.'
          : lines.some((line) => !line.stock_item_id)
            ? 'Chaque ligne doit contenir un article selectionne.'
            : lines.some((line) => Number(line.quantity) <= 0)
              ? 'Chaque ligne doit contenir une quantite strictement positive.'
              : lines.some((line) => Number(line.unit_price) < 0)
                ? 'Le cout unitaire doit etre superieur ou egal a 0.'
                : duplicateInfo
                  ? duplicateInfo.message
                  : paymentType === 'CASH' && !paymentMethod
                    ? 'Selectionnez un mode de paiement.'
                    : !receiptStatus
                      ? 'Selectionnez le statut de reception.'
                      : '';

  async function handleAttachmentSelection(fileList: FileList | null) {
    if (!fileList?.length) return;
    const nextFiles = [...attachments];
    for (const file of Array.from(fileList)) {
      if (nextFiles.length >= 5) {
        setError('Vous ne pouvez pas joindre plus de 5 fichiers a un achat.');
        break;
      }
      if (!PURCHASE_ATTACHMENT_ACCEPT.split(',').includes(file.type)) {
        setError(`Le format de fichier ${file.name} n'est pas autorise.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`Le fichier ${file.name} depasse 10 Mo.`);
        continue;
      }
      nextFiles.push(file);
    }
    setAttachments(nextFiles);
  }

  async function submit() {
    setError('');
    if (blockingReason) {
      setError(blockingReason);
      return;
    }

    const payload = {
      purchase_date: purchaseDate,
      supplier_id: supplierId,
      supplier_reference: supplierReference.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      payment_method: paymentType === 'CASH' ? paymentMethod : null,
      payment_type: paymentType,
      receipt_status: receiptStatus,
      observations: observations.trim() || null,
      lines: lines.map((line) => ({
        stock_item_id: line.stock_item_id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
      })),
    };

    setSubmitting(true);
    try {
      await onSubmit(payload, attachments);
    } catch (err: any) {
      setError(parseApiError(err, "Impossible d'enregistrer l'achat fournisseur."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Modal title="Nouvel achat fournisseur" onClose={onClose}>
        <form
          className="stock-purchase-modal"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="modal-section">
            <h3>Informations generales</h3>
            <div className="form-grid stock-purchase-grid">
              <label className="locked-field">
                N° achat
                <input value={previewNextPurchaseNumber(purchases)} readOnly />
              </label>
              <label>
                Date
                <input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} required />
              </label>
              <label className="wide-field">
                Fournisseur *
                <div className="inline-form-actions">
                  <div className="grow-field">
                    <SearchableSelect
                      options={supplierOptions}
                      value={supplierId}
                      onChange={(value) => {
                        const nextValue = value ? Number(value) : null;
                        setSupplierId(nextValue);
                        const nextSupplier = suppliers.find((entry) => entry.id === nextValue);
                        if (nextSupplier && !paymentTerms.trim()) {
                          setPaymentTerms(String(nextSupplier.payment_terms ?? ''));
                        }
                      }}
                      placeholder="Rechercher un fournisseur"
                      emptyMessage="Aucun fournisseur"
                    />
                  </div>
                  <button type="button" className="secondary" onClick={() => setSupplierModalOpen(true)}>
                    <Plus size={15} />
                    Nouveau fournisseur
                  </button>
                </div>
              </label>
              <label>
                Reference fournisseur
                <input value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} />
              </label>
              <label>
                Conditions de paiement
                <input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder={selectedSupplier?.payment_terms ?? ''} />
              </label>
              <label>
                Paiement
                <select value={paymentType} onChange={(event) => setPaymentType(event.target.value as 'CASH' | 'DEFERRED')}>
                  <option value="CASH">Comptant</option>
                  <option value="DEFERRED">Differe</option>
                </select>
              </label>
              <label>
                Mode paiement
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={paymentType !== 'CASH'} required={paymentType === 'CASH'}>
                  <option value="">Selectionner</option>
                  <option value="CASH">Especes</option>
                  <option value="BANK">Banque</option>
                  <option value="MOBILE_MONEY">Mobile Money</option>
                  <option value="OTHER">Autre</option>
                </select>
              </label>
              <label>
                Reception des articles
                <select value={receiptStatus} onChange={(event) => setReceiptStatus(event.target.value as 'PENDING' | 'RECEIVED')}>
                  <option value="PENDING">Articles non encore recus</option>
                  <option value="RECEIVED">Articles deja recus</option>
                </select>
              </label>
              <label className="wide-field">
                Observations
                <textarea value={observations} onChange={(event) => setObservations(event.target.value)} rows={3} />
              </label>
            </div>
          </div>

          <div className="modal-section">
            <div className="section-heading-row">
              <h3>Lignes d'achat</h3>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { rowId: Date.now(), stock_item_id: null, quantity: '1', unit_price: '0' },
                  ])
                }
              >
                <Plus size={15} />
                Ajouter un article
              </button>
            </div>
            {!lines.length && <div className="info-message">Ajoutez au moins un article.</div>}
            <div className="table-wrap stock-document-lines-wrap">
              <table className="stock-document-lines">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="right">Quantite</th>
                    <th className="right">Cout unitaire</th>
                    <th className="right">Total ligne</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.rowId}>
                      <td>
                        <SearchableSelect
                          options={itemOptions}
                          value={line.stock_item_id}
                          onChange={(value) => {
                            if (!value) {
                              setLines((current) =>
                                current.map((entry) => (entry.rowId === line.rowId ? { ...entry, stock_item_id: null } : entry)),
                              );
                              return;
                            }
                            const duplicateLine = lines.findIndex((entry) => entry.rowId !== line.rowId && entry.stock_item_id === Number(value));
                            if (duplicateLine >= 0) {
                              setError(
                                `Cet article est deja present a la ligne ${duplicateLine + 1}. Veuillez modifier la quantite sur cette ligne au lieu de l'ajouter une seconde fois.`,
                              );
                              return;
                            }
                            const item = items.find((entry) => entry.id === Number(value));
                            setError('');
                            setLines((current) =>
                              current.map((entry) =>
                                entry.rowId === line.rowId
                                  ? {
                                      ...entry,
                                      stock_item_id: Number(value),
                                      unit_price: String(Number(item?.average_purchase_price ?? item?.purchase_price ?? 0)),
                                    }
                                  : entry,
                              ),
                            );
                          }}
                          placeholder={`Selectionner un article - ligne ${index + 1}`}
                          emptyMessage="Aucun article"
                        />
                      </td>
                      <td>
                        <input
                          className="right"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((entry) => (entry.rowId === line.rowId ? { ...entry, quantity: event.target.value } : entry)),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="right"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price}
                          onChange={(event) =>
                            setLines((current) =>
                              current.map((entry) => (entry.rowId === line.rowId ? { ...entry, unit_price: event.target.value } : entry)),
                            )
                          }
                        />
                      </td>
                      <td className="right">{money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td>
                      <td className="actions actions-compact">
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Supprimer"
                          onClick={() => setLines((current) => (current.length > 1 ? current.filter((entry) => entry.rowId !== line.rowId) : current))}
                        >
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stock-document-totals">
              <div>
                <span>Total HT</span>
                <strong>{money(totals.subtotal)} USD</strong>
              </div>
              <div>
                <span>Taxes</span>
                <strong>0 USD</strong>
              </div>
              <div>
                <span>Remise</span>
                <strong>0 USD</strong>
              </div>
              <div>
                <span>Total TTC</span>
                <strong>{money(totals.subtotal)} USD</strong>
              </div>
            </div>
          </div>

          <div className="modal-section">
            <div className="section-heading-row">
              <h3>Pieces jointes</h3>
              <label className="secondary button-like-file">
                <Upload size={15} />
                Ajouter des fichiers
                <input type="file" accept={PURCHASE_ATTACHMENT_ACCEPT} multiple onChange={(event) => void handleAttachmentSelection(event.target.files)} />
              </label>
            </div>
            {attachments.length ? (
              <div className="compact-list">
                {attachments.map((file, index) => (
                  <div className="compact-item" key={`${file.name}-${file.size}-${index}`}>
                    <span>
                      {file.name}
                      <br />
                      <small>
                        {formatFileSize(file.size)} • {file.type || 'type inconnu'}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Retirer"
                      onClick={() => setAttachments((current) => current.filter((_, attachmentIndex) => attachmentIndex !== index))}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="info-message">Aucune piece jointe selectionnee.</div>
            )}
            {blockingReason && !error ? <div className="info-message">{blockingReason}</div> : null}
            {error && <div className="error-banner">{error}</div>}
          </div>

          <div className="modal-footer-sticky">
            <button type="button" className="secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" disabled={submitting || Boolean(blockingReason)}>
              {submitting ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>

      {supplierModalOpen && (
        <SupplierCreateModal
          onClose={() => setSupplierModalOpen(false)}
          onSubmit={async (payload) => {
            const createdSupplier = await onCreateSupplier(payload);
            setSupplierId(createdSupplier.id);
            setPaymentTerms(String(createdSupplier.payment_terms ?? ''));
            setSupplierModalOpen(false);
          }}
        />
      )}
    </>
  );
}

export function PurchaseReceiveModal({
  purchase,
  onClose,
  onSubmit,
}: {
  purchase: StockPurchaseDetail;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [rows, setRows] = useState(() =>
    purchase.lines
      .map((line) => ({
        stock_purchase_line_id: line.id,
        item_name: line.item_name ?? '-',
        quantity: Number(line.quantity ?? 0),
        received_quantity: Number(line.received_quantity ?? 0),
        remaining: Math.max(Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0), 0),
        quantity_to_receive: Math.max(Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0), 0).toString(),
      }))
      .filter((line) => line.remaining > 0),
  );
  const [error, setError] = useState('');

  async function submit(form: FormData) {
    const lines = rows
      .filter((row) => Number(row.quantity_to_receive) > 0)
      .map((row) => ({
        stock_purchase_line_id: row.stock_purchase_line_id,
        quantity_received: Number(row.quantity_to_receive),
      }));
    if (!lines.length) return setError('Aucune ligne de reception saisie.');
    if (lines.some((line, index) => Number(line.quantity_received) > rows[index].remaining)) {
      return setError('Une quantite recue depasse le reste a recevoir.');
    }
    await onSubmit({
      receipt_date: String(form.get('receipt_date') ?? ''),
      receiver_name: String(form.get('receiver_name') ?? ''),
      store: String(form.get('store') ?? ''),
      notes: String(form.get('notes') ?? ''),
      lines,
    });
  }

  return (
    <Modal title={`Recevoir marchandises - ${purchase.purchase_number}`} onClose={onClose}>
      <form
        className="stock-purchase-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
        <div className="modal-section">
          <h3>Reception</h3>
          <div className="form-grid stock-purchase-grid">
            <label className="locked-field">
              N° reception
              <input value="BR-000001" readOnly />
            </label>
            <label>
              Date
              <input name="receipt_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </label>
            <label>
              Receptionnaire
              <input name="receiver_name" />
            </label>
            <label>
              Magasin
              <input name="store" defaultValue={purchase.store ?? ''} />
            </label>
            <label className="wide-field">
              Notes
              <textarea name="notes" rows={3} />
            </label>
          </div>
        </div>
        <div className="modal-section">
          <div className="table-wrap stock-document-lines-wrap">
            <table className="stock-document-lines">
              <thead>
                <tr>
                  <th>Article</th>
                  <th className="right">Commande</th>
                  <th className="right">Deja recu</th>
                  <th className="right">Reste</th>
                  <th className="right">Quantite recue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.stock_purchase_line_id}>
                    <td>{row.item_name}</td>
                    <td className="right">{row.quantity}</td>
                    <td className="right">{row.received_quantity}</td>
                    <td className="right">{row.remaining}</td>
                    <td>
                      <input
                        className="right"
                        type="number"
                        min="0"
                        max={row.remaining}
                        step="0.01"
                        value={row.quantity_to_receive}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((entry) =>
                              entry.stock_purchase_line_id === row.stock_purchase_line_id
                                ? { ...entry, quantity_to_receive: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit">Valider la reception</button>
        </div>
      </form>
    </Modal>
  );
}

export function PurchasePaymentModal({
  purchase,
  onClose,
  onSubmit,
}: {
  purchase: StockPurchase;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState('');
  return (
    <Modal title={`Paiement fournisseur - ${purchase.purchase_number}`} onClose={onClose}>
      <form
        className="stock-purchase-modal"
        onSubmit={(event) => {
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
        }}
      >
        <div className="modal-section">
          <h3>Dette fournisseur</h3>
          <div className="mini-stats">
            <Kpi label="Montant achat" value={`${money(purchase.total_amount)} USD`} />
            <Kpi label="Paye" value={`${money(purchase.paid_amount)} USD`} />
            <Kpi label="Reste a payer" value={`${money(purchase.outstanding_amount)} USD`} />
          </div>
          <div className="form-grid stock-purchase-grid">
            <label>
              Date
              <input name="payment_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </label>
            <label>
              Montant *
              <input name="amount" type="number" min="0" step="0.01" defaultValue={purchase.outstanding_amount} required />
            </label>
            <label>
              Mode paiement
              <select name="payment_method" defaultValue={purchase.payment_method ?? 'BANK'}>
                <option value="CASH">Especes</option>
                <option value="BANK">Banque</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="OTHER">Autre</option>
              </select>
            </label>
            <label>
              Reference
              <input name="reference" defaultValue={purchase.purchase_number} />
            </label>
            <label className="wide-field">
              Notes
              <textarea name="notes" rows={3} />
            </label>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit">Enregistrer paiement</button>
        </div>
      </form>
    </Modal>
  );
}

function SupplierCreateModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!name.trim()) {
      setError('Le nom du fournisseur est obligatoire.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        company_name: name.trim(),
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        payment_terms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
        status: 'ACTIVE',
      });
    } catch (err: any) {
      setError(parseApiError(err, 'Impossible de creer le fournisseur.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nouveau fournisseur" onClose={onClose}>
      <form
        className="stock-purchase-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-section">
          <div className="form-grid stock-purchase-grid">
            <label>
              Nom / raison sociale *
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Contact
              <input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} />
            </label>
            <label>
              Telephone
              <input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label>
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
            <label className="wide-field">
              Adresse
              <textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} />
            </label>
            <label>
              Conditions de paiement
              <input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} />
            </label>
            <label className="wide-field">
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </label>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creation...' : 'Creer le fournisseur'}
          </button>
        </div>
      </form>
    </Modal>
  );
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
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeDisplayCode(value: string | undefined, prefix: string, id: number, width: number) {
  const code = String(value ?? '').trim();
  const match = code.match(/([A-Z]+-\d+)/i);
  if (match) return match[1].toUpperCase();
  return `${prefix}-${String(id).padStart(width, '0')}`;
}

function previewNextPurchaseNumber(purchases: StockPurchase[]) {
  const next =
    purchases.reduce((max, purchase) => {
      const match = String(purchase.purchase_number ?? '').match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
  return `PO-${String(next).padStart(6, '0')}`;
}

function findDuplicateLine(lines: DraftLine[]) {
  const seen = new Map<number, number>();
  for (let index = 0; index < lines.length; index += 1) {
    const stockItemId = Number(lines[index].stock_item_id ?? 0);
    if (!stockItemId) continue;
    const firstLine = seen.get(stockItemId);
    if (firstLine) {
      return {
        firstLine,
        duplicateLine: index + 1,
        message: `Cet article est deja present a la ligne ${firstLine}. Veuillez modifier la quantite sur cette ligne au lieu de l'ajouter une seconde fois.`,
      };
    }
    seen.set(stockItemId, index + 1);
  }
  return null;
}

function parseApiError(error: any, fallback: string) {
  const payload = error?.response?.data;
  if (typeof payload?.message === 'string') return payload.message;
  if (Array.isArray(payload?.message)) return payload.message.join(' | ');
  if (payload?.message && typeof payload.message === 'object' && typeof payload.message.message === 'string') {
    return payload.message.message;
  }
  if (typeof payload?.error === 'string') return payload.error;
  return fallback;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}
