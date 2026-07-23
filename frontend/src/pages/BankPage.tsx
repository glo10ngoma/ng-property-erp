import { Eye, Pencil, Plus, RefreshCcw, Search, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, type NavigateFunction } from 'react-router-dom';
import { api, money, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, LoadingState, Modal, PageHeader, SuccessMessage } from '../components';
import { ExpenseModal } from '../core/components/ExpenseModal';
import { useCashExpenseCategories, type CashExpenseCategory } from '../modules/cash/hooks/useCashExpenseCategories';
import { ShareholderPayoutModal } from './ShareholderPayoutModal';

type BankDashboard = {
  period: {
    start: string;
    end: string;
  };
  totals: {
    usd: number;
    cdf: number;
    period_in_usd: number;
    period_in_cdf: number;
    period_out_usd: number;
    period_out_cdf: number;
    active_accounts: number;
  };
};

type BankAccount = {
  id: number;
  bank_name: string;
  account_name: string;
  account_number?: string | null;
  account_type: 'CURRENT' | 'SAVINGS' | 'ESCROW' | 'OTHER';
  currency: 'USD' | 'CDF';
  opening_balance: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  notes?: string | null;
  created_by_name?: string | null;
  created_at: string;
  archived_at?: string | null;
  total_in?: number;
  total_out?: number;
  current_balance?: number;
  transaction_count?: number;
};

type BankTransaction = {
  id: number;
  bank_account_id: number;
  transaction_number: string;
  transaction_date: string;
  direction: 'IN' | 'OUT';
  transaction_type: 'OPENING_BALANCE' | 'MANUAL_ADJUSTMENT' | 'RENT_PAYMENT' | 'GUARANTEE_PAYMENT' | 'GUARANTEE_REFUND' | 'TENANT_CREDIT' | 'SHAREHOLDER_PAYOUT' | 'BANK_EXPENSE';
  amount: number;
  currency: 'USD' | 'CDF';
  reference?: string | null;
  description?: string | null;
  counterparty_name?: string | null;
  category?: string | null;
  attachment_file_name?: string | null;
  attachment_file_url?: string | null;
  source_module?: string | null;
  source_entity_type?: string | null;
  source_entity_id?: number | null;
  source_payment_id?: number | null;
  source_payment_receipt_number?: string | null;
  source_guarantee_id?: number | null;
  source_tenant_credit_id?: number | null;
  source_tenant_credit_receipt_number?: string | null;
  source_lease_id?: number | null;
  source_lease_number?: number | string | null;
  source_invoice_id?: number | null;
  source_invoice_number?: string | null;
  source_unit_id?: number | null;
  source_unit_number?: string | null;
  source_tenant_id?: number | null;
  source_tenant_name?: string | null;
  source_shareholder_payout_line_id?: number | null;
  source_shareholder_payout_receipt_number?: string | null;
  source_shareholder_payout_batch_id?: number | null;
  source_shareholder_payout_batch_reference?: string | null;
  source_shareholder_id?: number | null;
  source_shareholder_name?: string | null;
  status: 'VALIDATED' | 'REVERSED';
  created_at: string;
  created_by_name?: string | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  account_type?: string | null;
  entry_amount?: number;
  exit_amount?: number;
};

type BankAccountForm = {
  bank_name: string;
  account_name: string;
  account_number: string;
  account_type: string;
  currency: string;
  opening_balance: string;
  status: string;
  notes: string;
};

const defaultForm = (): BankAccountForm => ({
  bank_name: '',
  account_name: '',
  account_number: '',
  account_type: 'CURRENT',
  currency: 'USD',
  opening_balance: '0',
  status: 'ACTIVE',
  notes: '',
});

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

