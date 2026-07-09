import { ArrowLeft, FileSpreadsheet, Printer, WalletCards } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, exportXlsxWorkbook, money, shortDate } from '../../../api';
import { EmptyState, PageHeader, SuccessMessage } from '../../../components';
import { StockNav } from '../StockNav';
import type { StockPurchase, StockPurchaseDetail } from '../stock.types';
import { movementLabel, paymentStatusLabel, purchaseStatusLabel, receptionStatusLabel } from '../stock.utils';
import { PurchasePaymentModal, PurchaseReceiveModal } from './StockPurchasesPage';

export function StockPurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState<StockPurchaseDetail | null>(null);
  const [success, setSuccess] = useState('');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  async function load() {
    if (!id) return;
    const response = await api.get<StockPurchaseDetail>(`/stock/purchases/${id}`);
    setPurchase(response.data);
  }

  useEffect(() => { void load(); }, [id]);

  const totals = useMemo(() => ({
    lines: purchase?.lines.length ?? 0,
    received: purchase?.lines.reduce((sum, line) => sum + Number(line.received_quantity ?? 0), 0) ?? 0,
    ordered: purchase?.lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0) ?? 0,
  }), [purchase]);

  if (!purchase) return <section><PageHeader title="Fiche achat fournisseur" /><StockNav /><EmptyState message="Chargement..." /></section>;
  const detail = purchase;

  function exportWorkbook() {
    return exportXlsxWorkbook(`Achat_${detail.purchase_number}.xlsx`, [
      { name: 'Resume', rows: [{ numero: detail.purchase_number, fournisseur: detail.supplier_name, montant: detail.total_amount, paye: detail.paid_amount, reste: detail.outstanding_amount }] },
      { name: 'Lignes', rows: detail.lines.map((line) => ({ article: line.item_name, code: line.item_code, quantite: line.quantity, recu: line.received_quantity, cout_unitaire: line.unit_price, total: line.line_total })) },
      { name: 'Paiements', rows: detail.payments.map((row) => ({ date: shortDate(row.payment_date), montant: row.amount, mode: row.payment_method ?? '-', reference: row.reference ?? '-', utilisateur: row.user_name ?? '-' })) },
      { name: 'Receptions', rows: detail.receipt_lines.map((row) => ({ bon: row.receipt_number, date: shortDate(row.receipt_date), article: row.item_name, quantite: row.quantity_received, cout_unitaire: row.unit_price, total: row.line_total })) },
      { name: 'Mouvements stock', rows: detail.stock_movements.map((row) => ({ date: shortDate(row.movement_date), type: movementLabel(row), article: row.item_name, quantite: row.quantity, reference: row.reference ?? '-' })) },
      { name: 'Mouvements caisse', rows: detail.cash_movements.map((row) => row) },
      { name: 'Timeline', rows: detail.timeline.map((row) => ({ date: shortDate(row.created_at), titre: row.title, details: row.details ?? '-', utilisateur: row.user_name ?? '-' })) },
    ]);
  }

  async function receivePurchase(payload: Record<string, unknown>) {
    await api.post(`/stock/purchases/${detail.id}/receive`, payload);
    setReceiveOpen(false);
    setSuccess('Reception enregistree.');
    await load();
  }

  async function payPurchase(payload: Record<string, unknown>) {
    await api.post(`/stock/purchases/${detail.id}/pay`, payload);
    setPaymentOpen(false);
    setSuccess('Paiement fournisseur enregistre.');
    await load();
  }

  return <section>
    <PageHeader title={`Achat ${detail.purchase_number}`} />
    <StockNav />
    <SuccessMessage message={success} />
    <div className="actions-row">
      <button className="secondary" onClick={() => navigate('/stock/purchases')}><ArrowLeft size={16} />Retour</button>
      {detail.reception_status !== 'RECEIVED' && <button className="secondary" onClick={() => setReceiveOpen(true)}>Recevoir</button>}
      {Number(detail.outstanding_amount ?? 0) > 0 && <button className="secondary" onClick={() => setPaymentOpen(true)}><WalletCards size={16} />Paiement</button>}
      <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
      <button onClick={exportWorkbook}><FileSpreadsheet size={16} />Excel</button>
    </div>
    <div className="mini-stats">
      <Kpi label="Montant achat" value={`${money(detail.total_amount)} USD`} />
      <Kpi label="Paye" value={`${money(detail.paid_amount)} USD`} />
      <Kpi label="Reste a payer" value={`${money(detail.outstanding_amount)} USD`} />
      <Kpi label="Lignes" value={totals.lines} />
      <Kpi label="Quantite recue" value={totals.received} />
      <Kpi label="Reception" value={receptionStatusLabel(detail.reception_status)} />
    </div>
    <div className="detail-section">
      <h4>Resume</h4>
      <div className="detail-list">
        <span>Numero</span><strong>{detail.purchase_number}</strong>
        <span>Date</span><strong>{shortDate(detail.purchase_date)}</strong>
        <span>Fournisseur</span><strong>{detail.supplier_name}</strong>
        <span>Reference fournisseur</span><strong>{detail.supplier_reference ?? '-'}</strong>
        <span>Magasin</span><strong>{detail.store ?? '-'}</strong>
        <span>Conditions</span><strong>{detail.payment_terms ?? '-'}</strong>
        <span>Mode paiement</span><strong>{detail.payment_method ?? '-'}</strong>
        <span>Type paiement</span><strong>{detail.payment_type}</strong>
        <span>Statut achat</span><strong>{purchaseStatusLabel(detail.purchase_status)}</strong>
        <span>Statut reception</span><strong>{receptionStatusLabel(detail.reception_status)}</strong>
        <span>Statut paiement</span><strong>{paymentStatusLabel(detail.payment_status)}</strong>
        <span>Echeance</span><strong>{detail.due_date ? shortDate(detail.due_date) : '-'}</strong>
      </div>
    </div>
    <Section title="Lignes">
      <table>
        <thead><tr><th>Article</th><th className="right">Quantite</th><th className="right">Recu</th><th className="right">Reste</th><th className="right">Cout unitaire</th><th className="right">Total</th></tr></thead>
        <tbody>{detail.lines.map((line) => <tr key={line.id}>
          <td>{line.item_code} - {line.item_name}</td>
          <td className="right">{line.quantity}</td>
          <td className="right">{line.received_quantity}</td>
          <td className="right">{Math.max(Number(line.quantity ?? 0) - Number(line.received_quantity ?? 0), 0)}</td>
          <td className="right">{money(line.unit_price)}</td>
          <td className="right">{money(line.line_total)}</td>
        </tr>)}</tbody>
      </table>
    </Section>
    <Section title="Paiements">
      {detail.payments.length ? <table>
        <thead><tr><th>Date</th><th className="right">Montant</th><th>Mode</th><th>Reference</th><th>Utilisateur</th></tr></thead>
        <tbody>{detail.payments.map((row) => <tr key={row.id}><td>{shortDate(row.payment_date)}</td><td className="right">{money(row.amount)}</td><td>{row.payment_method ?? '-'}</td><td>{row.reference ?? '-'}</td><td>{row.user_name ?? '-'}</td></tr>)}</tbody>
      </table> : <EmptyState message="Aucun paiement fournisseur." />}
    </Section>
    <Section title="Receptions">
      {detail.receipt_lines.length ? <table>
        <thead><tr><th>Bon reception</th><th>Date</th><th>Article</th><th className="right">Quantite recue</th><th className="right">Cout unitaire</th><th className="right">Total</th></tr></thead>
        <tbody>{detail.receipt_lines.map((row) => <tr key={row.id}><td>{row.receipt_number}</td><td>{shortDate(row.receipt_date)}</td><td>{row.item_name}</td><td className="right">{row.quantity_received}</td><td className="right">{money(row.unit_price)}</td><td className="right">{money(row.line_total)}</td></tr>)}</tbody>
      </table> : <EmptyState message="Aucune reception enregistree." />}
    </Section>
    <Section title="Mouvements stock">
      {detail.stock_movements.length ? <table>
        <thead><tr><th>Date</th><th>Type</th><th>Article</th><th className="right">Quantite</th><th>Reference</th></tr></thead>
        <tbody>{detail.stock_movements.map((row) => <tr key={row.id}><td>{shortDate(row.movement_date)}</td><td>{movementLabel(row)}</td><td>{row.item_name}</td><td className="right">{row.quantity}</td><td>{row.receipt_number ?? row.reference ?? '-'}</td></tr>)}</tbody>
      </table> : <EmptyState message="Aucun mouvement stock." />}
    </Section>
    <Section title="Mouvements caisse">
      {detail.cash_movements.length ? <table>
        <thead><tr><th>Date</th><th>Type</th><th>Libelle</th><th className="right">Montant</th><th>Reference</th></tr></thead>
        <tbody>{detail.cash_movements.map((row, index) => <tr key={String((row as { id?: number }).id ?? index)}>
          <td>{shortDate(String((row as { movement_date?: string }).movement_date ?? ''))}</td>
          <td>{String((row as { type?: string }).type ?? '-')}</td>
          <td>{String((row as { label?: string }).label ?? (row as { description?: string }).description ?? '-')}</td>
          <td className="right">{money(Number((row as { amount?: number }).amount ?? 0))}</td>
          <td>{String((row as { reference?: string }).reference ?? '-')}</td>
        </tr>)}</tbody>
      </table> : <EmptyState message="Aucun mouvement caisse." />}
    </Section>
    <Section title="Timeline">
      {detail.timeline.length ? <table>
        <thead><tr><th>Date</th><th>Evenement</th><th>Details</th><th>Utilisateur</th></tr></thead>
        <tbody>{detail.timeline.map((row) => <tr key={row.id}><td>{shortDate(row.created_at)}</td><td>{row.title}</td><td>{row.details ?? '-'}</td><td>{row.user_name ?? '-'}</td></tr>)}</tbody>
      </table> : <EmptyState message="Aucun historique." />}
    </Section>
    {receiveOpen && <PurchaseReceiveModal purchase={detail} onClose={() => setReceiveOpen(false)} onSubmit={receivePurchase} />}
    {paymentOpen && <PurchasePaymentModal purchase={detail as StockPurchase} onClose={() => setPaymentOpen(false)} onSubmit={payPurchase} />}
  </section>;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="mini-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="detail-section"><h4>{title}</h4>{children}</div>;
}
