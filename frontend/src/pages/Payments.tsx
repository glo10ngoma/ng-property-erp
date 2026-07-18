import { ChevronRight, FileSpreadsheet, Filter, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, exportXlsxWorkbook, includesText, money, paymentMethodLabel, shortDate } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Modal, PageHeader, SuccessMessage } from '../components';
import { useApiList } from '../hooks';
import { formatLeaseReference } from '../utils/lease-reference';

type Payment = {
  id: number;
  invoice_id?: number;
  invoice_number: string;
  invoice_status?: string;
  tenant_id?: number;
  tenant_name: string;
  tenant_phone?: string;
  tenant_email?: string;
  unit_number?: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference?: string;
  notes?: string;
  receipt_number?: string;
  payer_name?: string;
  status?: string;
};

type Invoice = {
  id: number;
  invoice_number: string;
  tenant_id: number;
  tenant_name: string;
  building_id?: number;
  building_name?: string;
  unit_id?: number;
  remaining_amount: number;
  total: number;
  status: string;
  unit_number?: string;
  lease_id?: number;
  lease_number?: number;
  tenant_phone?: string;
  tenant_email?: string;
  paid_amount?: number;
};

type ExchangeRate = {
  fromCurrency?: string;
  toCurrency?: string;
  rate: number;
  effectiveDate?: string;
};

const paymentMethods = [
  ['CASH', 'Espèces'],
  ['BANK', 'Banque'],
  ['MOBILE_MONEY', 'Mobile Money'],
];

