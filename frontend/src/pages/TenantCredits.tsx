import { AlertCircle, ArrowLeft, Ban, FileText, Plus, Printer, RefreshCw, Search, Wallet, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { Modal, SuccessMessage } from '../components';
import { formatLeaseReference } from '../utils/lease-reference';

type TenantCreditAllocation = {
  id: number;
  amount_applied: number;
  currency: 'USD' | 'CDF';
  invoice_id: number;
  invoice_number: string;
  payment_id: number;
  payment_date: string;
  created_at: string;
};

type TenantCreditRefund = {
  id: number;
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
  cash_piece_number?: string;
  created_by_name?: string;
};

type TenantCredit = {
  id: number;
  tenant_id: number;
  lease_id?: number;
  source_payment_id: number;
  currency: 'USD' | 'CDF';
  original_amount: number;
  remaining_amount: number;
  status: string;
  payment_date: string;
  reference?: string;
  notes?: string;
  receipt_number?: string;
  payment_method?: string;
  tenant_name?: string;
  unit_number?: string;
  building_name?: string;
  lease_number?: number;
  amount_usd?: number;
  amount_cdf?: number;
  total_equivalent_usd?: number;
  allocations?: TenantCreditAllocation[];
  refunds?: TenantCreditRefund[];
  can_refund?: boolean;
  can_cancel?: boolean;
};

type FormDataPayload = {
  tenants: Array<{ id: number; name: string; tenant_number?: string }>;
  leases: Array<{ id: number; tenant_id: number; lease_number?: number; unit_number?: string; building_name?: string; status: string }>;
  paymentMethods?: Array<{ value: string; label: string }>;
  currencies?: string[];
};

type RefundFormState = {
  amount: string;
  refund_date: string;
  payment_method: string;
  reference: string;
  reason: string;
};

type CreditHistoryRow = {
  key: string;
  date: string;
  type: string;
  detail: string;
  amountLabel: string;
  direction: 'IN' | 'OUT';
  paymentId?: number;
  invoiceId?: number;
  refundId?: number;
};

const today = () => new Date().toISOString().slice(0, 10);

export function TenantCredits() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const [credits, setCredits] = useState<TenantCredit[]>([]);
  const [formData, setFormData] = useState<FormDataPayload>({ tenants: [], leases: [] });
  const [loading, setLoading] = useState(true);
  const [formDataLoading, setFormDataLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<TenantCredit | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formDataError, setFormDataError] = useState('');
  const [success, setSuccess] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    currency: '',
    start: '',
    end: '',
    lease_id: searchParams.get('lease_id') ?? '',
  });
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [form, setForm] = useState({
    tenant_id: '',
    lease_id: '',
    payment_date: today(),
    currency: 'USD',
    amount: '',
    payment_method: 'CASH',
    exchange_rate_used: '',
    reference: '',
    notes: '',
  });
  const [refundForm, setRefundForm] = useState<RefundFormState>({
    amount: '',
    refund_date: today(),
    payment_method: 'CASH',
    reference: '',
    reason: '',
  });
  const [cancelForm, setCancelForm] = useState<Omit<RefundFormState, 'amount'>>({
    refund_date: today(),
    payment_method: 'CASH',
    reference: '',
    reason: '',
  });

  const resolveLoadError = (loadError: any) => {
    const message = String(loadError?.response?.data?.message ?? '').trim();
    const status = Number(loadError?.response?.status ?? 0);
    if (status === 401) return 'Votre session a expiré. Veuillez vous reconnecter.';
    if (status === 403) return 'Accès refusé au module crédits locataires.';
    if (status === 404) return 'Le module des crédits locataires n’est pas encore configuré.';
    if (status === 400 && /crédits locataires/i.test(message)) return message;
    if (message) return message;
    return 'Impossible de charger les crédits locataires.';
  };

  const resolveFormDataError = (loadError: any) => {
    const message = String(loadError?.response?.data?.message ?? '').trim();
    const status = Number(loadError?.response?.status ?? 0);
    if (status === 401) return 'Votre session a expiré. Veuillez vous reconnecter.';
    if (status === 403) return 'Accès refusé pour charger le formulaire.';
    if (status === 404) return 'Le formulaire des crédits locataires est indisponible.';
    if (status >= 500) return 'Le chargement des locataires et baux a échoué.';
    if (message) return message;
    return 'Impossible de charger le formulaire des crédits locataires.';
  };

  const loadCredits = async () => {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const response = await api.get<TenantCredit[]>('/tenant-credits', { params });
      setCredits(response.data);
      setPage(1);
    } catch (loadError: any) {
      setError(resolveLoadError(loadError));
    } finally {
      setLoading(false);
    }
  };

  const loadFormData = async () => {
    setFormDataLoading(true);
    setFormDataError('');
    try {
      const response = await api.get<FormDataPayload>('/tenant-credits/form-data');
      setFormData(response.data);
    } catch (loadError: any) {
      setFormDataError(resolveFormDataError(loadError));
      setFormData({ tenants: [], leases: [], paymentMethods: [], currencies: ['USD', 'CDF'] });
    } finally {
      setFormDataLoading(false);
    }
  };

  useEffect(() => {
    void loadCredits();
    void loadFormData();
  }, []);

  const filteredLeases = useMemo(
    () => formData.leases.filter((lease) => !form.tenant_id || Number(lease.tenant_id) === Number(form.tenant_id)),
    [form.tenant_id, formData.leases],
  );

  const paymentMethods = formData.paymentMethods?.length
    ? formData.paymentMethods
    : [
        { value: 'CASH', label: 'Espèces' },
        { value: 'BANK', label: 'Banque' },
        { value: 'MOBILE_MONEY', label: 'Mobile Money' },
      ];

  const currencies = formData.currencies?.length ? formData.currencies : ['USD', 'CDF'];
  const tenantSelectDisabled = formDataLoading || !!formDataError || formData.tenants.length === 0;
  const leaseSelectDisabled = !form.tenant_id || formDataLoading || !!formDataError;
  const canSubmitCredit = Boolean(
    form.tenant_id
      && form.lease_id
      && Number(form.amount) > 0
      && (form.currency === 'USD' || Number(form.exchange_rate_used) > 0)
      && !submitting
      && !formDataLoading
      && !formDataError,
  );

  const visibleCredits = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return credits.filter((credit) => {
      if (filters.status && credit.status !== filters.status) return false;
      if (filters.currency && credit.currency !== filters.currency) return false;
      if (filters.lease_id && String(credit.lease_id ?? '') !== filters.lease_id) return false;
      if (filters.start && credit.payment_date < filters.start) return false;
      if (filters.end && credit.payment_date > filters.end) return false;
      if (!search) return true;
      const haystack = [
        credit.tenant_name,
        credit.building_name,
        credit.unit_number,
        credit.reference,
        credit.receipt_number,
        credit.status,
        credit.currency,
        credit.lease_number ? formatLeaseReference(credit.lease_number, credit.lease_id ?? credit.id) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [credits, filters]);

  const totalPages = Math.max(1, Math.ceil(visibleCredits.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedCredits = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visibleCredits.slice(start, start + pageSize);
  }, [currentPage, pageSize, visibleCredits]);

  const totals = useMemo(() => ({
    usd: visibleCredits.filter((credit) => credit.currency === 'USD').reduce((sum, credit) => sum + Number(credit.remaining_amount ?? 0), 0),
    cdf: visibleCredits.filter((credit) => credit.currency === 'CDF').reduce((sum, credit) => sum + Number(credit.remaining_amount ?? 0), 0),
    usedUsd: visibleCredits.filter((credit) => credit.currency === 'USD').reduce((sum, credit) => sum + Number(credit.original_amount ?? 0) - Number(credit.remaining_amount ?? 0), 0),
    usedCdf: visibleCredits.filter((credit) => credit.currency === 'CDF').reduce((sum, credit) => sum + Number(credit.original_amount ?? 0) - Number(credit.remaining_amount ?? 0), 0),
    count: visibleCredits.length,
  }), [visibleCredits]);

  const cdfEquivalent = useMemo(() => {
    const amount = Number(form.amount || 0);
    const rate = Number(form.exchange_rate_used || 0);
    if (form.currency !== 'CDF' || amount <= 0 || rate <= 0) return 0;
    return Number((amount / rate).toFixed(2));
  }, [form.amount, form.currency, form.exchange_rate_used]);

  const refundSummary = useMemo(() => {
    if (!selectedCredit) return null;
    const amount = Number(refundForm.amount || 0);
    const before = Number(selectedCredit.remaining_amount ?? 0);
    return {
      before,
      refund: amount > 0 ? amount : 0,
      after: Math.max(Number((before - (amount > 0 ? amount : 0)).toFixed(2)), 0),
    };
  }, [refundForm.amount, selectedCredit]);

  const updateFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const updateFilterAndReset = (key: keyof typeof filters, value: string) => {
    setPage(1);
    updateFilter(key, value);
  };
  const resetFilters = () => {
    setFilters({
      search: '',
      status: '',
      currency: '',
      start: '',
      end: '',
      lease_id: searchParams.get('lease_id') ?? '',
    });
    setPage(1);
  };
  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'tenant_id' ? { lease_id: '' } : {}),
    }));
  };

  const openDetail = async (creditId: number) => {
    setError('');
    try {
      const response = await api.get<TenantCredit>(`/tenant-credits/${creditId}`);
      setSelectedCredit(response.data);
      setDetailOpen(true);
    } catch (detailError: any) {
      setError(detailError?.response?.data?.message ?? 'Impossible de charger le détail du crédit.');
    }
  };

  const reloadDetail = async (creditId: number) => {
    await Promise.all([loadCredits(), openDetail(creditId)]);
  };

  const resetRefundForm = (credit: TenantCredit | null) => {
    setRefundForm({
      amount: credit ? String(Number(credit.remaining_amount ?? 0)) : '',
      refund_date: today(),
      payment_method: 'CASH',
      reference: '',
      reason: '',
    });
  };

  const resetCancelForm = () => {
    setCancelForm({
      refund_date: today(),
      payment_method: 'CASH',
      reference: '',
      reason: '',
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/tenant-credits', {
        tenant_id: Number(form.tenant_id),
        lease_id: form.lease_id ? Number(form.lease_id) : null,
        payment_date: form.payment_date,
        currency: form.currency,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        exchange_rate_used: form.currency === 'CDF' ? Number(form.exchange_rate_used) : null,
        reference: form.reference || null,
        notes: form.notes || null,
        idempotency_key: `tenant-credit:${form.tenant_id}:${form.lease_id || 'none'}:${form.payment_date}:${form.currency}:${form.amount}:${form.reference || 'noref'}`,
      });
      setSuccess('Crédit locataire enregistré.');
      setModalOpen(false);
      setForm({
        tenant_id: '',
        lease_id: '',
        payment_date: today(),
        currency: 'USD',
        amount: '',
        payment_method: 'CASH',
        exchange_rate_used: '',
        reference: '',
        notes: '',
      });
      await loadCredits();
    } catch (submitError: any) {
      setError(submitError?.response?.data?.message ?? 'Impossible d’enregistrer le crédit locataire.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRefund = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCredit) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post<{ refund: TenantCreditRefund }>(`/tenant-credits/${selectedCredit.id}/refund`, {
        amount: Number(refundForm.amount),
        refund_date: refundForm.refund_date,
        payment_method: refundForm.payment_method,
        reference: refundForm.reference || null,
        reason: refundForm.reason,
        idempotency_key: `tenant-credit-refund:${selectedCredit.id}:${refundForm.refund_date}:${refundForm.amount}:${refundForm.payment_method}:${refundForm.reference || 'noref'}`,
      });
      setSuccess(
        response.data?.refund?.receipt_number
          ? `Remboursement enregistré. Justificatif ${response.data.refund.receipt_number}.`
          : 'Remboursement enregistré.',
      );
      setRefundOpen(false);
      await reloadDetail(selectedCredit.id);
    } catch (refundError: any) {
      setError(refundError?.response?.data?.message ?? 'Impossible d’enregistrer le remboursement.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCredit) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post<{ refund: TenantCreditRefund }>(`/tenant-credits/${selectedCredit.id}/cancel`, {
        refund_date: cancelForm.refund_date,
        payment_method: cancelForm.payment_method,
        reference: cancelForm.reference || null,
        reason: cancelForm.reason,
        idempotency_key: `tenant-credit-cancel:${selectedCredit.id}:${cancelForm.refund_date}:${cancelForm.payment_method}:${cancelForm.reference || 'noref'}`,
      });
      setSuccess(
        response.data?.refund?.receipt_number
          ? `Crédit annulé. Justificatif ${response.data.refund.receipt_number}.`
          : 'Crédit annulé.',
      );
      setCancelOpen(false);
      await reloadDetail(selectedCredit.id);
    } catch (cancelError: any) {
      setError(cancelError?.response?.data?.message ?? 'Impossible d’annuler ce crédit.');
    } finally {
      setSubmitting(false);
    }
  };

  const historyRows = useMemo(() => buildCreditHistory(selectedCredit), [selectedCredit]);

  return (
    <section>
      <div className="page-header">
        <div>
          <button type="button" className="link-button" onClick={() => navigate('/payments')}><ArrowLeft size={15} />Retour paiements</button>
          <h2>Crédits locataires</h2>
          <p>Paiements anticipés disponibles, sans création de factures futures.</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => void loadCredits()}><RefreshCw size={16} />Actualiser</button>
          {can('payments.create') ? <button type="button" onClick={() => { setModalOpen(true); void loadFormData(); }}><Plus size={16} />Nouveau crédit locataire</button> : null}
        </div>
      </div>

      <SuccessMessage message={success} />
      {error && <div className="error">{error}</div>}

      <div className="summary-grid tenant-credit-kpis">
        <div className="summary-card"><span>Crédits visibles</span><strong>{totals.count}</strong></div>
        <div className="summary-card"><span>Disponible USD</span><strong>{money(totals.usd)}</strong></div>
        <div className="summary-card"><span>Disponible CDF</span><strong>{totals.cdf.toLocaleString('fr-FR')} CDF</strong></div>
        <div className="summary-card"><span>Utilisé USD</span><strong>{money(totals.usedUsd)}</strong></div>
        <div className="summary-card"><span>Utilisé CDF</span><strong>{totals.usedCdf.toLocaleString('fr-FR')} CDF</strong></div>
      </div>

      <div className="tenant-credit-toolbar">
        <div className="tenant-credit-toolbar-row tenant-credit-toolbar-search">
          <label className="tenant-credit-search">
            <Search size={15} />
            <input
              value={filters.search}
              onChange={(event) => updateFilterAndReset('search', event.target.value)}
              placeholder="Rechercher par locataire, bail, référence..."
            />
          </label>
        </div>
        <div className="tenant-credit-toolbar-row tenant-credit-toolbar-filters">
          <select value={filters.status} onChange={(event) => updateFilterAndReset('status', event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="AVAILABLE">Disponible</option>
            <option value="PARTIALLY_USED">Partiellement utilisé</option>
            <option value="USED">Utilisé</option>
            <option value="REFUNDED">Remboursé</option>
            <option value="CANCELLED">Annulé</option>
          </select>
          <select value={filters.currency} onChange={(event) => updateFilterAndReset('currency', event.target.value)}>
            <option value="">Toutes devises</option>
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
          <label className="tenant-credit-date-field">
            <span>Du</span>
            <input type="date" value={filters.start} onChange={(event) => updateFilterAndReset('start', event.target.value)} />
          </label>
          <label className="tenant-credit-date-field">
            <span>Au</span>
            <input type="date" value={filters.end} onChange={(event) => updateFilterAndReset('end', event.target.value)} />
          </label>
          <div className="tenant-credit-toolbar-actions">
            <button type="button" className="secondary" onClick={resetFilters}>Réinitialiser</button>
            <button type="button" onClick={() => void loadCredits()}>Filtrer</button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Locataire</th>
              <th>Bail</th>
              <th>Reçu</th>
              <th>Mode</th>
              <th className="right">Montant initial</th>
              <th className="right">Disponible</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedCredits.map((credit) => (
              <tr key={credit.id}>
                <td>{shortDate(credit.payment_date)}</td>
                <td>
                  <div className="tenant-credit-tenant-cell">
                    <strong>{credit.tenant_name ?? '-'}</strong>
                    <small>
                      {[credit.building_name, credit.unit_number].filter((value) => String(value ?? '').trim().length > 0).join(' - ') || '-'}
                    </small>
                  </div>
                </td>
                <td>{credit.lease_id ? formatLeaseReference(credit.lease_number, credit.lease_id) : '-'}</td>
                <td>{credit.receipt_number ?? '-'}</td>
                <td>{paymentMethodLabel(credit.payment_method ?? '')}</td>
                <td className="right">{formatCreditAmount(credit.original_amount, credit.currency)}</td>
                <td className="right">{formatCreditAmount(credit.remaining_amount, credit.currency)}</td>
                <td><span className={`badge ${String(credit.status ?? '').toLowerCase()}`}>{creditStatusLabel(credit.status)}</span></td>
                <td>
                  <button type="button" className="icon-button" title="Voir le détail" onClick={() => void openDetail(credit.id)}><FileText size={15} /></button>
                  <button type="button" className="icon-button" title="Ouvrir le reçu d'origine" onClick={() => navigate(`/payments/${credit.source_payment_id}`)}><Printer size={15} /></button>
                </td>
              </tr>
            ))}
            {!loading && visibleCredits.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty tenant-credit-empty">
                    <strong>Aucun crédit locataire.</strong>
                    <span>Aucun paiement anticipé enregistré pour les filtres sélectionnés.</span>
                  </div>
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={9}>
                  <div className="empty tenant-credit-empty">
                    <strong>Chargement...</strong>
                    <span>Veuillez patienter pendant la récupération des crédits.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-bar tenant-credit-pagination">
        <div className="table-meta">Total {visibleCredits.length} crédit{visibleCredits.length > 1 ? 's' : ''}</div>
        <div className="tenant-credit-pagination-controls">
          <span>Page {currentPage} sur {totalPages}</span>
          <button type="button" className="icon-btn" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={currentPage <= 1} aria-label="Page précédente">‹</button>
          <button type="button" className="icon-btn" onClick={() => setPage(currentPage)} disabled>{currentPage}</button>
          <button type="button" className="icon-btn" onClick={() => setPage((current) => Math.min(current + 1, totalPages))} disabled={currentPage >= totalPages} aria-label="Page suivante">›</button>
        </div>
      </div>

      {modalOpen && (
        <div className="tenant-credit-drawer-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <aside className="tenant-credit-drawer" role="dialog" aria-modal="true" aria-labelledby="tenant-credit-drawer-title" onClick={(event) => event.stopPropagation()}>
            <div className="tenant-credit-drawer-head">
              <div>
                <h3 id="tenant-credit-drawer-title">Nouveau crédit locataire</h3>
                <p>Renseignez un paiement anticipé pour le locataire et le bail concernés.</p>
              </div>
              <button type="button" className="icon-btn secondary" onClick={() => setModalOpen(false)} aria-label="Fermer">
                <X size={16} />
              </button>
            </div>

            <div className="tenant-credit-drawer-body">
              {formDataError ? (
                <div className="tenant-credit-drawer-state tenant-credit-drawer-state-error" role="alert">
                  <AlertCircle size={18} />
                  <div>
                    <strong>Impossible de charger les locataires et baux.</strong>
                    <p>{formDataError}</p>
                  </div>
                  <button type="button" className="secondary" onClick={() => void loadFormData()}>Réessayer</button>
                </div>
              ) : null}

              {formDataLoading ? (
                <div className="tenant-credit-drawer-state tenant-credit-drawer-state-loading" aria-live="polite">
                  <div className="spinner" />
                  <div>
                    <strong>Chargement du formulaire…</strong>
                    <p>Nous préparons les locataires et les baux de l’organisation active.</p>
                  </div>
                </div>
              ) : null}

              <form className="tenant-credit-drawer-form" onSubmit={(event) => void submit(event)}>
                <label>
                  <span>Locataire *</span>
                  <select required value={form.tenant_id} disabled={tenantSelectDisabled} onChange={(event) => updateForm('tenant_id', event.target.value)}>
                    {formDataLoading ? (
                      <option value="">Chargement des locataires…</option>
                    ) : formData.tenants.length === 0 ? (
                      <option value="">Aucun locataire disponible</option>
                    ) : (
                      <>
                        <option value="">Sélectionner un locataire</option>
                        {formData.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                      </>
                    )}
                  </select>
                  <small>{formDataLoading ? 'Chargement des locataires…' : formData.tenants.length === 0 ? 'Aucun locataire disponible.' : 'Choisissez le locataire concerné par ce crédit.'}</small>
                </label>
                <label>
                  <span>Bail actif *</span>
                  <select required value={form.lease_id} disabled={leaseSelectDisabled} onChange={(event) => updateForm('lease_id', event.target.value)}>
                    {!form.tenant_id ? (
                      <option value="">Sélectionnez d’abord un locataire</option>
                    ) : formDataLoading ? (
                      <option value="">Chargement des baux…</option>
                    ) : filteredLeases.length === 0 ? (
                      <option value="">Aucun bail actif pour ce locataire</option>
                    ) : (
                      <>
                        <option value="">Sélectionner un bail</option>
                        {filteredLeases.map((lease) => (
                          <option key={lease.id} value={lease.id}>{formatLeaseReference(lease.lease_number, lease.id)} - {lease.building_name ?? '-'} / {lease.unit_number ?? '-'}</option>
                        ))}
                      </>
                    )}
                  </select>
                  <small>{!form.tenant_id ? 'Sélectionnez d’abord un locataire.' : formDataLoading ? 'Chargement des baux…' : filteredLeases.length === 0 ? 'Aucun bail actif pour ce locataire.' : 'Sélectionnez le bail actif du locataire.'}</small>
                </label>
                <label>
                  <span>Date *</span>
                  <input type="date" required value={form.payment_date} onChange={(event) => updateForm('payment_date', event.target.value)} />
                  <small>Date du paiement anticipé.</small>
                </label>
                <label>
                  <span>Devise *</span>
                  <select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)}>
                    {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                  <small>Devise du crédit locataire.</small>
                </label>
                <label>
                  <span>Montant *</span>
                  <div className="tenant-credit-amount-field">
                    <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} />
                    <span>{form.currency === 'USD' ? '$US' : 'CDF'}</span>
                  </div>
                  <small>Montant payé d’avance.</small>
                </label>
                <label>
                  <span>Mode de paiement *</span>
                  <select value={form.payment_method} onChange={(event) => updateForm('payment_method', event.target.value)}>
                    {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                  </select>
                  <small>Mode de paiement utilisé.</small>
                </label>
                {form.currency === 'CDF' && (
                  <>
                    <label>
                      <span>Taux USD/CDF *</span>
                      <input type="number" min="0.000001" step="0.000001" required value={form.exchange_rate_used} onChange={(event) => updateForm('exchange_rate_used', event.target.value)} />
                      <small>Taux appliqué pour l’équivalent USD.</small>
                    </label>
                    <label>
                      <span>Équivalent USD</span>
                      <input readOnly value={money(cdfEquivalent)} />
                      <small>Valeur calculée automatiquement.</small>
                    </label>
                  </>
                )}
                <label className="tenant-credit-drawer-wide">
                  <span>Référence</span>
                  <input value={form.reference} onChange={(event) => updateForm('reference', event.target.value)} placeholder="Référence du paiement" />
                  <small>Numéro de reçu, bordereau, chèque, etc.</small>
                </label>
                <label className="tenant-credit-drawer-wide">
                  <span>Notes</span>
                  <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="Notes (optionnel)" />
                  <small>Informations complémentaires.</small>
                </label>
                <div className="tenant-credit-drawer-footer tenant-credit-drawer-wide">
                  <button type="button" className="secondary" onClick={() => setModalOpen(false)}>Annuler</button>
                  <button type="submit" disabled={!canSubmitCredit}><FileText size={16} />{submitting ? 'Enregistrement...' : 'Enregistrer le crédit'}</button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      )}

      {detailOpen && selectedCredit && (
        <Modal title={`Crédit locataire #${selectedCredit.id}`} onClose={() => { setDetailOpen(false); setSelectedCredit(null); }}>
          <div className="compact-list">
            <div className="compact-item"><span>Création</span><strong>{shortDate(selectedCredit.payment_date)} | {formatCreditAmount(selectedCredit.original_amount, selectedCredit.currency)}</strong></div>
            <div className="compact-item"><span>Disponible</span><strong>{formatCreditAmount(selectedCredit.remaining_amount, selectedCredit.currency)}</strong></div>
            <div className="compact-item"><span>Utilisé</span><strong>{formatCreditAmount(Number(selectedCredit.original_amount ?? 0) - Number(selectedCredit.remaining_amount ?? 0), selectedCredit.currency)}</strong></div>
            <div className="compact-item"><span>Reçu d'origine</span><strong>{selectedCredit.receipt_number ?? '-'}</strong></div>
            <div className="compact-item"><span>Statut</span><strong>{creditStatusLabel(selectedCredit.status)}</strong></div>
          </div>

          <div className="tenant-credit-detail-actions">
            <button type="button" className="secondary" onClick={() => navigate(`/payments/${selectedCredit.source_payment_id}`)}><Printer size={15} />Reçu d'origine</button>
            {can('tenant_credits.refund') && selectedCredit.can_refund ? (
              <button
                type="button"
                onClick={() => {
                  resetRefundForm(selectedCredit);
                  setRefundOpen(true);
                }}
              >
                <Wallet size={15} />Rembourser le solde
              </button>
            ) : null}
            {can('tenant_credits.cancel') && selectedCredit.can_cancel ? (
              <button
                type="button"
                className="secondary danger"
                onClick={() => {
                  resetCancelForm();
                  setCancelOpen(true);
                }}
              >
                <Ban size={15} />Annuler le crédit
              </button>
            ) : null}
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Détail</th>
                  <th className="right">Montant</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.key}>
                    <td>{shortDate(row.date)}</td>
                    <td>{row.type}</td>
                    <td>{row.detail}</td>
                    <td className={`right ${row.direction === 'OUT' ? 'negative' : ''}`}>{row.amountLabel}</td>
                    <td>
                      {row.invoiceId ? <button type="button" className="link-button" onClick={() => navigate(`/invoices/${row.invoiceId}`)}>Ouvrir la facture</button> : null}
                      {row.refundId ? <button type="button" className="link-button" onClick={() => navigate(`/tenant-credits/refunds/${row.refundId}`)}>Justificatif</button> : null}
                      {row.paymentId ? <button type="button" className="link-button" onClick={() => navigate(`/payments/${row.paymentId}`)}>Reçu</button> : null}
                    </td>
                  </tr>
                ))}
                {!historyRows.length && <tr><td colSpan={5} className="empty">Aucun historique disponible.</td></tr>}
              </tbody>
            </table>
          </div>

          {selectedCredit.status === 'REFUNDED' && !(selectedCredit.refunds ?? []).length ? (
            <div className="inline-info-card" style={{ marginTop: 12 }}>
              <AlertCircle size={16} />
              <div>
                <strong>Historique incomplet</strong>
                <p>Le crédit est marqué remboursé mais aucun justificatif détaillé n’a été trouvé.</p>
              </div>
            </div>
          ) : null}
        </Modal>
      )}

      {refundOpen && selectedCredit && (
        <Modal title="Rembourser un crédit locataire" onClose={() => setRefundOpen(false)}>
          <form className="form-grid" onSubmit={(event) => void submitRefund(event)}>
            <label>Solde disponible<input readOnly value={formatCreditAmount(Number(selectedCredit.remaining_amount ?? 0), selectedCredit.currency)} /></label>
            <label>Devise<input readOnly value={selectedCredit.currency} /></label>
            <label>Montant à rembourser<input type="number" min="0.01" step="0.01" max={selectedCredit.remaining_amount} required value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} /></label>
            <label>Date<input type="date" required value={refundForm.refund_date} onChange={(event) => setRefundForm((current) => ({ ...current, refund_date: event.target.value }))} /></label>
            <label>Mode<select value={refundForm.payment_method} onChange={(event) => setRefundForm((current) => ({ ...current, payment_method: event.target.value }))}>
              <option value="CASH">Espèces</option>
              <option value="BANK">Banque</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
            </select></label>
            <label>Référence<input value={refundForm.reference} onChange={(event) => setRefundForm((current) => ({ ...current, reference: event.target.value }))} /></label>
            <label className="full">Motif<textarea required value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            {refundSummary ? (
              <div className="tenant-credit-refund-summary full">
                <div><span>Disponible avant</span><strong>{formatCreditAmount(refundSummary.before, selectedCredit.currency)}</strong></div>
                <div><span>Montant remboursé</span><strong>{formatCreditAmount(refundSummary.refund, selectedCredit.currency)}</strong></div>
                <div><span>Disponible après</span><strong>{formatCreditAmount(refundSummary.after, selectedCredit.currency)}</strong></div>
              </div>
            ) : null}
            <div className="form-actions full">
              <button type="button" className="secondary" onClick={() => setRefundOpen(false)}>Annuler</button>
              <button type="submit" disabled={submitting}><Wallet size={16} />{submitting ? 'Enregistrement...' : 'Valider le remboursement'}</button>
            </div>
          </form>
        </Modal>
      )}

      {cancelOpen && selectedCredit && (
        <Modal title="Annuler un crédit inutilisé" onClose={() => setCancelOpen(false)}>
          <form className="form-grid" onSubmit={(event) => void submitCancel(event)}>
            <label>Montant annulé<input readOnly value={formatCreditAmount(Number(selectedCredit.remaining_amount ?? 0), selectedCredit.currency)} /></label>
            <label>Devise<input readOnly value={selectedCredit.currency} /></label>
            <label>Date<input type="date" required value={cancelForm.refund_date} onChange={(event) => setCancelForm((current) => ({ ...current, refund_date: event.target.value }))} /></label>
            <label>Mode<select value={cancelForm.payment_method} onChange={(event) => setCancelForm((current) => ({ ...current, payment_method: event.target.value }))}>
              <option value="CASH">Espèces</option>
              <option value="BANK">Banque</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
            </select></label>
            <label>Référence<input value={cancelForm.reference} onChange={(event) => setCancelForm((current) => ({ ...current, reference: event.target.value }))} /></label>
            <label className="full">Motif obligatoire<textarea required value={cancelForm.reason} onChange={(event) => setCancelForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            <div className="inline-info-card full">
              <AlertCircle size={16} />
              <div>
                <strong>Annulation contrôlée</strong>
                <p>Cette opération n’est autorisée que pour un crédit jamais utilisé. Le paiement initial et son reçu d’origine seront conservés.</p>
              </div>
            </div>
            <div className="form-actions full">
              <button type="button" className="secondary" onClick={() => setCancelOpen(false)}>Retour</button>
              <button type="submit" className="danger" disabled={submitting}><Ban size={16} />{submitting ? 'Annulation...' : 'Confirmer l’annulation'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function formatCreditAmount(value: number, currency: 'USD' | 'CDF') {
  return currency === 'USD' ? money(value) : `${Number(value ?? 0).toLocaleString('fr-FR')} CDF`;
}

function creditStatusLabel(status: string) {
  return ({
    AVAILABLE: 'Disponible',
    PARTIALLY_USED: 'Partiellement utilisé',
    USED: 'Utilisé',
    REFUNDED: 'Remboursé',
    CANCELLED: 'Annulé',
  } as Record<string, string>)[status] ?? status;
}

function buildCreditHistory(credit: TenantCredit | null): CreditHistoryRow[] {
  if (!credit) return [];
  const creationRow: CreditHistoryRow = {
    key: `credit-created-${credit.id}`,
    date: credit.payment_date,
    type: 'Création',
    detail: `Crédit créé${credit.receipt_number ? ` - ${credit.receipt_number}` : ''}`,
    amountLabel: `+ ${formatCreditAmount(Number(credit.original_amount ?? 0), credit.currency)}`,
    direction: 'IN' as const,
    paymentId: credit.source_payment_id,
  };
  const allocationRows: CreditHistoryRow[] = (credit.allocations ?? []).map((allocation) => ({
    key: `credit-allocation-${allocation.id}`,
    date: allocation.created_at || allocation.payment_date,
    type: 'Affectation',
    detail: `Affecté à ${allocation.invoice_number}`,
    amountLabel: `- ${formatCreditAmount(Number(allocation.amount_applied ?? 0), allocation.currency)}`,
    direction: 'OUT' as const,
    invoiceId: allocation.invoice_id,
    paymentId: allocation.payment_id,
  }));
  const refundRows: CreditHistoryRow[] = (credit.refunds ?? []).map((refund) => ({
    key: `credit-refund-${refund.id}`,
    date: refund.refund_date,
    type: refund.status === 'CANCELLED' ? 'Annulation' : 'Remboursement',
    detail: `${paymentMethodLabel(refund.payment_method)}${refund.reference ? ` - ${refund.reference}` : ''}`,
    amountLabel: `- ${formatCreditAmount(Number(refund.amount ?? 0), refund.currency)}`,
    direction: 'OUT' as const,
    refundId: refund.id,
  }));
  return [creationRow, ...allocationRows, ...refundRows].sort((a, b) => {
    const timeA = new Date(a.date).getTime();
    const timeB = new Date(b.date).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.key.localeCompare(b.key);
  });
}
