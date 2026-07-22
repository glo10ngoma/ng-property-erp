import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';

type ShareholderPayoutReceiptData = {
  id: number;
  receipt_number: string;
  shareholder_name: string;
  shareholder_type: string;
  amount: number;
  currency: 'USD' | 'CDF';
  payment_method: string;
  reference?: string | null;
  notes?: string | null;
  batch_reference?: string | null;
  source_register: 'MAIN_CASH' | 'GUARANTEE_CASH';
  operation_type: string;
  reason: string;
  payout_date: string;
  organization_name?: string;
  created_by_name?: string | null;
  cash_piece_number?: string | null;
};

export function ShareholderPayoutReceiptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<ShareholderPayoutReceiptData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        const response = await api.get<ShareholderPayoutReceiptData>(`/shareholder-payout-lines/${id}/receipt`);
        setReceipt(response.data);
      } catch (loadError: any) {
        setError(loadError?.response?.data?.message ?? 'Impossible de charger le reçu actionnaire.');
      }
    };
    void load();
  }, [id]);

  if (!receipt) {
    return <div className="empty">{error || 'Chargement du reçu...'}</div>;
  }

  return (
    <section>
      <div className="page-header no-print">
        <h2>Reçu actionnaire</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/shareholders')}><ArrowLeft size={16} />Retour</button>
          <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        </div>
      </div>

      <article className="print-invoice">
        <header className="receipt-header-custom">
          <div className="receipt-title-block">
            <h2>REÇU DE REMBOURSEMENT ACTIONNAIRE</h2>
            <p>{receipt.organization_name ?? 'Organisation'}</p>
          </div>
          <div className="invoice-meta">
            <strong>{receipt.receipt_number}</strong>
            <span>Date : {shortDate(receipt.payout_date)}</span>
            <span>Mode : {paymentMethodLabel(receipt.payment_method)}</span>
            <span>Utilisateur : {receipt.created_by_name ?? '-'}</span>
          </div>
        </header>

        <div className="invoice-parties">
          <div>
            <span>Actionnaire</span>
            <strong>{receipt.shareholder_name}</strong>
            <p>Type : {receipt.shareholder_type === 'COMPANY' ? 'Société' : 'Individuel'}</p>
            <p>Source des fonds : {receipt.source_register === 'MAIN_CASH' ? 'Caisse principale' : 'Caisse garanties locatives'}</p>
          </div>
          <div>
            <span>Lot</span>
            <strong>{receipt.batch_reference ?? '-'}</strong>
            <p>Type d’opération : {receipt.operation_type}</p>
            <p>N° pièce caisse : {receipt.cash_piece_number ?? '-'}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Référence</th>
              <th>Motif</th>
              <th>Devise</th>
              <th className="right">Montant individuel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Remboursement actionnaire</td>
              <td>{receipt.reference ?? receipt.receipt_number}</td>
              <td>{receipt.reason}</td>
              <td>{receipt.currency}</td>
              <td className="right">{money(receipt.amount)} {receipt.currency}</td>
            </tr>
          </tbody>
        </table>

        {receipt.notes ? <p className="thanks">{receipt.notes}</p> : null}
      </article>
    </section>
  );
}
