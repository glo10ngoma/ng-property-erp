import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../core/auth/AuthContext';
import {
  cancelSalesInvoice,
  cancelSalesInvoicePayment,
  createSalesInvoicePayment,
  downloadSalesDocument,
  generateSalesInvoice,
  getSalesInvoice,
  listSalesInvoiceReminders,
  getSalesSubscriptionFinancialSummary,
  issueSalesInvoice,
  listSalesInvoices,
  regenerateSalesInvoicePaymentReceipt,
  regenerateSalesInvoiceDocument,
  refundSalesInvoicePayment,
  sendSalesInvoiceReminder,
  sendSalesInvoice,
} from '../api/sales.api';
import {
  SALES_RESERVATION_DESTINATION_TYPES,
  SALES_RESERVATION_PAYMENT_METHODS,
} from '../types';
import type {
  CreateSalesReservationPaymentInput,
  CreateSalesReservationRefundInput,
  SalesDocumentGeneration,
  SalesInvoice,
  SalesInvoiceReminder,
  SalesReservationPaymentDestination,
  SalesSubscriptionFinancialSummary,
} from '../types';
import {
  SalesActionDialog,
  SalesDataTable,
  SalesEmptyState,
  SalesField,
  SalesFilterBar,
  SalesInlineNotice,
  SalesKpiCard,
  SalesKpiGrid,
  SalesModulePage,
  SalesSection,
  SalesStatusBadge,
  type SalesStatusTone,
} from '../components/SalesUi';

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  if (error instanceof Error) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}

function formatDate(value?: string | null) {
  if (!value) return 'Donnée non disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Donnée non disponible';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
}

function formatCurrency(value?: number | null, currency?: string | null) {
  if (value == null) return 'Donnée non disponible';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function invoiceStatusLabel(value?: string | null) {
  switch ((value || '').toUpperCase()) {
    case 'DRAFT': return 'Brouillon';
    case 'ISSUED': return 'Émise';
    case 'PARTIALLY_PAID': return 'Partiellement payée';
    case 'PAID': return 'Payée';
    case 'OVERDUE': return 'En retard';
    case 'CANCELLED': return 'Annulée';
    default: return value || '—';
  }
}

function installmentFinancialStatusLabel(value?: string | null) {
  switch ((value || '').toUpperCase()) {
    case 'PAID': return 'Payée';
    case 'OVERDUE': return 'En retard';
    case 'PARTIALLY_PAID': return 'Partielle';
    case 'SCHEDULED': return 'À venir';
    default: return value || '—';
  }
}

function getStatusTone(value?: string | null): SalesStatusTone {
  switch ((value || '').toUpperCase()) {
    case 'PAID':
    case 'APPROVED':
    case 'CONFIRMED':
      return 'success';
    case 'PARTIALLY_PAID':
    case 'ISSUED':
    case 'DRAFT':
      return 'warning';
    case 'OVERDUE':
    case 'CANCELLED':
    case 'REJECTED':
      return 'danger';
    default:
      return 'info';
  }
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

type InvoicePaymentFormState = {
  amount: string;
  payment_date: string;
  payment_method: string;
  destination_type: string;
  cash_session_id: string;
  bank_account_id: string;
  external_reference: string;
  notes: string;
  idempotency_key: string;
};

function createPaymentIntentKey(invoiceId?: number) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `sales-invoice-${invoiceId ?? 'new'}-${Date.now()}-${suffix}`;
}

function emptyPaymentForm(invoice?: SalesInvoice | null): InvoicePaymentFormState {
  const balance = Number(invoice?.balance_due ?? 0);
  const destinationType = 'CASH';
  return {
    amount: balance > 0 ? String(balance) : '',
    payment_date: todayInput(),
    payment_method: 'CASH',
    destination_type: destinationType,
    cash_session_id: String(invoice?.payment_destinations?.cash_sessions?.[0]?.id ?? ''),
    bank_account_id: String(invoice?.payment_destinations?.bank_accounts?.[0]?.id ?? ''),
    external_reference: '',
    notes: '',
    idempotency_key: createPaymentIntentKey(invoice?.id),
  };
}

function trimOrUndefined(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function reservationPaymentMethodLabel(value?: string | null) {
  switch ((value || '').toUpperCase()) {
    case 'CASH': return 'Espèces';
    case 'BANK': return 'Banque';
    case 'MOBILE_MONEY': return 'Mobile money';
    case 'OTHER': return 'Autre';
    default: return value || '—';
  }
}

async function triggerDocumentDownload(salesDocument: SalesDocumentGeneration) {
  const blob = await downloadSalesDocument(salesDocument.id);
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = salesDocument.file_name || `${salesDocument.document_number || `document-${salesDocument.id}`}.pdf`;
  anchor.style.display = 'none';
  window.document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 0);
}

type ReasonDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  reason: string;
  error: string | null;
  busy: boolean;
  handler: (reason: string) => Promise<void>;
};

