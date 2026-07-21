import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';
import { formatLeaseReference } from '../utils/lease-reference';

type TenantCreditRefundDetailData = {
  id: number;
  tenant_credit_id: number;
  tenant_id: number;
  lease_id?: number;
  amount: number;
  currency: 'USD' | 'CDF';
  refund_date: string;
  payment_method: string;
  reference?: string;
  reason: string;
  cash_movement_id?: number;
  receipt_number: string;
  status: string;
  created_at: string;
  original_amount?: number;
  remaining_amount?: number;
  credit_status?: string;
  credit_reference?: string;
  source_payment_id?: number;
  credit_payment_date?: string;
  tenant_name?: string;
  lease_number?: number;
  unit_number?: string;
  building_name?: string;
  cash_piece_number?: string;
  source_receipt_number?: string;
  created_by_name?: string;
};

export function TenantCreditRefundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [refund, setRefund] = useState<TenantCreditRefundDetailData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        const response = await api.get<TenantCreditRefundDetailData>(`/tenant-credits/refunds/${id}`);
        setRefund(response.data);
      } catch (loadError: any) {
        setError(loadError?.response?.data?.message ?? 'Impossible de charger le justificatif de remboursement.');
      }
    };
    void load();
  }, [id]);

  if (!refund) {
    return <div className="empty">{error || 'Chargement du justificatif...'}</div>;
  }

  const remainingAfter = Number(refund.remaining_amount ?? 0);
  const title = refund.status === 'CANCELLED' ? 'ANNULATION DE CRÉDIT LOCATAIRE' : 'REMBOURSEMENT DE CRÉDIT LOCATAIRE';

  return (
    <section>
      <div className="page-header no-print">
        <h2>Justificatif crédit locataire</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/tenant-credits')}><ArrowLeft size={16} />Retour</button>
          <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        </div>
      </div>

      {error ? <div className="error no-print">{error}</div> : null}

      <article className="print-invoice">
        <header className="receipt-header-custom">
          <div className="receipt-title-block">
            <h2>{title}</h2>
            <p>Justificatif financier</p>
          </div>
          <div className="invoice-meta">
            <strong>{refund.receipt_number}</strong>
            <span>Date : {shortDate(refund.refund_date)}</span>
            <span>Mode : {paymentMethodLabel(refund.payment_method)}</span>
            <span className={`badge ${String(refund.status ?? '').toLowerCase()}`}>{refund.status === 'CANCELLED' ? 'Annulé' : 'Remboursé'}</span>
          </div>
        </header>

        <div className="invoice-parties">
          <div>
            <span>Locataire</span>
            <strong>{refund.tenant_name ?? '-'}</strong>
            <p>Bail : {refund.lease_id ? formatLeaseReference(refund.lease_number, refund.lease_id) : '-'}</p>
            <p>Immeuble : {refund.building_name ?? '-'}</p>
            <p>Appartement : {refund.unit_number ?? '-'}</p>
          </div>
          <div>
            <span>Crédit d'origine</span>
            <strong>{refund.credit_reference ?? '-'}</strong>
            <p>Reçu d'origine : {refund.source_receipt_number ?? '-'}</p>
            <p>Montant initial : {formatRefundAmount(Number(refund.original_amount ?? 0), refund.currency)}</p>
            <p>Solde après remboursement : {formatRefundAmount(remainingAfter, refund.currency)}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Référence</th>
              <th>Motif</th>
              <th className="right">Montant</th>
              <th>Devise</th>
              <th>Utilisateur</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{title}</td>
              <td>{refund.reference || refund.receipt_number}</td>
              <td>{refund.reason}</td>
              <td className="right">{formatRefundAmount(Number(refund.amount ?? 0), refund.currency)}</td>
              <td>{refund.currency}</td>
              <td>{refund.created_by_name ?? '-'}</td>
            </tr>
          </tbody>
        </table>

        <div className="tenant-credit-refund-summary">
          <div><span>Pièce de caisse</span><strong>{refund.cash_piece_number ?? '-'}</strong></div>
          <div><span>Crédit courant</span><strong>{refund.credit_status ?? '-'}</strong></div>
          <div><span>Sortie enregistrée</span><strong>{formatRefundAmount(Number(refund.amount ?? 0), refund.currency)}</strong></div>
        </div>

        <p className="thanks">{refund.reason}</p>
      </article>
    </section>
  );
}

function formatRefundAmount(value: number, currency: 'USD' | 'CDF') {
  return currency === 'USD' ? money(value) : `${Number(value ?? 0).toLocaleString('fr-FR')} CDF`;
}
