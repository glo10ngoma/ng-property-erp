import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from './Modal';
import { type CashExpenseCategory } from '../../modules/cash/hooks/useCashExpenseCategories';

type BankAccountOption = {
  id: number;
  bank_name: string;
  account_name: string;
  account_number?: string | null;
  currency: 'USD' | 'CDF';
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
};

type ExpenseSourceRegister = 'MAIN_CASH' | 'BANK';

type ExpenseModalProps = {
  open: boolean;
  sourceRegister: ExpenseSourceRegister;
  categories: CashExpenseCategory[];
  bankAccounts?: BankAccountOption[];
  defaultBankAccountId?: number | null;
  nextPieceNumber?: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCreateCategory: (payload: { code: string; name: string; description?: string | null; status?: string }) => Promise<CashExpenseCategory>;
};

const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseModal({
  open,
  sourceRegister,
  categories,
  bankAccounts = [],
  defaultBankAccountId = null,
  nextPieceNumber,
  onClose,
  onSubmit,
  onCreateCategory,
}: ExpenseModalProps) {
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachmentName, setAttachmentName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  const [formState, setFormState] = useState({
    label: '',
    category: '',
    amount: '',
    movement_date: today(),
    supplier: '',
    payment_method: sourceRegister === 'BANK' ? 'BANK' : '',
    reference: '',
    description: '',
    notes: '',
    bank_account_id: '',
  });

  const activeCategories = useMemo(
    () => categories.filter((category) => category.status === 'ACTIVE'),
    [categories],
  );

  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((account) => account.status === 'ACTIVE'),
    [bankAccounts],
  );

  const selectedBankAccount = useMemo(
    () => activeBankAccounts.find((account) => String(account.id) === String(formState.bank_account_id)) ?? null,
    [activeBankAccounts, formState.bank_account_id],
  );

  useEffect(() => {
    if (!open) return;
    const initialBankAccount = sourceRegister === 'BANK'
      ? activeBankAccounts.find((account) => Number(account.id) === Number(defaultBankAccountId ?? 0))
        ?? activeBankAccounts.find((account) => account.currency === 'USD')
        ?? activeBankAccounts[0]
        ?? null
      : null;
    setFormState({
      label: '',
      category: '',
      amount: '',
      movement_date: today(),
      supplier: '',
      payment_method: sourceRegister === 'BANK' ? 'BANK' : '',
      reference: '',
      description: '',
      notes: '',
      bank_account_id: initialBankAccount ? String(initialBankAccount.id) : '',
    });
    setAttachmentName('');
    setFormError('');
    setSubmitting(false);
    setCategoryModalOpen(false);
    setCurrency(initialBankAccount?.currency ?? 'USD');
  }, [activeBankAccounts, defaultBankAccountId, open, sourceRegister]);

  useEffect(() => {
    if (sourceRegister !== 'BANK') return;
    if (!selectedBankAccount) return;
    setCurrency(selectedBankAccount.currency);
  }, [selectedBankAccount, sourceRegister]);

  async function submit() {
    if (!formState.category) {
      setFormError('La catégorie est obligatoire.');
      return;
    }
    if (sourceRegister === 'BANK' && !formState.bank_account_id) {
      setFormError('Un compte bancaire actif est requis.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await onSubmit({
        source_register: sourceRegister,
        label: formState.label,
        category: formState.category,
        amount: formState.amount,
        movement_date: formState.movement_date,
        supplier: formState.supplier || null,
        payment_method: sourceRegister === 'BANK' ? 'BANK' : formState.payment_method || null,
        reference: formState.reference || null,
        description: formState.description || null,
        notes: formState.notes || null,
        attachment_file_name: attachmentName || null,
        currency: sourceRegister === 'BANK' ? selectedBankAccount?.currency ?? currency : currency,
        bank_account_id: sourceRegister === 'BANK' ? Number(formState.bank_account_id) : null,
      });
      onClose();
    } catch (err: any) {
      setFormError(apiErrorMessage(err, 'Impossible d’enregistrer la dépense.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  async function createCategory(payload: { code: string; name: string; description?: string | null; status?: string }) {
    const created = await onCreateCategory(payload);
    setFormState((current) => ({ ...current, category: created.code }));
    setCategoryModalOpen(false);
    return created;
  }

  if (!open) return null;

  return (
    <Modal title="Enregistrer dépense" onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-section">
          <h3>Informations principales</h3>
          <div className="inline-info-card">
            <div>
              <strong>Source des fonds</strong>
              <p>{sourceRegister === 'MAIN_CASH' ? 'Caisse principale' : 'Banque'}</p>
            </div>
            {sourceRegister === 'BANK' && selectedBankAccount ? (
              <div>
                <strong>{selectedBankAccount.bank_name}</strong>
                <p>{selectedBankAccount.account_name}</p>
              </div>
            ) : null}
          </div>
          {sourceRegister === 'BANK' && !activeBankAccounts.length ? (
            <div className="info-message">Aucun compte bancaire actif disponible.</div>
          ) : null}
          <div className="lease-section-grid">
            {sourceRegister === 'MAIN_CASH' ? (
              <label>
                N° piece
                <input value={nextPieceNumber ?? '-'} readOnly className="locked-field" />
              </label>
            ) : null}
            <label>
              Libelle *
              <input
                name="label"
                required
                placeholder="Libelle"
                value={formState.label}
                onChange={(event) => setFormState((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
            <label className="lease-field-full">
              Catégorie *
              <div className="cash-category-inline">
                <select
                  name="category"
                  required
                  value={formState.category}
                  onChange={(event) => setFormState((current) => ({ ...current, category: event.target.value }))}
                >
                  <option value="">Sélectionner</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.code}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary" onClick={() => setCategoryModalOpen(true)}>
                  <Plus size={14} />
                  Nouvelle catégorie
                </button>
              </div>
            </label>
            <label>
              Montant *
              <input
                name="amount"
                type="number"
                required
                step="0.01"
                value={formState.amount}
                onChange={(event) => setFormState((current) => ({ ...current, amount: event.target.value }))}
              />
            </label>
            <label>
              Date *
              <input
                name="movement_date"
                type="date"
                required
                value={formState.movement_date}
                onChange={(event) => setFormState((current) => ({ ...current, movement_date: event.target.value }))}
              />
            </label>
            {sourceRegister === 'BANK' ? (
              <>
                <label className="form-field-full">
                  Compte bancaire *
                  <select
                    name="bank_account_id"
                    value={formState.bank_account_id}
                    onChange={(event) => {
                      const nextAccount = activeBankAccounts.find((account) => String(account.id) === event.target.value) ?? null;
                      setFormState((current) => ({ ...current, bank_account_id: event.target.value }));
                      if (nextAccount) {
                        setCurrency(nextAccount.currency);
                      }
                    }}
                    required
                  >
                    <option value="">Sélectionner un compte bancaire</option>
                    {activeBankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bank_name} - {account.account_name} ({account.currency})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Devise
                  <input value={selectedBankAccount?.currency ?? currency} readOnly className="locked-field" />
                </label>
              </>
            ) : (
              <label>
                Devise
                <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value as 'USD' | 'CDF')}>
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="modal-section">
          <h3>Paiement / fournisseur</h3>
          <div className="lease-section-grid">
            <label>
              Fournisseur
              <input
                name="supplier"
                placeholder="Fournisseur"
                value={formState.supplier}
                onChange={(event) => setFormState((current) => ({ ...current, supplier: event.target.value }))}
              />
            </label>
            <label>
              Moyen de paiement
              <select
                name="payment_method"
                value={sourceRegister === 'BANK' ? 'BANK' : formState.payment_method}
                onChange={(event) => setFormState((current) => ({ ...current, payment_method: event.target.value }))}
                disabled={sourceRegister === 'BANK'}
              >
                {sourceRegister === 'BANK' ? (
                  <option value="BANK">Banque</option>
                ) : (
                  <>
                    <option value="">-</option>
                    <option value="CASH">Espèces</option>
                    <option value="BANK">Banque</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </>
                )}
              </select>
            </label>
            <label>
              Référence
              <input
                name="reference"
                placeholder="Référence"
                value={formState.reference}
                onChange={(event) => setFormState((current) => ({ ...current, reference: event.target.value }))}
              />
            </label>
            <label>
              Pièce jointe
              <input
                name="attachment_file"
                type="file"
                accept=".pdf,image/jpeg,image/png"
                onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? '')}
              />
            </label>
            <label>
              Fichier sélectionné
              <input value={attachmentName || '-'} readOnly className="locked-field" />
            </label>
          </div>
        </div>

        <div className="modal-section">
          <h3>Notes</h3>
          <div className="lease-section-grid">
            <label>
              Description
              <textarea
                name="description"
                rows={2}
                placeholder="Description"
                value={formState.description}
                onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label>
              Observations internes
              <textarea
                name="notes"
                rows={2}
                placeholder="Observations internes"
                value={formState.notes}
                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
          </div>
        </div>

        {formError ? <div className="error-message">{formError}</div> : null}

        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button type="submit" disabled={submitting || (sourceRegister === 'BANK' && (!selectedBankAccount || !formState.bank_account_id))}>
            {submitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>

      {categoryModalOpen ? (
        <CashInlineCategoryModal
          onClose={() => setCategoryModalOpen(false)}
          onSubmit={createCategory}
        />
      ) : null}
    </Modal>
  );
}

function CashInlineCategoryModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { code: string; name: string; description?: string | null; status?: string }) => Promise<CashExpenseCategory>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(form: HTMLFormElement) {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        code: String(new FormData(form).get('code') ?? '').trim(),
        name: String(new FormData(form).get('name') ?? '').trim(),
        description: String(new FormData(form).get('description') ?? '').trim() || null,
        status: 'ACTIVE',
      });
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Impossible de créer la catégorie.'));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  return (
    <Modal title="Nouvelle catégorie" onClose={onClose}>
      <form
        className="cash-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <div className="modal-section">
          <h3>Catégorie de dépense</h3>
          <div className="lease-section-grid">
            <label>
              Code
              <input name="code" placeholder="AUTRE_DEPENSE" />
            </label>
            <label>
              Nom *
              <input name="name" required placeholder="Autre dépense" />
            </label>
            <label className="lease-field-full">
              Description
              <textarea name="description" rows={3} placeholder="Description" />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
        </div>
        <div className="modal-footer-sticky">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}