export function SalesSubscriptionFinancialSection({ subscriptionId }: { subscriptionId: number }) {
  const [summary, setSummary] = useState<SalesSubscriptionFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesSubscriptionFinancialSummary(subscriptionId);
        if (!cancelled) setSummary(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (subscriptionId) void load();
    return () => {
      cancelled = true;
    };
  }, [subscriptionId]);

  return (
    <SalesSection
      title="Situation financière"
      description="Synthèse backend du solde, des échéances, des retards et des allocations de frais."
      action={<Link className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" to={`/sales/subscriptions/${subscriptionId}/financials`}>Vue détaillée</Link>}
    >
      {loading ? <SalesInlineNotice>Chargement de la situation financière…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {summary ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Prix final" value={formatCurrency(summary.final_sale_price, summary.currency)} helper={`Solde global : ${formatCurrency(summary.global_balance_due, summary.currency)}`} />
            <SalesKpiCard label="Total facturé" value={formatCurrency(summary.total_invoiced, summary.currency)} helper={`Payé : ${formatCurrency(summary.total_paid, summary.currency)}`} />
            <SalesKpiCard label="Montant en retard" value={formatCurrency(summary.overdue_amount, summary.currency)} helper={`Prochaine échéance : ${formatDate(summary.next_due_date)}`} />
            <SalesKpiCard label="Frais de réservation" value={formatCurrency(summary.reservation_fee.allocated, summary.currency)} helper={`Disponible : ${formatCurrency(summary.reservation_fee.available, summary.currency)}`} />
          </SalesKpiGrid>
          <SalesDataTable
            rowKey={(item) => `${item.id ?? item.sequence_number}-${item.invoice_id ?? 'none'}`}
            rows={summary.installments.slice(0, 4)}
            columns={[
              { key: 'label', label: 'Échéance', render: (item) => item.label || `Échéance ${item.sequence_number}` },
              { key: 'date', label: 'Date', render: (item) => formatDate(item.due_date) },
              { key: 'amount', label: 'Montant', render: (item) => formatCurrency(item.amount, item.currency) },
              { key: 'paid', label: 'Payé', render: (item) => formatCurrency(item.paid_amount ?? 0, item.currency) },
              { key: 'balance', label: 'Solde', render: (item) => formatCurrency(item.balance_due ?? item.amount, item.currency) },
              { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={installmentFinancialStatusLabel(item.financial_status)} tone={getStatusTone(item.financial_status)} /> },
            ]}
          />
        </>
      ) : null}
    </SalesSection>
  );
}

