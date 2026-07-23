import { Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api';
import { Modal } from '../components';

type ShareholderOption = {
  id: number;
  display_name: string;
  shareholder_type: string;
  phone?: string | null;
  email?: string | null;
};

type ShareholderPayoutFormData = {
  source_register: 'MAIN_CASH' | 'GUARANTEE_CASH' | 'BANK';
  shareholders: ShareholderOption[];
  balances: Record<string, number>;
  bank_accounts?: Array<{
    id: number;
    bank_name: string;
    account_name: string;
    account_number?: string | null;
    currency: 'USD' | 'CDF';
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    current_balance?: number | null;
  }>;
  payment_methods: Array<{ value: string; label: string }>;
  operation_types: Array<{ value: string; label: string }>;
};

type ShareholderPayoutResultLine = {
  id: number;
  shareholder_id: number;
  shareholder_name: string;
  amount: number;
  currency: string;
  receipt_number: string;
};

type ShareholderPayoutResult = {
  id: number;
  reference?: string | null;
  source_register: 'MAIN_CASH' | 'GUARANTEE_CASH' | 'BANK';
  currency: 'USD' | 'CDF';
  total_amount: number;
  beneficiary_count: number;
  lines: ShareholderPayoutResultLine[];
};

type PayoutLineState = {
  shareholder_id: string;
  amount: string;
  payment_method: string;
  reference: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

export function ShareholderPayoutModal({
  endpoint,
  sourceRegister,
  defaultBankAccountId,
  onClose,
  onSuccess,
}: {
  endpoint: '/cash/shareholder-payouts' | '/guarantee-cash/shareholder-payouts' | '/bank/shareholder-payouts';
  sourceRegister: 'MAIN_CASH' | 'GUARANTEE_CASH' | 'BANK';
  defaultBankAccountId?: number | null;
  onClose: () => void;
  onSuccess?: () => Promise<void> | void;
}) {
  const [formData, setFormData] = useState<ShareholderPayoutFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ShareholderPayoutResult | null>(null);
  const [form, setForm] = useState({
    payout_date: today(),
    currency: 'USD',
    operation_type: 'SHAREHOLDER_REPAYMENT',
    reason: '',
    reference: '',
    default_payment_method: sourceRegister === 'BANK' ? 'BANK' : 'CASH',
    notes: '',
    bank_account_id: '',
  });
  const [lines, setLines] = useState<PayoutLineState[]>([
    { shareholder_id: '', amount: '', payment_method: sourceRegister === 'BANK' ? 'BANK' : 'CASH', reference: '', notes: '' },
  ]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get<ShareholderPayoutFormData>(`${endpoint}/form-data`);
        setFormData(response.data);
        const bankAccounts = response.data.bank_accounts ?? [];
        const initialBankAccount = sourceRegister === 'BANK'
          ? bankAccounts.find((account) => Number(account.id) === Number(defaultBankAccountId ?? 0))
            ?? bankAccounts.find((account) => account.currency === 'USD' && account.status === 'ACTIVE')
            ?? bankAccounts.find((account) => account.status === 'ACTIVE')
            ?? bankAccounts[0]
          : null;
        setForm((current) => ({
          ...current,
          currency: initialBankAccount ? initialBankAccount.currency : (response.data.balances.CDF > 0 && response.data.balances.USD <= 0 ? 'CDF' : current.currency),
          default_payment_method: sourceRegister === 'BANK' ? 'BANK' : response.data.payment_methods[0]?.value ?? current.default_payment_method,
          operation_type: response.data.operation_types[0]?.value ?? current.operation_type,
          bank_account_id: initialBankAccount ? String(initialBankAccount.id) : current.bank_account_id,
        }));
        setLines((current) =>
          current.map((line) => ({
            ...line,
            payment_method: sourceRegister === 'BANK' ? 'BANK' : response.data.payment_methods[0]?.value ?? line.payment_method,
          })),
        );
      } catch (loadError: any) {
        setError(apiErrorMessage(loadError, 'Impossible de charger le formulaire de remboursement actionnaire.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [endpoint, sourceRegister, defaultBankAccountId]);

  const totalAmount = useMemo(
    () => Number(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0).toFixed(2)),
    [lines],
  );

  const beneficiaryCount = useMemo(
    () => lines.filter((line) => Number(line.shareholder_id) > 0).length,
    [lines],
  );

  const bankAccounts = formData?.bank_accounts ?? [];
  const bankAccountsForCurrency = useMemo(
    () => bankAccounts.filter((account) => account.status === 'ACTIVE' && account.currency === form.currency),
    [bankAccounts, form.currency],
  );
  const selectedBankAccount = useMemo(
    () => bankAccountsForCurrency.find((account) => String(account.id) === String(form.bank_account_id)) ?? null,
    [bankAccountsForCurrency, form.bank_account_id],
  );
  const bankAvailableBalance = Number(selectedBankAccount?.current_balance ?? 0);
  const availableBalance = sourceRegister === 'BANK'
    ? bankAvailableBalance
    : Number(formData?.balances?.[form.currency] ?? 0);
  const estimatedBalance = Number((availableBalance - totalAmount).toFixed(2));
  const shareholders = formData?.shareholders ?? [];
  const paymentMethods = formData?.payment_methods ?? [];
  const paymentMethodOptions = sourceRegister === 'BANK'
    ? [{ value: 'BANK', label: 'Banque' }]
    : paymentMethods;
  const operationTypes = formData?.operation_types ?? [];

  useEffect(() => {
    if (sourceRegister !== 'BANK' || !formData?.bank_accounts?.length) return;
    setForm((current) => {
      const accountsForCurrency = formData.bank_accounts?.filter(
        (account) => account.status === 'ACTIVE' && account.currency === current.currency,
      ) ?? [];
      const currentSelected = accountsForCurrency.find((account) => String(account.id) === String(current.bank_account_id));
      if (currentSelected) {
        return current;
      }
      const fallback = accountsForCurrency[0];
      if (!fallback) {
        return current.bank_account_id ? { ...current, bank_account_id: '' } : current;
      }
      return { ...current, bank_account_id: String(fallback.id) };
    });
  }, [sourceRegister, form.currency, formData]);

  function updateLine(index: number, patch: Partial<PayoutLineState>) {
    setLines((current) => current.map((line, currentIndex) => (currentIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, { shareholder_id: '', amount: '', payment_method: form.default_payment_method, reference: '', notes: '' }]);
  }

  function removeLine(index: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((_, currentIndex) => currentIndex !== index)));
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        payout_date: form.payout_date,
        currency: form.currency,
        operation_type: form.operation_type,
        reason: form.reason,
        reference: form.reference || null,
        default_payment_method: form.default_payment_method,
        notes: form.notes || null,
        bank_account_id: sourceRegister === 'BANK' ? Number(form.bank_account_id) : null,
        lines: lines.map((line) => ({
          shareholder_id: Number(line.shareholder_id),
          amount: Number(line.amount),
          payment_method: line.payment_method || form.default_payment_method,
          reference: line.reference || null,
          notes: line.notes || null,
        })),
      };
      const response = await api.post<ShareholderPayoutResult>(endpoint, payload);
      setResult(response.data);
      await onSuccess?.();
    } catch (submitError: any) {
      setError(apiErrorMessage(submitError, 'Impossible de valider le remboursement actionnaire.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={result ? 'Opération validée' : 'Rembourser actionnaires'}
      onClose={onClose}
      className="shareholder-payout-modal"
    >
      {loading ? <div className="empty"><strong>Chargement...</strong><span>Préparation du formulaire actionnaires.</span></div> : null}
      {!loading && error ? <div className="error-message">{error}</div> : null}
      {!loading && !result && formData ? (
        <form
          className="shareholder-payout-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="shareholder-payout-source">
            <strong>Source des fonds</strong>
            <span>{sourceRegister === 'MAIN_CASH' ? 'Caisse principale' : sourceRegister === 'GUARANTEE_CASH' ? 'Caisse garanties locatives' : 'Banque'}</span>
          </div>
          {sourceRegister === 'GUARANTEE_CASH' ? (
            <div className="shareholder-payout-warning">
              Cette opération utilisera des fonds de la caisse des garanties locatives. Vérifiez que l’opération a été autorisée avant validation.
            </div>
          ) : null}
          <div className="shareholder-payout-grid">
            <label>
              Date de l’opération
              <input type="date" value={form.payout_date} onChange={(event) => setForm({ ...form, payout_date: event.target.value })} required />
            </label>
            <label>
              Devise
              <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as 'USD' | 'CDF' })}>
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
            </label>
            <label>
              Type d’opération
              <select value={form.operation_type} onChange={(event) => setForm({ ...form, operation_type: event.target.value })}>
                {operationTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              Mode par défaut
              <select value={form.default_payment_method} onChange={(event) => setForm({ ...form, default_payment_method: event.target.value })} disabled={sourceRegister === 'BANK'}>
                {paymentMethodOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            {sourceRegister === 'BANK' ? (
              <label className="form-field-full">
                Compte bancaire
                <select
                  value={form.bank_account_id}
                  onChange={(event) => setForm((current) => ({ ...current, bank_account_id: event.target.value }))}
                  required
                >
                  <option value="">Sélectionner un compte bancaire</option>
                  {bankAccountsForCurrency.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bank_name} - {account.account_name} ({account.currency})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="form-field-full">
              Motif obligatoire
              <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} required />
            </label>
            <label>
              Référence globale
              <input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
            </label>
            <label className="form-field-full">
              Commentaire
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
          </div>

          <div className="shareholder-payout-lines-header">
            <strong>Actionnaires</strong>
            <button type="button" className="secondary" onClick={addLine}><Plus size={15} />Ajouter une ligne</button>
          </div>
          <div className="shareholder-payout-lines">
            {lines.map((line, index) => (
              <div className="shareholder-payout-line" key={`line-${index}`}>
                <label className="shareholder-payout-line-field shareholder-payout-line-shareholder">
                  Actionnaire
                  <select value={line.shareholder_id} onChange={(event) => updateLine(index, { shareholder_id: event.target.value })} required>
                    <option value="">Sélectionner</option>
                    {shareholders.map((shareholder) => (
                      <option key={shareholder.id} value={shareholder.id}>
                        {shareholder.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="shareholder-payout-line-field shareholder-payout-line-amount">
                  Montant
                  <input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} required />
                </label>
                <label className="shareholder-payout-line-field shareholder-payout-line-method">
                  Mode
                  <select value={line.payment_method} onChange={(event) => updateLine(index, { payment_method: event.target.value })} disabled={sourceRegister === 'BANK'}>
                    {paymentMethodOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="shareholder-payout-line-field shareholder-payout-line-reference">
                  Référence
                  <input value={line.reference} onChange={(event) => updateLine(index, { reference: event.target.value })} />
                </label>
                <label className="shareholder-payout-line-field shareholder-payout-line-comment">
                  Commentaire
                  <input value={line.notes} onChange={(event) => updateLine(index, { notes: event.target.value })} />
                </label>
                <div className="shareholder-payout-line-actions">
                  <button type="button" className="icon-btn danger" onClick={() => removeLine(index)} aria-label="Retirer la ligne">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="shareholder-payout-summary">
            <div><span>Bénéficiaires</span><strong>{beneficiaryCount}</strong></div>
            <div><span>Total du lot</span><strong>{money(totalAmount)} {form.currency}</strong></div>
            <div><span>Solde disponible</span><strong>{money(availableBalance)} {form.currency}</strong></div>
            <div><span>Solde estimé après opération</span><strong>{money(estimatedBalance)} {form.currency}</strong></div>
          </div>

          <div className="modal-footer-sticky">
            <button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button>
            <button type="submit" disabled={submitting || loading || (sourceRegister === 'BANK' && (!form.bank_account_id || !selectedBankAccount))}>{submitting ? 'Validation...' : 'Valider le lot'}</button>
          </div>
        </form>
      ) : null}

      {!loading && result ? (
        <div className="shareholder-payout-result">
          <div className="success-message">Opération validée.</div>
          <div className="shareholder-payout-summary">
            <div><span>Référence du lot</span><strong>{result.reference ?? `Lot #${result.id}`}</strong></div>
            <div><span>Source</span><strong>{result.source_register === 'MAIN_CASH' ? 'Caisse principale' : result.source_register === 'GUARANTEE_CASH' ? 'Caisse garanties locatives' : 'Banque'}</strong></div>
            <div><span>Devise</span><strong>{result.currency}</strong></div>
            <div><span>Total</span><strong>{money(result.total_amount)} {result.currency}</strong></div>
            <div><span>Bénéficiaires</span><strong>{result.beneficiary_count}</strong></div>
          </div>
          <div className="shareholder-payout-result-list">
            {result.lines.map((line) => (
              <div key={line.id} className="shareholder-payout-result-row">
                <div>
                  <strong>{line.shareholder_name}</strong>
                  <span>{money(line.amount)} {line.currency}</span>
                </div>
                <button type="button" className="secondary" onClick={() => window.open(`/shareholder-payout-lines/${line.id}/receipt`, '_blank', 'noopener')}>
                  <Printer size={15} />
                  {line.receipt_number}
                </button>
              </div>
            ))}
          </div>
          <div className="shareholder-payout-result-actions">
            <button type="button" className="secondary" onClick={() => window.open(`/shareholder-payouts/${result.id}`, '_blank', 'noopener')}>
              <Printer size={15} />
              Imprimer le récapitulatif
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                result.lines.forEach((line) => window.open(`/shareholder-payout-lines/${line.id}/receipt`, '_blank', 'noopener'));
              }}
            >
              <Printer size={15} />
              Imprimer tous les reçus
            </button>
            <button type="button" onClick={onClose}>Fermer</button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}