export function BankPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const expenseCategories = useCashExpenseCategories();
  const [dashboard, setDashboard] = useState<BankDashboard | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDefaultBankAccountId, setExpenseDefaultBankAccountId] = useState<number | null>(null);
  const [shareholderPayoutOpen, setShareholderPayoutOpen] = useState(false);
  const [shareholderPayoutBankAccountId, setShareholderPayoutBankAccountId] = useState<number | null>(null);
  const [transactionDetailOpen, setTransactionDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'accounts' | 'transactions'>('accounts');
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    bank_name: '',
    currency: '',
    status: '',
    start: '',
    end: '',
    bank_account_id: '',
    direction: '',
    transaction_type: '',
    source_module: '',
    reference: '',
  });
  const [form, setForm] = useState<BankAccountForm>(defaultForm());
  const [transactionsPage, setTransactionsPage] = useState(1);
  const transactionsPageSize = 10;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const dashboardParams = Object.fromEntries(
        Object.entries({
          bank_name: filters.bank_name.trim(),
          currency: filters.currency,
          status: filters.status,
          start: filters.start,
          end: filters.end,
          bank_account_id: filters.bank_account_id,
        }).filter(([, value]) => value),
      );
      const accountParams = Object.fromEntries(
        Object.entries({
          search: filters.search.trim(),
          bank_name: filters.bank_name.trim(),
          currency: filters.currency,
          status: filters.status,
        }).filter(([, value]) => value),
      );
      const transactionParams = Object.fromEntries(
        Object.entries({
          search: filters.search.trim(),
          bank_name: filters.bank_name.trim(),
          currency: filters.currency,
          status: filters.status,
          start: filters.start,
          end: filters.end,
          bank_account_id: filters.bank_account_id,
          direction: filters.direction,
          transaction_type: filters.transaction_type,
          source_module: filters.source_module.trim(),
          reference: filters.reference.trim(),
        }).filter(([, value]) => value),
      );

      const [dashboardResponse, accountsResponse, transactionsResponse] = await Promise.all([
        api.get<BankDashboard>('/bank-dashboard', { params: dashboardParams }),
        api.get<BankAccount[]>('/bank-accounts', { params: accountParams }),
        api.get<BankTransaction[]>('/bank-transactions', { params: transactionParams }),
      ]);

      setDashboard(dashboardResponse.data);
      setAccounts(accountsResponse.data);
      setTransactions(transactionsResponse.data);
      setTransactionsPage(1);
    } catch (loadError: any) {
      setError(apiErrorMessage(loadError, 'Impossible de charger le module Banque.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const bankOptions = useMemo(
    () => Array.from(new Set(accounts.map((account) => account.bank_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr')),
    [accounts],
  );

  const accountOptions = useMemo(
    () => accounts.map((account) => ({
      id: String(account.id),
      label: `${account.bank_name} - ${account.account_name}`,
    })),
    [accounts],
  );

  const pagedTransactions = useMemo(() => {
    const startIndex = (transactionsPage - 1) * transactionsPageSize;
    return transactions.slice(startIndex, startIndex + transactionsPageSize);
  }, [transactions, transactionsPage]);

  const totalTransactionPages = Math.max(1, Math.ceil(transactions.length / transactionsPageSize));

  const openCreate = () => {
    setSelectedAccount(null);
    setForm(defaultForm());
    setAccountModalOpen(true);
  };

  const openShareholderPayout = (bankAccountId?: number | null) => {
    setShareholderPayoutBankAccountId(bankAccountId ?? null);
    setShareholderPayoutOpen(true);
  };

  const openExpense = (bankAccountId?: number | null) => {
    setExpenseDefaultBankAccountId(bankAccountId ?? null);
    setExpenseOpen(true);
  };

  const openEdit = (account: BankAccount) => {
    setSelectedAccount(account);
    setForm({
      bank_name: account.bank_name ?? '',
      account_name: account.account_name ?? '',
      account_number: account.account_number ?? '',
      account_type: account.account_type ?? 'CURRENT',
      currency: account.currency ?? 'USD',
      opening_balance: String(Number(account.opening_balance ?? 0)),
      status: account.status ?? 'ACTIVE',
      notes: account.notes ?? '',
    });
    setAccountModalOpen(true);
  };

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        bank_name: form.bank_name,
        account_name: form.account_name,
        account_number: form.account_number || null,
        account_type: form.account_type,
        currency: form.currency,
        opening_balance: Number(form.opening_balance || 0),
        status: form.status,
        notes: form.notes || null,
        opening_date: today(),
      };
      if (selectedAccount) {
        await api.patch(`/bank-accounts/${selectedAccount.id}`, payload);
        setSuccess('Compte bancaire mis Ã  jour.');
      } else {
        await api.post('/bank-accounts', payload);
        setSuccess('Compte bancaire crÃ©Ã©.');
      }
      setAccountModalOpen(false);
      setForm(defaultForm());
      await load();
    } catch (submitError: any) {
      setError(apiErrorMessage(submitError, 'Impossible dâ€™enregistrer le compte bancaire.'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitExpense = async (payload: Record<string, unknown>) => {
    setError('');
    await api.post('/cash/expenses', payload);
    setSuccess('Dépense bancaire enregistrée.');
    await load();
  };

  const createExpenseCategory = async (payload: { code: string; name: string; description?: string | null; status?: string }) => {
    setError('');
    const response = await api.post<CashExpenseCategory>('/cash/expense-categories', payload);
    await expenseCategories.reload();
    setSuccess('Catégorie de dépense créée.');
    return response.data;
  };

  const openTransactionDetail = async (transactionId: number) => {
    try {
      const response = await api.get<BankTransaction>(`/bank-transactions/${transactionId}`);
      setSelectedTransaction(response.data);
      setTransactionDetailOpen(true);
    } catch (detailError: any) {
      setError(apiErrorMessage(detailError, 'Impossible de charger le dÃ©tail de la transaction bancaire.'));
    }
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      bank_name: '',
      currency: '',
      status: '',
      start: '',
      end: '',
      bank_account_id: '',
      direction: '',
      transaction_type: '',
      source_module: '',
      reference: '',
    });
    setTransactionsPage(1);
  };

  if (loading && !dashboard) {
    return (
      <section>
        <PageHeader title="Banque" />
        <LoadingState />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="Banque"
        action={(
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={() => void load()}>
              <RefreshCcw size={16} />
              Actualiser
            </button>
            {activeTab === 'accounts' && can('cash.create') ? (
              <button type="button" className="secondary" onClick={() => openExpense()}>
                Enregistrer une dépense
              </button>
            ) : null}
            {activeTab === 'accounts' && can('shareholder_payouts.from_bank') ? (
              <button type="button" className="secondary" onClick={() => openShareholderPayout()}>
                Rembourser actionnaires
              </button>
            ) : null}
            {activeTab === 'accounts' && can('bank_accounts.create') ? (
              <button type="button" onClick={openCreate}>
                <Plus size={16} />
                Nouveau compte bancaire
              </button>
            ) : null}
          </div>
        )}
      />
      <p className="page-subtitle">RÃ©fÃ©rentiel des comptes bancaires et registre des opÃ©rations par organisation.</p>
      <SuccessMessage message={success} />
      {expenseCategories.error ? <div className="error-message">{expenseCategories.error}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}

      <div className="mini-stats bank-kpis">
        <div className="mini-stat"><span>Total banques USD</span><strong>{money(dashboard?.totals.usd ?? 0)} $US</strong></div>
        <div className="mini-stat"><span>Total banques CDF</span><strong>{Number(dashboard?.totals.cdf ?? 0).toLocaleString('fr-FR')} CDF</strong></div>
        <div className="mini-stat"><span>EntrÃ©es de la pÃ©riode</span><strong>{money(dashboard?.totals.period_in_usd ?? 0)} $US</strong><small>{Number(dashboard?.totals.period_in_cdf ?? 0).toLocaleString('fr-FR')} CDF</small></div>
        <div className="mini-stat"><span>Sorties de la pÃ©riode</span><strong>{money(dashboard?.totals.period_out_usd ?? 0)} $US</strong><small>{Number(dashboard?.totals.period_out_cdf ?? 0).toLocaleString('fr-FR')} CDF</small></div>
        <div className="mini-stat"><span>Comptes actifs</span><strong>{dashboard?.totals.active_accounts ?? 0}</strong></div>
      </div>
      <div className="tabs compact-tabs bank-tabs" role="tablist" aria-label="Navigation Banque">
        <button type="button" role="tab" aria-selected={activeTab === 'accounts'} className={activeTab === 'accounts' ? 'active' : ''} onClick={() => setActiveTab('accounts')}>
          Comptes bancaires
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'transactions'} className={activeTab === 'transactions' ? 'active' : ''} onClick={() => setActiveTab('transactions')}>
          Registre bancaire
        </button>
      </div>

      {activeTab === 'accounts' ? (
        <>
          <div className="bank-toolbar">
            <div className="bank-toolbar-search">
              <Search size={16} />
              <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Rechercher une banque, un compte ou une transaction..." />
            </div>
            <div className="bank-toolbar-grid bank-toolbar-grid-accounts">
              <select value={filters.bank_name} onChange={(event) => setFilters((current) => ({ ...current, bank_name: event.target.value }))}>
                <option value="">Toutes les banques</option>
                {bankOptions.map((bankName) => <option key={bankName} value={bankName}>{bankName}</option>)}
              </select>
              <select value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}>
                <option value="">Toutes les devises</option>
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">Tous les statuts</option>
                <option value="ACTIVE">Actif</option>
                <option value="INACTIVE">Inactif</option>
                <option value="ARCHIVED">ArchivÃ©</option>
              </select>
              <div className="bank-toolbar-actions">
                <button type="button" className="secondary" onClick={resetFilters}>RÃ©initialiser</button>
                <button type="button" className="secondary" onClick={() => void load()}>Filtrer</button>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4>Comptes bancaires</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Banque</th>
                    <th>Compte</th>
                    <th>NumÃ©ro</th>
                    <th>Devise</th>
                    <th className="right">Solde courant</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.bank_name}</td>
                      <td>
                        <div className="bank-account-cell">
                          <strong>{account.account_name}</strong>
                          <small>{accountTypeLabel(account.account_type)}</small>
                        </div>
                      </td>
                      <td>{maskAccountNumber(account.account_number)}</td>
                      <td>{account.currency}</td>
                      <td className="right">{formatBankMoney(account.current_balance ?? 0, account.currency)}</td>
                      <td><span className={`badge ${statusBadgeClass(account.status)}`}>{accountStatusLabel(account.status)}</span></td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="DÃ©tail" onClick={() => navigate(`/bank/accounts/${account.id}`)}>
                            <Eye size={16} />
                          </button>
                          {can('bank_accounts.update') ? (
                            <button type="button" className="icon-btn" title="Modifier" onClick={() => openEdit(account)}>
                              <Pencil size={16} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!accounts.length ? <EmptyState title="Aucun compte bancaire" message="CrÃ©ez le premier compte bancaire pour initialiser le registre." /> : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="bank-toolbar">
            <div className="bank-toolbar-search bank-toolbar-search-transaction">
              <Search size={16} />
              <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Rechercher une banque, un compte ou une transaction..." />
            </div>
            <div className="bank-toolbar-grid bank-toolbar-grid-transactions">
              <select value={filters.bank_account_id} onChange={(event) => setFilters((current) => ({ ...current, bank_account_id: event.target.value }))}>
                <option value="">Tous les comptes</option>
                {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
              <input type="date" value={filters.start} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} />
              <input type="date" value={filters.end} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} />
              <select value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}>
                <option value="">Toutes les devises</option>
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
              <select value={filters.direction} onChange={(event) => setFilters((current) => ({ ...current, direction: event.target.value }))}>
                <option value="">Toutes les directions</option>
                <option value="IN">EntrÃ©e</option>
                <option value="OUT">Sortie</option>
              </select>
              <select value={filters.transaction_type} onChange={(event) => setFilters((current) => ({ ...current, transaction_type: event.target.value }))}>
                <option value="">Tous les types</option>
                <option value="OPENING_BALANCE">Solde initial</option>
                <option value="MANUAL_ADJUSTMENT">Ajustement manuel</option>
                <option value="RENT_PAYMENT">Paiement de loyer</option>
                <option value="GUARANTEE_PAYMENT">Paiement de garantie</option>
                <option value="GUARANTEE_REFUND">Remboursement de garantie</option>
                <option value="TENANT_CREDIT">Crédit locataire</option>
                <option value="SHAREHOLDER_PAYOUT">Remboursement actionnaire</option>
                <option value="BANK_EXPENSE">Dépense bancaire</option>
              </select>
              <input value={filters.source_module} onChange={(event) => setFilters((current) => ({ ...current, source_module: event.target.value }))} placeholder="Origine" />
              <input value={filters.reference} onChange={(event) => setFilters((current) => ({ ...current, reference: event.target.value }))} placeholder="RÃ©fÃ©rence" />
              <div className="bank-toolbar-actions">
                <button type="button" className="secondary" onClick={resetFilters}>RÃ©initialiser</button>
                <button type="button" className="secondary" onClick={() => void load()}>Filtrer</button>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4>Registre bancaire</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>NumÃ©ro</th>
                    <th>Banque</th>
                    <th>Compte</th>
                    <th>Type</th>
                    <th>Origine</th>
                    <th>Catégorie</th>
                    <th>Payeur / bÃ©nÃ©ficiaire</th>
                    <th className="right">EntrÃ©e</th>
                    <th className="right">Sortie</th>
                    <th>Devise</th>
                    <th>RÃ©fÃ©rence</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{shortDate(transaction.transaction_date)}</td>
                      <td>{transaction.transaction_number}</td>
                      <td>{transaction.bank_name || '-'}</td>
                      <td>{transaction.account_name || '-'}</td>
                      <td>{transactionTypeLabel(transaction.transaction_type, transaction.source_module, transaction.source_entity_type)}</td>
                      <td>{sourceModuleLabel(transaction.source_module)}</td>
                      <td>{cashCategoryLabel(transaction.category)}</td>
                      <td>{transaction.counterparty_name || '-'}</td>
                      <td className="right">{transaction.direction === 'IN' ? formatBankMoney(transaction.amount, transaction.currency) : ''}</td>
                      <td className="right">{transaction.direction === 'OUT' ? formatBankMoney(transaction.amount, transaction.currency) : ''}</td>
                      <td>{transaction.currency}</td>
                      <td>{transaction.reference || '-'}</td>
                      <td><span className={`badge ${transaction.status === 'VALIDATED' ? 'paid' : 'draft'}`}>{transaction.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="Voir la transaction" onClick={() => void openTransactionDetail(transaction.id)}>
                            <Eye size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!transactions.length ? <EmptyState title="Aucune transaction bancaire" message="Le registre affichera les soldes initiaux et les Ã©critures automatiques des phases suivantes." /> : null}
            </div>
            {transactions.length ? (
              <div className="tenant-credit-pagination bank-pagination">
                <div className="tenant-credit-pagination-controls">
                  <button type="button" className="icon-btn" onClick={() => setTransactionsPage((current) => Math.max(current - 1, 1))} disabled={transactionsPage === 1}>â€¹</button>
                  <strong>Page {transactionsPage} / {totalTransactionPages}</strong>
                  <button type="button" className="icon-btn" onClick={() => setTransactionsPage((current) => Math.min(current + 1, totalTransactionPages))} disabled={transactionsPage >= totalTransactionPages}>â€º</button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
      {accountModalOpen ? (
        <Modal title={selectedAccount ? 'Modifier le compte bancaire' : 'Nouveau compte bancaire'} onClose={() => setAccountModalOpen(false)} className="bank-account-modal">
          <form className="bank-account-form" onSubmit={(event) => void submitAccount(event)}>
            <div className="inline-info-card">
              <div>
                <strong>Solde initial</strong>
                <p>Le solde initial sera enregistrÃ© comme premiÃ¨re transaction bancaire.</p>
              </div>
            </div>
            <div className="bank-account-form-grid">
              <label>
                Banque
                <input value={form.bank_name} onChange={(event) => setForm((current) => ({ ...current, bank_name: event.target.value }))} required />
              </label>
              <label>
                Nom du compte
                <input value={form.account_name} onChange={(event) => setForm((current) => ({ ...current, account_name: event.target.value }))} required />
              </label>
              <label>
                NumÃ©ro de compte
                <input value={form.account_number} onChange={(event) => setForm((current) => ({ ...current, account_number: event.target.value }))} />
              </label>
              <label>
                Type de compte
                <select value={form.account_type} onChange={(event) => setForm((current) => ({ ...current, account_type: event.target.value }))}>
                  <option value="CURRENT">Courant</option>
                  <option value="SAVINGS">Ã‰pargne</option>
                  <option value="ESCROW">SÃ©questre</option>
                  <option value="OTHER">Autre</option>
                </select>
              </label>
              <label>
                Devise
                <select
                  value={form.currency}
                  onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
                  disabled={Boolean(selectedAccount)}
                >
                  <option value="USD">USD</option>
                  <option value="CDF">CDF</option>
                </select>
              </label>
              <label>
                Solde initial
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.opening_balance}
                  onChange={(event) => setForm((current) => ({ ...current, opening_balance: event.target.value }))}
                  disabled={Boolean(selectedAccount)}
                />
              </label>
              <label>
                Statut
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  <option value="ACTIVE">Actif</option>
                  <option value="INACTIVE">Inactif</option>
                  <option value="ARCHIVED">ArchivÃ©</option>
                </select>
              </label>
              <label className="form-field-full">
                Notes
                <textarea rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
            </div>
            {selectedAccount ? (
              <div className="summary-band">
                <div className="summary-item"><span>Devise</span><strong>{selectedAccount.currency}</strong></div>
                <div className="summary-item"><span>Solde initial</span><strong>{formatBankMoney(selectedAccount.opening_balance, selectedAccount.currency)}</strong></div>
                <div className="summary-item"><span>CrÃ©Ã© le</span><strong>{shortDate(selectedAccount.created_at)}</strong></div>
              </div>
            ) : null}
            <div className="modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setAccountModalOpen(false)} disabled={submitting}>Annuler</button>
              <button type="submit" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {transactionDetailOpen && selectedTransaction ? (
        <TransactionDetailDrawer transaction={selectedTransaction} onClose={() => setTransactionDetailOpen(false)} navigate={navigate} />
      ) : null}
      {shareholderPayoutOpen ? (
        <ShareholderPayoutModal
          endpoint="/bank/shareholder-payouts"
          sourceRegister="BANK"
          defaultBankAccountId={shareholderPayoutBankAccountId}
          onClose={() => setShareholderPayoutOpen(false)}
          onSuccess={load}
        />
      ) : null}
      <ExpenseModal
        open={expenseOpen}
        sourceRegister="BANK"
        categories={expenseCategories.data}
        bankAccounts={accounts}
        defaultBankAccountId={expenseDefaultBankAccountId}
        onClose={() => {
          setExpenseOpen(false);
          setExpenseDefaultBankAccountId(null);
        }}
        onSubmit={submitExpense}
        onCreateCategory={createExpenseCategory}
      />
    </section>
  );
}
export function BankAccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const expenseCategories = useCashExpenseCategories();
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [shareholderPayoutOpen, setShareholderPayoutOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const accountId = Number(id);
      const [accountResponse, transactionsResponse] = await Promise.all([
        api.get<BankAccount>(`/bank-accounts/${accountId}`),
        api.get<BankTransaction[]>('/bank-transactions', { params: { bank_account_id: accountId } }),
      ]);
      setAccount(accountResponse.data);
      setTransactions(transactionsResponse.data);
    } catch (loadError: any) {
      setError(apiErrorMessage(loadError, 'Impossible de charger le dÃ©tail du compte bancaire.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const openTransaction = async (transactionId: number) => {
    try {
      const response = await api.get<BankTransaction>(`/bank-transactions/${transactionId}`);
      setSelectedTransaction(response.data);
      setDetailOpen(true);
    } catch (loadError: any) {
      setError(apiErrorMessage(loadError, 'Impossible de charger la transaction bancaire.'));
    }
  };

  const submitExpense = async (payload: Record<string, unknown>) => {
    setError('');
    await api.post('/cash/expenses', payload);
    setSuccess('Dépense bancaire enregistrée.');
    await load();
  };

  const createExpenseCategory = async (payload: { code: string; name: string; description?: string | null; status?: string }) => {
    setError('');
    const response = await api.post<CashExpenseCategory>('/cash/expense-categories', payload);
    await expenseCategories.reload();
    setSuccess('Catégorie de dépense créée.');
    return response.data;
  };

  if (loading) {
    return (
      <section>
        <PageHeader title="DÃ©tail compte bancaire" />
        <LoadingState />
      </section>
    );
  }

  if (!account) {
    return (
      <section>
        <PageHeader
          title="DÃ©tail compte bancaire"
          action={<button type="button" className="secondary" onClick={() => navigate('/bank')}><X size={16} />Retour</button>}
        />
        <EmptyState title="Compte introuvable" message={error || 'Le compte bancaire demandÃ© nâ€™est pas accessible.'} />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="DÃ©tail compte bancaire"
      action={(
          <div className="page-header-actions">
            <button type="button" className="secondary" onClick={() => navigate('/bank')}>Retour</button>
            {can('bank_accounts.read') ? <button type="button" className="secondary" onClick={() => void load()}><RefreshCcw size={16} />Actualiser</button> : null}
            {can('cash.create') ? (
              <button type="button" className="secondary" onClick={() => setExpenseOpen(true)}>
                Enregistrer une dépense
              </button>
            ) : null}
            {can('shareholder_payouts.from_bank') ? (
              <button type="button" className="secondary" onClick={() => setShareholderPayoutOpen(true)}>
                Rembourser actionnaires
              </button>
            ) : null}
          </div>
        )}
      />
      {error ? <div className="error-message">{error}</div> : null}
      <SuccessMessage message={success} />
      {expenseCategories.error ? <div className="error-message">{expenseCategories.error}</div> : null}

      <div className="summary-band bank-account-summary">
        <div className="summary-item summary-item-wide"><span>Banque</span><strong>{account.bank_name}</strong></div>
        <div className="summary-item summary-item-wide"><span>Nom du compte</span><strong>{account.account_name}</strong></div>
        <div className="summary-item"><span>NumÃ©ro</span><strong>{maskAccountNumber(account.account_number)}</strong></div>
        <div className="summary-item"><span>Type</span><strong>{accountTypeLabel(account.account_type)}</strong></div>
        <div className="summary-item"><span>Devise</span><strong>{account.currency}</strong></div>
        <div className="summary-item"><span>Statut</span><strong>{accountStatusLabel(account.status)}</strong></div>
        <div className="summary-item"><span>Solde initial</span><strong>{formatBankMoney(account.opening_balance, account.currency)}</strong></div>
        <div className="summary-item"><span>Solde courant</span><strong>{formatBankMoney(account.current_balance ?? 0, account.currency)}</strong></div>
        <div className="summary-item"><span>Total entrÃ©es</span><strong>{formatBankMoney(account.total_in ?? 0, account.currency)}</strong></div>
        <div className="summary-item"><span>Total sorties</span><strong>{formatBankMoney(account.total_out ?? 0, account.currency)}</strong></div>
        <div className="summary-item"><span>CrÃ©Ã© le</span><strong>{shortDate(account.created_at)}</strong></div>
        <div className="summary-item summary-item-wide"><span>Notes</span><strong>{account.notes || '-'}</strong></div>
      </div>

      <div className="detail-section">
        <h4>Registre filtrÃ© sur ce compte</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>NumÃ©ro</th>
                <th>Type</th>
                <th>Origine</th>
                <th>Catégorie</th>
                <th>RÃ©fÃ©rence</th>
                <th className="right">EntrÃ©e</th>
                <th className="right">Sortie</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{shortDate(transaction.transaction_date)}</td>
                  <td>{transaction.transaction_number}</td>
                  <td>{transactionTypeLabel(transaction.transaction_type, transaction.source_module, transaction.source_entity_type)}</td>
                  <td>{sourceModuleLabel(transaction.source_module)}</td>
                  <td>{cashCategoryLabel(transaction.category)}</td>
                  <td>{transaction.reference || '-'}</td>
                  <td className="right">{transaction.direction === 'IN' ? formatBankMoney(transaction.amount, transaction.currency) : ''}</td>
                  <td className="right">{transaction.direction === 'OUT' ? formatBankMoney(transaction.amount, transaction.currency) : ''}</td>
                  <td><span className={`badge ${transaction.status === 'VALIDATED' ? 'paid' : 'draft'}`}>{transaction.status}</span></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" title="Voir la transaction" onClick={() => void openTransaction(transaction.id)}>
                        <Eye size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!transactions.length ? <EmptyState title="Aucune transaction bancaire" message="Seul le solde initial apparaÃ®t tant quâ€™aucune intÃ©gration mÃ©tier nâ€™est branchÃ©e." /> : null}
        </div>
      </div>

      {detailOpen && selectedTransaction ? (
        <TransactionDetailDrawer transaction={selectedTransaction} onClose={() => setDetailOpen(false)} navigate={navigate} />
      ) : null}
      {shareholderPayoutOpen && account ? (
        <ShareholderPayoutModal
          endpoint="/bank/shareholder-payouts"
          sourceRegister="BANK"
          defaultBankAccountId={account.id}
          onClose={() => setShareholderPayoutOpen(false)}
          onSuccess={load}
        />
      ) : null}
      <ExpenseModal
        open={expenseOpen}
        sourceRegister="BANK"
        categories={expenseCategories.data}
        bankAccounts={account ? [account] : []}
        defaultBankAccountId={account?.id ?? null}
        onClose={() => setExpenseOpen(false)}
        onSubmit={submitExpense}
        onCreateCategory={createExpenseCategory}
      />
    </section>
  );
}

function TransactionDetailDrawer({ transaction, onClose, navigate }: { transaction: BankTransaction; onClose: () => void; navigate: NavigateFunction }) {
  return (
    <div className="tenant-credit-drawer-backdrop" role="presentation">
      <aside className="tenant-credit-drawer bank-transaction-drawer">
        <div className="tenant-credit-drawer-head">
          <div>
            <h3>Transaction bancaire</h3>
            <p>{transaction.transaction_number}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="tenant-credit-drawer-body">
          <div className="summary-band">
            <div className="summary-item"><span>Date</span><strong>{shortDate(transaction.transaction_date)}</strong></div>
            <div className="summary-item"><span>Banque</span><strong>{transaction.bank_name || '-'}</strong></div>
            <div className="summary-item"><span>Compte</span><strong>{transaction.account_name || '-'}</strong></div>
            <div className="summary-item"><span>Direction</span><strong>{transaction.direction === 'IN' ? 'EntrÃ©e' : 'Sortie'}</strong></div>
            <div className="summary-item"><span>Type</span><strong>{transactionTypeLabel(transaction.transaction_type, transaction.source_module, transaction.source_entity_type)}</strong></div>
            <div className="summary-item"><span>Montant</span><strong>{formatBankMoney(transaction.amount, transaction.currency)}</strong></div>
            <div className="summary-item"><span>Devise</span><strong>{transaction.currency}</strong></div>
            <div className="summary-item"><span>Statut</span><strong>{transaction.status}</strong></div>
          </div>

          <div className="bank-detail-grid">
            <div className="compact-item"><span>RÃ©fÃ©rence</span><strong>{transaction.reference || '-'}</strong></div>
            <div className="compact-item"><span>Tiers</span><strong>{transaction.counterparty_name || '-'}</strong></div>
            <div className="compact-item"><span>Origine</span><strong>{sourceModuleLabel(transaction.source_module)}</strong></div>
            <div className="compact-item"><span>Catégorie</span><strong>{cashCategoryLabel(transaction.category)}</strong></div>
            <div className="compact-item"><span>Type source</span><strong>{sourceEntityTypeLabel(transaction.source_entity_type, transaction.source_module)}</strong></div>
            <div className="compact-item"><span>Source entity id</span><strong>{transaction.source_entity_id ?? '-'}</strong></div>
            <div className="compact-item"><span>Bail source</span><strong>{transaction.source_lease_number ? `B-${String(transaction.source_lease_number).padStart(5, '0')}` : transaction.source_lease_id ?? '-'}</strong></div>
            <div className="compact-item"><span>UnitÃ© source</span><strong>{transaction.source_unit_number || transaction.source_unit_id || '-'}</strong></div>
            <div className="compact-item"><span>Utilisateur</span><strong>{transaction.created_by_name || '-'}</strong></div>
            <div className="compact-item"><span>CrÃ©Ã©e le</span><strong>{shortDate(transaction.created_at)}</strong></div>
            <div className="compact-item"><span>NumÃ©ro de compte</span><strong>{maskAccountNumber(transaction.account_number)}</strong></div>
          </div>
          {transaction.source_payment_id || transaction.source_shareholder_payout_line_id ? (
            <div className="detail-section">
              <h4>Source documentaire</h4>
              <div className="row-actions">
                {transaction.source_payment_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/payments/${transaction.source_payment_id}`)}>
                    Reçu {transaction.source_payment_receipt_number || `PAY-${transaction.source_payment_id}`}
                  </button>
                ) : null}
                {transaction.source_tenant_credit_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/tenant-credits?credit_id=${transaction.source_tenant_credit_id}`)}>
                    Crédit {transaction.source_tenant_credit_receipt_number || transaction.source_payment_receipt_number || `#${transaction.source_tenant_credit_id}`}
                  </button>
                ) : null}
                {transaction.source_shareholder_payout_line_id ? (
                  <>
                    <button type="button" className="secondary" onClick={() => navigate(`/shareholder-payout-lines/${transaction.source_shareholder_payout_line_id}/receipt`)}>
                      Reçu {transaction.source_shareholder_payout_receipt_number || `SHR-${transaction.source_shareholder_payout_line_id}`}
                    </button>
                    {transaction.source_shareholder_payout_batch_id ? (
                      <button type="button" className="secondary" onClick={() => navigate(`/shareholder-payouts/${transaction.source_shareholder_payout_batch_id}`)}>
                        Lot {transaction.source_shareholder_payout_batch_reference || `#${transaction.source_shareholder_payout_batch_id}`}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {transaction.source_invoice_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/invoices/${transaction.source_invoice_id}`)}>
                    Facture {transaction.source_invoice_number || `INV-${transaction.source_invoice_id}`}
                  </button>
                ) : null}
                {transaction.source_guarantee_id && transaction.source_lease_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/leases/${transaction.source_lease_id}`)}>
                    Garantie {transaction.source_lease_number ? `B-${String(transaction.source_lease_number).padStart(5, '0')}` : `#${transaction.source_guarantee_id}`}
                  </button>
                ) : null}
                {transaction.source_lease_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/leases/${transaction.source_lease_id}`)}>
                    Bail {transaction.source_lease_number ? `B-${String(transaction.source_lease_number).padStart(5, '0')}` : `#${transaction.source_lease_id}`}
                  </button>
                ) : null}
                {transaction.source_unit_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/units/${transaction.source_unit_id}`)}>
                    Unité {transaction.source_unit_number || `#${transaction.source_unit_id}`}
                  </button>
                ) : null}
                {transaction.source_tenant_id ? (
                  <button type="button" className="secondary" onClick={() => navigate(`/tenants/${transaction.source_tenant_id}/situation`)}>
                    Locataire {transaction.source_tenant_name || `#${transaction.source_tenant_id}`}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="detail-section">
            <h4>Description</h4>
            <div className="compact-empty">{transaction.description || 'Aucune description enregistrÃ©e pour cette transaction.'}</div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' | ');
  return message || fallback;
}

function accountTypeLabel(value?: string | null) {
  switch (String(value ?? '').toUpperCase()) {
    case 'CURRENT':
      return 'Courant';
    case 'SAVINGS':
      return 'Ã‰pargne';
    case 'ESCROW':
      return 'SÃ©questre';
    default:
      return 'Autre';
  }
}

function accountStatusLabel(value?: string | null) {
  switch (String(value ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Actif';
    case 'INACTIVE':
      return 'Inactif';
    default:
      return 'ArchivÃ©';
  }
}

function transactionTypeLabel(value?: string | null, sourceModule?: string | null, sourceEntityType?: string | null) {
  const moduleValue = String(sourceModule ?? '').toUpperCase();
  const entityValue = String(sourceEntityType ?? '').toUpperCase();
  if (moduleValue === 'PAYMENTS' && entityValue === 'PAYMENT') {
    return 'Paiement de loyer';
  }
  if (moduleValue === 'TENANT_CREDITS' || entityValue === 'TENANT_CREDIT') {
    return 'Crédit locataire';
  }
  if (moduleValue === 'SHAREHOLDER_PAYOUTS' || entityValue === 'SHAREHOLDER_PAYOUT_LINE') {
    return 'Remboursement actionnaire';
  }
  if (moduleValue === 'EXPENSES' || entityValue === 'EXPENSE') {
    return 'Dépense bancaire';
  }
  if (moduleValue === 'GUARANTEES') {
    if (entityValue === 'GUARANTEE_REFUND') {
      return 'Remboursement de garantie locative';
    }
    return 'Paiement de garantie locative';
  }
  switch (String(value ?? '').toUpperCase()) {
    case 'OPENING_BALANCE':
      return 'Solde initial';
    case 'MANUAL_ADJUSTMENT':
      return 'Ajustement manuel';
    case 'RENT_PAYMENT':
      return 'Paiement de loyer';
    case 'GUARANTEE_PAYMENT':
      return 'Paiement de garantie locative';
    case 'GUARANTEE_REFUND':
      return 'Remboursement de garantie locative';
    case 'TENANT_CREDIT':
      return 'Crédit locataire';
    case 'SHAREHOLDER_PAYOUT':
      return 'Remboursement actionnaire';
    case 'BANK_EXPENSE':
      return 'Dépense bancaire';
    default:
      return value || '-';
  }
}

function sourceModuleLabel(value?: string | null) {
  switch (String(value ?? '').toUpperCase()) {
    case 'PAYMENTS':
      return 'Paiements';
    case 'GUARANTEES':
      return 'Garanties';
    case 'TENANT_CREDITS':
      return 'Crédits locataires';
    case 'SHAREHOLDER_PAYOUTS':
      return 'Actionnaires';
    case 'EXPENSES':
      return 'Dépenses';
    default:
      return value || '-';
  }
}

function sourceEntityTypeLabel(value?: string | null, sourceModule?: string | null) {
  const moduleValue = String(sourceModule ?? '').toUpperCase();
  const entityValue = String(value ?? '').toUpperCase();
  if (moduleValue === 'TENANT_CREDITS' || entityValue === 'TENANT_CREDIT') {
    return 'Crédit locataire';
  }
  if (moduleValue === 'SHAREHOLDER_PAYOUTS' || entityValue === 'SHAREHOLDER_PAYOUT_LINE') {
    return 'Remboursement actionnaire';
  }
  if (moduleValue === 'GUARANTEES' && entityValue === 'GUARANTEE_REFUND') {
    return 'Remboursement de garantie';
  }
  if (moduleValue === 'GUARANTEES' && entityValue === 'GUARANTEE_PAYMENT') {
    return 'Paiement de garantie';
  }
  if (moduleValue === 'PAYMENTS' && entityValue === 'PAYMENT') {
    return 'Paiement';
  }
  if (moduleValue === 'EXPENSES' || entityValue === 'EXPENSE') {
    return 'Dépense';
  }
  return value || '-';
}

function cashCategoryLabel(value?: string | null) {
  const label = (
    {
      INVOICE_PAYMENT: 'Paiement facture',
      SALARY_ADVANCE: 'Avance salaire',
      OTHER_INCOME: 'Autre entree',
      OTHER_EXPENSE: 'Autre dépense',
      LEASE_GUARANTEE: 'Garantie locative',
      LEASE_GUARANTEE_REFUND: 'Remboursement garantie',
      SALARY_PAYMENT: 'Paiement salaire',
      MAINTENANCE_EXPENSE: 'Depense maintenance',
      PAYMENT_REFUND: 'Remboursement paiement',
      STOCK_PURCHASE: 'Achat fournisseur',
      SHAREHOLDER_PAYOUT: 'Actionnaires',
    } as Record<string, string>
  )[String(value ?? '')];
  return label ?? String(value ?? '-');
}

function formatBankMoney(amount: number, currency: string) {
  return currency === 'CDF'
    ? `${Number(amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CDF`
    : `${money(amount ?? 0)} $US`;
}

function maskAccountNumber(value?: string | null) {
  const digits = String(value ?? '').trim();
  if (!digits) return '-';
  if (digits.length <= 4) return digits;
  return `â€¢â€¢â€¢â€¢ ${digits.slice(-4)}`;
}

function statusBadgeClass(status?: string | null) {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'paid';
    case 'INACTIVE':
      return 'partial';
    default:
      return 'draft';
  }
}
