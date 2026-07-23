import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';

type ShareholderPayoutLine = {
  id: number;
  shareholder_name: string;
  shareholder_type: string;
  amount: number;
  currency: string;
  payment_method: string;
  reference?: string | null;
  receipt_number: string;
  cash_piece_number?: string | null;
};

type ShareholderPayoutBatchDetailData = {
  id: number;
  organization_name?: string;
  source_register: 'MAIN_CASH' | 'GUARANTEE_CASH' | 'BANK';
  currency: 'USD' | 'CDF';
  payout_date: string;
  operation_type: string;
  reason: string;
  reference?: string | null;
  notes?: string | null;
  bank_account_id?: number | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_account_currency?: string | null;
  total_amount: number;
  beneficiary_count: number;
  created_by_name?: string | null;
  lines: ShareholderPayoutLine[];
};

export function ShareholderPayoutBatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<ShareholderPayoutBatchDetailData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        const response = await api.get<ShareholderPayoutBatchDetailData>(`/shareholder-payouts/${id}`);
        setBatch(response.data);
      } catch (loadError: any) {
        setError(loadError?.response?.data?.message ?? 'Impossible de charger le récapitulatif du lot.');
      }
    };
    void load();
  }, [id]);

  if (!batch) {
    return <div className="empty">{error || 'Chargement du récapitulatif...'}</div>;
  }

  return (
    <section>
      <div className="page-header no-print">
        <h2>État de remboursement des actionnaires</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/shareholders')}><ArrowLeft size={16} />Retour</button>
          <button onClick={() => window.print()}><Printer size={16} />Imprimer</button>
        </div>
      </div>

      <article className="print-invoice">
        <header className="receipt-header-custom">
          <div className="receipt-title-block">
            <h2>ÉTAT DE REMBOURSEMENT DES ACTIONNAIRES</h2>
            <p>{batch.organization_name ?? 'Organisation'}</p>
          </div>
          <div className="invoice-meta">
            <strong>{batch.reference ?? `Lot #${batch.id}`}</strong>
            <span>Date : {shortDate(batch.payout_date)}</span>
            <span>Source : {batch.source_register === 'MAIN_CASH' ? 'Caisse principale' : batch.source_register === 'GUARANTEE_CASH' ? 'Caisse garanties locatives' : 'Banque'}</span>
            {batch.source_register === 'BANK' ? (
              <>
                <span>Banque : {batch.bank_name ?? '-'}</span>
                <span>Compte : {batch.bank_account_name ?? '-'}</span>
                <span>Numéro : {batch.bank_account_number ?? '-'}</span>
              </>
            ) : null}
            <span>Utilisateur : {batch.created_by_name ?? '-'}</span>
          </div>
        </header>

        <div className="invoice-parties">
          <div>
            <span>Opération</span>
            <strong>{batch.operation_type}</strong>
            <p>Motif : {batch.reason}</p>
          </div>
          <div>
            <span>Totaux</span>
            <strong>{money(batch.total_amount)} {batch.currency}</strong>
            <p>Bénéficiaires : {batch.beneficiary_count}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Actionnaire</th>
              <th>Type</th>
              <th>Mode</th>
              <th>Référence</th>
              <th>Reçu</th>
              <th className="right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {batch.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.shareholder_name}</td>
                <td>{line.shareholder_type === 'COMPANY' ? 'Société' : 'Individuel'}</td>
                <td>{paymentMethodLabel(line.payment_method)}</td>
                <td>{line.reference ?? '-'}</td>
                <td>{line.receipt_number}</td>
                <td className="right">{money(line.amount)} {line.currency}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total du lot</td>
              <td className="right">{money(batch.total_amount)} {batch.currency}</td>
            </tr>
          </tfoot>
        </table>
      </article>
    </section>
  );
}