export function SalesSubscriptionFinancialV32Page() {
  const { id } = useParams();
  const subscriptionId = Number(id);
  const [summary, setSummary] = useState<SalesSubscriptionFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesSubscriptionFinancialSummary(subscriptionId);
        if (!cancelled) setSummary(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (subscriptionId) void load();
    return () => {
      cancelled = true;
    };
  }, [subscriptionId]);

  return (
    <SalesModulePage
      title={`Situation financière ${summary?.subscription_number || ''}`.trim()}
      subtitle="Solde global, échéancier réel et exposition au retard calculés côté backend."
      activeTab="subscriptions"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/subscriptions/${subscriptionId}`}>Retour à la souscription</Link>}
    >
      {loading ? <SalesInlineNotice>Chargement des données financières…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {summary ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Prix final" value={formatCurrency(summary.final_sale_price, summary.currency)} helper={`Acompte prévu : ${formatCurrency(summary.deposit_expected, summary.currency)}`} />
            <SalesKpiCard label="Encaissements" value={formatCurrency(summary.total_paid, summary.currency)} helper={`Remboursé : ${formatCurrency(summary.total_refunded, summary.currency)}`} />
            <SalesKpiCard label="Montant échu" value={formatCurrency(summary.amount_due, summary.currency)} helper={`En retard : ${formatCurrency(summary.overdue_amount, summary.currency)}`} />
            <SalesKpiCard label="Échéances" value={`${summary.installments_paid}/${summary.installments.length}`} helper={`${summary.installments_overdue} en retard`} />
          </SalesKpiGrid>

          <SalesSection title="Résumé financier" description="Vision consolidée de la souscription et des frais de réservation.">
            <SalesDataTable
              rowKey={(item) => item.label}
              rows={[
                { label: 'Total facturé', value: formatCurrency(summary.total_invoiced, summary.currency) },
                { label: 'Solde restant global', value: formatCurrency(summary.global_balance_due, summary.currency) },
                { label: 'Frais encaissés', value: formatCurrency(summary.reservation_fee.paid, summary.currency) },
                { label: 'Frais affectés', value: formatCurrency(summary.reservation_fee.allocated, summary.currency) },
              ]}
              columns={[
                { key: 'label', label: 'Indicateur', render: (item) => item.label },
                { key: 'value', label: 'Valeur', render: (item) => item.value },
              ]}
            />
          </SalesSection>

          <SalesSection title="Échéancier compact" description="Chaque ligne affiche l’état financier réel et l’accès direct à la facture liée.">
            <SalesDataTable
              rowKey={(item) => `${item.id ?? item.sequence_number}-${item.invoice_id ?? 'none'}`}
              rows={summary.installments}
              columns={[
                { key: 'sequence', label: '#', render: (item) => item.sequence_number },
                { key: 'label', label: 'Libellé', render: (item) => item.label || `Échéance ${item.sequence_number}` },
                { key: 'date', label: 'Échéance', render: (item) => formatDate(item.due_date) },
                { key: 'amount', label: 'Montant', render: (item) => formatCurrency(item.amount, item.currency) },
                { key: 'invoice', label: 'Facture', render: (item) => item.invoice_id ? <Link to={`/sales/invoices/${item.invoice_id}`}>{item.invoice_number || 'Ouvrir'}</Link> : 'Non générée' },
                { key: 'paid', label: 'Payé', render: (item) => formatCurrency(item.paid_amount ?? 0, item.currency) },
                { key: 'balance', label: 'Solde', render: (item) => formatCurrency(item.balance_due ?? item.amount, item.currency) },
                { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={installmentFinancialStatusLabel(item.financial_status)} tone={getStatusTone(item.financial_status)} /> },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (item) => item.invoice_id ? (
                    <Link className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" to={`/sales/invoices/${item.invoice_id}`}>
                      Voir la facture
                    </Link>
                  ) : (
                    <InvoiceGenerateButton subscriptionId={summary.subscription_id} installmentId={Number(item.id)} />
                  ),
                },
              ]}
            />
          </SalesSection>
        </>
      ) : null}
    </SalesModulePage>
  );
}

function InvoiceGenerateButton({ subscriptionId, installmentId }: { subscriptionId: number; installmentId: number }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact"
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const invoice = await generateSalesInvoice(subscriptionId, installmentId);
          navigate(`/sales/invoices/${invoice.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Génération…' : 'Générer la facture'}
    </button>
  );
}