export function Payments() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState('');
  const invoices = useApiList<Invoice>('/invoices');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    month: '',
    year: '',
    payment_method: '',
    tenant: '',
    status: '',
    invoice: '',
    start: '',
    end: '',
    min: '',
    max: '',
    receipt: '',
    reference: '',
  });
  const [success, setSuccess] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);

  const reloadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError('');
    try {
      const response = await api.get<Payment[]>('/payments');
      setPayments(response.data);
    } catch (error) {
      setPaymentsError(apiErrorMessage(error, 'Impossible de charger les paiements. Veuillez réessayer ou contacter l’administrateur.'));
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  async function refreshExchangeRate() {
    try {
      const response = await api.get<ExchangeRate | null>('/settings/exchange-rate');
      setExchangeRate(response.data ?? null);
    } catch {
      setExchangeRate(null);
    }
  }

  useEffect(() => {
    refreshExchangeRate();
  }, []);

  useEffect(() => {
    reloadPayments();
  }, [reloadPayments]);

  const invoiceOptions = useMemo(
    () => invoices.data.filter((invoice) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(invoice.status) && Number(invoice.remaining_amount) > 0),
    [invoices.data],
  );

  const selectedInvoice = useMemo(
    () => invoiceOptions.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [invoiceOptions, selectedInvoiceId],
  );

  const filtered = payments.filter((payment) => {
    const date = payment.payment_date.slice(0, 10);
    return (
      includesText(
        {
          ...payment,
          payment_method_label: paymentMethodLabel(payment.payment_method),
          invoice_status_label: payment.status ?? payment.invoice_status ?? '',
        },
        query,
      )
      && (!filters.month || new Date(payment.payment_date).getMonth() + 1 === Number(filters.month))
      && (!filters.year || new Date(payment.payment_date).getFullYear() === Number(filters.year))
      && (!filters.payment_method || payment.payment_method === filters.payment_method)
      && (!filters.tenant || payment.tenant_name === filters.tenant)
      && (!filters.status || (payment.status ?? payment.invoice_status ?? '') === filters.status)
      && (!filters.invoice || payment.invoice_number?.toLowerCase().includes(filters.invoice.toLowerCase()))
      && (!filters.start || date >= filters.start)
      && (!filters.end || date <= filters.end)
      && (!filters.min || Number(payment.amount) >= Number(filters.min))
      && (!filters.max || Number(payment.amount) <= Number(filters.max))
      && (!filters.receipt || String(payment.receipt_number ?? '').toLowerCase().includes(filters.receipt.toLowerCase()))
      && (!filters.reference || String(payment.reference ?? '').toLowerCase().includes(filters.reference.toLowerCase()))
    );
  });

  const totals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    return {
      total: payments.length,
      today: payments.filter((payment) => payment.payment_date.slice(0, 10) === today).length,
      month: payments.filter((payment) => new Date(payment.payment_date).getMonth() + 1 === month && new Date(payment.payment_date).getFullYear() === year).length,
      cash: payments.filter((payment) => payment.payment_method === 'CASH').length,
      bank: payments.filter((payment) => payment.payment_method === 'BANK').length,
      mobile: payments.filter((payment) => payment.payment_method === 'MOBILE_MONEY').length,
      partial: payments.filter((payment) => payment.status === 'PARTIAL' || payment.invoice_status === 'PARTIAL').length,
      collected: payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
    };
  }, [payments]);

  async function save(form: FormData) {
    const payload = {
      invoice_id: Number(form.get('invoice_id')),
      payment_date: form.get('payment_date'),
      amount: Number(form.get('amount')),
      payment_currency: String(form.get('payment_currency') ?? 'USD'),
      amount_usd: Number(form.get('amount_usd') ?? 0),
      amount_cdf: Number(form.get('amount_cdf') ?? 0),
      exchange_rate_used: Number(form.get('exchange_rate_used') ?? 0) || undefined,
      exchange_rate_date: form.get('exchange_rate_date'),
      payment_method: form.get('payment_method'),
      reference: form.get('reference'),
      notes: form.get('notes'),
      payer_name: form.get('payer_name'),
    };
    await api.post('/payments', payload);
    setSuccess('Paiement enregistré avec succès.');
    setOpen(false);
    setSelectedInvoiceId(null);
    reloadPayments();
    invoices.reload();
  }

  function exportRows() {
    return filtered.map((payment) => ({
      reference_paiement: payment.receipt_number ?? `PAY-${payment.id}`,
      facture: payment.invoice_number,
      locataire: payment.tenant_name,
      appartement: payment.unit_number ?? '-',
      date: shortDate(payment.payment_date),
      montant: money(payment.amount),
      mode: paymentMethodLabel(payment.payment_method),
      reference_externe: payment.reference ?? '-',
      statut: payment.status ?? payment.invoice_status ?? '-',
    }));
  }

  const quickStats = [
    ['Total paiements', totals.total],
    ['Paiements aujourd\'hui', totals.today],
    ['Ce mois', totals.month],
    ['Espèces', totals.cash],
    ['Banque', totals.bank],
    ['Mobile Money', totals.mobile],
    ['Paiements partiels', totals.partial],
    ['Total encaissé', money(totals.collected)],
  ] as const;

  return (
    <section>
      <PageHeader title="Paiements" action={can('payments.create') ? <button onClick={() => { setOpen(true); refreshExchangeRate(); }}><Plus size={16} />Nouveau paiement</button> : undefined} />
      <SuccessMessage message={success} />
      {paymentsError ? <div className="error-banner">{paymentsError}</div> : null}

      <div className="summary-band">
        {quickStats.map(([label, value]) => (
          <div key={label} className="summary-item">
            <span>{label}</span>
            <strong>{String(value)}</strong>
          </div>
        ))}
      </div>

      <div className="table-toolbar">
        <div className="toolbar-main">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        </div>
        <div className="toolbar-actions">
          <button type="button" className="secondary" onClick={() => setFilters({ month: '', year: '', payment_method: '', tenant: '', status: '', invoice: '', start: '', end: '', min: '', max: '', receipt: '', reference: '' })}>Réinitialiser</button>
          <button type="button" className="secondary" onClick={() => exportXlsxWorkbook('Paiements.xlsx', [{ name: 'Paiements', rows: exportRows() }])}><FileSpreadsheet size={16} />Exporter</button>
        </div>
      </div>

      <details className="detail-section" open>
        <summary><Filter size={16} />Filtres avancés</summary>
        <div className="quick-form compact-grid">
          <input type="number" min="1" max="12" placeholder="Mois" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
          <input type="number" min="2000" max="2100" placeholder="Année" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} />
          <select value={filters.payment_method} onChange={(event) => setFilters({ ...filters, payment_method: event.target.value })}>
            <option value="">Mode de paiement</option>
            {paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={filters.tenant} onChange={(event) => setFilters({ ...filters, tenant: event.target.value })}>
            <option value="">Locataire</option>
            {Array.from(new Set(invoices.data.map((invoice) => invoice.tenant_name).filter(Boolean))).map((tenant) => (
              <option key={tenant} value={tenant}>{tenant}</option>
            ))}
          </select>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Statut</option>
            <option value="PAID">Payée</option>
            <option value="PARTIAL">Paiement partiel</option>
            <option value="UNPAID">Non payée</option>
          </select>
          <input placeholder="Facture" value={filters.invoice} onChange={(event) => setFilters({ ...filters, invoice: event.target.value })} />
        <button type="button" className="secondary" onClick={() => setFilters({ ...filters, month: '', year: '', payment_method: '', tenant: '', status: '', invoice: '', start: '', end: '', min: '', max: '', receipt: '', reference: '' })}>Réinitialiser</button>
        </div>
        <div className="quick-form compact-grid advanced-grid">
          <input type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} />
          <input type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} />
          <input type="number" placeholder="Montant min." value={filters.min} onChange={(event) => setFilters({ ...filters, min: event.target.value })} />
          <input type="number" placeholder="Montant max." value={filters.max} onChange={(event) => setFilters({ ...filters, max: event.target.value })} />
          <input placeholder="Reçu" value={filters.receipt} onChange={(event) => setFilters({ ...filters, receipt: event.target.value })} />
          <input placeholder="Référence" value={filters.reference} onChange={(event) => setFilters({ ...filters, reference: event.target.value })} />
        </div>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Facture</th>
              <th>Locataire</th>
              <th>Appartement</th>
              <th>Date</th>
              <th className="right">Montant</th>
              <th>Mode</th>
              <th>Référence</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((payment) => {
              const status = payment.status ?? payment.invoice_status ?? 'PAID';
              return (
                <tr key={payment.id} className="clickable-row" onClick={() => navigate(`/payments/${payment.id}`)}>
                  <td>{payment.invoice_number}</td>
                  <td>{payment.tenant_name}</td>
                  <td>{payment.unit_number ?? '-'}</td>
                  <td>{shortDate(payment.payment_date)}</td>
                  <td className="right">{money(payment.amount)}</td>
                  <td>{paymentMethodLabel(payment.payment_method)}</td>
                  <td>{payment.reference ?? '-'}</td>
                  <td><span className={`badge ${String(status).toLowerCase()}`}>{statusLabel(status)}</span></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" title="Voir" onClick={(event) => { event.stopPropagation(); navigate(`/payments/${payment.id}`); }}><ChevronRight size={16} /></button>
                      {can('payments.update') && <button type="button" className="icon-btn" title="Modifier" onClick={(event) => { event.stopPropagation(); navigate(`/payments/${payment.id}?edit=1`); }}><Pencil size={16} /></button>}
                      {can('payments.delete') && <button type="button" className="icon-btn danger" title="Supprimer" onClick={(event) => { event.stopPropagation(); cancelPayment(payment.id); }}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {paymentsLoading ? <EmptyState message="Chargement des paiements..." /> : null}
        {!paymentsLoading && !paymentsError && !payments.length ? (
          <EmptyState message="Aucun élément trouvé. Ajustez les filtres ou créez le premier élément si vous avez les droits." />
        ) : null}
      </div>

      {open && (
        <PaymentModal
          invoices={invoiceOptions}
          selectedInvoice={selectedInvoice}
          selectedInvoiceId={selectedInvoiceId}
          exchangeRate={exchangeRate}
          onSelectInvoice={setSelectedInvoiceId}
          onClose={() => {
            setOpen(false);
            setSelectedInvoiceId(null);
          }}
          onSubmit={save}
        />
      )}
    </section>
  );

  async function cancelPayment(paymentId: number) {
    if (!window.confirm('Annuler ce paiement ?')) return;
    await api.delete(`/payments/${paymentId}`);
    reloadPayments();
    invoices.reload();
  }
}

function PaymentModal({
  invoices,
  selectedInvoice,
  selectedInvoiceId,
  exchangeRate,
  onSelectInvoice,
  onClose,
  onSubmit,
}: {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  selectedInvoiceId: number | null;
  exchangeRate: ExchangeRate | null;
  onSelectInvoice: (value: number | null) => void;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const remaining = Number(selectedInvoice?.remaining_amount ?? 0);
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'CDF' | 'MIXED'>('USD');
  const [usdAmount, setUsdAmount] = useState<string>(remaining ? String(remaining) : '');
  const [cdfAmount, setCdfAmount] = useState<string>('');
  const [rateInput, setRateInput] = useState<string>(exchangeRate?.rate ? String(exchangeRate.rate) : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const rate = Number(rateInput || exchangeRate?.rate || 0);
  const cdfEquivalentUsd = paymentCurrency === 'USD' || rate <= 0 ? 0 : Number((Number(cdfAmount || 0) / rate).toFixed(2));
  const totalEquivalentUsd = Number(
    (
      paymentCurrency === 'USD'
        ? Number(usdAmount || 0)
        : paymentCurrency === 'CDF'
          ? cdfEquivalentUsd
          : Number(usdAmount || 0) + cdfEquivalentUsd
    ).toFixed(2),
  );
  const validationError = paymentValidationError({
    selectedInvoice,
    paymentCurrency,
    usdAmount,
    cdfAmount,
    rate,
    totalEquivalentUsd,
    remaining,
  });

  useEffect(() => {
    setError('');
    if (!selectedInvoice) {
      setUsdAmount('');
      setCdfAmount('');
      return;
    }
    if (paymentCurrency === 'USD') {
      setUsdAmount(remaining ? remaining.toFixed(2) : '');
      setCdfAmount('');
      return;
    }
    if (paymentCurrency === 'CDF') {
      setUsdAmount('0');
      setCdfAmount(rate > 0 && remaining > 0 ? String(Math.round(remaining * rate)) : '');
      return;
    }
    setUsdAmount(remaining ? remaining.toFixed(2) : '');
    setCdfAmount('');
  }, [selectedInvoice?.id, paymentCurrency, remaining]);

  useEffect(() => {
    setRateInput(exchangeRate?.rate ? String(exchangeRate.rate) : '');
  }, [exchangeRate?.rate]);

  useEffect(() => {
    if (!selectedInvoice || paymentCurrency !== 'CDF') return;
    setCdfAmount(rate > 0 && remaining > 0 ? String(Math.round(remaining * rate)) : '');
  }, [rate, paymentCurrency, remaining, selectedInvoice]);

  const contextPlaceholder = 'Sélectionnez d’abord une facture';
  const contextFallback = 'Non renseigné';
  const invoiceTenantLabel = (invoice: Invoice) => invoice.tenant_name || contextFallback;
  const tenantDisplay = selectedInvoice ? invoiceTenantLabel(selectedInvoice) : contextPlaceholder;
  const buildingDisplay = selectedInvoice ? selectedInvoice.building_name || contextFallback : contextPlaceholder;
  const unitDisplay = selectedInvoice ? selectedInvoice.unit_number || contextFallback : contextPlaceholder;
  const leaseDisplay = !selectedInvoice
    ? contextPlaceholder
    : selectedInvoice.lease_id
      ? formatLeaseReference(selectedInvoice.lease_number, selectedInvoice.lease_id)
      : contextFallback;

  return (
    <Modal title="Nouveau paiement" onClose={onClose}>
      <form
        className="form-grid payment-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          const nextError = paymentValidationError({
            selectedInvoice,
            paymentCurrency,
            usdAmount,
            cdfAmount,
            rate,
            totalEquivalentUsd,
            remaining,
          });
          if (nextError) {
            setError(nextError);
            return;
          }
          setSubmitting(true);
          setError('');
          try {
            await onSubmit(new FormData(event.currentTarget));
          } catch (nextError) {
            setError(apiErrorMessage(nextError, 'Impossible d enregistrer le paiement.'));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="detail-section compact-modal-section">
          <summary>Informations paiement</summary>
          <div className="lease-section-grid">
            <label>
              Facture
              <select
                name="invoice_id"
                required
                value={selectedInvoiceId ?? ''}
                onChange={(event) => onSelectInvoice(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Sélectionnez d’abord une facture</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} — {invoiceTenantLabel(invoice)} — {invoice.unit_number ?? contextFallback} — {money(invoice.remaining_amount)} USD
                  </option>
                ))}
              </select>
            </label>
            <label>
              Locataire
              <input value={tenantDisplay} readOnly className="locked-field" />
            </label>
            <label>
              Immeuble
              <input value={buildingDisplay} readOnly className="locked-field" />
            </label>
            <label>
              Appartement / Unité
              <input value={unitDisplay} readOnly className="locked-field" />
            </label>
            <label>
              Bail
              <input value={leaseDisplay} readOnly className="locked-field" />
            </label>
          </div>
          {selectedInvoice && (
            <div className="payment-summary-strip">
              <span>{selectedInvoice.invoice_number}</span>
              <span>{invoiceTenantLabel(selectedInvoice)}</span>
              <span>{selectedInvoice.building_name ?? contextFallback}</span>
              <span>{selectedInvoice.unit_number ?? '-'}</span>
              <span>Facture : <strong>{money(selectedInvoice.total)}</strong></span>
              <span>Payé : <strong>{money(selectedInvoice.paid_amount ?? Math.max(0, Number(selectedInvoice.total) - Number(selectedInvoice.remaining_amount)))}</strong></span>
              <span>Reste : <strong>{money(remaining)}</strong></span>
            </div>
          )}
        </div>

        <div className="detail-section compact-modal-section">
          <summary>Paiement</summary>
          <div className="lease-section-grid">
            <label>
              Mode de règlement
              <select
                value={paymentCurrency}
                onChange={(event) => {
                  const next = event.target.value as 'USD' | 'CDF' | 'MIXED';
                  setPaymentCurrency(next);
                  if (next === 'USD') {
                    setUsdAmount(remaining ? String(remaining) : '');
                    setCdfAmount('');
                  }
                  if (next === 'CDF') {
                    setUsdAmount('0');
                    setCdfAmount(rate > 0 && remaining > 0 ? String(Math.round(remaining * rate)) : '');
                  }
                  if (next === 'MIXED') {
                    setUsdAmount(remaining ? String(remaining) : '');
                    setCdfAmount('');
                  }
                }}
              >
                <option value="USD">USD uniquement</option>
                <option value="CDF">CDF uniquement</option>
                <option value="MIXED">Mixte USD + CDF</option>
              </select>
            </label>
            <label>Reste dû<input value={selectedInvoice ? money(remaining) : contextPlaceholder} readOnly className="locked-field" /></label>
            <label>Date<input name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Montant USD<input name="amount_usd" type="number" step="0.01" min="0" value={paymentCurrency === 'CDF' ? '0' : usdAmount} onChange={(event) => setUsdAmount(event.target.value)} disabled={paymentCurrency === 'CDF'} /></label>
            <label>Montant CDF<input name="amount_cdf" type="number" step="1" min="0" value={paymentCurrency === 'USD' ? '' : cdfAmount} onChange={(event) => setCdfAmount(event.target.value)} disabled={paymentCurrency === 'USD'} /></label>
            <label>Taux appliqué<input name="exchange_rate_used" type="number" step="0.000001" min="0" value={rateInput} onChange={(event) => setRateInput(event.target.value)} className={paymentCurrency === 'USD' ? 'locked-field' : ''} readOnly={paymentCurrency === 'USD'} /></label>
            <label>Équivalent USD du CDF<input value={cdfEquivalentUsd.toFixed(2)} readOnly className="locked-field" /></label>
            <label>Total équivalent USD<input name="amount" type="number" value={totalEquivalentUsd || usdAmount || cdfEquivalentUsd || ''} readOnly className="locked-field" /></label>
            <label>Mode de paiement
              <select name="payment_method">
                <option value="CASH">Espèces</option>
                <option value="BANK">Banque</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
              </select>
            </label>
            <label>Référence<input name="reference" placeholder="Référence" /></label>
            <input type="hidden" name="payment_currency" value={paymentCurrency} />
            <input type="hidden" name="exchange_rate_date" value={exchangeRate?.effectiveDate ?? new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="payment-summary-strip">
            <span>USD reçu: <strong>{Number(usdAmount || 0).toFixed(2)}</strong></span>
            <span>CDF reçu: <strong>{Number(cdfAmount || 0).toLocaleString('fr-FR')}</strong></span>
            <span>Taux: <strong>{rate ? `1 USD = ${rate.toLocaleString('fr-FR')} CDF` : 'Non disponible'}</strong></span>
            <span>Total: <strong>{totalEquivalentUsd.toFixed(2)} USD</strong></span>
            <span>Reste: <strong>{Math.max(remaining - totalEquivalentUsd, 0).toFixed(2)} USD</strong></span>
          </div>
          {(error || validationError) ? <div className="error-message">{error || validationError}</div> : null}
        </div>

        <div className="detail-section compact-modal-section">
          <summary>Informations complémentaires</summary>
          <div className="lease-section-grid">
            <label>Banque<input name="payer_name" placeholder="Banque / payeur" /></label>
            <label>Numéro transaction<input name="transaction_number" placeholder="Numéro transaction" /></label>
            <label>Chèque<input name="check_number" placeholder="Chèque" /></label>
            <label>Observations<textarea name="notes" rows={2} placeholder="Observations" /></label>
          </div>
        </div>

        <button type="submit" disabled={submitting || Boolean(validationError)}>
          {submitting ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}

function paymentValidationError({
  selectedInvoice,
  paymentCurrency,
  usdAmount,
  cdfAmount,
  rate,
  totalEquivalentUsd,
  remaining,
}: {
  selectedInvoice: Invoice | null;
  paymentCurrency: 'USD' | 'CDF' | 'MIXED';
  usdAmount: string;
  cdfAmount: string;
  rate: number;
  totalEquivalentUsd: number;
  remaining: number;
}) {
  const amountUsd = Number(usdAmount || 0);
  const amountCdf = Number(cdfAmount || 0);
  if (!selectedInvoice?.id) return 'Selectionnez une facture.';
  if (!Number.isFinite(amountUsd) || amountUsd < 0 || !Number.isFinite(amountCdf) || amountCdf < 0 || !Number.isFinite(totalEquivalentUsd)) return 'Montant invalide.';
  if (amountUsd <= 0 && amountCdf <= 0) return 'Le paiement doit contenir au moins un montant USD ou CDF.';
  if ((paymentCurrency === 'CDF' || paymentCurrency === 'MIXED' || amountCdf > 0) && rate <= 0) return 'Aucun taux de change disponible pour un paiement CDF.';
  if (totalEquivalentUsd > remaining + 0.01) return `Le montant dépasse le restant dû (${money(remaining)} USD).`;
  return '';
}

function apiErrorMessage(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(responseMessage)) return responseMessage.join(' ');
  return responseMessage || (error instanceof Error ? error.message : fallback);
}

function statusLabel(value: string) {
  return ({ PAID: 'Payée', PARTIAL: 'Paiement partiel', UNPAID: 'Non payée', OVERDUE: 'En retard', DRAFT: 'Brouillon', CANCELLED: 'Annulée' } as Record<string, string>)[value] ?? value;
}
