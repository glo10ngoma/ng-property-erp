import { ArrowRightLeft, Landmark, RefreshCcw, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money, shortDate } from '../api';
import { EmptyState, LoadingState, Modal, PageHeader, SuccessMessage } from '../components';

export type TreasuryTransferType = 'CASH_TO_BANK' | 'BANK_TO_CASH' | 'BANK_TO_BANK';

type TreasuryTransferFormData = {
  source_register: 'MAIN_CASH' | 'BANK';
  transfer_types: Array<{ value: TreasuryTransferType; label: string }>;
  payment_methods: Array<{ value: string; label: string }>;
  cash_session: {
    id: number;
    status: string;
    opened_at: string;
    opening_balance: number;
  } | null;
  cash_balances: Record<string, number>;
  bank_accounts: Array<{
    id: number;
    bank_name: string;
    account_name: string;
    account_number?: string | null;
    currency: 'USD' | 'CDF';
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    current_balance?: number | null;
  }>;
};

export type TreasuryTransferDetail = {
  id: number;
  transfer_number: string;
  transfer_type: TreasuryTransferType;
  transfer_date: string;
  currency: 'USD' | 'CDF';
  amount: number;
  payment_method?: string | null;
  reference?: string | null;
  description?: string | null;
  notes?: string | null;
  status: 'VALIDATED' | 'CANCELLED';
  source_type: 'MAIN_CASH' | 'BANK';
  source_cash_session_id?: number | null;
  source_bank_account_id?: number | null;
  destination_type: 'MAIN_CASH' | 'BANK';
  destination_cash_session_id?: number | null;
  destination_bank_account_id?: number | null;
  source_cash_movement_id?: number | null;
  source_bank_transaction_id?: number | null;
  destination_cash_movement_id?: number | null;
  destination_bank_transaction_id?: number | null;
  source_cash_piece_number?: string | null;
  destination_cash_piece_number?: string | null;
  source_bank_transaction_number?: string | null;
  destination_bank_transaction_number?: string | null;
  source_label?: string | null;
  destination_label?: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type TreasuryTransferPreset = {
  defaultTransferType?: TreasuryTransferType;
  defaultSourceBankAccountId?: number | null;
  defaultDestinationBankAccountId?: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);

function nextTreasuryTransferKey() {
  return `treasury-transfer:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function TreasuryTransferModal({
  endpoint,
  formDataEndpoint,
  sourceRegister,
  preset,
  onClose,
  onSuccess,
}: {
  endpoint: '/cash/treasury-transfers' | '/bank/treasury-transfers';
  formDataEndpoint: '/cash/treasury-transfers/form-data' | '/bank/treasury-transfers/form-data';
  sourceRegister: 'MAIN_CASH' | 'BANK';
  preset?: TreasuryTransferPreset;
  onClose: () => void;
  onSuccess?: (transfer: TreasuryTransferDetail) => Promise<void> | void;
}) {
  const [formData, setFormData] = useState<TreasuryTransferFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => nextTreasuryTransferKey());
  const [form, setForm] = useState({
    transfer_type: preset?.defaultTransferType ?? 'CASH_TO_BANK',
    transfer_date: today(),
    currency: 'USD',
    source_bank_account_id: preset?.defaultSourceBankAccountId ? String(preset.defaultSourceBankAccountId) : '',
    destination_bank_account_id: preset?.defaultDestinationBankAccountId ? String(preset.defaultDestinationBankAccountId) : '',
    amount: '',
    payment_method: 'BANK_TRANSFER',
    reference: '',
    description: '',
    notes: '',
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get<TreasuryTransferFormData>(formDataEndpoint);
        const data = response.data;
        setFormData(data);
        const fallbackType = data.transfer_types.find((entry) => entry.value === form.transfer_type)?.value
          ?? data.transfer_types[0]?.value
          ?? 'CASH_TO_BANK';
        const accountsForCurrency = data.bank_accounts.filter((account) => account.status === 'ACTIVE' && account.currency === form.currency);
        const sourceAccount = preset?.defaultSourceBankAccountId
          ? accountsForCurrency.find((account) => account.id === preset.defaultSourceBankAccountId)
          : accountsForCurrency[0];
        const destinationAccount = preset?.defaultDestinationBankAccountId
          ? accountsForCurrency.find((account) => account.id === preset.defaultDestinationBankAccountId)
          : accountsForCurrency.find((account) => account.id !== sourceAccount?.id) ?? accountsForCurrency[0];
        setForm((current) => ({
          ...current,
          transfer_type: fallbackType,
          currency:
            (sourceAccount?.currency
              ?? destinationAccount?.currency
              ?? (data.cash_balances.CDF > 0 && data.cash_balances.USD <= 0 ? 'CDF' : current.currency)) as 'USD' | 'CDF',
          payment_method: data.payment_methods[0]?.value ?? current.payment_method,
          source_bank_account_id: sourceAccount ? String(sourceAccount.id) : current.source_bank_account_id,
          destination_bank_account_id: destinationAccount ? String(destinationAccount.id) : current.destination_bank_account_id,
        }));
      } catch (loadError: any) {
        setError(apiErrorMessage(loadError, 'Impossible de charger le formulaire de transfert interne.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [formDataEndpoint]);

  const activeBankAccounts = useMemo(
    () => (formData?.bank_accounts ?? []).filter((account) => account.status === 'ACTIVE'),
    [formData],
  );
  const bankAccountsForCurrency = useMemo(
    () => activeBankAccounts.filter((account) => account.currency === form.currency),
    [activeBankAccounts, form.currency],
  );
  const selectedSourceBankAccount = useMemo(
    () => bankAccountsForCurrency.find((account) => String(account.id) === String(form.source_bank_account_id)) ?? null,
    [bankAccountsForCurrency, form.source_bank_account_id],
  );
  const selectedDestinationBankAccount = useMemo(
    () => bankAccountsForCurrency.find((account) => String(account.id) === String(form.destination_bank_account_id)) ?? null,
    [bankAccountsForCurrency, form.destination_bank_account_id],
  );
  const transferAmount = Number(form.amount || 0);
  const availableBalance = useMemo(() => {
    if (!formData) return 0;
    if (form.transfer_type === 'CASH_TO_BANK') {
      return Number(formData.cash_balances?.[form.currency] ?? 0);
    }
    return Number(selectedSourceBankAccount?.current_balance ?? 0);
  }, [form.currency, form.transfer_type, formData, selectedSourceBankAccount]);
  const estimatedBalance = Number((availableBalance - transferAmount).toFixed(2));
  const sourceLabel = useMemo(() => {
    if (form.transfer_type === 'CASH_TO_BANK') return 'Caisse principale';
    return selectedSourceBankAccount ? `${selectedSourceBankAccount.bank_name} - ${selectedSourceBankAccount.account_name}` : 'Compte bancaire source';
  }, [form.transfer_type, selectedSourceBankAccount]);
  const destinationLabel = useMemo(() => {
    if (form.transfer_type === 'BANK_TO_CASH') return 'Caisse principale';
    return selectedDestinationBankAccount ? `${selectedDestinationBankAccount.bank_name} - ${selectedDestinationBankAccount.account_name}` : 'Compte bancaire destination';
  }, [form.transfer_type, selectedDestinationBankAccount]);

  useEffect(() => {
    if (!formData) return;
    if (!bankAccountsForCurrency.length) {
      setForm((current) => ({
        ...current,
        source_bank_account_id: current.transfer_type === 'BANK_TO_CASH' || current.transfer_type === 'BANK_TO_BANK' ? '' : current.source_bank_account_id,
        destination_bank_account_id: current.transfer_type === 'CASH_TO_BANK' || current.transfer_type === 'BANK_TO_BANK' ? '' : current.destination_bank_account_id,
      }));
      return;
    }
    setForm((current) => {
      const next = { ...current };
      if ((current.transfer_type === 'BANK_TO_CASH' || current.transfer_type === 'BANK_TO_BANK') && !bankAccountsForCurrency.some((account) => String(account.id) === current.source_bank_account_id)) {
        next.source_bank_account_id = bankAccountsForCurrency[0] ? String(bankAccountsForCurrency[0].id) : '';
      }
      if (current.transfer_type === 'CASH_TO_BANK' && !bankAccountsForCurrency.some((account) => String(account.id) === current.destination_bank_account_id)) {
        next.destination_bank_account_id = bankAccountsForCurrency[0] ? String(bankAccountsForCurrency[0].id) : '';
      }
      if (current.transfer_type === 'BANK_TO_BANK') {
        const destinationStillValid = bankAccountsForCurrency.some((account) => String(account.id) === current.destination_bank_account_id && String(account.id) !== next.source_bank_account_id);
        if (!destinationStillValid) {
          const fallback = bankAccountsForCurrency.find((account) => String(account.id) !== next.source_bank_account_id);
          next.destination_bank_account_id = fallback ? String(fallback.id) : '';
        }
      }
      return next;
    });
  }, [bankAccountsForCurrency, formData]);

  const transferTypes = formData?.transfer_types ?? [];
  const paymentMethods = formData?.payment_methods ?? [];
  const cashSessionOpen = Boolean(formData?.cash_session?.id);
  const requiresCashSession = form.transfer_type === 'CASH_TO_BANK' || form.transfer_type === 'BANK_TO_CASH';
  const canSubmit = Boolean(
    !submitting
    && !loading
    && transferTypes.length
    && (!requiresCashSession || cashSessionOpen)
    && (!['BANK_TO_CASH', 'BANK_TO_BANK'].includes(form.transfer_type) || selectedSourceBankAccount)
    && (!['CASH_TO_BANK', 'BANK_TO_BANK'].includes(form.transfer_type) || selectedDestinationBankAccount)
    && !(form.transfer_type === 'BANK_TO_BANK' && form.source_bank_account_id && form.source_bank_account_id === form.destination_bank_account_id)
  );

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post<TreasuryTransferDetail>(endpoint, {
        transfer_type: form.transfer_type,
        transfer_date: form.transfer_date,
        currency: form.currency,
        source_bank_account_id:
          form.transfer_type === 'BANK_TO_CASH' || form.transfer_type === 'BANK_TO_BANK'
            ? Number(form.source_bank_account_id)
            : null,
        destination_bank_account_id:
          form.transfer_type === 'CASH_TO_BANK' || form.transfer_type === 'BANK_TO_BANK'
            ? Number(form.destination_bank_account_id)
            : null,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference: form.reference || null,
        description: form.description || null,
        notes: form.notes || null,
        idempotency_key: idempotencyKey,
      });
      await onSuccess?.(response.data);
      setIdempotencyKey(nextTreasuryTransferKey());
      onClose();
    } catch (submitError: any) {
      setError(apiErrorMessage(submitError, 'Impossible de valider le transfert interne.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Transfert interne" onClose={onClose} className="treasury-transfer-modal">
      {loading ? <div className="empty"><strong>Chargement...</strong><span>Préparation du formulaire de transfert interne.</span></div> : null}
      {!loading && error ? <div className="error-message">{error}</div> : null}
      {!loading && formData ? (
        !transferTypes.length ? (
          <EmptyState
            title="Aucun transfert disponible"
            message="Votre rôle ne dispose pas des permissions nécessaires pour initier un transfert interne depuis cet écran."
          />
        ) : (
          <form
            className="treasury-transfer-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="treasury-transfer-source">
              <strong>Origine de l’action</strong>
              <span>{sourceRegister === 'MAIN_CASH' ? 'Caisse principale' : 'Banque'}</span>
            </div>
            {!cashSessionOpen && requiresCashSession ? (
              <div className="shareholder-payout-warning">
                Une session de caisse principale ouverte est requise pour les transferts impliquant la caisse.
              </div>
            ) : null}
            <div className="treasury-transfer-grid">
              <label>
                Type de transfert
                <select value={form.transfer_type} onChange={(event) => setForm((current) => ({ ...current, transfer_type: event.target.value as TreasuryTransferType }))} required>
                  {transferTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                Date
                <input type="date" value={form.transfer_date} onChange={(event) => setForm((current) => ({ ...current, transfer_date: event.target.value }))} required />
              </label>
              <label>
                Devise
                <select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value as 'USD' | 'CDF' }))}>
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </label>
              <label>
                Mode de transfert
                <select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}>
                  {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>

              {form.transfer_type === 'BANK_TO_CASH' || form.transfer_type === 'BANK_TO_BANK' ? (
                <label>
                  Compte bancaire source
                  <select value={form.source_bank_account_id} onChange={(event) => setForm((current) => ({ ...current, source_bank_account_id: event.target.value }))} required>
                    <option value="">Sélectionner un compte source</option>
                    {bankAccountsForCurrency.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bank_name} - {account.account_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Source
                  <input value="Caisse principale" readOnly />
                </label>
              )}

              {form.transfer_type === 'CASH_TO_BANK' || form.transfer_type === 'BANK_TO_BANK' ? (
                <label>
                  Compte bancaire destination
                  <select value={form.destination_bank_account_id} onChange={(event) => setForm((current) => ({ ...current, destination_bank_account_id: event.target.value }))} required>
                    <option value="">Sélectionner un compte destination</option>
                    {bankAccountsForCurrency
                      .filter((account) => form.transfer_type !== 'BANK_TO_BANK' || String(account.id) !== String(form.source_bank_account_id))
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.bank_name} - {account.account_name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <label>
                  Destination
                  <input value="Caisse principale" readOnly />
                </label>
              )}

              <label>
                Montant
                <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
              </label>
              <label>
                Référence
                <input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} />
              </label>
              <label className="form-field-full">
                Motif / description
                <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label className="form-field-full">
                Notes
                <textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
            </div>

            <div className="treasury-transfer-summary">
              <div><span>Source</span><strong>{sourceLabel}</strong></div>
              <div><span>Destination</span><strong>{destinationLabel}</strong></div>
              <div><span>Solde source disponible</span><strong>{formatTransferMoney(availableBalance, form.currency)}</strong></div>
              <div><span>Solde estimé après transfert</span><strong>{formatTransferMoney(estimatedBalance, form.currency)}</strong></div>
              <div><span>Écritures créées</span><strong>2</strong></div>
            </div>

            <div className="modal-footer-sticky">
              <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
              <button type="submit" disabled={!canSubmit}>
                {submitting ? 'Validation...' : 'Valider le transfert'}
              </button>
            </div>
          </form>
        )
      ) : null}
    </Modal>
  );
}

export function TreasuryTransferDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [transfer, setTransfer] = useState<TreasuryTransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      setError('');
      try {
        const response = await api.get<TreasuryTransferDetail>(`/treasury-transfers/${id}`);
        setTransfer(response.data);
      } catch (loadError: any) {
        setError(apiErrorMessage(loadError, 'Impossible de charger le détail du transfert interne.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id]);

  if (loading) {
    return (
      <section>
        <PageHeader title="Détail transfert interne" />
        <LoadingState />
      </section>
    );
  }

  if (!transfer) {
    return (
      <section>
        <PageHeader
          title="Détail transfert interne"
          action={<button type="button" className="secondary" onClick={() => navigate('/bank')}>Retour</button>}
        />
        <EmptyState title="Transfert introuvable" message={error || 'Le transfert demandé n’est pas accessible.'} />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="Détail transfert interne"
        action={(
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={() => navigate('/bank')}>Retour</button>
            <button type="button" className="secondary" onClick={() => window.print()}>Imprimer</button>
          </div>
        )}
      />
      <SuccessMessage message={success} />
      {error ? <div className="error-message">{error}</div> : null}

      <div className="summary-band treasury-transfer-detail-summary">
        <div className="summary-item"><span>Numéro</span><strong>{transfer.transfer_number}</strong></div>
        <div className="summary-item"><span>Type</span><strong>{transferTypeLabel(transfer.transfer_type)}</strong></div>
        <div className="summary-item"><span>Date</span><strong>{shortDate(transfer.transfer_date)}</strong></div>
        <div className="summary-item"><span>Montant</span><strong>{formatTransferMoney(transfer.amount, transfer.currency)}</strong></div>
        <div className="summary-item"><span>Devise</span><strong>{transfer.currency}</strong></div>
        <div className="summary-item"><span>Statut</span><strong>{transfer.status}</strong></div>
      </div>

      <div className="detail-section treasury-transfer-detail-grid">
        <div className="inline-info-card">
          <div>
            <strong>Source</strong>
            <p>{transfer.source_label || supportTypeLabel(transfer.source_type)}</p>
          </div>
          <WalletCards size={18} />
        </div>
        <div className="inline-info-card">
          <div>
            <strong>Destination</strong>
            <p>{transfer.destination_label || supportTypeLabel(transfer.destination_type)}</p>
          </div>
          <Landmark size={18} />
        </div>
      </div>

      <div className="summary-band treasury-transfer-meta">
        <div className="summary-item summary-item-wide"><span>Référence</span><strong>{transfer.reference || '-'}</strong></div>
        <div className="summary-item summary-item-wide"><span>Description</span><strong>{transfer.description || '-'}</strong></div>
        <div className="summary-item summary-item-wide"><span>Notes</span><strong>{transfer.notes || '-'}</strong></div>
        <div className="summary-item"><span>Mode</span><strong>{paymentMethodLabel(transfer.payment_method)}</strong></div>
        <div className="summary-item"><span>Utilisateur</span><strong>{transfer.created_by_name || '-'}</strong></div>
        <div className="summary-item"><span>Créé le</span><strong>{shortDate(transfer.created_at)}</strong></div>
      </div>

      <div className="detail-section">
        <h4>Écritures générées</h4>
        <div className="row-actions treasury-transfer-linked-actions">
          {transfer.source_cash_movement_id ? (
            <button type="button" className="secondary" onClick={() => navigate(`/cash/${transfer.source_cash_movement_id}`)}>
              Mouvement caisse source {transfer.source_cash_piece_number || `#${transfer.source_cash_movement_id}`}
            </button>
          ) : null}
          {transfer.destination_cash_movement_id ? (
            <button type="button" className="secondary" onClick={() => navigate(`/cash/${transfer.destination_cash_movement_id}`)}>
              Mouvement caisse destination {transfer.destination_cash_piece_number || `#${transfer.destination_cash_movement_id}`}
            </button>
          ) : null}
          {transfer.source_bank_transaction_number ? (
            <span className="info-message">Transaction bancaire source {transfer.source_bank_transaction_number}</span>
          ) : null}
          {transfer.destination_bank_transaction_number ? (
            <span className="info-message">Transaction bancaire destination {transfer.destination_bank_transaction_number}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function transferTypeLabel(value: TreasuryTransferType | string) {
  switch (String(value ?? '').toUpperCase()) {
    case 'CASH_TO_BANK':
      return 'Dépôt en banque';
    case 'BANK_TO_CASH':
      return 'Retrait bancaire vers caisse';
    case 'BANK_TO_BANK':
      return 'Virement entre comptes';
    default:
      return value || '-';
  }
}

function supportTypeLabel(value?: string | null) {
  return String(value ?? '').toUpperCase() === 'MAIN_CASH' ? 'Caisse principale' : 'Compte bancaire';
}

function paymentMethodLabel(value?: string | null) {
  switch (String(value ?? '').toUpperCase()) {
    case 'BANK_TRANSFER':
      return 'Virement bancaire';
    case 'CASH':
      return 'Espèces';
    case 'CHEQUE':
      return 'Chèque';
    default:
      return value || '-';
  }
}

function formatTransferMoney(amount: number, currency: string) {
  return currency === 'CDF'
    ? `${Number(amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CDF`
    : `${money(amount ?? 0)} $US`;
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}