export function SalesInvoicesV32Page() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesInvoices({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'due_date',
          sortOrder: 'desc',
        });
        if (!cancelled) setItems(response.items);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [search, status]);

  return (
    <SalesModulePage
      title="Factures"
      subtitle="Facturation des échéances, encaissements et suivi des soldes de souscription."
      activeTab="invoices"
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      <SalesKpiGrid>
        <SalesKpiCard label="Total" value={items.length} helper="factures visibles" />
        <SalesKpiCard label="En retard" value={items.filter((item) => item.status === 'OVERDUE').length} helper="à suivre" />
        <SalesKpiCard label="Payées" value={items.filter((item) => item.status === 'PAID').length} helper="soldées" />
        <SalesKpiCard label="Partielles" value={items.filter((item) => item.status === 'PARTIALLY_PAID').length} helper="reste à encaisser" />
      </SalesKpiGrid>
      <SalesSection title="Liste des factures" description="Tableau compact des échéances facturées avec solde et statut.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher une facture" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="DRAFT">Brouillon</option>
            <option value="ISSUED">Émise</option>
            <option value="PARTIALLY_PAID">Partiellement payée</option>
            <option value="PAID">Payée</option>
            <option value="OVERDUE">En retard</option>
            <option value="CANCELLED">Annulée</option>
          </select>
        </SalesFilterBar>
        {loading ? <SalesInlineNotice>Chargement des factures…</SalesInlineNotice> : null}
        {!loading && !items.length ? (
          <SalesEmptyState title="Aucune facture générée" description="Les factures apparaîtront ici dès qu’une échéance sera matérialisée." />
        ) : null}
        {!!items.length && (
          <SalesDataTable
            rowKey={(item) => item.id}
            rows={items}
            rowHref={(item) => `/sales/invoices/${item.id}`}
            rowAriaLabel={(item) => `Ouvrir la facture ${item.invoice_number}`}
            columns={[
              {
                key: 'number',
                label: 'Numéro',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.invoice_number}</strong>
                    <span className="sales-v21-cell-subtitle">{item.subscription_number || 'Souscription'}</span>
                  </div>
                ),
              },
              { key: 'buyer', label: 'Acquéreur', render: (item) => item.buyer_name || 'Donnée non disponible' },
              { key: 'asset', label: 'Bien', render: (item) => item.catalog_title || 'Donnée non disponible' },
              { key: 'issue', label: 'Émission', render: (item) => formatDate(item.issue_date) },
              { key: 'due', label: 'Échéance', render: (item) => formatDate(item.due_date) },
              { key: 'total', label: 'Total', render: (item) => formatCurrency(item.total_amount, item.currency) },
              { key: 'paid', label: 'Payé', render: (item) => formatCurrency(item.paid_amount, item.currency) },
              { key: 'balance', label: 'Solde', render: (item) => formatCurrency(item.balance_due, item.currency) },
              { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={invoiceStatusLabel(item.status)} tone={getStatusTone(item.status)} /> },
            ]}
          />
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesInvoiceDetailV32Page() {
  const { id } = useParams();
  const invoiceId = Number(id);
  const { can } = useAuth();
  const [invoice, setInvoice] = useState<SalesInvoice | null>(null);
  const [paymentForm, setPaymentForm] = useState<InvoicePaymentFormState>(emptyPaymentForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<ReasonDialogState | null>(null);
  const [reminders, setReminders] = useState<SalesInvoiceReminder[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [response, remindersResponse] = await Promise.all([
          getSalesInvoice(invoiceId),
          listSalesInvoiceReminders(invoiceId).catch(() => []),
        ]);
        if (!cancelled) {
          setInvoice(response);
          setPaymentForm(emptyPaymentForm(response));
          setReminders(remindersResponse);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (invoiceId) void load();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  const canCollect = can('sales_payments.create');
  const canCancelInvoice = can('sales_invoices.cancel');
  const canCollectOnInvoice = Boolean(
    invoice
    && Number(invoice.balance_due ?? 0) > 0
    && ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(String(invoice.status ?? '').toUpperCase()),
  );

  const invoiceDocuments = useMemo(() => invoice?.documents ?? [], [invoice]);

  async function refreshInvoice() {
    const [response, remindersResponse] = await Promise.all([
      getSalesInvoice(invoiceId),
      listSalesInvoiceReminders(invoiceId).catch(() => reminders),
    ]);
    setInvoice(response);
    setPaymentForm(emptyPaymentForm(response));
    setReminders(remindersResponse);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!invoice) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentFormError('Saisissez un montant supérieur à zéro.');
      return;
    }
    if (amount > Number(invoice.balance_due ?? 0)) {
      setPaymentFormError('Le paiement dépasse le solde restant.');
      return;
    }
    if (paymentForm.destination_type === 'CASH' && !paymentForm.cash_session_id) {
      setPaymentFormError('Sélectionnez une session de caisse ouverte.');
      return;
    }
    if (paymentForm.destination_type === 'BANK' && !paymentForm.bank_account_id) {
      setPaymentFormError('Sélectionnez un compte bancaire compatible.');
      return;
    }
    const payload: CreateSalesReservationPaymentInput = {
      amount,
      payment_date: paymentForm.payment_date,
      payment_method: paymentForm.payment_method,
      destination_type: paymentForm.destination_type,
      cash_session_id: paymentForm.destination_type === 'CASH' ? Number(paymentForm.cash_session_id) : undefined,
      bank_account_id: paymentForm.destination_type === 'BANK' ? Number(paymentForm.bank_account_id) : undefined,
      external_reference: trimOrUndefined(paymentForm.external_reference),
      notes: trimOrUndefined(paymentForm.notes),
      idempotency_key: paymentForm.idempotency_key,
    };
    setSaving(true);
    setError(null);
    setPaymentFormError(null);
    try {
      const response = await createSalesInvoicePayment(invoiceId, payload);
      setInvoice(response);
      setPaymentForm(emptyPaymentForm(response));
    } catch (submitError) {
      const message = getErrorMessage(submitError);
      setError(message);
      setPaymentFormError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={invoice?.invoice_number || 'Facture'}
      subtitle="Détail compact de la facture, des encaissements, des documents et du solde client."
      activeTab="invoices"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/invoices">Retour aux factures</Link>}
    >
      {loading ? <SalesInlineNotice>Chargement de la facture…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {invoice ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Montant total" value={formatCurrency(invoice.total_amount, invoice.currency)} helper={invoice.buyer_name || 'Acquéreur'} />
            <SalesKpiCard label="Déjà payé" value={formatCurrency(invoice.paid_amount, invoice.currency)} helper={`Remboursé : ${formatCurrency(invoice.refunded_amount, invoice.currency)}`} />
            <SalesKpiCard label="Solde" value={formatCurrency(invoice.balance_due, invoice.currency)} helper={`Échéance : ${formatDate(invoice.due_date)}`} />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={invoiceStatusLabel(invoice.status)} tone={getStatusTone(invoice.status)} />} helper={invoice.subscription_number || 'Souscription'} />
          </SalesKpiGrid>

          <SalesSection
            title="Actions facture"
            description="Émission, annulation, régénération du PDF et envoi journalisé."
            action={
              <div className="sales-v21-table-actions">
                {invoice.status === 'DRAFT' ? (
                  <button className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact" type="button" onClick={() => void issueSalesInvoice(invoice.id).then(setInvoice).catch((actionError) => setError(getErrorMessage(actionError)))}>
                    Émettre
                  </button>
                ) : null}
                <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void regenerateSalesInvoiceDocument(invoice.id).then(setInvoice).catch((actionError) => setError(getErrorMessage(actionError)))}>
                  Régénérer le PDF
                </button>
                <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void sendSalesInvoice(invoice.id).then(setInvoice).catch((actionError) => setError(getErrorMessage(actionError)))}>
                  Envoyer
                </button>
                {canCancelInvoice && invoice.status !== 'CANCELLED' ? (
                  <button
                    className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact"
                    type="button"
                    onClick={() => setReasonDialog({
                      title: 'Annuler la facture',
                      description: 'Cette action annule le document sans supprimer l’historique ni les audits.',
                      confirmLabel: 'Annuler la facture',
                      reason: '',
                      error: null,
                      busy: false,
                      handler: async (reason) => {
                        const response = await cancelSalesInvoice(invoice.id, { reason });
                        setInvoice(response);
                      },
                    })}
                  >
                    Annuler
                  </button>
                ) : null}
              </div>
            }
          >
            <SalesDataTable
              rowKey={(item) => item.label}
              rows={[
                { label: 'Souscription', value: invoice.subscription_number || '—' },
                { label: 'Bien', value: invoice.catalog_title || '—' },
                { label: 'Projet', value: invoice.project_name || '—' },
                { label: 'Échéance', value: invoice.installment_label || `Échéance ${invoice.installment_sequence_number ?? '—'}` },
              ]}
              columns={[
                { key: 'label', label: 'Champ', render: (item) => item.label },
                { key: 'value', label: 'Valeur', render: (item) => item.value },
              ]}
            />
          </SalesSection>

          <SalesSection title="Communications et relances" description="Historique compact des événements d’émission, rappels et relances attachés à cette facture.">
            {reminders.length ? (
              <SalesDataTable
                rowKey={(item) => item.id}
                rows={reminders}
                columns={[
                  { key: 'id', label: 'ID', render: (item) => item.id },
                  { key: 'type', label: 'Type', render: (item) => item.reminder_type },
                  { key: 'stage', label: 'Étape', render: (item) => item.reminder_stage || '—' },
                  { key: 'date', label: 'Date', render: (item) => formatDate(item.sent_at || item.scheduled_for) },
                  { key: 'channel', label: 'Canal', render: (item) => item.channel || 'EMAIL' },
                  { key: 'recipient', label: 'Destinataire', render: (item) => item.masked_recipient || 'Destinataire indisponible' },
                  { key: 'log', label: 'Journal', render: (item) => item.communication_log_id ?? '—' },
                  { key: 'log-status', label: 'Statut log', render: (item) => item.communication_status || '—' },
                  { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={item.status} tone={getStatusTone(item.status)} /> },
                  { key: 'error', label: 'Erreur', render: (item) => item.failure_message || item.communication_subject || '—' },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucune relance enregistrée" description="Les rappels automatiques et les renvois manuels apparaîtront ici après la migration V3.3." />
            )}
            {can('sales_reminders.send') ? (
              <div className="sales-v21-table-actions">
                <button
                  className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                  type="button"
                  onClick={async () => {
                    try {
                      await sendSalesInvoiceReminder(invoice.id, { reminder_type: 'UPCOMING_DUE', reminder_stage: 'MANUAL', reason: 'Relance manuelle depuis le détail facture' });
                      await refreshInvoice();
                    } catch (actionError) {
                      setError(getErrorMessage(actionError));
                    }
                  }}
                >
                  Déclencher une relance
                </button>
              </div>
            ) : null}
          </SalesSection>

          <div className="sales-v21-two-columns">
            <SalesSection title="Historique des encaissements" description="Paiements partiels ou complets affectés à cette facture.">
              {invoice.payments?.length ? (
                <SalesDataTable
                  rowKey={(item) => item.id}
                  rows={invoice.payments}
                  columns={[
                    { key: 'number', label: 'Paiement', render: (item) => item.payment_number },
                    { key: 'date', label: 'Date', render: (item) => formatDate(item.payment_date) },
                    { key: 'method', label: 'Mode', render: (item) => item.payment_method },
                    { key: 'amount', label: 'Montant', render: (item) => formatCurrency(item.amount, item.currency) },
                    { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={invoiceStatusLabel(item.status)} tone={getStatusTone(item.status)} /> },
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (item) => (
                        <div className="sales-v21-table-actions">
                          {item.receipt_document_id ? (
                            <button
                              className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                              type="button"
                              onClick={() => void triggerDocumentDownload({
                                id: Number(item.receipt_document_id),
                                organization_id: invoice.organization_id,
                                entity_type: 'SALES_INVOICE_PAYMENT',
                                entity_id: item.id,
                                template_type: 'SALES_INVOICE_RECEIPT',
                                document_number: item.payment_number,
                                file_name: `${item.payment_number}.pdf`,
                              })}
                            >
                              Télécharger le reçu
                            </button>
                          ) : null}
                          <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void regenerateSalesInvoicePaymentReceipt(item.id).then(setInvoice).catch((actionError) => setError(getErrorMessage(actionError)))}>
                            Régénérer le reçu
                          </button>
                          {can('sales_payments.cancel') && item.status !== 'CANCELLED' ? (
                            <button
                              className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact"
                              type="button"
                              onClick={() => setReasonDialog({
                                title: 'Annuler le paiement',
                                description: 'Une écriture inverse sera utilisée si la politique métier l’autorise.',
                                confirmLabel: 'Annuler le paiement',
                                reason: '',
                                error: null,
                                busy: false,
                                handler: async (reason) => {
                                  const response = await cancelSalesInvoicePayment(item.id, { reason });
                                  setInvoice(response);
                                },
                              })}
                            >
                              Annuler
                            </button>
                          ) : null}
                          {can('sales_payments.refund') && item.status !== 'CANCELLED' ? (
                            <button
                              className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                              type="button"
                              onClick={async () => {
                                const payload: CreateSalesReservationRefundInput = {
                                  amount: Number(item.available_refundable_amount ?? item.amount),
                                  refund_date: todayInput(),
                                  refund_method: item.payment_method,
                                  destination_type: item.destination_type,
                                  reason: 'Remboursement partiel V3.2',
                                };
                                try {
                                  const response = await refundSalesInvoicePayment(item.id, payload);
                                  setInvoice(response);
                                } catch (actionError) {
                                  setError(getErrorMessage(actionError));
                                }
                              }}
                            >
                              Rembourser
                            </button>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                />
              ) : (
                <SalesEmptyState title="Aucun paiement enregistré" description="Les encaissements apparaîtront ici dès le premier règlement." />
              )}
            </SalesSection>

            <SalesSection title="Encaisser la facture" description="Paiement partiel ou complet, vers caisse ou banque, avec contrôles métier.">
              {canCollect && canCollectOnInvoice ? (
                <form className="sales-v21-form" onSubmit={submitPayment}>
                  {paymentFormError ? <SalesInlineNotice tone="danger">{paymentFormError}</SalesInlineNotice> : null}
                  <SalesField label="Montant">
                    <input className="sales-v21-input" type="number" min="0" step="0.01" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} />
                  </SalesField>
                  <SalesField label="Date de paiement">
                    <input className="sales-v21-input" type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_date: event.target.value }))} />
                  </SalesField>
                  <SalesField label="Mode">
                    <select
                      className="sales-v21-select"
                      value={paymentForm.payment_method}
                      onChange={(event) => {
                        const nextMethod = event.target.value;
                        setPaymentForm((current) => ({
                          ...current,
                          payment_method: nextMethod,
                          destination_type: nextMethod === 'BANK' ? 'BANK' : nextMethod === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : nextMethod === 'OTHER' ? 'OTHER' : 'CASH',
                        }));
                      }}
                    >
                      {SALES_RESERVATION_PAYMENT_METHODS.map((entry) => <option key={entry} value={entry}>{reservationPaymentMethodLabel(entry)}</option>)}
                    </select>
                  </SalesField>
                  <SalesField label="Destination">
                    <select className="sales-v21-select" value={paymentForm.destination_type} onChange={(event) => setPaymentForm((current) => ({ ...current, destination_type: event.target.value }))}>
                      {SALES_RESERVATION_DESTINATION_TYPES.map((entry) => <option key={entry} value={entry}>{reservationPaymentMethodLabel(entry)}</option>)}
                    </select>
                  </SalesField>
                  {paymentForm.destination_type === 'CASH' ? (
                    <SalesField label="Session de caisse">
                      <select className="sales-v21-select" value={paymentForm.cash_session_id} onChange={(event) => setPaymentForm((current) => ({ ...current, cash_session_id: event.target.value }))}>
                        <option value="">Sélectionner</option>
                        {(invoice.payment_destinations?.cash_sessions ?? []).map((entry: SalesReservationPaymentDestination) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                      </select>
                    </SalesField>
                  ) : null}
                  {paymentForm.destination_type === 'BANK' ? (
                    <SalesField label="Compte bancaire">
                      <select className="sales-v21-select" value={paymentForm.bank_account_id} onChange={(event) => setPaymentForm((current) => ({ ...current, bank_account_id: event.target.value }))}>
                        <option value="">Sélectionner</option>
                        {(invoice.payment_destinations?.bank_accounts ?? []).map((entry: SalesReservationPaymentDestination) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                      </select>
                    </SalesField>
                  ) : null}
                  <SalesField label="Référence externe">
                    <input className="sales-v21-input" value={paymentForm.external_reference} onChange={(event) => setPaymentForm((current) => ({ ...current, external_reference: event.target.value, idempotency_key: createPaymentIntentKey(invoice.id) }))} />
                  </SalesField>
                  <SalesField label="Notes">
                    <textarea className="sales-v21-textarea" rows={4} value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} />
                  </SalesField>
                  <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Encaissement…' : 'Encaisser'}</button>
                </form>
              ) : canCollect ? (
                <SalesEmptyState
                  title="Encaissement indisponible"
                  description={invoice?.status === 'DRAFT' ? 'Émettez d’abord la facture avant de saisir un paiement.' : 'Cette facture ne peut plus recevoir de paiement.'}
                />
              ) : (
                <SalesEmptyState title="Accès restreint" description="Votre rôle ne permet pas d’enregistrer un paiement sur cette facture." />
              )}
            </SalesSection>
          </div>

          <SalesSection title="Documents" description="PDF de facture et reçus régénérables sans créer de doublon métier.">
            {invoiceDocuments.length ? (
              <SalesDataTable
                rowKey={(item) => item.id}
                rows={invoiceDocuments}
                columns={[
                  { key: 'number', label: 'Document', render: (item) => item.document_number || item.file_name || `Document ${item.id}` },
                  { key: 'type', label: 'Type', render: (item) => item.template_type || 'PDF' },
                  { key: 'status', label: 'Statut', render: (item) => item.generation_status || 'Généré' },
                  { key: 'date', label: 'Date', render: (item) => formatDate(item.generated_at || item.created_at) },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (item) => (
                      <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void triggerDocumentDownload(item)}>
                        Télécharger
                      </button>
                    ),
                  },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucun document" description="Le PDF apparaîtra ici après la première génération." />
            )}
          </SalesSection>
        </>
      ) : null}

      <SalesActionDialog
        open={Boolean(reasonDialog)}
        title={reasonDialog?.title || 'Confirmer'}
        description={reasonDialog?.description || ''}
        confirmLabel={reasonDialog?.confirmLabel || 'Confirmer'}
        reason={reasonDialog?.reason || ''}
        error={reasonDialog?.error || null}
        busy={Boolean(reasonDialog?.busy)}
        onReasonChange={(value) => setReasonDialog((current) => current ? { ...current, reason: value } : null)}
        onCancel={() => setReasonDialog(null)}
        onConfirm={() => {
          if (!reasonDialog) return;
          const trimmed = reasonDialog.reason.trim();
          if (!trimmed) {
            setReasonDialog((current) => current ? { ...current, error: 'Un motif est obligatoire.' } : null);
            return;
          }
          setReasonDialog((current) => current ? { ...current, busy: true, error: null } : null);
          void reasonDialog.handler(trimmed)
            .then(() => refreshInvoice())
            .then(() => setReasonDialog(null))
            .catch((actionError) => {
              setReasonDialog((current) => current ? { ...current, busy: false, error: getErrorMessage(actionError) } : null);
            });
        }}
      />
    </SalesModulePage>
  );
}
