import { ArrowLeft, Printer, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components';

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
  guarantee_cash_movement_id?: number | null;
  bank_transaction_id?: number | null;
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
  const { can } = useAuth();
  const [batch, setBatch] = useState<ShareholderPayoutBatchDetailData | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ShareholderPayoutLine | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function loadBatch() {
    if (!id) return;
    try {
      const response = await api.get<ShareholderPayoutBatchDetailData>(`/shareholder-payouts/${id}`);
      setBatch(response.data);
      setError('');
    } catch (loadError: any) {
      setError(loadError?.response?.data?.message ?? 'Impossible de charger le récapitulatif du lot.');
    }
  }

  useEffect(() => {
    void loadBatch();
  }, [id]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setDeleteError('Le motif de suppression est obligatoire.');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await api.delete(`/shareholder-payout-lines/${deleteTarget.id}`, {
        data: { reason },
      });
      const remainingLines = Number(response.data?.remaining_batch_lines ?? 0);
      setDeleteTarget(null);
      setDeleteReason('');
      setSuccess('Remboursement actionnaire placé dans la corbeille.');
      if (remainingLines <= 0) {
        navigate('/shareholders');
        return;
      }
      await loadBatch();
    } catch (deleteRequestError: any) {
      setDeleteError(apiErrorMessage(deleteRequestError, 'Impossible de supprimer ce remboursement actionnaire.'));
    } finally {
      setDeleting(false);
    }
  }

  if (!batch) {
    return <div className="empty">{error || 'Chargement du récapitulatif...'}</div>;
  }

  const canDeletePayout = can('shareholder_payouts.delete');

  return (
    <section>
      <div className="page-header no-print">
        <h2>État de remboursement des actionnaires</h2>
        <div className="actions">
          <button className="secondary" onClick={() => navigate('/shareholders')}>
            <ArrowLeft size={16} />
            Retour
          </button>
          <button onClick={() => window.print()}>
            <Printer size={16} />
            Imprimer
          </button>
        </div>
      </div>
      {success ? <div className="success-message">{success}</div> : null}

      <article className="print-invoice">
        <header className="receipt-header-custom">
          <div className="receipt-title-block">
            <h2>ÉTAT DE REMBOURSEMENT DES ACTIONNAIRES</h2>
            <p>{batch.organization_name ?? 'Organisation'}</p>
          </div>
          <div className="invoice-meta">
            <strong>{batch.reference ?? `Lot #${batch.id}`}</strong>
            <span>Date : {shortDate(batch.payout_date)}</span>
            <span>
              Source : {batch.source_register === 'MAIN_CASH'
                ? 'Caisse principale'
                : batch.source_register === 'GUARANTEE_CASH'
                  ? 'Caisse garanties locatives'
                  : 'Banque'}
            </span>
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
              {canDeletePayout ? <th className="no-print">Actions</th> : null}
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
                {canDeletePayout ? (
                  <td className="no-print">
                    {!line.bank_transaction_id ? (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Supprimer"
                        onClick={() => {
                          setDeleteTarget(line);
                          setDeleteReason('');
                          setDeleteError('');
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <span className="text-muted">Banque</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={canDeletePayout ? 6 : 5}>Total du lot</td>
              <td className="right">{money(batch.total_amount)} {batch.currency}</td>
            </tr>
          </tfoot>
        </table>
      </article>

      {deleteTarget ? (
        <Modal title="Supprimer le remboursement actionnaire" onClose={() => setDeleteTarget(null)}>
          <div className="modal-section">
            <h3>Confirmation</h3>
            <p>
              Cette action mettra en corbeille le remboursement actionnaire, les écritures
              associées et recalculera automatiquement le solde ainsi que le statut.
            </p>
            <div className="mini-stats">
              <div className="mini-stat">
                <span>Actionnaire</span>
                <strong>{deleteTarget.shareholder_name}</strong>
              </div>
              <div className="mini-stat">
                <span>Montant</span>
                <strong>{money(deleteTarget.amount)} {deleteTarget.currency}</strong>
              </div>
              <div className="mini-stat">
                <span>Reçu</span>
                <strong>{deleteTarget.receipt_number}</strong>
              </div>
            </div>
            <label className="form-field-full">
              Motif de suppression *
              <textarea
                rows={3}
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Ex. remboursement saisi en double"
              />
            </label>
            {deleteError ? <div className="error-message">{deleteError}</div> : null}
          </div>
          <div className="modal-footer-sticky">
            <button type="button" className="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Annuler
            </button>
            <button type="button" className="danger" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Suppression...' : 'Mettre dans la corbeille'}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const responseData = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = responseData?.message;
  if (Array.isArray(message)) {
    return message.join(' | ');
  }
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  return fallback;
}
