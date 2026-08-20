import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../core/auth/AuthContext';
import {
  approveSalesSubscription,
  cancelSalesReservation,
  cancelSalesReservationPayment,
  cancelSalesSubscription,
  confirmSalesReservation,
  createSalesReservationPayment,
  createSalesReservationRefund,
  convertSalesReservation,
  createSalesReservation,
  createSalesSubscription,
  createSalesDocumentTemplate,
  downloadSalesDocument,
  expireSalesReservation,
  getSalesReservation,
  getSalesSettings,
  getSalesSubscription,
  regenerateSalesReservationPaymentReceipt,
  listSalesDocumentTemplates,
  listSalesBuyers,
  listSalesCatalog,
  listSalesProjects,
  listSalesReservations,
  listSalesSubscriptions,
  regenerateSalesReservationDocument,
  regenerateSalesSubscriptionDocument,
  rejectSalesSubscription,
  simulateSalesSubscription,
  submitSalesSubscription,
  updateSalesDocumentTemplate,
  updateSalesSettings,
  updateSalesReservation,
  updateSalesSubscription,
} from '../api/sales.api';
import {
  SALES_DEPOSIT_TYPES,
  SALES_RESERVATION_DESTINATION_TYPES,
  SALES_RESERVATION_PAYMENT_METHODS,
  SALES_RESERVATION_STATUSES,
  SALES_SCHEDULE_FREQUENCIES,
  SALES_SUBSCRIPTION_ORIGIN_MODES,
  SALES_SUBSCRIPTION_STATUSES,
  SALES_SUPPORTED_CURRENCIES,
  type CreateSalesReservationInput,
  type CreateSalesReservationPaymentInput,
  type CreateSalesReservationRefundInput,
  type CreateSalesSubscriptionInput,
  type CustomInstallmentInput,
  type SalesBuyer,
  type SalesCatalogItem,
  type SalesDocumentGeneration,
  type SalesDocumentTemplate,
  type SalesDocumentTemplatePayload,
  type SalesProject,
  type SalesReservation,
  type SalesReservationPayment,
  type SalesSettings,
  type SalesSubscription,
  type SalesSubscriptionInstallment,
  type SalesSubscriptionSimulation,
} from '../types';
import {
  SalesActionDialog,
  SalesDataTable,
  SalesEmptyState,
  SalesField,
  SalesFilterBar,
  SalesFormActions,
  SalesFormSection,
  SalesInfoList,
  SalesInlineNotice,
  SalesKpiCard,
  SalesKpiGrid,
  SalesModulePage,
  SalesSection,
  SalesStatusBadge,
  SalesSubNavigation,
  type SalesStatusTone,
} from '../components/SalesUi';

type ReservationFormState = {
  reservation_number: string;
  buyer_id: string;
  catalog_item_id: string;
  project_id: string;
  status: string;
  currency: string;
  catalog_price: string;
  negotiated_price: string;
  reservation_fee: string;
  reservation_date: string;
  expires_at: string;
  notes: string;
};

type SubscriptionFormState = {
  subscription_number: string;
  origin_mode: string;
  reservation_id: string;
  buyer_id: string;
  catalog_item_id: string;
  project_id: string;
  status: string;
  currency: string;
  catalog_price: string;
  negotiated_price: string;
  discount_amount: string;
  deposit_type: string;
  deposit_percentage: string;
  deposit_amount: string;
  installment_count: string;
  frequency: string;
  first_due_date: string;
  grace_period_days: string;
  notes: string;
  custom_installments: CustomInstallmentInput[];
};

type ReservationPaymentFormState = {
  amount: string;
  payment_date: string;
  payment_method: string;
  destination_type: string;
  cash_session_id: string;
  bank_account_id: string;
  external_reference: string;
  notes: string;
};

type ReservationRefundFormState = {
  amount: string;
  refund_date: string;
  refund_method: string;
  destination_type: string;
  cash_session_id: string;
  bank_account_id: string;
  reason: string;
  external_reference: string;
  notes: string;
};

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  CONFIRMED: 'Confirmée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
  CONVERTED: 'Convertie',
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Soumise',
  APPROVED: 'Approuvée',
  REJECTED: 'Rejetée',
  CONVERTED: 'Convertie',
  CANCELLED: 'Annulée',
};

const RESERVATION_PAYMENT_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmé',
  CANCELLED: 'Annulé',
  PARTIALLY_REFUNDED: 'Partiellement remboursé',
  REFUNDED: 'Remboursé',
};

const RESERVATION_PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Caisse',
  BANK: 'Banque',
  MOBILE_MONEY: 'Mobile money',
  OTHER: 'Autre',
};

type SalesDetailAction = {
  key: string;
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

const TEMPLATE_PREVIEW_ALLOWED_TAGS = new Set([
  'a', 'article', 'br', 'div', 'em', 'footer', 'h1', 'h2', 'h3', 'h4', 'header', 'hr',
  'li', 'ol', 'p', 'section', 'small', 'span', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
]);
const TEMPLATE_PREVIEW_ALLOWED_ATTRIBUTES = new Set(['class', 'colspan', 'href', 'rel', 'rowspan', 'scope', 'target']);
const TEMPLATE_PREVIEW_FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
  CUSTOM: 'Personnalisée',
};
const TEMPLATE_PREVIEW_ORIGIN_LABELS: Record<string, string> = {
  DIRECT: 'Souscription directe',
  RESERVATION: 'Issue d’une réservation',
};

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

function buildActionClassName(tone: SalesDetailAction['tone']) {
  if (tone === 'primary') return 'sales-v21-btn sales-v21-btn-primary sales-v21-action-btn';
  if (tone === 'danger') return 'sales-v21-btn sales-v21-btn-danger sales-v21-action-btn';
  return 'sales-v21-btn sales-v21-btn-secondary sales-v21-action-btn';
}

function SalesDetailActionsCard({
  primaryAction,
  editHref,
  secondaryActions,
  hint,
}: {
  primaryAction?: SalesDetailAction | null;
  editHref?: string | null;
  secondaryActions: SalesDetailAction[];
  hint: string;
}) {
  if (!primaryAction && !editHref && !secondaryActions.length) {
    return null;
  }

  return (
    <div className="sales-v21-action-stack">
      <div className="sales-v21-action-row">
        {primaryAction ? (
          primaryAction.href ? (
            <Link className={buildActionClassName(primaryAction.tone)} to={primaryAction.href}>
              {primaryAction.label}
            </Link>
          ) : (
            <button className={buildActionClassName(primaryAction.tone)} type="button" disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          )
        ) : null}
        {editHref ? (
          <Link className="sales-v21-btn sales-v21-btn-secondary sales-v21-action-btn" to={editHref}>
            Modifier
          </Link>
        ) : null}
        {secondaryActions.length ? (
          <details className="sales-v21-action-menu">
            <summary className="sales-v21-btn sales-v21-btn-ghost sales-v21-action-btn sales-v21-action-menu-trigger">
              Plus d’actions
            </summary>
            <div className="sales-v21-action-menu-panel">
              {secondaryActions.map((action) => (
                action.href ? (
                  <Link key={action.key} className={buildActionClassName(action.tone)} to={action.href}>
                    {action.label}
                  </Link>
                ) : (
                  <button key={action.key} className={buildActionClassName(action.tone)} type="button" disabled={action.disabled} onClick={action.onClick}>
                    {action.label}
                  </button>
                )
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <p className="sales-v21-action-hint">{hint}</p>
    </div>
  );
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
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
    maximumFractionDigits: 0,
  }).format(value);
}

function reservationFeeDeductibilityLabel(value?: string | null) {
  if (!value) return '—';
  if (value === 'DEDUCTIBLE') return 'Déductibles';
  if (value === 'NON_DEDUCTIBLE') return 'Non déductibles';
  if (value === 'PARTIALLY_DEDUCTIBLE') return 'Partiellement déductibles';
  return value;
}

function salesFrequencyLabel(value?: string | null) {
  if (!value) return '—';
  if (value === 'MONTHLY') return 'Mensuelle';
  if (value === 'QUARTERLY') return 'Trimestrielle';
  if (value === 'CUSTOM') return 'Personnalisée';
  return value;
}

function accountingTreatmentLabel(value?: string | null) {
  if (!value) return '—';
  if (value === 'CUSTOMER_ADVANCE') return 'Avance client';
  if (value === 'RESERVATION_FEE_REVENUE') return 'Produit des frais de réservation';
  return value;
}

function boolSettingLabel(value?: boolean | null) {
  return value ? 'Activée' : 'Désactivée';
}

function buildNumberingExample(format?: string | null, fallback = 'SALES-2026-0001') {
  if (!format?.trim()) return fallback;
  return format
    .replace(/\{\{\s*YYYY\s*\}\}/gi, '2026')
    .replace(/\{\{\s*YY\s*\}\}/gi, '26')
    .replace(/\{\{\s*MM\s*\}\}/gi, '08')
    .replace(/\{\{\s*ORG\s*\}\}/gi, 'SAL')
    .replace(/\{\{\s*SEQ(?::\d+)?\s*\}\}/gi, '0001')
    .replace(/\bYYYY\b/g, '2026')
    .replace(/\bYY\b/g, '26')
    .replace(/\bMM\b/g, '08')
    .replace(/\bORG\b/g, 'SAL')
    .replace(/\bSEQ\b/g, '0001')
    .replace(/#+/g, (match) => '0'.repeat(Math.max(match.length - 1, 0)) + '1');
}

function hasPreviewHtmlMarkup(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function isSafePreviewUrl(value: string) {
  return /^(https?:|mailto:|tel:|#|\/)/i.test(value);
}

function sanitizePreviewMarkup(markup: string) {
  const withoutDangerousBlocks = markup
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*\/?\s*>/gi, '');

  return withoutDangerousBlocks.replace(/<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi, (_, closing: string, tagName: string, rawAttributes: string) => {
    const tag = tagName.toLowerCase();
    if (!TEMPLATE_PREVIEW_ALLOWED_TAGS.has(tag)) return '';
    if (closing) return `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;

    const attributes: string[] = [];
    rawAttributes.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (_, name: string, __: string, quotedDouble: string, quotedSingle: string, unquoted: string) => {
      const attributeName = name.toLowerCase();
      if (!TEMPLATE_PREVIEW_ALLOWED_ATTRIBUTES.has(attributeName) || attributeName.startsWith('on')) return '';
      const rawValue = quotedDouble ?? quotedSingle ?? unquoted ?? '';
      if ((attributeName === 'href' || attributeName === 'src') && !isSafePreviewUrl(rawValue)) return '';
      if (attributeName === 'target' && rawValue !== '_blank') return '';
      if (attributeName === 'rel') {
        attributes.push('rel="noopener noreferrer"');
        return '';
      }
      attributes.push(`${attributeName}="${escapePreviewHtml(rawValue)}"`);
      return '';
    });
    if (rawAttributes && /target\s*=\s*(['"]?)_blank\1/i.test(rawAttributes) && !attributes.some((attribute) => attribute.startsWith('rel='))) {
      attributes.push('rel="noopener noreferrer"');
    }
    return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
  });
}

function renderPlainTextPreviewMarkup(value: string) {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapePreviewHtml).join('<br />')}</p>`)
    .join('\n');
}

async function triggerDocumentDownload(document: SalesDocumentGeneration) {
  const blob = await downloadSalesDocument(document.id);
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.file_name || `${document.document_number}.pdf`;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getStatusTone(status?: string | null): SalesStatusTone {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
    case 'CONFIRMED':
    case 'APPROVED':
      return 'success';
    case 'DRAFT':
    case 'SUBMITTED':
    case 'RESERVED':
      return 'warning';
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'danger';
    case 'CONVERTED':
    case 'SOLD':
      return 'neutral';
    default:
      return 'info';
  }
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function nextWeekInput() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function emptyReservationForm(): ReservationFormState {
  return {
    reservation_number: '',
    buyer_id: '',
    catalog_item_id: '',
    project_id: '',
    status: 'ACTIVE',
    currency: 'USD',
    catalog_price: '',
    negotiated_price: '',
    reservation_fee: '',
    reservation_date: todayInput(),
    expires_at: nextWeekInput(),
    notes: '',
  };
}

function emptySubscriptionForm(): SubscriptionFormState {
  return {
    subscription_number: '',
    origin_mode: 'DIRECT',
    reservation_id: '',
    buyer_id: '',
    catalog_item_id: '',
    project_id: '',
    status: 'DRAFT',
    currency: 'USD',
    catalog_price: '',
    negotiated_price: '',
    discount_amount: '',
    deposit_type: 'PERCENTAGE',
    deposit_percentage: '20',
    deposit_amount: '',
    installment_count: '12',
    frequency: 'MONTHLY',
    first_due_date: todayInput(),
    grace_period_days: '0',
    notes: '',
    custom_installments: [],
  };
}

function mapReservationToForm(item: SalesReservation): ReservationFormState {
  return {
    reservation_number: item.reservation_number ?? '',
    buyer_id: String(item.buyer_id),
    catalog_item_id: String(item.catalog_item_id),
    project_id: item.project_id ? String(item.project_id) : '',
    status: item.status ?? 'ACTIVE',
    currency: item.currency ?? 'USD',
    catalog_price: String(item.catalog_price ?? ''),
    negotiated_price: String(item.negotiated_price ?? ''),
    reservation_fee: item.reservation_fee != null ? String(item.reservation_fee) : '',
    reservation_date: item.reservation_date?.slice(0, 10) ?? todayInput(),
    expires_at: item.expires_at?.slice(0, 10) ?? nextWeekInput(),
    notes: item.notes ?? '',
  };
}

function mapSubscriptionToForm(item: SalesSubscription): SubscriptionFormState {
  const inferredDiscount = item.discount_amount != null
    ? item.discount_amount
    : Math.max(0, Number(item.catalog_price ?? 0) - Number(item.final_sale_price ?? 0));

  return {
    subscription_number: item.subscription_number ?? '',
    origin_mode: item.reservation_id ? 'RESERVATION' : 'DIRECT',
    reservation_id: item.reservation_id ? String(item.reservation_id) : '',
    buyer_id: String(item.buyer_id),
    catalog_item_id: String(item.catalog_item_id),
    project_id: item.project_id ? String(item.project_id) : '',
    status: item.status ?? 'DRAFT',
    currency: item.currency ?? 'USD',
    catalog_price: String(item.catalog_price ?? ''),
    negotiated_price: String(item.final_sale_price ?? ''),
    discount_amount: inferredDiscount ? String(inferredDiscount) : '',
    deposit_type: item.deposit_type ?? 'PERCENTAGE',
    deposit_percentage: item.deposit_percentage != null ? String(item.deposit_percentage) : '',
    deposit_amount: item.deposit_amount != null ? String(item.deposit_amount) : '',
    installment_count: String(item.installment_count ?? 0),
    frequency: item.frequency ?? 'MONTHLY',
    first_due_date: item.first_due_date?.slice(0, 10) ?? todayInput(),
    grace_period_days: item.grace_period_days != null ? String(item.grace_period_days) : '0',
    notes: item.notes ?? '',
    custom_installments: (item.installments ?? [])
      .filter((installment) => installment.installment_type !== 'DEPOSIT')
      .map((installment) => ({
        sequence_number: installment.sequence_number,
        label: installment.label ?? '',
        due_date: installment.due_date?.slice(0, 10),
        amount: installment.amount,
        currency: item.currency,
        installment_type: installment.installment_type ?? 'CUSTOM',
      })),
  };
}

function useSalesReferenceData() {
  const [buyers, setBuyers] = useState<SalesBuyer[]>([]);
  const [catalog, setCatalog] = useState<SalesCatalogItem[]>([]);
  const [projects, setProjects] = useState<SalesProject[]>([]);
  const [reservations, setReservations] = useState<SalesReservation[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [buyersResponse, catalogResponse, projectsResponse, reservationsResponse] = await Promise.all([
          listSalesBuyers({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesCatalog({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesProjects({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesReservations({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
        ]);
        if (cancelled) return;
        setBuyers(buyersResponse.items);
        setCatalog(catalogResponse.items);
        setProjects(projectsResponse.items);
        setReservations(reservationsResponse.items);
      } catch {
        if (!cancelled) {
          setBuyers([]);
          setCatalog([]);
          setProjects([]);
          setReservations([]);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { buyers, catalog, projects, reservations };
}

function buildReservationPayload(form: ReservationFormState): CreateSalesReservationInput {
  return {
    buyer_id: Number(form.buyer_id),
    catalog_item_id: Number(form.catalog_item_id),
    project_id: parseOptionalNumber(form.project_id),
    status: form.status,
    currency: form.currency,
    catalog_price: Number(form.catalog_price),
    negotiated_price: Number(form.negotiated_price),
    reservation_fee: parseOptionalNumber(form.reservation_fee),
    reservation_date: form.reservation_date,
    expires_at: trimOrUndefined(form.expires_at),
    notes: trimOrUndefined(form.notes),
  };
}

function buildSubscriptionPayload(form: SubscriptionFormState): CreateSalesSubscriptionInput {
  return {
    origin_mode: form.origin_mode,
    reservation_id: parseOptionalNumber(form.reservation_id),
    buyer_id: Number(form.buyer_id),
    catalog_item_id: Number(form.catalog_item_id),
    project_id: parseOptionalNumber(form.project_id),
    status: form.status,
    currency: form.currency,
    catalog_price: Number(form.catalog_price),
    negotiated_price: parseOptionalNumber(form.negotiated_price),
    discount_amount: parseOptionalNumber(form.discount_amount),
    deposit_type: form.deposit_type,
    deposit_percentage: parseOptionalNumber(form.deposit_percentage),
    deposit_amount: parseOptionalNumber(form.deposit_amount),
    installment_count: Number(form.installment_count),
    frequency: form.frequency,
    first_due_date: trimOrUndefined(form.first_due_date),
    grace_period_days: parseOptionalNumber(form.grace_period_days),
    notes: trimOrUndefined(form.notes),
    custom_installments: form.frequency === 'CUSTOM'
      ? form.custom_installments.map((item, index) => ({
          sequence_number: item.sequence_number ?? index + 1,
          label: trimOrUndefined(item.label ?? ''),
          due_date: trimOrUndefined(item.due_date ?? ''),
          amount: Number(item.amount),
          currency: item.currency,
          installment_type: item.installment_type ?? 'CUSTOM',
        }))
      : undefined,
  };
}

function reservationOptionsStatus(status: string) {
  return RESERVATION_STATUS_LABELS[status] || status;
}

function subscriptionOptionsStatus(status: string) {
  return SUBSCRIPTION_STATUS_LABELS[status] || status;
}

function reservationPaymentStatusLabel(status?: string | null) {
  if (!status) return 'À définir';
  return RESERVATION_PAYMENT_STATUS_LABELS[status] || status;
}

function reservationPaymentMethodLabel(method?: string | null) {
  if (!method) return 'À définir';
  return RESERVATION_PAYMENT_METHOD_LABELS[method] || method;
}

export function SalesReservationsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<SalesReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesReservations({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'updated_at',
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
      title="Réservations"
      subtitle="Suivi des options de vente, des expirations et des confirmations avant souscription."
      activeTab="reservations"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/reservations/new">Nouvelle réservation</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      <SalesSection title="Portefeuille de réservations" description="Vue compacte des dossiers en cours, avec tri par statut et échéance.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher une réservation" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {SALES_RESERVATION_STATUSES.map((item) => <option key={item} value={item}>{reservationOptionsStatus(item)}</option>)}
          </select>
        </SalesFilterBar>

        {loading ? <SalesInlineNotice>Chargement des réservations…</SalesInlineNotice> : null}
        {!loading && !items.length ? (
          <SalesEmptyState
            title="Aucune réservation active"
            description="Créez une réservation pour bloquer un bien et préparer la souscription."
            action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/reservations/new">Créer une réservation</Link>}
          />
        ) : null}

        {!!items.length && (
          <SalesDataTable
            rowKey={(item) => item.id}
            rows={items}
            rowHref={(item) => `/sales/reservations/${item.id}`}
            rowAriaLabel={(item) => `Ouvrir la réservation ${item.reservation_number}`}
            columns={[
              {
                key: 'reservation',
                label: 'Réservation',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.reservation_number}</strong>
                    <p className="sales-v21-cell-subtitle">{item.catalog_title || item.catalog_ref || 'Bien non disponible'}</p>
                  </div>
                ),
              },
              {
                key: 'buyer',
                label: 'Acquéreur',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.buyer_name || 'Donnée non disponible'}</strong>
                    <p className="sales-v21-cell-subtitle">{item.buyer_ref || 'Référence non disponible'}</p>
                  </div>
                ),
              },
              {
                key: 'amount',
                label: 'Montant',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{formatCurrency(item.negotiated_price, item.currency)}</strong>
                    <p className="sales-v21-cell-subtitle">Frais : {formatCurrency(item.reservation_fee, item.currency)}</p>
                  </div>
                ),
              },
              {
                key: 'timeline',
                label: 'Calendrier',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{formatDate(item.reservation_date)}</strong>
                    <p className="sales-v21-cell-subtitle">Expire le {formatDate(item.expires_at)}</p>
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Statut',
                render: (item) => <SalesStatusBadge label={reservationOptionsStatus(item.status)} tone={getStatusTone(item.status)} />,
              },
            ]}
          />
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesReservationFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const [form, setForm] = useState<ReservationFormState>(emptyReservationForm());
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { buyers, catalog, projects } = useSalesReferenceData();
  const filteredCatalog = useMemo(
    () => catalog.filter((item) => !form.project_id || String(item.project_id ?? '') === form.project_id),
    [catalog, form.project_id],
  );

  useEffect(() => {
    let cancelled = false;
    void getSalesSettings().then((response) => { if (!cancelled) setSettings(response); }).catch(() => undefined);
    if (!editingId) return () => { cancelled = true; };

    async function load() {
      if (!editingId) return;
      setLoading(true);
      try {
        const reservation = await getSalesReservation(editingId);
        if (!cancelled) setForm(mapReservationToForm(reservation));
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
  }, [editingId]);

  useEffect(() => {
    const selectedCatalog = catalog.find((item) => String(item.id) === form.catalog_item_id);
    if (!selectedCatalog) return;
    setForm((current) => ({
      ...current,
      currency: current.currency || selectedCatalog.currency || 'USD',
      catalog_price: current.catalog_price || String(selectedCatalog.list_price ?? ''),
      project_id: current.project_id || (selectedCatalog.project_id ? String(selectedCatalog.project_id) : ''),
    }));
  }, [catalog, form.catalog_item_id]);

  useEffect(() => {
    if (!form.catalog_item_id) return;
    const selectedCatalog = catalog.find((item) => String(item.id) === form.catalog_item_id);
    if (!selectedCatalog) return;
    if (form.project_id && String(selectedCatalog.project_id ?? '') !== form.project_id) {
      setForm((current) => ({ ...current, catalog_item_id: '' }));
    }
  }, [catalog, form.catalog_item_id, form.project_id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = buildReservationPayload(form);
      const response = editingId
        ? await updateSalesReservation(editingId, payload)
        : await createSalesReservation(payload);
      navigate(`/sales/reservations/${response.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={editingId ? 'Modifier une réservation' : 'Nouvelle réservation'}
      subtitle="Dossier compact pour bloquer un bien, cadrer l’offre et préparer le passage en souscription."
      activeTab="reservations"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/reservations/${editingId}` : '/sales/reservations'}>Retour</Link>}
    >
      <SalesSection title="Paramètres de réservation" description="Acquéreur, bien, calendrier et conditions financières.">
        {loading ? <SalesInlineNotice>Chargement de la réservation…</SalesInlineNotice> : null}
        {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
        {!loading && (
          <form className="sales-v21-form" onSubmit={handleSubmit}>
            <SalesFormSection title="Identification" description="Référence interne et rattachement commercial.">
              <SalesInlineNotice>Le numéro de réservation est généré automatiquement à l’enregistrement.</SalesInlineNotice>
              <SalesField label="Acquéreur">
                <select className="sales-v21-select" value={form.buyer_id} onChange={(event) => setForm((current) => ({ ...current, buyer_id: event.target.value }))}>
                  <option value="">Sélectionner</option>
                  {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.full_name || buyer.company_name || buyer.buyer_ref}</option>)}
                </select>
              </SalesField>
              <SalesField label="Projet">
                <select className="sales-v21-select" value={form.project_id} onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value }))}>
                  <option value="">Sélectionner un projet</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </SalesField>
              <SalesField label="Bien à vendre" hint="Le bien est filtré selon le projet sélectionné.">
                <select
                  className="sales-v21-select"
                  value={form.catalog_item_id}
                  disabled={!form.project_id}
                  onChange={(event) => setForm((current) => ({ ...current, catalog_item_id: event.target.value }))}
                >
                  <option value="">{form.project_id ? 'Sélectionner' : 'Choisissez d’abord un projet'}</option>
                  {filteredCatalog.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.catalog_ref}</option>)}
                </select>
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Conditions financières" description="Prix de référence, prix négocié et frais éventuels.">
              <SalesField label="Devise">
                <select className="sales-v21-select" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>
                  {SALES_SUPPORTED_CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Prix catalogue">
                <input className="sales-v21-input" inputMode="decimal" value={form.catalog_price} onChange={(event) => setForm((current) => ({ ...current, catalog_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Prix négocié">
                <input className="sales-v21-input" inputMode="decimal" value={form.negotiated_price} onChange={(event) => setForm((current) => ({ ...current, negotiated_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Frais de réservation convenus" hint={settings?.reservation_fee_required ? `Minimum configuré : ${settings.reservation_default_fee ?? 0}` : 'Montant convenu hors encaissements déjà reçus.'}>
                <input className="sales-v21-input" inputMode="decimal" value={form.reservation_fee} onChange={(event) => setForm((current) => ({ ...current, reservation_fee: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Calendrier" description="Dates de blocage, expiration et commentaires opérationnels.">
              <SalesField label="Date de réservation">
                <input className="sales-v21-input" type="date" value={form.reservation_date} onChange={(event) => setForm((current) => ({ ...current, reservation_date: event.target.value }))} />
              </SalesField>
              <SalesField label="Expiration">
                <input className="sales-v21-input" type="date" value={form.expires_at} onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value }))} />
              </SalesField>
              <SalesField label="Statut initial">
                <select className="sales-v21-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  {SALES_RESERVATION_STATUSES.map((item) => <option key={item} value={item}>{reservationOptionsStatus(item)}</option>)}
                </select>
              </SalesField>
              <SalesField label="Notes">
                <textarea className="sales-v21-textarea" rows={5} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormActions>
              <Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/reservations/${editingId}` : '/sales/reservations'}>Annuler</Link>
              <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </SalesFormActions>
          </form>
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesReservationDetailPage() {
  const { id } = useParams();
  const reservationId = Number(id);
  const { can } = useAuth();
  const [item, setItem] = useState<SalesReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{
    actionKey: string;
    title: string;
    description: string;
    confirmLabel: string;
    reason: string;
    error: string | null;
    handler: (reason: string) => Promise<unknown>;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState<ReservationPaymentFormState>({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'CASH',
    destination_type: 'CASH',
    cash_session_id: '',
    bank_account_id: '',
    external_reference: '',
    notes: '',
  });
  const [refundTargetId, setRefundTargetId] = useState<number | null>(null);
  const [refundForms, setRefundForms] = useState<Record<number, ReservationRefundFormState>>({});

  async function reloadReservation() {
    const response = await getSalesReservation(reservationId);
    setItem(response);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesReservation(reservationId);
        if (!cancelled) setItem(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (reservationId) void load();
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  useEffect(() => {
    if (!item) return;
    setPaymentForm((current) => ({
      ...current,
      amount: current.amount || String(Number(item.fee_summary?.fee_remaining ?? item.reservation_fee ?? 0) || ''),
      cash_session_id: current.cash_session_id || String(item.payment_destinations?.cash_sessions?.[0]?.id ?? ''),
      bank_account_id: current.bank_account_id || String(item.payment_destinations?.bank_accounts?.[0]?.id ?? ''),
    }));
  }, [item]);

  async function runAction(label: string, handler: () => Promise<unknown>) {
    setBusyAction(label);
    setError(null);
    try {
      const response = await handler();
      setItem(response as SalesReservation);
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function runReasonedAction(label: string, actionLabel: string, handler: (reason: string) => Promise<unknown>) {
    setReasonDialog({
      actionKey: label,
      title: actionLabel,
      description: 'Cette action modifie le statut de la réservation. Le motif sera enregistré dans l’audit métier.',
      confirmLabel: actionLabel,
      reason: '',
      error: null,
      handler,
    });
  }

  async function confirmReasonDialog() {
    if (!reasonDialog) return;
    const trimmedReason = reasonDialog.reason.trim();
    if (!trimmedReason) {
      setReasonDialog((current) => current ? { ...current, error: 'Un motif est obligatoire pour poursuivre cette action.' } : current);
      return;
    }
    setBusyAction(reasonDialog.actionKey);
    setError(null);
    setReasonDialog((current) => current ? { ...current, error: null } : current);
    try {
      const response = await reasonDialog.handler(trimmedReason);
      setItem(response as SalesReservation);
      setReasonDialog(null);
    } catch (actionError) {
      const message = getErrorMessage(actionError);
      setReasonDialog((current) => current ? { ...current, error: message } : current);
    } finally {
      setBusyAction(null);
    }
  }

  function getRefundForm(payment: SalesReservationPayment): ReservationRefundFormState {
    return refundForms[payment.id] ?? {
      amount: String(Number(payment.available_refundable_amount ?? 0) || ''),
      refund_date: new Date().toISOString().slice(0, 10),
      refund_method: payment.payment_method || 'CASH',
      destination_type: payment.destination_type || 'CASH',
      cash_session_id: String(item?.payment_destinations?.cash_sessions?.[0]?.id ?? ''),
      bank_account_id: String(item?.payment_destinations?.bank_accounts?.[0]?.id ?? ''),
      reason: '',
      external_reference: '',
      notes: '',
    };
  }

  function setRefundForm(paymentId: number, patch: Partial<ReservationRefundFormState>) {
    setRefundForms((current) => ({
      ...current,
      [paymentId]: {
        ...(current[paymentId] ?? {
          amount: '',
          refund_date: new Date().toISOString().slice(0, 10),
          refund_method: 'CASH',
          destination_type: 'CASH',
          cash_session_id: String(item?.payment_destinations?.cash_sessions?.[0]?.id ?? ''),
          bank_account_id: String(item?.payment_destinations?.bank_accounts?.[0]?.id ?? ''),
          reason: '',
          external_reference: '',
          notes: '',
        }),
        ...patch,
      },
    }));
  }

  async function submitReservationPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const payload: CreateSalesReservationPaymentInput = {
      amount: Number(paymentForm.amount),
      payment_date: paymentForm.payment_date,
      payment_method: paymentForm.payment_method,
      destination_type: paymentForm.destination_type,
      external_reference: trimOrUndefined(paymentForm.external_reference),
      notes: trimOrUndefined(paymentForm.notes),
      idempotency_key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    };
    if (paymentForm.destination_type === 'CASH' && paymentForm.cash_session_id) {
      payload.cash_session_id = Number(paymentForm.cash_session_id);
    }
    if (paymentForm.destination_type === 'BANK' && paymentForm.bank_account_id) {
      payload.bank_account_id = Number(paymentForm.bank_account_id);
    }
    setBusyAction('fee-payment');
    setError(null);
    try {
      await createSalesReservationPayment(item.id, payload);
      await reloadReservation();
      setPaymentForm((current) => ({
        ...current,
        amount: '',
        external_reference: '',
        notes: '',
      }));
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReservationRefund(event: FormEvent<HTMLFormElement>, payment: SalesReservationPayment) {
    event.preventDefault();
    const form = getRefundForm(payment);
    const payload: CreateSalesReservationRefundInput = {
      amount: Number(form.amount),
      refund_date: form.refund_date,
      refund_method: form.refund_method,
      destination_type: form.destination_type,
      reason: form.reason,
      external_reference: trimOrUndefined(form.external_reference),
      notes: trimOrUndefined(form.notes),
      idempotency_key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    };
    if (form.destination_type === 'CASH' && form.cash_session_id) {
      payload.cash_session_id = Number(form.cash_session_id);
    }
    if (form.destination_type === 'BANK' && form.bank_account_id) {
      payload.bank_account_id = Number(form.bank_account_id);
    }
    setBusyAction(`refund-${payment.id}`);
    setError(null);
    try {
      await createSalesReservationRefund(payment.id, payload);
      await reloadReservation();
      setRefundTargetId(null);
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <SalesModulePage
      title={item?.reservation_number || 'Réservation'}
      subtitle="Vue détaillée de l’option commerciale, des montants et de la prochaine action métier."
      activeTab="reservations"
      action={
        <div className="sales-v21-header-actions">
          <Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/reservations">Retour</Link>
          {item && can('sales_reservations.update') ? <Link className="sales-v21-btn sales-v21-btn-primary" to={`/sales/reservations/${item.id}/edit`}>Modifier</Link> : null}
        </div>
      }
    >
      {loading ? <SalesInlineNotice>Chargement de la réservation…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {item ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Acquéreur" value={item.buyer_name || 'Donnée non disponible'} helper={item.buyer_ref || 'Référence acquéreur'} />
            <SalesKpiCard label="Bien" value={item.catalog_ref || 'Donnée non disponible'} helper={item.catalog_title || 'Article commercial'} />
            <SalesKpiCard label="Montant négocié" value={formatCurrency(item.negotiated_price, item.currency)} helper={`Frais : ${formatCurrency(item.reservation_fee, item.currency)}`} />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={reservationOptionsStatus(item.status)} tone={getStatusTone(item.status)} />} helper={`Expire le ${formatDate(item.expires_at)}`} />
          </SalesKpiGrid>

          <div className="sales-v21-two-columns">
            <SalesSection title="Résumé" description="Les points essentiels avant transformation en souscription.">
              <SalesInfoList
                items={[
                  { label: 'Projet', value: item.project_name || '—' },
                  { label: 'Date de réservation', value: formatDate(item.reservation_date) },
                  { label: 'Expiration', value: formatDate(item.expires_at) },
                  { label: 'Confirmée le', value: item.confirmed_at ? formatDate(item.confirmed_at) : '—' },
                  { label: 'Annulée le', value: item.cancelled_at ? formatDate(item.cancelled_at) : '—' },
                ]}
              />
              <p className="sales-v21-reservation-note">{item.notes || 'Aucune note complémentaire.'}</p>
            </SalesSection>

            <SalesSection title="Actions métier" description="Carte compacte : action principale visible, actions sensibles regroupées et toujours motivées.">
              <SalesDetailActionsCard
                primaryAction={
                  can('sales_reservations.approve') && ['ACTIVE', 'DRAFT'].includes(item.status)
                    ? {
                        key: 'confirm',
                        label: busyAction === 'confirm' ? 'Confirmation…' : 'Confirmer',
                        tone: 'primary',
                        disabled: busyAction === 'confirm',
                        onClick: () => void runReasonedAction('confirm', 'Confirmer la réservation', (reason) => confirmSalesReservation(item.id, { reason })),
                      }
                    : can('sales_subscriptions.create') && ['ACTIVE', 'CONFIRMED'].includes(item.status)
                      ? {
                          key: 'create-subscription',
                          label: 'Créer la souscription',
                          tone: 'primary',
                          href: `/sales/subscriptions/new?reservation_id=${item.id}`,
                        }
                      : can('sales_reservations.update') && item.status === 'CONFIRMED'
                        ? {
                            key: 'convert',
                            label: busyAction === 'convert' ? 'Conversion…' : 'Convertir',
                            tone: 'primary',
                            disabled: busyAction === 'convert',
                            onClick: () => void runReasonedAction('convert', 'Convertir la réservation', (reason) => convertSalesReservation(item.id, { reason })),
                          }
                        : null
                }
                editHref={can('sales_reservations.update') ? `/sales/reservations/${item.id}/edit` : null}
                secondaryActions={[
                  can('sales_reservations.update') && item.status === 'ACTIVE'
                    ? {
                        key: 'expire',
                        label: busyAction === 'expire' ? 'Expiration…' : 'Expirer',
                        tone: 'secondary',
                        disabled: busyAction === 'expire',
                        onClick: () => void runReasonedAction('expire', 'Expirer la réservation', (reason) => expireSalesReservation(item.id, { reason })),
                      }
                    : null,
                  can('sales_subscriptions.create') && ['ACTIVE', 'CONFIRMED'].includes(item.status) && !(can('sales_reservations.approve') && ['ACTIVE', 'DRAFT'].includes(item.status))
                    ? {
                        key: 'create-subscription',
                        label: 'Créer la souscription',
                        tone: 'secondary',
                        href: `/sales/subscriptions/new?reservation_id=${item.id}`,
                      }
                    : null,
                  can('sales_reservations.update') && item.status === 'CONFIRMED' && !(can('sales_subscriptions.create') && ['ACTIVE', 'CONFIRMED'].includes(item.status)) && !(can('sales_reservations.approve') && ['ACTIVE', 'DRAFT'].includes(item.status))
                    ? {
                        key: 'convert',
                        label: busyAction === 'convert' ? 'Conversion…' : 'Convertir',
                        tone: 'secondary',
                        disabled: busyAction === 'convert',
                        onClick: () => void runReasonedAction('convert', 'Convertir la réservation', (reason) => convertSalesReservation(item.id, { reason })),
                      }
                    : null,
                  can('sales_reservations.cancel') && ['ACTIVE', 'CONFIRMED', 'DRAFT'].includes(item.status)
                    ? {
                        key: 'cancel',
                        label: busyAction === 'cancel' ? 'Annulation…' : 'Annuler',
                        tone: 'danger',
                        disabled: busyAction === 'cancel',
                        onClick: () => void runReasonedAction('cancel', 'Annuler la réservation', (reason) => cancelSalesReservation(item.id, { reason })),
                      }
                    : null,
                ].filter(Boolean) as SalesDetailAction[]}
                hint="Chaque changement d’état exige un motif et une confirmation explicite."
              />
            </SalesSection>
          </div>

          <SalesSection
            title="Frais de réservation"
            description="Encaissement, reçus, annulation et remboursements partiels directement depuis le dossier."
          >
            <div className="sales-v21-fee-grid">
              <SalesKpiCard
                label="Convenu"
                value={formatCurrency(item.fee_summary?.fee_agreed ?? item.reservation_fee ?? 0, item.currency)}
                helper={`Statut : ${reservationPaymentStatusLabel(item.fee_summary?.payment_status)}`}
              />
              <SalesKpiCard
                label="Encaissé"
                value={formatCurrency(item.fee_summary?.fee_paid ?? 0, item.currency)}
                helper={`Remboursé : ${formatCurrency(item.fee_summary?.fee_refunded ?? 0, item.currency)}`}
              />
              <SalesKpiCard
                label="Disponible"
                value={formatCurrency(item.fee_summary?.fee_available ?? 0, item.currency)}
                helper={`Alloué : ${formatCurrency(item.fee_summary?.fee_allocated ?? 0, item.currency)}`}
              />
              <SalesKpiCard
                label="Solde à encaisser"
                value={formatCurrency(item.fee_summary?.fee_remaining ?? 0, item.currency)}
                helper={`Déductibilité : ${reservationFeeDeductibilityLabel(item.fee_summary?.deductibility)}`}
              />
            </div>

            {can('sales_reservation_payments.create') && Number(item.fee_summary?.fee_remaining ?? 0) > 0 ? (
              <div className="sales-v21-fee-form-card">
                <div className="sales-v21-fee-form-card-head">
                  <h3>Encaisser les frais</h3>
                  <p>Le formulaire est séparé du résumé pour garder les montants lisibles et limiter les erreurs de saisie.</p>
                </div>
                <form className="sales-v21-fee-form" onSubmit={submitReservationPayment}>
                <SalesField label="Montant">
                  <input className="sales-v21-input" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} />
                </SalesField>
                <SalesField label="Date">
                  <input className="sales-v21-input" type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_date: event.target.value }))} />
                </SalesField>
                <SalesField label="Canal">
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
                      {(item.payment_destinations?.cash_sessions ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                    </select>
                  </SalesField>
                ) : null}
                {paymentForm.destination_type === 'BANK' ? (
                  <SalesField label="Compte bancaire">
                    <select className="sales-v21-select" value={paymentForm.bank_account_id} onChange={(event) => setPaymentForm((current) => ({ ...current, bank_account_id: event.target.value }))}>
                      <option value="">Sélectionner</option>
                      {(item.payment_destinations?.bank_accounts ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                    </select>
                  </SalesField>
                ) : null}
                <SalesField label="Référence">
                  <input className="sales-v21-input" value={paymentForm.external_reference} onChange={(event) => setPaymentForm((current) => ({ ...current, external_reference: event.target.value }))} />
                </SalesField>
                <SalesField label="Note">
                  <input className="sales-v21-input" value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} />
                </SalesField>
                <div className="sales-v21-fee-actions">
                  <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={busyAction === 'fee-payment'}>
                    {busyAction === 'fee-payment' ? 'Encaissement…' : 'Payer les frais'}
                  </button>
                </div>
                </form>
              </div>
            ) : null}

            {item.payments?.length ? (
              <SalesDataTable
                rowKey={(payment) => payment.id}
                rows={item.payments}
                columns={[
                  {
                    key: 'number',
                    label: 'Paiement',
                    render: (payment) => (
                      <div className="sales-v21-cell-stack">
                        <strong className="sales-v21-cell-primary">{payment.payment_number}</strong>
                        <p className="sales-v21-cell-subtitle">{formatDate(payment.payment_date)} · {reservationPaymentMethodLabel(payment.payment_method)}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'amount',
                    label: 'Montant',
                    render: (payment) => (
                      <div className="sales-v21-cell-stack">
                        <strong className="sales-v21-cell-primary">{formatCurrency(payment.amount, payment.currency)}</strong>
                        <p className="sales-v21-cell-subtitle">Disponible : {formatCurrency(payment.available_refundable_amount ?? 0, payment.currency)}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Statut',
                    render: (payment) => (
                      <div className="sales-v21-cell-stack">
                        <SalesStatusBadge label={reservationPaymentStatusLabel(payment.status)} tone={getStatusTone(payment.status)} />
                        <p className="sales-v21-cell-subtitle">Remboursé : {formatCurrency(payment.refunded_amount ?? 0, payment.currency)}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (payment) => (
                      <div className="sales-v21-table-actions sales-v21-table-actions-wrap">
                        {payment.receipt ? (
                          <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void triggerDocumentDownload(payment.receipt as SalesDocumentGeneration)}>
                            Télécharger le reçu
                          </button>
                        ) : null}
                        {can('sales_reservation_receipts.generate') ? (
                          <button
                            className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                            type="button"
                            disabled={busyAction === `receipt-${payment.id}`}
                            onClick={() => void runAction(`receipt-${payment.id}`, async () => {
                              await regenerateSalesReservationPaymentReceipt(payment.id);
                              return getSalesReservation(item.id);
                            })}
                          >
                            Régénérer le reçu
                          </button>
                        ) : null}
                        {can('sales_reservation_payments.refund') && payment.status !== 'CANCELLED' && Number(payment.available_refundable_amount ?? 0) > 0 ? (
                          <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => setRefundTargetId((current) => current === payment.id ? null : payment.id)}>
                            {refundTargetId === payment.id ? 'Fermer le remboursement' : 'Rembourser'}
                          </button>
                        ) : null}
                        {can('sales_reservation_payments.cancel') && payment.status === 'CONFIRMED' ? (
                          <button
                            className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact"
                            type="button"
                            disabled={busyAction === `cancel-payment-${payment.id}`}
                            onClick={() => void runReasonedAction(`cancel-payment-${payment.id}`, 'Annuler ce paiement de frais', (reason) => cancelSalesReservationPayment(payment.id, { reason }).then(() => getSalesReservation(item.id)))}
                          >
                            Annuler
                          </button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucun encaissement enregistré" description="Le premier paiement de frais apparaîtra ici avec son reçu, son statut et ses éventuels remboursements." />
            )}

            {refundTargetId ? (
              (() => {
                const payment = item.payments?.find((entry) => entry.id === refundTargetId);
                if (!payment) return null;
                const refundForm = getRefundForm(payment);
                return (
                  <form className="sales-v21-refund-panel" onSubmit={(event) => void submitReservationRefund(event, payment)}>
                    <div className="sales-v21-refund-head">
                      <div>
                        <h3>Rembourser {payment.payment_number}</h3>
                        <p>Disponible : {formatCurrency(payment.available_refundable_amount ?? 0, payment.currency)}</p>
                      </div>
                      <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => setRefundTargetId(null)}>Fermer</button>
                    </div>
                    <div className="sales-v21-fee-form">
                      <SalesField label="Montant">
                        <input className="sales-v21-input" type="number" min="0" step="0.01" value={refundForm.amount} onChange={(event) => setRefundForm(payment.id, { amount: event.target.value })} />
                      </SalesField>
                      <SalesField label="Date de remboursement">
                        <input className="sales-v21-input" type="date" value={refundForm.refund_date} onChange={(event) => setRefundForm(payment.id, { refund_date: event.target.value })} />
                      </SalesField>
                      <SalesField label="Canal">
                        <select
                          className="sales-v21-select"
                          value={refundForm.refund_method}
                          onChange={(event) => {
                            const nextMethod = event.target.value;
                            setRefundForm(payment.id, {
                              refund_method: nextMethod,
                              destination_type: nextMethod === 'BANK' ? 'BANK' : nextMethod === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : nextMethod === 'OTHER' ? 'OTHER' : 'CASH',
                            });
                          }}
                        >
                          {SALES_RESERVATION_PAYMENT_METHODS.map((entry) => <option key={entry} value={entry}>{reservationPaymentMethodLabel(entry)}</option>)}
                        </select>
                      </SalesField>
                      <SalesField label="Destination">
                        <select className="sales-v21-select" value={refundForm.destination_type} onChange={(event) => setRefundForm(payment.id, { destination_type: event.target.value })}>
                          {SALES_RESERVATION_DESTINATION_TYPES.map((entry) => <option key={entry} value={entry}>{reservationPaymentMethodLabel(entry)}</option>)}
                        </select>
                      </SalesField>
                      {refundForm.destination_type === 'CASH' ? (
                        <SalesField label="Session de caisse">
                          <select className="sales-v21-select" value={refundForm.cash_session_id} onChange={(event) => setRefundForm(payment.id, { cash_session_id: event.target.value })}>
                            <option value="">Sélectionner</option>
                            {(item.payment_destinations?.cash_sessions ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                          </select>
                        </SalesField>
                      ) : null}
                      {refundForm.destination_type === 'BANK' ? (
                        <SalesField label="Compte bancaire">
                          <select className="sales-v21-select" value={refundForm.bank_account_id} onChange={(event) => setRefundForm(payment.id, { bank_account_id: event.target.value })}>
                            <option value="">Sélectionner</option>
                            {(item.payment_destinations?.bank_accounts ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                          </select>
                        </SalesField>
                      ) : null}
                      <SalesField label="Motif">
                        <input className="sales-v21-input" value={refundForm.reason} onChange={(event) => setRefundForm(payment.id, { reason: event.target.value })} />
                      </SalesField>
                      <SalesField label="Référence externe">
                        <input className="sales-v21-input" value={refundForm.external_reference} onChange={(event) => setRefundForm(payment.id, { external_reference: event.target.value })} />
                      </SalesField>
                      <SalesField label="Notes">
                        <input className="sales-v21-input" value={refundForm.notes} onChange={(event) => setRefundForm(payment.id, { notes: event.target.value })} />
                      </SalesField>
                    </div>
                    <div className="sales-v21-fee-actions">
                      <button className="sales-v21-btn sales-v21-btn-danger" type="submit" disabled={busyAction === `refund-${payment.id}`}>
                        {busyAction === `refund-${payment.id}` ? 'Remboursement…' : 'Confirmer le remboursement'}
                      </button>
                    </div>
                  </form>
                );
              })()
            ) : null}

            {item.payments?.some((payment) => payment.refunds?.length) ? (
              <div className="sales-v21-card-list">
                {item.payments.flatMap((payment) => (payment.refunds ?? []).map((refund) => (
                  <article key={refund.id} className="sales-v21-entity-card">
                    <div className="sales-v21-entity-head">
                      <div>
                        <h3>{refund.refund_number}</h3>
                        <p>{payment.payment_number} · {formatDate(refund.refund_date)}</p>
                      </div>
                      <SalesStatusBadge label={reservationPaymentStatusLabel(refund.status)} tone={getStatusTone(refund.status)} />
                    </div>
                    <div className="sales-v21-entity-body">
                      <p>{formatCurrency(refund.amount, refund.currency)} · {reservationPaymentMethodLabel(refund.refund_method)}</p>
                      <p>{refund.reason}</p>
                    </div>
                    {refund.receipt ? (
                      <div className="sales-v21-table-actions">
                        <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void triggerDocumentDownload(refund.receipt as SalesDocumentGeneration)}>
                          Télécharger le reçu de remboursement
                        </button>
                      </div>
                    ) : null}
                  </article>
                )))}
              </div>
            ) : null}
          </SalesSection>

          <SalesSection
            title="Documents contractuels"
            description="Contrat généré automatiquement et régénération manuelle si le dossier évolue."
            action={can('sales_documents.regenerate') ? (
              <button
                className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                type="button"
                disabled={busyAction === 'document'}
                onClick={() => void runAction('document', async () => {
                  await regenerateSalesReservationDocument(item.id);
                  return getSalesReservation(item.id);
                })}
              >
                Régénérer le contrat
              </button>
            ) : null}
          >
            {item.documents?.length ? (
              <SalesDataTable
                rowKey={(document) => document.id}
                rows={item.documents}
                columns={[
                  { key: 'number', label: 'Document', render: (document) => document.document_number },
                  { key: 'type', label: 'Type', render: (document) => document.template_type },
                  { key: 'status', label: 'Statut', render: (document) => document.generation_status || 'PENDING' },
                  { key: 'date', label: 'Généré le', render: (document) => formatDate(document.generated_at || document.created_at) },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (document) => (
                      <div className="sales-v21-table-actions">
                        <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void triggerDocumentDownload(document)}>
                          Télécharger
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucun contrat généré" description="Le premier PDF apparaîtra ici dès la génération du contrat de réservation." />
            )}
          </SalesSection>
        </>
      ) : null}
    </SalesModulePage>
  );
}

export function SalesSubscriptionsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<SalesSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesSubscriptions({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'updated_at',
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
      title="Souscriptions"
      subtitle="Simulation, validation et suivi des engagements de vente avec échéancier compact."
      activeTab="subscriptions"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/subscriptions/new">Nouvelle souscription</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      <SalesSection title="Portefeuille de souscriptions" description="Lecture dense des dossiers, du solde financé et du statut d’approbation.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher une souscription" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {SALES_SUBSCRIPTION_STATUSES.map((item) => <option key={item} value={item}>{subscriptionOptionsStatus(item)}</option>)}
          </select>
        </SalesFilterBar>
        {loading ? <SalesInlineNotice>Chargement des souscriptions…</SalesInlineNotice> : null}
        {!loading && !items.length ? (
          <SalesEmptyState
            title="Aucune souscription active"
            description="Créez une souscription pour générer un échéancier et préparer l’engagement final."
            action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/subscriptions/new">Créer une souscription</Link>}
          />
        ) : null}

        {!!items.length && (
          <SalesDataTable
            rowKey={(item) => item.id}
            rows={items}
            rowHref={(item) => `/sales/subscriptions/${item.id}`}
            rowAriaLabel={(item) => `Ouvrir la souscription ${item.subscription_number}`}
            columns={[
              {
                key: 'subscription',
                label: 'Souscription',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.subscription_number}</strong>
                    <p className="sales-v21-cell-subtitle">{item.catalog_title || item.catalog_ref || 'Bien non disponible'}</p>
                  </div>
                ),
              },
              {
                key: 'buyer',
                label: 'Acquéreur',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.buyer_name || 'Donnée non disponible'}</strong>
                    <p className="sales-v21-cell-subtitle">{item.reservation_number || 'Sans réservation liée'}</p>
                  </div>
                ),
              },
              {
                key: 'finance',
                label: 'Structure',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{formatCurrency(item.final_sale_price, item.currency)}</strong>
                    <p className="sales-v21-cell-subtitle">Solde : {formatCurrency(item.financed_balance, item.currency)}</p>
                  </div>
                ),
              },
              {
                key: 'schedule',
                label: 'Échéancier',
                render: (item) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{item.installment_count} échéances</strong>
                    <p className="sales-v21-cell-subtitle">{item.frequency} ⬢ 1re échéance {formatDate(item.first_due_date)}</p>
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Statut',
                render: (item) => <SalesStatusBadge label={subscriptionOptionsStatus(item.status)} tone={getStatusTone(item.status)} />,
              },
            ]}
          />
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesSubscriptionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const [form, setForm] = useState<SubscriptionFormState>(emptySubscriptionForm());
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const [simulation, setSimulation] = useState<SalesSubscriptionSimulation | null>(null);
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { buyers, catalog, projects, reservations } = useSalesReferenceData();
  const linkedReservation = useMemo(
    () => reservations.find((item) => String(item.id) === form.reservation_id),
    [form.reservation_id, reservations],
  );
  const filteredCatalog = useMemo(
    () => catalog.filter((item) => !form.project_id || String(item.project_id ?? '') === form.project_id),
    [catalog, form.project_id],
  );

  useEffect(() => {
    let cancelled = false;
    void getSalesSettings().then((response) => {
      if (cancelled) return;
      setSettings(response);
      setForm((current) => ({
        ...current,
        grace_period_days: String(response.grace_period_days ?? current.grace_period_days),
        installment_count: String(response.maximum_installment_count && Number(current.installment_count) > Number(response.maximum_installment_count)
          ? response.maximum_installment_count
          : current.installment_count),
        frequency: response.default_installment_frequency ?? current.frequency,
      }));
    }).catch(() => undefined);

    if (!editingId) {
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      if (!editingId) return;
      setLoading(true);
      try {
        const response = await getSalesSubscription(editingId);
        if (!cancelled) {
          setForm(mapSubscriptionToForm(response));
          setSimulation(response.installments ? {
            summary: {
              currency: response.currency,
              catalog_price: response.catalog_price,
              final_sale_price: response.final_sale_price,
              discount_amount: response.discount_amount ?? 0,
              total_installments: response.installments.length,
              deposit_amount: response.deposit_amount ?? 0,
              remaining_amount: response.financed_balance ?? 0,
              approval_required: false,
              approval_reason: null,
            },
            installments: response.installments,
          } : null);
        }
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
  }, [editingId]);

  useEffect(() => {
    const reservationId = new URLSearchParams(window.location.search).get('reservation_id');
    if (!reservationId || editingId) return;
    const reservation = reservations.find((item) => String(item.id) === reservationId);
    if (!reservation) return;
    setForm((current) => ({
      ...current,
      origin_mode: 'RESERVATION',
      reservation_id: reservationId,
      buyer_id: String(reservation.buyer_id),
      catalog_item_id: String(reservation.catalog_item_id),
      project_id: reservation.project_id ? String(reservation.project_id) : current.project_id,
      currency: reservation.currency,
      catalog_price: String(reservation.catalog_price),
      negotiated_price: String(reservation.negotiated_price),
    }));
  }, [editingId, reservations]);

  useEffect(() => {
    if (form.origin_mode !== 'RESERVATION' || !linkedReservation) return;
    setForm((current) => ({
      ...current,
      buyer_id: String(linkedReservation.buyer_id),
      catalog_item_id: String(linkedReservation.catalog_item_id),
      project_id: linkedReservation.project_id ? String(linkedReservation.project_id) : '',
      currency: linkedReservation.currency,
      catalog_price: String(linkedReservation.catalog_price ?? ''),
      negotiated_price: String(linkedReservation.negotiated_price ?? ''),
    }));
  }, [form.origin_mode, linkedReservation]);

  useEffect(() => {
    if (form.origin_mode === 'RESERVATION') return;
    if (!form.catalog_item_id) return;
    const selectedCatalog = catalog.find((item) => String(item.id) === form.catalog_item_id);
    if (!selectedCatalog) return;
    if (form.project_id && String(selectedCatalog.project_id ?? '') !== form.project_id) {
      setForm((current) => ({ ...current, catalog_item_id: '' }));
    }
  }, [catalog, form.catalog_item_id, form.origin_mode, form.project_id]);

  async function refreshSimulation() {
    setSimulating(true);
    setError(null);
    try {
      const response = await simulateSalesSubscription(buildSubscriptionPayload(form));
      setSimulation(response);
    } catch (simulationError) {
      setError(getErrorMessage(simulationError));
    } finally {
      setSimulating(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = buildSubscriptionPayload(form);
      const response = editingId
        ? await updateSalesSubscription(editingId, payload)
        : await createSalesSubscription(payload);
      navigate(`/sales/subscriptions/${response.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={editingId ? 'Modifier une souscription' : 'Nouvelle souscription'}
      subtitle="Formulaire structuré, simulation d’échéancier et validations métier avant engagement."
      activeTab="subscriptions"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/subscriptions/${editingId}` : '/sales/subscriptions'}>Retour</Link>}
    >
      <SalesSection title="Paramètres de souscription" description="Acquéreur, bien, acompte, fréquence et notes de contractualisation.">
        {loading ? <SalesInlineNotice>Chargement de la souscription…</SalesInlineNotice> : null}
        {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
        {!loading && (
          <form className="sales-v21-form" onSubmit={handleSubmit}>
            <SalesFormSection title="Rattachement" description="Origine commerciale et entités liées.">
              <SalesInlineNotice>Le numéro de souscription est généré automatiquement à l’enregistrement.</SalesInlineNotice>
              <SalesField label="Mode d’origine">
                <select className="sales-v21-select" value={form.origin_mode} onChange={(event) => setForm((current) => ({ ...current, origin_mode: event.target.value, reservation_id: event.target.value === 'DIRECT' ? '' : current.reservation_id }))}>
                  {SALES_SUBSCRIPTION_ORIGIN_MODES.map((item) => <option key={item} value={item}>{item === 'RESERVATION' ? 'Depuis une réservation' : 'Souscription directe'}</option>)}
                </select>
              </SalesField>
              <SalesField label="Réservation liée">
                <select className="sales-v21-select" value={form.reservation_id} disabled={form.origin_mode !== 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, reservation_id: event.target.value }))}>
                  <option value="">{form.origin_mode === 'RESERVATION' ? 'Sélectionner une réservation' : 'Mode direct sans réservation'}</option>
                  {reservations.map((item) => <option key={item.id} value={item.id}>{item.reservation_number}</option>)}
                </select>
              </SalesField>
              <SalesField label="Acquéreur">
                <select className="sales-v21-select" value={form.buyer_id} disabled={form.origin_mode === 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, buyer_id: event.target.value }))}>
                  <option value="">Sélectionner</option>
                  {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.full_name || buyer.company_name || buyer.buyer_ref}</option>)}
                </select>
              </SalesField>
              <SalesField label="Projet">
                <select className="sales-v21-select" value={form.project_id} disabled={form.origin_mode === 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value }))}>
                  <option value="">{form.origin_mode === 'RESERVATION' ? 'Projet imposé par la réservation' : 'Sélectionner un projet'}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </SalesField>
              <SalesField label="Bien">
                <select
                  className="sales-v21-select"
                  value={form.catalog_item_id}
                  disabled={form.origin_mode === 'RESERVATION' || !form.project_id}
                  onChange={(event) => setForm((current) => ({ ...current, catalog_item_id: event.target.value }))}
                >
                  <option value="">{form.origin_mode === 'RESERVATION' ? 'Bien imposé par la réservation' : form.project_id ? 'Sélectionner' : 'Choisissez d’abord un projet'}</option>
                  {filteredCatalog.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.catalog_ref}</option>)}
                </select>
              </SalesField>
              <SalesField label="Statut initial">
                <select className="sales-v21-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  {SALES_SUBSCRIPTION_STATUSES.map((item) => <option key={item} value={item}>{subscriptionOptionsStatus(item)}</option>)}
                </select>
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Montants" description="Prix final, remise et structure de l’acompte.">
              <SalesField label="Devise">
                <select className="sales-v21-select" value={form.currency} disabled={form.origin_mode === 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>
                  {(settings?.allowed_currencies ?? SALES_SUPPORTED_CURRENCIES).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Prix catalogue">
                <input className="sales-v21-input" inputMode="decimal" value={form.catalog_price} readOnly={form.origin_mode === 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, catalog_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Prix final négocié">
                <input className="sales-v21-input" inputMode="decimal" value={form.negotiated_price} readOnly={form.origin_mode === 'RESERVATION'} onChange={(event) => setForm((current) => ({ ...current, negotiated_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Remise" hint="Optionnel si vous pilotez directement par prix final.">
                <input className="sales-v21-input" inputMode="decimal" value={form.discount_amount} onChange={(event) => setForm((current) => ({ ...current, discount_amount: event.target.value }))} />
              </SalesField>
              <SalesField label="Type d’acompte">
                <select className="sales-v21-select" value={form.deposit_type} onChange={(event) => setForm((current) => ({ ...current, deposit_type: event.target.value }))}>
                  {SALES_DEPOSIT_TYPES.map((item) => <option key={item} value={item}>{item === 'PERCENTAGE' ? 'Pourcentage' : 'Montant fixe'}</option>)}
                </select>
              </SalesField>
              <SalesField label="Acompte %" hint={form.deposit_type === 'PERCENTAGE' ? 'Utilisé pour calculer le montant.' : 'Optionnel si acompte fixe.'}>
                <input className="sales-v21-input" inputMode="decimal" value={form.deposit_percentage} onChange={(event) => setForm((current) => ({ ...current, deposit_percentage: event.target.value }))} />
              </SalesField>
              <SalesField label="Acompte montant">
                <input className="sales-v21-input" inputMode="decimal" value={form.deposit_amount} onChange={(event) => setForm((current) => ({ ...current, deposit_amount: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Échéancier" description="Cadence, première échéance et éventuel planning personnalisé.">
              <SalesField label="Nombre d’échéances" hint={`Maximum conseillé : ${settings?.maximum_installment_count ?? 24}`}>
                <input className="sales-v21-input" inputMode="numeric" value={form.installment_count} onChange={(event) => setForm((current) => ({ ...current, installment_count: event.target.value }))} />
              </SalesField>
              <SalesField label="Fréquence">
                <select className="sales-v21-select" value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}>
                  {SALES_SCHEDULE_FREQUENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Première échéance">
                <input className="sales-v21-input" type="date" value={form.first_due_date} onChange={(event) => setForm((current) => ({ ...current, first_due_date: event.target.value }))} />
              </SalesField>
              <SalesField label="Période de grâce (jours)">
                <input className="sales-v21-input" inputMode="numeric" value={form.grace_period_days} onChange={(event) => setForm((current) => ({ ...current, grace_period_days: event.target.value }))} />
              </SalesField>
              <SalesField label="Notes">
                <textarea className="sales-v21-textarea" rows={5} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            {form.frequency === 'CUSTOM' ? (
              <SalesFormSection title="Échéancier personnalisé" description="Saisissez vos lignes manuellement pour une simulation fine.">
                {(form.custom_installments.length ? form.custom_installments : [{ amount: 0, currency: form.currency, installment_type: 'CUSTOM' }]).map((item, index) => (
                  <div key={`${index}-${item.sequence_number ?? index + 1}`} className="sales-v21-form-grid">
                    <SalesField label={`Ligne ${index + 1} — libellé`}>
                      <input
                        className="sales-v21-input"
                        value={item.label ?? ''}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          custom_installments: (current.custom_installments.length ? current.custom_installments : [{ amount: 0, currency: current.currency, installment_type: 'CUSTOM' }]).map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry),
                        }))}
                      />
                    </SalesField>
                    <SalesField label="Date">
                      <input
                        className="sales-v21-input"
                        type="date"
                        value={item.due_date ?? ''}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          custom_installments: (current.custom_installments.length ? current.custom_installments : [{ amount: 0, currency: current.currency, installment_type: 'CUSTOM' }]).map((entry, entryIndex) => entryIndex === index ? { ...entry, due_date: event.target.value } : entry),
                        }))}
                      />
                    </SalesField>
                    <SalesField label="Montant">
                      <input
                        className="sales-v21-input"
                        inputMode="decimal"
                        value={String(item.amount ?? '')}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          custom_installments: (current.custom_installments.length ? current.custom_installments : [{ amount: 0, currency: current.currency, installment_type: 'CUSTOM' }]).map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: Number(event.target.value || 0) } : entry),
                        }))}
                      />
                    </SalesField>
                  </div>
                ))}
                <button
                  className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                  type="button"
                  onClick={() => setForm((current) => ({
                    ...current,
                    custom_installments: [
                      ...current.custom_installments,
                      {
                        sequence_number: current.custom_installments.length + 1,
                        label: '',
                        due_date: current.first_due_date,
                        amount: 0,
                        currency: current.currency,
                        installment_type: 'CUSTOM',
                      },
                    ],
                  }))}
                >
                  Ajouter une ligne
                </button>
              </SalesFormSection>
            ) : null}

            <SalesSection
              title="Simulateur compact"
              description="Calculez immédiatement l’acompte, le solde et les lignes d’échéancier avant enregistrement."
              action={<button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" disabled={simulating} onClick={() => void refreshSimulation()}>{simulating ? 'Simulation…' : 'Actualiser la simulation'}</button>}
            >
              {simulation ? (
                <>
                  <SalesKpiGrid>
                    <SalesKpiCard label="Prix final" value={formatCurrency(simulation.summary.final_sale_price, simulation.summary.currency)} helper={`Remise : ${formatCurrency(simulation.summary.discount_amount, simulation.summary.currency)}`} />
                    <SalesKpiCard label="Acompte" value={formatCurrency(simulation.summary.deposit_amount, simulation.summary.currency)} helper={`Solde : ${formatCurrency(simulation.summary.remaining_amount, simulation.summary.currency)}`} />
                    <SalesKpiCard label="Échéances" value={simulation.summary.total_installments} helper={simulation.summary.approval_required ? 'Validation manager requise' : 'Validation standard'} />
                    <SalesKpiCard label="Alerte remise" value={simulation.summary.approval_required ? 'Oui' : 'Non'} helper={simulation.summary.approval_reason || 'Aucune'} />
                  </SalesKpiGrid>
                  <SalesDataTable
                    rowKey={(item) => `${item.sequence_number}-${item.label}`}
                    rows={simulation.installments}
                    columns={[
                      { key: 'sequence', label: '#', render: (item) => item.sequence_number },
                      { key: 'label', label: 'Libellé', render: (item) => item.label || 'Échéance' },
                      { key: 'due_date', label: 'Échéance', render: (item) => formatDate(item.due_date) },
                      { key: 'amount', label: 'Montant', render: (item) => formatCurrency(item.amount, item.currency) },
                      { key: 'type', label: 'Type', render: (item) => item.installment_type || 'REGULAR' },
                    ]}
                  />
                </>
              ) : (
                <SalesEmptyState title="Aucune simulation" description="Complétez le formulaire puis lancez la simulation pour visualiser l’échéancier." />
              )}
            </SalesSection>

            <SalesFormActions>
              <Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/subscriptions/${editingId}` : '/sales/subscriptions'}>Annuler</Link>
              <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer la souscription'}</button>
            </SalesFormActions>
          </form>
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesSubscriptionDetailPage() {
  const { id } = useParams();
  const subscriptionId = Number(id);
  const { can } = useAuth();
  const [item, setItem] = useState<SalesSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{
    actionKey: string;
    title: string;
    description: string;
    confirmLabel: string;
    reason: string;
    error: string | null;
    handler: (reason: string) => Promise<unknown>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesSubscription(subscriptionId);
        if (!cancelled) setItem(response);
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

  async function runAction(label: string, handler: () => Promise<unknown>) {
    setBusyAction(label);
    setError(null);
    try {
      const response = await handler();
      setItem(response as SalesSubscription);
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  async function runReasonedAction(label: string, actionLabel: string, handler: (reason: string) => Promise<unknown>) {
    setReasonDialog({
      actionKey: label,
      title: actionLabel,
      description: 'Cette action sera journalisée avec son motif. Aucun appel API ne part avant votre confirmation.',
      confirmLabel: actionLabel,
      reason: '',
      error: null,
      handler,
    });
  }

  async function confirmReasonDialog() {
    if (!reasonDialog) return;
    const trimmedReason = reasonDialog.reason.trim();
    if (!trimmedReason) {
      setReasonDialog((current) => current ? { ...current, error: 'Un motif est obligatoire pour poursuivre cette action.' } : current);
      return;
    }
    setBusyAction(reasonDialog.actionKey);
    setError(null);
    setReasonDialog((current) => current ? { ...current, error: null } : current);
    try {
      const response = await reasonDialog.handler(trimmedReason);
      setItem(response as SalesSubscription);
      setReasonDialog(null);
    } catch (actionError) {
      const message = getErrorMessage(actionError);
      setReasonDialog((current) => current ? { ...current, error: message } : current);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <SalesModulePage
      title={item?.subscription_number || 'Souscription'}
      subtitle="Vue compacte du financement, de l’approbation et de l’échéancier du client."
      activeTab="subscriptions"
      action={
        <div className="sales-v21-header-actions">
          <Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/subscriptions">Retour</Link>
          {item && can('sales_subscriptions.update') ? <Link className="sales-v21-btn sales-v21-btn-primary" to={`/sales/subscriptions/${item.id}/edit`}>Modifier</Link> : null}
        </div>
      }
    >
      {loading ? <SalesInlineNotice>Chargement de la souscription…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {item ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Acquéreur" value={item.buyer_name || 'Donnée non disponible'} helper={item.buyer_ref || 'Référence acquéreur'} />
            <SalesKpiCard label="Prix final" value={formatCurrency(item.final_sale_price, item.currency)} helper={`Acompte : ${formatCurrency(item.deposit_amount, item.currency)}`} />
            <SalesKpiCard label="Solde financé" value={formatCurrency(item.financed_balance, item.currency)} helper={`${item.installment_count} échéances`} />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={subscriptionOptionsStatus(item.status)} tone={getStatusTone(item.status)} />} helper={`1re échéance : ${formatDate(item.first_due_date)}`} />
          </SalesKpiGrid>

          <div className="sales-v21-two-columns">
            <SalesSection title="Résumé contractuel" description="Points de contrôle avant approbation ou rejet.">
              <SalesInfoList
                items={[
                  { label: 'Bien', value: item.catalog_title || item.catalog_ref || '—' },
                  { label: 'Projet', value: item.project_name || '—' },
                  { label: 'Réservation liée', value: item.reservation_number || 'Aucune' },
                  { label: 'Fréquence', value: salesFrequencyLabel(item.frequency) },
                  { label: 'Approuvée le', value: item.approved_at ? formatDate(item.approved_at) : '—' },
                ]}
              />
              <p className="sales-v21-reservation-note">{item.notes || 'Aucune note contractuelle.'}</p>
            </SalesSection>

            <SalesSection title="Actions métier" description="Bloc compact : action principale prioritaire, actions sensibles regroupées et journalisées avec motif.">
              <SalesDetailActionsCard
                primaryAction={
                  can('sales_subscriptions.update') && ['DRAFT', 'REJECTED'].includes(item.status)
                    ? {
                        key: 'submit',
                        label: busyAction === 'submit' ? 'Soumission…' : 'Soumettre',
                        tone: 'primary',
                        disabled: busyAction === 'submit',
                        onClick: () => void runReasonedAction('submit', 'Soumettre la souscription', (reason) => submitSalesSubscription(item.id, { reason })),
                      }
                    : can('sales_subscriptions.approve') && item.status === 'SUBMITTED'
                      ? {
                          key: 'approve',
                          label: busyAction === 'approve' ? 'Validation…' : 'Approuver',
                          tone: 'primary',
                          disabled: busyAction === 'approve',
                          onClick: () => void runReasonedAction('approve', 'Approuver la souscription', (reason) => approveSalesSubscription(item.id, { reason })),
                        }
                      : null
                }
                editHref={can('sales_subscriptions.update') ? `/sales/subscriptions/${item.id}/edit` : null}
                secondaryActions={[
                  can('sales_subscriptions.update') && item.status === 'SUBMITTED'
                    ? {
                        key: 'reject',
                        label: busyAction === 'reject' ? 'Rejet…' : 'Rejeter',
                        tone: 'danger',
                        disabled: busyAction === 'reject',
                        onClick: () => void runReasonedAction('reject', 'Rejeter la souscription', (reason) => rejectSalesSubscription(item.id, { reason })),
                      }
                    : null,
                  can('sales_subscriptions.cancel') && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(item.status)
                    ? {
                        key: 'cancel',
                        label: busyAction === 'cancel' ? 'Annulation…' : 'Annuler',
                        tone: 'danger',
                        disabled: busyAction === 'cancel',
                        onClick: () => void runReasonedAction('cancel', 'Annuler la souscription', (reason) => cancelSalesSubscription(item.id, { reason })),
                      }
                    : null,
                ].filter(Boolean) as SalesDetailAction[]}
                hint="Soumission, approbation, rejet et annulation exigent un motif puis une confirmation."
              />
            </SalesSection>
          </div>

          <SalesSection title="Échéancier" description="Plan de paiement détaillé généré par la souscription.">
            {item.installments?.length ? (
              <SalesDataTable
                rowKey={(installment) => `${installment.sequence_number}-${installment.label}`}
                rows={item.installments}
                columns={[
                  { key: 'sequence', label: '#', render: (installment) => installment.sequence_number },
                  { key: 'label', label: 'Libellé', render: (installment) => installment.label || 'Échéance' },
                  { key: 'due_date', label: 'Date', render: (installment) => formatDate(installment.due_date) },
                  { key: 'amount', label: 'Montant', render: (installment) => formatCurrency(installment.amount, installment.currency) },
                  { key: 'type', label: 'Type', render: (installment) => installment.installment_type || 'REGULAR' },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucune ligne d’échéancier" description="Le plan de paiement apparaîtra ici après simulation et enregistrement." />
            )}
          </SalesSection>

          <SalesSection
            title="Documents contractuels"
            description="Contrat de souscription et pièces générées à partir du gabarit actif."
            action={can('sales_documents.regenerate') ? (
              <button
                className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                type="button"
                disabled={busyAction === 'document'}
                onClick={() => void runAction('document', async () => {
                  await regenerateSalesSubscriptionDocument(item.id);
                  return getSalesSubscription(item.id);
                })}
              >
                Régénérer le contrat
              </button>
            ) : null}
          >
            {item.documents?.length ? (
              <SalesDataTable
                rowKey={(document) => document.id}
                rows={item.documents}
                columns={[
                  { key: 'number', label: 'Document', render: (document) => document.document_number },
                  { key: 'type', label: 'Type', render: (document) => document.template_type },
                  { key: 'status', label: 'Statut', render: (document) => document.generation_status || 'PENDING' },
                  { key: 'date', label: 'Généré le', render: (document) => formatDate(document.generated_at || document.created_at) },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (document) => (
                      <div className="sales-v21-table-actions">
                        <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void triggerDocumentDownload(document)}>
                          Télécharger
                        </button>
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <SalesEmptyState title="Aucun contrat généré" description="Le contrat PDF apparaîtra ici après la première génération documentaire." />
            )}
          </SalesSection>
        </>
      ) : null}
      <SalesActionDialog
        open={Boolean(reasonDialog)}
        title={reasonDialog?.title || 'Confirmer l’action'}
        description={reasonDialog?.description || ''}
        entitySummary={
          item ? (
            <>
              <p><strong>{item.subscription_number || 'Souscription'}</strong></p>
              <p>{item.buyer_name || item.catalog_title || item.catalog_ref || 'Dossier commercial'}</p>
            </>
          ) : undefined
        }
        confirmLabel={reasonDialog?.confirmLabel || 'Confirmer'}
        reason={reasonDialog?.reason || ''}
        busy={Boolean(reasonDialog && busyAction === reasonDialog.actionKey)}
        error={reasonDialog?.error || null}
        onReasonChange={(value) => setReasonDialog((current) => current ? { ...current, reason: value, error: current.error && value.trim() ? null : current.error } : current)}
        onCancel={() => {
          if (busyAction) return;
          setReasonDialog(null);
        }}
        onConfirm={() => void confirmReasonDialog()}
      />
    </SalesModulePage>
  );
}

type TemplateEditorTab = 'editor' | 'variables' | 'preview';
type TemplateType = 'RESERVATION_CONTRACT' | 'SUBSCRIPTION_CONTRACT';
type TemplateStarterMode = 'EMPTY' | 'STANDARD';

type TemplateVariableDefinition = {
  label: string;
  code: string;
  example: string;
};

const SALES_TEMPLATE_GROUPS: Record<TemplateType, Array<{ title: string; items: TemplateVariableDefinition[] }>> = {
  RESERVATION_CONTRACT: [
    {
      title: 'Organisation',
      items: [
        { label: 'Nom de l’organisation', code: '{{organization.name}}', example: 'SALES Internal Test' },
        { label: 'Adresse', code: '{{organization.address}}', example: 'Kinshasa, Gombe' },
        { label: 'Téléphone', code: '{{organization.phone}}', example: '+243 999 000 000' },
        { label: 'Email', code: '{{organization.email}}', example: 'contact@example.com' },
        { label: 'Raison sociale', code: '{{organization.legal_name}}', example: 'NG Property ERP' },
        { label: 'Numéro fiscal', code: '{{organization.tax_number}}', example: 'A0001234X' },
      ],
    },
    {
      title: 'Acquéreur',
      items: [
        { label: 'Référence acquéreur', code: '{{buyer.number}}', example: 'ACQ-2026-00012' },
        { label: 'Nom', code: '{{buyer.name}}', example: 'Glody Ngoma' },
        { label: 'Téléphone', code: '{{buyer.phone}}', example: '+243 815 000 000' },
        { label: 'Email', code: '{{buyer.email}}', example: 'glody@example.com' },
        { label: 'Adresse', code: '{{buyer.address}}', example: 'Kinshasa' },
        { label: 'Pièce d’identité', code: '{{buyer.identity_number}}', example: 'ID-778899' },
      ],
    },
    {
      title: 'Projet & Bien',
      items: [
        { label: 'Référence projet', code: '{{project.number}}', example: 'PRJ-2026-0004' },
        { label: 'Nom du projet', code: '{{project.name}}', example: 'Résidence Horizon' },
        { label: 'Localisation projet', code: '{{project.location}}', example: 'Kinshasa / Ngaliema' },
        { label: 'Référence bien', code: '{{property.number}}', example: 'BIE-2026-0005' },
        { label: 'Titre du bien', code: '{{property.title}}', example: 'Appartement A12' },
        { label: 'Type du bien', code: '{{property.type}}', example: 'Appartement' },
        { label: 'Localisation du bien', code: '{{property.location}}', example: 'Bloc A' },
        { label: 'Surface', code: '{{property.surface}}', example: '120 m²' },
      ],
    },
    {
      title: 'Réservation',
      items: [
        { label: 'Numéro de réservation', code: '{{reservation.number}}', example: 'RSV-2026-00003' },
        { label: 'Date de réservation', code: '{{reservation.date}}', example: '18 août 2026' },
        { label: 'Date d’expiration', code: '{{reservation.expiration_date}}', example: '25 août 2026' },
        { label: 'Devise', code: '{{reservation.currency}}', example: 'USD' },
        { label: 'Prix catalogue', code: '{{reservation.catalog_price}}', example: '160 000,00 USD' },
        { label: 'Prix négocié', code: '{{reservation.negotiated_price}}', example: '150 000,00 USD' },
        { label: 'Frais de réservation', code: '{{reservation.fee_amount}}', example: '2 000,00 USD' },
      ],
    },
    {
      title: 'Génération',
      items: [
        { label: 'Date de génération', code: '{{generation.date}}', example: '18 août 2026' },
        { label: 'Utilisateur', code: '{{user.name}}', example: 'Utilisateur #12' },
      ],
    },
  ],
  SUBSCRIPTION_CONTRACT: [
    {
      title: 'Organisation',
      items: [
        { label: 'Nom de l’organisation', code: '{{organization.name}}', example: 'SALES Internal Test' },
        { label: 'Adresse', code: '{{organization.address}}', example: 'Kinshasa, Gombe' },
        { label: 'Téléphone', code: '{{organization.phone}}', example: '+243 999 000 000' },
        { label: 'Email', code: '{{organization.email}}', example: 'contact@example.com' },
        { label: 'Raison sociale', code: '{{organization.legal_name}}', example: 'NG Property ERP' },
        { label: 'Numéro fiscal', code: '{{organization.tax_number}}', example: 'A0001234X' },
      ],
    },
    {
      title: 'Acquéreur',
      items: [
        { label: 'Référence acquéreur', code: '{{buyer.number}}', example: 'ACQ-2026-00012' },
        { label: 'Nom', code: '{{buyer.name}}', example: 'Glody Ngoma' },
        { label: 'Téléphone', code: '{{buyer.phone}}', example: '+243 815 000 000' },
        { label: 'Email', code: '{{buyer.email}}', example: 'glody@example.com' },
        { label: 'Adresse', code: '{{buyer.address}}', example: 'Kinshasa' },
        { label: 'Pièce d’identité', code: '{{buyer.identity_number}}', example: 'ID-778899' },
      ],
    },
    {
      title: 'Projet & Bien',
      items: [
        { label: 'Référence projet', code: '{{project.number}}', example: 'PRJ-2026-0004' },
        { label: 'Nom du projet', code: '{{project.name}}', example: 'Résidence Horizon' },
        { label: 'Localisation projet', code: '{{project.location}}', example: 'Kinshasa / Ngaliema' },
        { label: 'Référence bien', code: '{{property.number}}', example: 'BIE-2026-0005' },
        { label: 'Titre du bien', code: '{{property.title}}', example: 'Appartement A12' },
        { label: 'Type du bien', code: '{{property.type}}', example: 'Appartement' },
        { label: 'Localisation du bien', code: '{{property.location}}', example: 'Bloc A' },
        { label: 'Surface', code: '{{property.surface}}', example: '120 m²' },
      ],
    },
    {
      title: 'Souscription',
      items: [
        { label: 'Numéro de souscription', code: '{{subscription.number}}', example: 'SOU-2026-00002' },
        { label: 'Origine', code: '{{subscription.origin}}', example: 'Réservation' },
        { label: 'Date', code: '{{subscription.date}}', example: '18 août 2026' },
        { label: 'Devise', code: '{{subscription.currency}}', example: 'USD' },
        { label: 'Prix catalogue', code: '{{subscription.catalog_price}}', example: '160 000,00 USD' },
        { label: 'Remise', code: '{{subscription.discount}}', example: '10 000,00 USD' },
        { label: 'Prix final', code: '{{subscription.final_price}}', example: '150 000,00 USD' },
        { label: 'Acompte %', code: '{{subscription.deposit_percentage}}', example: '20 %' },
        { label: 'Acompte montant', code: '{{subscription.deposit_amount}}', example: '30 000,00 USD' },
        { label: 'Solde financé', code: '{{subscription.financed_balance}}', example: '120 000,00 USD' },
        { label: 'Fréquence', code: '{{subscription.frequency}}', example: 'MONTHLY' },
        { label: 'Nombre d’échéances', code: '{{subscription.installment_count}}', example: '12' },
        { label: 'Première échéance', code: '{{subscription.first_due_date}}', example: '30 septembre 2026' },
      ],
    },
    {
      title: 'Génération',
      items: [
        { label: 'Date de génération', code: '{{generation.date}}', example: '18 août 2026' },
        { label: 'Utilisateur', code: '{{user.name}}', example: 'Utilisateur #12' },
        { label: 'Tableau échéancier', code: '{{installments.table}}', example: 'Tableau HTML généré automatiquement' },
      ],
    },
  ],
};

const REQUIRED_TEMPLATE_VARIABLES: Record<TemplateType, string[]> = {
  RESERVATION_CONTRACT: ['buyer.name', 'property.title', 'reservation.number'],
  SUBSCRIPTION_CONTRACT: ['buyer.name', 'property.title', 'subscription.number'],
};

function standardReservationTemplateBody() {
  return `<div class="contract-meta">
  <div>
    <span class="contract-label">Numéro de réservation</span>
    <span class="contract-value">{{reservation.number}}</span>
  </div>
  <div>
    <span class="contract-label">Date d’édition</span>
    <span class="contract-value">{{generation.date}}</span>
  </div>
  <div>
    <span class="contract-label">Projet</span>
    <span class="contract-value">{{project.name}}</span>
  </div>
  <div>
    <span class="contract-label">Bien réservé</span>
    <span class="contract-value">{{property.title}}</span>
  </div>
</div>
<section class="contract-section">
  <h2>1. Parties au contrat</h2>
  <p>Entre <strong>{{organization.legal_name}}</strong>, sise à {{organization.address}}, joignable au {{organization.phone}} et à l’adresse {{organization.email}}, ci-après dénommée « le Vendeur ».</p>
  <p>Et <strong>{{buyer.name}}</strong>, référence dossier {{buyer.number}}, joignable au {{buyer.phone}} et identifié si besoin sous le numéro {{buyer.identity_number}}, ci-après dénommé « l’Acquéreur ».</p>
</section>
<section class="contract-section">
  <h2>2. Objet de la réservation</h2>
  <p>Le Vendeur réserve à l’Acquéreur le bien <strong>{{property.title}}</strong>, référence {{property.number}}, de type {{property.type}}, situé à {{property.location}} dans le projet <strong>{{project.name}}</strong>.</p>
  <p class="contract-note">Surface indicative : {{property.surface}}.</p>
</section>
<section class="contract-section">
  <h2>3. Conditions financières</h2>
  <p>Le prix catalogue du bien est de <strong>{{reservation.catalog_price}}</strong>. Le prix négocié retenu pour cette réservation est de <strong>{{reservation.negotiated_price}}</strong>.</p>
  <p>Les frais de réservation convenus s’élèvent à <strong>{{reservation.fee_amount}}</strong> dans la devise {{reservation.currency}}.</p>
</section>
<section class="contract-section">
  <h2>4. Durée et validité</h2>
  <p>La présente réservation prend effet le <strong>{{reservation.date}}</strong> et demeure valable jusqu’au <strong>{{reservation.expiration_date}}</strong>, sauf confirmation, conversion ou annulation anticipée conformément aux règles commerciales en vigueur.</p>
</section>
<section class="contract-section">
  <h2>5. Engagements des parties</h2>
  <ul>
    <li>Le Vendeur s’engage à maintenir le bien indisponible à la vente pendant la période de réservation validée.</li>
    <li>L’Acquéreur s’engage à compléter les formalités de souscription dans le délai prévu ou à notifier toute difficulté majeure au Vendeur.</li>
    <li>Les documents et informations transmis dans le cadre du dossier doivent rester exacts, complets et à jour.</li>
  </ul>
</section>
<section class="contract-section">
  <h2>6. Signatures</h2>
  <p>Fait à Kinshasa, le {{generation.date}}, en deux exemplaires de même valeur probante.</p>
  <div class="contract-signatures">
    <div class="contract-signature">
      <strong>Pour le Vendeur</strong>
      Nom, fonction et signature
    </div>
    <div class="contract-signature">
      <strong>Pour l’Acquéreur</strong>
      {{buyer.name}}
    </div>
  </div>
</section>`;
}

function standardSubscriptionTemplateBody() {
  return `<div class="contract-meta">
  <div>
    <span class="contract-label">Numéro de souscription</span>
    <span class="contract-value">{{subscription.number}}</span>
  </div>
  <div>
    <span class="contract-label">Origine</span>
    <span class="contract-value">{{subscription.origin}}</span>
  </div>
  <div>
    <span class="contract-label">Projet</span>
    <span class="contract-value">{{project.name}}</span>
  </div>
  <div>
    <span class="contract-label">Bien souscrit</span>
    <span class="contract-value">{{property.title}}</span>
  </div>
</div>
<section class="contract-section">
  <h2>1. Parties au contrat</h2>
  <p>Entre <strong>{{organization.legal_name}}</strong>, sise à {{organization.address}}, ci-après dénommée « le Vendeur »,</p>
  <p>Et <strong>{{buyer.name}}</strong>, dossier {{buyer.number}}, joignable au {{buyer.phone}} et identifié sous {{buyer.identity_number}}, ci-après dénommé « l’Acquéreur ».</p>
</section>
<section class="contract-section">
  <h2>2. Objet de la souscription</h2>
  <p>Le présent contrat confirme la souscription du bien <strong>{{property.title}}</strong>, référence {{property.number}}, situé à {{property.location}}, au sein du projet <strong>{{project.name}}</strong>.</p>
  <p class="contract-note">Type : {{property.type}} — Surface indicative : {{property.surface}}.</p>
</section>
<section class="contract-section">
  <h2>3. Conditions financières</h2>
  <p>Le prix catalogue est fixé à <strong>{{subscription.catalog_price}}</strong>. La remise commerciale consentie s’élève à <strong>{{subscription.discount}}</strong>.</p>
  <p>Le prix final de vente est arrêté à <strong>{{subscription.final_price}}</strong>. L’acompte attendu représente {{subscription.deposit_percentage}} soit <strong>{{subscription.deposit_amount}}</strong>.</p>
  <p>Le solde financé restant dû après acompte est de <strong>{{subscription.financed_balance}}</strong>.</p>
</section>
<section class="contract-section">
  <h2>4. Modalités de paiement</h2>
  <p>La souscription est traitée selon une fréquence <strong>{{subscription.frequency}}</strong> avec <strong>{{subscription.installment_count}}</strong> échéances à compter du <strong>{{subscription.first_due_date}}</strong>.</p>
  {{installments.table}}
</section>
<section class="contract-section">
  <h2>5. Dispositions finales</h2>
  <ul>
    <li>Tout retard, ajustement ou changement de statut doit être formalisé dans le dossier commercial de l’organisation.</li>
    <li>Les clauses particulières, annexes et justificatifs approuvés font partie intégrante du présent contrat.</li>
    <li>Les signatures ci-dessous valent accord sur les montants, la fréquence et l’échéancier ci-dessus.</li>
  </ul>
</section>
<section class="contract-section">
  <h2>6. Signatures</h2>
  <p>Fait à Kinshasa, le {{generation.date}}.</p>
  <div class="contract-signatures">
    <div class="contract-signature">
      <strong>Pour le Vendeur</strong>
      Nom, fonction et signature
    </div>
    <div class="contract-signature">
      <strong>Pour l’Acquéreur</strong>
      {{buyer.name}}
    </div>
  </div>
</section>`;
}

function buildDefaultSalesTemplate(templateType: TemplateType): SalesDocumentTemplate {
  return {
    id: 0,
    organization_id: 0,
    template_type: templateType,
    title: templateType === 'RESERVATION_CONTRACT' ? 'Contrat de réservation' : 'Contrat de souscription',
    template_body: templateType === 'RESERVATION_CONTRACT' ? standardReservationTemplateBody() : standardSubscriptionTemplateBody(),
    header_html: '',
    footer_html: '',
    variables_schema: [],
    clause_order: [],
    version: 1,
    is_active: true,
    used_documents_count: 0,
  };
}

function mergeTemplatesWithDefaults(templates: SalesDocumentTemplate[]) {
  return [
    ...templates,
    ...(['RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT'] as const)
      .filter((type) => !templates.some((item) => item.template_type === type))
      .map((type) => buildDefaultSalesTemplate(type)),
  ];
}

function normalizeTemplateText(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length ? trimmed : null;
}

export function buildSalesTemplatePayload(template: SalesDocumentTemplate): SalesDocumentTemplatePayload {
  return {
    template_type: template.template_type,
    title: String(template.title ?? '').trim(),
    template_body: String(template.template_body ?? '').trim(),
    header_html: normalizeTemplateText(template.header_html),
    footer_html: normalizeTemplateText(template.footer_html),
    variables_schema: template.variables_schema ?? [],
    clause_order: template.clause_order ?? [],
    is_active: template.is_active ?? true,
  };
}

function escapePreviewHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function flattenTemplateSnapshot(prefix: string, value: unknown, target: Record<string, string>) {
  if (value == null) {
    target[prefix] = '';
    return;
  }
  if (typeof value === 'string') {
    target[prefix] = value;
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    target[prefix] = String(value);
    return;
  }
  if (Array.isArray(value)) {
    target[prefix] = value.join(', ');
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    flattenTemplateSnapshot(prefix ? `${prefix}.${key}` : key, nestedValue, target);
  });
}

function detectTemplateVariables(content: string) {
  return [...new Set((content.match(/\{\{\s*([^}]+?)\s*\}\}/g) ?? []).map((entry) => entry.replace(/^\{\{\s*|\s*\}\}$/g, '').trim()))];
}

function formatTemplateMoney(value?: number | null, currency?: string | null) {
  if (value == null || Number.isNaN(Number(value))) return 'Donnée non disponible';
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))} ${String(currency || 'USD').toUpperCase()}`;
}

function formatTemplateDate(value?: string | null) {
  if (!value) return 'Donnée non disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Donnée non disponible';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date);
}

function formatTemplateSurface(value?: number | null) {
  if (value == null || Number.isNaN(Number(value)) || Number(value) <= 0) return 'Donnée non disponible';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(value))} m²`;
}

function compactTemplateSegments(parts: Array<unknown>, separator = ', ') {
  return parts
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(separator);
}
function buildInstallmentsPreviewTable(installments: SalesSubscriptionInstallment[] | undefined, currency?: string | null) {
  if (!installments?.length) {
    return '<p>Aucun échéancier disponible.</p>';
  }
  const rows = installments.map((installment) => `
    <tr>
      <td>${escapePreviewHtml(installment.sequence_number)}</td>
      <td>${escapePreviewHtml(installment.label || 'Échéance')}</td>
      <td>${escapePreviewHtml(formatTemplateDate(installment.due_date))}</td>
      <td>${escapePreviewHtml(formatTemplateMoney(installment.amount, installment.currency || currency))}</td>
    </tr>
  `).join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead>
        <tr>
          <th style="border:1px solid #d6dde5;padding:8px;text-align:left;">#</th>
          <th style="border:1px solid #d6dde5;padding:8px;text-align:left;">Libellé</th>
          <th style="border:1px solid #d6dde5;padding:8px;text-align:left;">Échéance</th>
          <th style="border:1px solid #d6dde5;padding:8px;text-align:left;">Montant</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildReservationPreviewSnapshot(
  reservation: SalesReservation,
  buyers: SalesBuyer[],
  catalog: SalesCatalogItem[],
  projects: SalesProject[],
) {
  const buyer = buyers.find((item) => item.id === reservation.buyer_id);
  const property = catalog.find((item) => item.id === reservation.catalog_item_id);
  const project = projects.find((item) => item.id === (reservation.project_id ?? property?.project_id));
  return {
    organization: {
      name: 'SALES Internal Test',
      address: 'Kinshasa, Gombe',
      phone: '+243 000 000 000',
      email: 'sales@test.local',
      legal_name: 'SALES Internal Test',
      contact_block: '<br />Kinshasa, Gombe<br />+243 000 000 000<br />sales@test.local',
      party_summary: compactTemplateSegments([
        'SALES Internal Test',
        'sise à Kinshasa, Gombe',
        'joignable au +243 000 000 000 et à l’adresse sales@test.local',
      ]),
      tax_number: 'N/A',
    },
    buyer: {
      number: reservation.buyer_ref || buyer?.buyer_ref || 'Donnée non disponible',
      name: reservation.buyer_name || buyer?.full_name || buyer?.company_name || 'Donnée non disponible',
      phone: buyer?.phone || 'Donnée non disponible',
      email: buyer?.email || 'Donnée non disponible',
      address: buyer?.address || 'Donnée non disponible',
      identity_number: buyer?.id_document_number || 'Donnée non disponible',
      party_summary: compactTemplateSegments([
        reservation.buyer_name || buyer?.full_name || buyer?.company_name || 'Donnée non disponible',
        "référence dossier ",
        buyer?.phone ? "joignable au " : '',
        buyer?.id_document_number ? "identifié sous le numéro " : '',
      ]),
    },
    project: {
      number: project?.project_ref || 'Donnée non disponible',
      name: reservation.project_name || project?.name || 'Donnée non disponible',
      location: project?.location_label || 'Donnée non disponible',
    },
    property: {
      number: reservation.catalog_ref || property?.catalog_ref || 'Donnée non disponible',
      title: reservation.catalog_title || property?.title || 'Donnée non disponible',
      type: property?.property_type || 'Donnée non disponible',
      location: property?.location_label || 'Donnée non disponible',
      surface: formatTemplateSurface(property?.surface_area),
      designation: compactTemplateSegments([
        reservation.catalog_title || property?.title || 'Donnée non disponible',
        (reservation.catalog_ref || property?.catalog_ref) ? "référence " : '',
        property?.property_type ? "de type " : '',
        property?.location_label ? "situé à " : '',
      ]),
      surface_note: property?.surface_area ? ('Surface indicative : ' + formatTemplateSurface(property?.surface_area) + '.') : '',
    },
    reservation: {
      number: reservation.reservation_number,
      date: formatTemplateDate(reservation.reservation_date),
      expiration_date: formatTemplateDate(reservation.expires_at),
      status: RESERVATION_STATUS_LABELS[reservation.status] || reservation.status || 'Donnée non disponible',
      currency: reservation.currency,
      catalog_price: formatTemplateMoney(reservation.catalog_price, reservation.currency),
      negotiated_price: formatTemplateMoney(reservation.negotiated_price, reservation.currency),
      fee_amount: formatTemplateMoney(reservation.reservation_fee, reservation.currency),
    },
    generation: {
      date: formatTemplateDate(new Date().toISOString()),
    },
    user: {
      name: 'Utilisateur de prévisualisation',
    },
  };
}

function buildSubscriptionPreviewSnapshot(
  subscription: SalesSubscription,
  buyers: SalesBuyer[],
  catalog: SalesCatalogItem[],
  projects: SalesProject[],
) {
  const buyer = buyers.find((item) => item.id === subscription.buyer_id);
  const property = catalog.find((item) => item.id === subscription.catalog_item_id);
  const project = projects.find((item) => item.id === (subscription.project_id ?? property?.project_id));
  return {
    organization: {
      name: 'SALES Internal Test',
      address: 'Kinshasa, Gombe',
      phone: '+243 000 000 000',
      email: 'sales@test.local',
      legal_name: 'SALES Internal Test',
      contact_block: '<br />Kinshasa, Gombe<br />+243 000 000 000<br />sales@test.local',
      party_summary: compactTemplateSegments([
        'SALES Internal Test',
        'sise à Kinshasa, Gombe',
        'joignable au +243 000 000 000 et à l’adresse sales@test.local',
      ]),
      tax_number: 'N/A',
    },
    buyer: {
      number: subscription.buyer_ref || buyer?.buyer_ref || 'Donnée non disponible',
      name: subscription.buyer_name || buyer?.full_name || buyer?.company_name || 'Donnée non disponible',
      phone: buyer?.phone || 'Donnée non disponible',
      email: buyer?.email || 'Donnée non disponible',
      address: buyer?.address || 'Donnée non disponible',
      identity_number: buyer?.id_document_number || 'Donnée non disponible',
      party_summary: compactTemplateSegments([
        subscription.buyer_name || buyer?.full_name || buyer?.company_name || 'Donnée non disponible',
        `dossier ${subscription.buyer_ref || buyer?.buyer_ref || 'Donnée non disponible'}`,
        buyer?.phone ? `joignable au ${buyer.phone}` : '',
        buyer?.id_document_number ? `identifié sous le numéro ${buyer.id_document_number}` : '',
      ]),
    },
    project: {
      number: project?.project_ref || 'Donnée non disponible',
      name: subscription.project_name || project?.name || 'Donnée non disponible',
      location: project?.location_label || 'Donnée non disponible',
    },
    property: {
      number: subscription.catalog_ref || property?.catalog_ref || 'Donnée non disponible',
      title: subscription.catalog_title || property?.title || 'Donnée non disponible',
      type: property?.property_type || 'Donnée non disponible',
      location: property?.location_label || 'Donnée non disponible',
      surface: formatTemplateSurface(property?.surface_area),
      designation: compactTemplateSegments([
        subscription.catalog_title || property?.title || 'Donnée non disponible',
        (subscription.catalog_ref || property?.catalog_ref) ? `référence ${subscription.catalog_ref || property?.catalog_ref}` : '',
        property?.property_type ? `de type ${property.property_type}` : '',
        property?.location_label ? `situé à ${property.location_label}` : '',
      ]),
      surface_note: property?.surface_area ? ('Surface indicative : ' + formatTemplateSurface(property?.surface_area) + '.') : '',
    },
    reservation: {
      number: subscription.reservation_number || 'Aucune',
    },
    subscription: {
      number: subscription.subscription_number,
      origin: TEMPLATE_PREVIEW_ORIGIN_LABELS[subscription.reservation_id ? 'RESERVATION' : 'DIRECT'],
      date: formatTemplateDate(subscription.created_at),
      status: SUBSCRIPTION_STATUS_LABELS[subscription.status] || subscription.status || 'Donnée non disponible',
      currency: subscription.currency,
      catalog_price: formatTemplateMoney(subscription.catalog_price, subscription.currency),
      discount: formatTemplateMoney(subscription.discount_amount, subscription.currency),
      final_price: formatTemplateMoney(subscription.final_sale_price, subscription.currency),
      deposit_percentage: subscription.deposit_percentage != null ? `${Number(subscription.deposit_percentage).toFixed(0)} %` : 'Donnée non disponible',
      deposit_amount: formatTemplateMoney(subscription.deposit_amount, subscription.currency),
      financed_balance: formatTemplateMoney(subscription.financed_balance, subscription.currency),
      frequency: TEMPLATE_PREVIEW_FREQUENCY_LABELS[subscription.frequency ?? ''] || subscription.frequency || 'Donnée non disponible',
      installment_count: String(subscription.installment_count ?? '0'),
      first_due_date: formatTemplateDate(subscription.first_due_date),
    },
    generation: {
      date: formatTemplateDate(new Date().toISOString()),
    },
    user: {
      name: 'Utilisateur de prévisualisation',
    },
    installments: {
      table: buildInstallmentsPreviewTable(subscription.installments, subscription.currency),
    },
  };
}

function renderTemplatePreview(template: SalesDocumentTemplate, snapshot: Record<string, unknown>) {
  const flat: Record<string, string> = {};
  flattenTemplateSnapshot('', snapshot, flat);
  const replaceTokens = (content?: string | null) => {
    const raw = String(content ?? '').trim();
    if (!raw) return '';
    const placeholders = new Map<string, string>();
    let index = 0;
    const withTokens = raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawToken: string) => {
      const token = rawToken.trim();
      if (token === 'installments.table' || token === 'organization.contact_block') {
        const placeholder = `__SALES_PREVIEW_HTML_${index += 1}__`;
        placeholders.set(placeholder, flat[token] ?? '<p class="contract-note">Valeur indisponible</p>');
        return placeholder;
      }
      return escapePreviewHtml(flat[token] ?? `{{${token}}}`);
    });
    const rendered = hasPreviewHtmlMarkup(withTokens)
      ? sanitizePreviewMarkup(withTokens)
      : renderPlainTextPreviewMarkup(withTokens);
    let finalMarkup = rendered;
    for (const [placeholder, value] of placeholders.entries()) {
      finalMarkup = finalMarkup.split(placeholder).join(value);
    }
    return finalMarkup;
  };
  return `
    <div style="position:relative;background:#eef4fb;border:1px solid #dce3ea;border-radius:22px;padding:24px;overflow:hidden;">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:.08;font-size:44px;font-weight:800;transform:rotate(-18deg);color:#203845;">APERÇU — NON CONTRACTUEL</div>
      <div style="position:relative;max-width:820px;margin:0 auto;background:#fff;border:1px solid #d9e2ec;border-radius:18px;padding:32px;box-shadow:0 18px 42px rgba(16,35,63,.08);color:#12243d;font-family:Arial,sans-serif;line-height:1.65;">
        <style>
          .contract-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px}
          .contract-meta > div{border:1px solid #e4eaf1;border-radius:10px;padding:10px 12px;background:#f8fbff}
          .contract-label{display:block;color:#63758d;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px}
          .contract-value{font-weight:700;color:#10233f}
          .contract-section{margin-bottom:16px}
          .contract-section h2{margin:0 0 8px;font-size:14px;line-height:1.35;color:#10233f;text-transform:uppercase;letter-spacing:.04em}
          .contract-signatures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}
          .contract-signature{border-top:1px solid #cdd8e4;padding-top:10px;min-height:70px}
          .contract-signature strong{display:block;margin-bottom:18px}
          .contract-note{color:#5d6f86;font-size:12px}
          table{width:100%;border-collapse:collapse;margin-top:12px}
          th,td{border:1px solid #d8e0ea;padding:8px 10px;text-align:left;vertical-align:top}
          th{background:#f4f8fc;color:#39506b;font-size:11px;text-transform:uppercase}
          p{margin:0 0 10px;text-align:justify}
        </style>
        ${template.header_html ? `<div style="margin-bottom:18px;color:#51606f;font-size:12px;">${replaceTokens(template.header_html)}</div>` : ''}
        <h2 style="margin:0 0 18px;font-size:24px;color:#102033;">${escapePreviewHtml(template.title)}</h2>
        <div style="color:#203845;">${replaceTokens(template.template_body)}</div>
        ${template.footer_html ? `<div style="margin-top:18px;color:#51606f;font-size:12px;">${replaceTokens(template.footer_html)}</div>` : ''}
      </div>
    </div>
  `;
}

function validateTemplateDraft(template: SalesDocumentTemplate) {
  const payload = buildSalesTemplatePayload(template);
  const variables = detectTemplateVariables(payload.template_body);
  const allowedVariables = new Set(SALES_TEMPLATE_GROUPS[template.template_type as TemplateType].flatMap((group) => group.items.map((item) => item.code.replace(/^\{\{|\}\}$/g, ''))));
  const unknownVariables = variables.filter((item) => !allowedVariables.has(item));
  if (!payload.template_body.trim()) {
    return { ok: false as const, message: 'Le modèle doit contenir au minimum un corps contractuel et les informations des parties.' };
  }
  if (unknownVariables.length && payload.is_active !== false) {
    return { ok: false as const, message: `Variable inconnue : {{${unknownVariables[0]}}}` };
  }
  const missingRequired = REQUIRED_TEMPLATE_VARIABLES[template.template_type as TemplateType].filter((item) => !variables.includes(item));
  if (missingRequired.length && payload.is_active !== false) {
    return { ok: false as const, message: 'Le modèle doit contenir au minimum un corps contractuel et les informations des parties.' };
  }
  return { ok: true as const, payload };
}

export function SalesSettingsPage() {
  const location = useLocation();
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const [templates, setTemplates] = useState<SalesDocumentTemplate[]>([]);
  const [subscriptionPreviewItems, setSubscriptionPreviewItems] = useState<SalesSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTemplateType, setActiveTemplateType] = useState<TemplateType>('RESERVATION_CONTRACT');
  const [activeEditorTab, setActiveEditorTab] = useState<TemplateEditorTab>('editor');
  const [variableSearch, setVariableSearch] = useState('');
  const [previewReservationId, setPreviewReservationId] = useState('');
  const [previewSubscriptionId, setPreviewSubscriptionId] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [editingNumberingField, setEditingNumberingField] = useState<null | {
    key: keyof SalesSettings;
    label: string;
    description: string;
    fallback: string;
    value: string;
  }>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const editorSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const { buyers, catalog, projects, reservations } = useSalesReferenceData();

  const settingsSection = useMemo<'numbering' | 'rules' | 'templates'>(() => {
    if (location.pathname.endsWith('/rules')) return 'rules';
    if (location.pathname.endsWith('/templates')) return 'templates';
    return 'numbering';
  }, [location.pathname]);

  const numberingItems = useMemo(
    () => ([
      { key: 'buyer_number_format', label: 'Format acquéreur', description: 'Référence commerciale des acquéreurs.', fallback: 'BUY-2026-0001' },
      { key: 'project_number_format', label: 'Format projet', description: 'Identification commerciale des projets.', fallback: 'PRJ-2026-0001' },
      { key: 'catalog_number_format', label: 'Format bien', description: 'Numérotation du catalogue commercial.', fallback: 'LOT-2026-0001' },
      { key: 'reservation_number_format', label: 'Format réservation', description: 'Numéros générés pour les réservations.', fallback: 'RSV-2026-0001' },
      { key: 'subscription_number_format', label: 'Format souscription', description: 'Numéros générés pour les souscriptions.', fallback: 'SUB-2026-0001' },
      { key: 'reservation_payment_number_format', label: 'Format paiement', description: 'Paiements de frais de réservation.', fallback: 'PAY-2026-0001' },
      { key: 'reservation_receipt_number_format', label: 'Format reçu', description: 'Reçus des paiements de réservation.', fallback: 'RCT-2026-0001' },
      { key: 'reservation_contract_number_format', label: 'Format contrat de réservation', description: 'Numéro du contrat de réservation.', fallback: 'CTR-RSV-2026-0001' },
      { key: 'subscription_contract_number_format', label: 'Format contrat de souscription', description: 'Numéro du contrat de souscription.', fallback: 'CTR-SUB-2026-0001' },
    ] satisfies Array<{ key: keyof SalesSettings; label: string; description: string; fallback: string }>),
    [],
  );

  const settingsNavItems = useMemo(
    () => [
      { key: 'numbering', label: 'Numérotation', to: '/sales/settings/numbering', isActive: settingsSection === 'numbering' },
      { key: 'rules', label: 'Règles opérationnelles', to: '/sales/settings/rules', isActive: settingsSection === 'rules' },
      { key: 'templates', label: 'Modèles contractuels', to: '/sales/settings/templates', isActive: settingsSection === 'templates' },
    ],
    [settingsSection],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [settingsResponse, templatesResponse, subscriptionsResponse] = await Promise.all([
          getSalesSettings(),
          listSalesDocumentTemplates(),
          listSalesSubscriptions({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
        ]);
        if (cancelled) return;
        setSettings(settingsResponse);
        setTemplates(mergeTemplatesWithDefaults(templatesResponse));
        setSubscriptionPreviewItems(subscriptionsResponse.items);
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
  }, []);

  const currentTemplateVersions = useMemo(
    () => templates.filter((item) => item.template_type === activeTemplateType).sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0)),
    [activeTemplateType, templates],
  );

  const currentTemplate = useMemo(
    () => currentTemplateVersions[0] ?? buildDefaultSalesTemplate(activeTemplateType),
    [activeTemplateType, currentTemplateVersions],
  );

  const filteredVariableGroups = useMemo(() => {
    const needle = variableSearch.trim().toLowerCase();
    return SALES_TEMPLATE_GROUPS[activeTemplateType]
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !needle
          || item.label.toLowerCase().includes(needle)
          || item.code.toLowerCase().includes(needle)
          || item.example.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length);
  }, [activeTemplateType, variableSearch]);

  function updateTemplateDraft(templateType: TemplateType, updater: (template: SalesDocumentTemplate) => SalesDocumentTemplate) {
    setTemplates((current) => {
      const typedTemplates = current
        .filter((item) => item.template_type === templateType)
        .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0));
      const editableTemplate = typedTemplates[0];
      if (!editableTemplate) return [...current, updater(buildDefaultSalesTemplate(templateType))];
      return current.map((item) => item.id === editableTemplate.id ? updater(item) : item);
    });
  }

  function insertVariable(code: string) {
    const textarea = editorRef.current;
    const fallbackLength = currentTemplate.template_body.length;
    const start = textarea?.selectionStart ?? editorSelectionRef.current.start ?? fallbackLength;
    const end = textarea?.selectionEnd ?? editorSelectionRef.current.end ?? fallbackLength;
    updateTemplateDraft(activeTemplateType, (template) => ({
      ...template,
      template_body: `${template.template_body.slice(0, start)}${code}${template.template_body.slice(end)}`,
    }));
    editorSelectionRef.current = { start: start + code.length, end: start + code.length };
    window.requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      const position = start + code.length;
      textarea.setSelectionRange(position, position);
    });
  }

  async function copyVariable(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setPreviewError('Impossible de copier la variable automatiquement.');
    }
  }

  function applyStarterTemplate(mode: TemplateStarterMode) {
    updateTemplateDraft(activeTemplateType, (template) => ({
      ...template,
      title: activeTemplateType === 'RESERVATION_CONTRACT' ? 'Contrat de réservation' : 'Contrat de souscription',
      template_body: mode === 'EMPTY'
        ? ''
        : activeTemplateType === 'RESERVATION_CONTRACT'
          ? standardReservationTemplateBody()
          : standardSubscriptionTemplateBody(),
    }));
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateSalesSettings(settings);
      setSettings(saved);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveNumberingField() {
    if (!settings || !editingNumberingField) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateSalesSettings({
        ...settings,
        [editingNumberingField.key]: editingNumberingField.value.trim(),
      });
      setSettings(saved);
      setEditingNumberingField(null);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(template: SalesDocumentTemplate) {
    const validation = validateTemplateDraft(template);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (template.id) {
        await updateSalesDocumentTemplate(template.id, validation.payload);
      } else {
        await createSalesDocumentTemplate(validation.payload);
      }
      const refreshed = await listSalesDocumentTemplates();
      setTemplates(mergeTemplatesWithDefaults(refreshed));
      setActiveTemplateType(template.template_type as TemplateType);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function refreshPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      if (activeTemplateType === 'RESERVATION_CONTRACT') {
        if (!previewReservationId) {
          setPreviewError('Sélectionnez une réservation de test pour générer l’aperçu.');
          setPreviewHtml('');
          return;
        }
        const reservation = await getSalesReservation(Number(previewReservationId));
        const snapshot = buildReservationPreviewSnapshot(reservation, buyers, catalog, projects);
        setPreviewHtml(renderTemplatePreview(currentTemplate, snapshot));
      } else {
        if (!previewSubscriptionId) {
          setPreviewError('Sélectionnez une souscription de test pour générer l’aperçu.');
          setPreviewHtml('');
          return;
        }
        const subscription = await getSalesSubscription(Number(previewSubscriptionId));
        const snapshot = buildSubscriptionPreviewSnapshot(subscription, buyers, catalog, projects);
        setPreviewHtml(renderTemplatePreview(currentTemplate, snapshot));
      }
    } catch (previewLoadError) {
      setPreviewError(getErrorMessage(previewLoadError));
      setPreviewHtml('');
    } finally {
      setPreviewLoading(false);
    }
  }

  function openPreviewPrintWindow() {
    if (!previewHtml) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=860');
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><meta charset="UTF-8" /><title>Aperçu modèle Sales</title></head><body style="margin:24px;background:#f5f7fa;font-family:Arial,sans-serif;">${previewHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function downloadPreviewHtml() {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeTemplateType.toLowerCase()}-preview.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SalesModulePage
      title="Paramètres métier"
      subtitle="Numérotation, règles opérationnelles et modèles contractuels structurés par rubriques dédiées."
      activeTab="settings"
    >
      <SalesSubNavigation items={settingsNavItems} />
      {loading ? <SalesInlineNotice>Chargement des paramètres…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      {settings && settingsSection === 'numbering' ? (
        <SalesSection title="Numérotation" description="Formats actuels, exemple généré et édition ciblée sans exposer les identifiants SQL internes.">
          <div className="sales-v21-settings-grid">
            {numberingItems.map((item) => {
              const currentFormat = String(settings[item.key] ?? '');
              return (
                <div key={String(item.key)} className="sales-v21-settings-row">
                  <div className="sales-v21-settings-row-label">
                    <strong>{item.label}</strong>
                    <p>{item.description}</p>
                  </div>
                  <div className="sales-v21-settings-row-value">
                    <strong>{currentFormat || 'Non défini'}</strong>
                    <p>Format actuel</p>
                  </div>
                  <div className="sales-v21-settings-example" title={buildNumberingExample(currentFormat, item.fallback)}>
                    {buildNumberingExample(currentFormat, item.fallback)}
                  </div>
                  <button
                    className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                    type="button"
                    onClick={() => setEditingNumberingField({
                      key: item.key,
                      label: item.label,
                      description: item.description,
                      fallback: item.fallback,
                      value: currentFormat,
                    })}
                  >
                    Modifier
                  </button>
                </div>
              );
            })}
          </div>

          {editingNumberingField ? (
            <SalesFormSection title={`Modifier — ${editingNumberingField.label}`} description="Le format est enregistré tel quel, puis immédiatement réinjecté dans l’aperçu généré.">
              <SalesField label="Format">
                <input className="sales-v21-input" value={editingNumberingField.value} onChange={(event) => setEditingNumberingField((current) => current ? { ...current, value: event.target.value } : current)} />
              </SalesField>
              <SalesField label="Exemple généré">
                <input className="sales-v21-input" value={buildNumberingExample(editingNumberingField.value, editingNumberingField.fallback)} readOnly />
              </SalesField>
              <SalesFormActions>
                <button className="sales-v21-btn sales-v21-btn-secondary" type="button" onClick={() => setEditingNumberingField(null)}>Annuler</button>
                <button className="sales-v21-btn sales-v21-btn-primary" type="button" disabled={saving} onClick={() => void saveNumberingField()}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </SalesFormActions>
            </SalesFormSection>
          ) : null}
        </SalesSection>
      ) : null}

      {settings && settingsSection === 'rules' ? (
        <form className="sales-v21-form" onSubmit={saveSettings}>
          <div className="sales-v21-rule-grid">
            <div className="sales-v21-rule-card">
              <h3>Durée par défaut d’une réservation</h3>
              <p>Nombre de jours proposé lors de la création d’une réservation.</p>
              <SalesField label="Durée (jours)">
                <input className="sales-v21-input" inputMode="numeric" value={String(settings.reservation_default_duration_days ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, reservation_default_duration_days: Number(event.target.value || 0) } : current)} />
              </SalesField>
            </div>
            <div className="sales-v21-rule-card">
              <h3>Acompte minimum</h3>
              <p>Montant ou pourcentage exigé avant validation du plan de paiement.</p>
              <SalesField label="Type d’acompte">
                <select className="sales-v21-select" value={settings.minimum_deposit_type ?? 'PERCENTAGE'} onChange={(event) => setSettings((current) => current ? { ...current, minimum_deposit_type: event.target.value } : current)}>
                  {SALES_DEPOSIT_TYPES.map((item) => <option key={item} value={item}>{item === 'PERCENTAGE' ? 'Pourcentage' : 'Montant fixe'}</option>)}
                </select>
              </SalesField>
              <SalesField label="Pourcentage minimum">
                <input className="sales-v21-input" inputMode="decimal" value={String(settings.minimum_deposit_percentage ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, minimum_deposit_percentage: Number(event.target.value || 0) } : current)} />
              </SalesField>
              <SalesField label="Montant minimum">
                <input className="sales-v21-input" inputMode="decimal" value={String(settings.minimum_deposit_amount ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, minimum_deposit_amount: Number(event.target.value || 0) } : current)} />
              </SalesField>
            </div>
            <div className="sales-v21-rule-card">
              <h3>Échéancier</h3>
              <p>Fréquence par défaut et plafond du nombre d’échéances.</p>
              <SalesField label="Nombre maximal d’échéances">
                <input className="sales-v21-input" inputMode="numeric" value={String(settings.maximum_installment_count ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, maximum_installment_count: Number(event.target.value || 0) } : current)} />
              </SalesField>
              <SalesField label="Fréquence par défaut">
                <select className="sales-v21-select" value={settings.default_installment_frequency ?? 'MONTHLY'} onChange={(event) => setSettings((current) => current ? { ...current, default_installment_frequency: event.target.value } : current)}>
                  {SALES_SCHEDULE_FREQUENCIES.map((item) => <option key={item} value={item}>{salesFrequencyLabel(item)}</option>)}
                </select>
              </SalesField>
            </div>
            <div className="sales-v21-rule-card">
              <h3>Frais de réservation</h3>
              <p>Présentation compacte des règles déjà validées en V3.1.5.</p>
              <SalesField label="Frais convenus">
                <input className="sales-v21-input" inputMode="decimal" value={String(settings.reservation_default_fee ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, reservation_default_fee: Number(event.target.value || 0) } : current)} />
              </SalesField>
              <SalesField label="Déductibilité des frais">
                <input className="sales-v21-input" value={reservationFeeDeductibilityLabel(settings.reservation_fee_deductibility)} readOnly />
              </SalesField>
              <SalesField label="Pourcentage déductible">
                <input className="sales-v21-input" inputMode="decimal" value={String(settings.reservation_fee_deductible_percentage ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, reservation_fee_deductible_percentage: Number(event.target.value || 0) } : current)} />
              </SalesField>
            </div>
            <div className="sales-v21-rule-card">
              <h3>Traitement comptable</h3>
              <p>Lecture claire du traitement actuellement appliqué aux frais.</p>
              <SalesField label="Traitement comptable">
                <input className="sales-v21-input" value={accountingTreatmentLabel(settings.reservation_fee_accounting_treatment)} readOnly />
              </SalesField>
            </div>
            <div className="sales-v21-rule-card">
              <h3>Génération documentaire</h3>
              <p>Conserve le comportement métier existant, présenté sans jargon technique.</p>
              <SalesField label="Génération automatique des contrats">
                <input className="sales-v21-input" value={boolSettingLabel(settings.contract_generation_mode === 'AUTO')} readOnly />
              </SalesField>
              <SalesField label="Génération automatique des reçus">
                <input className="sales-v21-input" value={boolSettingLabel(settings.settings_json?.auto_receipts === true)} readOnly />
              </SalesField>
            </div>
          </div>

          <SalesFormActions>
            <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}</button>
          </SalesFormActions>
        </form>
      ) : null}

      {settingsSection === 'templates' ? (
        <SalesSection
          title="Modèles contractuels"
          description="Édition stricte des modèles publics, versionnés automatiquement et limités aux variables autorisées."
          action={
            <div className="sales-v21-table-actions">
              <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => applyStarterTemplate('EMPTY')}>
                Modèle vide
              </button>
              <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => applyStarterTemplate('STANDARD')}>
                Modèle standard
              </button>
              <button className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact" type="button" disabled={saving} onClick={() => void saveTemplate(currentTemplate)}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          }
        >
          <div className="sales-v21-template-grid">
            {mergeTemplatesWithDefaults(templates).map((template) => (
              <article key={`${template.template_type}-${template.id ?? 'draft'}`} className={['sales-v21-template-card', activeTemplateType === template.template_type ? 'is-active' : ''].filter(Boolean).join(' ')}>
                <div className="sales-v21-template-meta">
                  <h3>{template.template_type === 'RESERVATION_CONTRACT' ? 'Modèle de réservation' : 'Modèle de souscription'}</h3>
                  <p>Version active : v{template.version ?? 1}</p>
                  <p>État : {template.is_active ? 'Actif' : 'Brouillon'}</p>
                  <p>Dernière modification : {formatDate(template.updated_at)}</p>
                </div>
                <div className="sales-v21-table-actions">
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => { setActiveTemplateType(template.template_type as TemplateType); setActiveEditorTab('editor'); }}>
                    Modifier
                  </button>
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => { setActiveTemplateType(template.template_type as TemplateType); setActiveEditorTab('preview'); }}>
                    Aperçu
                  </button>
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => { setActiveTemplateType(template.template_type as TemplateType); setActiveEditorTab('editor'); }}>
                    Historique
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="sales-v21-filter-bar">
            <select className="sales-v21-select" value={activeTemplateType} onChange={(event) => setActiveTemplateType(event.target.value as TemplateType)}>
              <option value="RESERVATION_CONTRACT">Contrat de réservation</option>
              <option value="SUBSCRIPTION_CONTRACT">Contrat de souscription</option>
            </select>
            <div className="sales-v21-table-actions">
              <button className={`sales-v21-btn ${activeEditorTab === 'editor' ? 'sales-v21-btn-primary' : 'sales-v21-btn-secondary'} sales-v21-btn-compact`} type="button" onClick={() => setActiveEditorTab('editor')}>Éditeur</button>
              <button className={`sales-v21-btn ${activeEditorTab === 'variables' ? 'sales-v21-btn-primary' : 'sales-v21-btn-secondary'} sales-v21-btn-compact`} type="button" onClick={() => setActiveEditorTab('variables')}>Variables</button>
              <button className={`sales-v21-btn ${activeEditorTab === 'preview' ? 'sales-v21-btn-primary' : 'sales-v21-btn-secondary'} sales-v21-btn-compact`} type="button" onClick={() => setActiveEditorTab('preview')}>Aperçu</button>
            </div>
          </div>

          <SalesKpiGrid>
            <SalesKpiCard label="Version active" value={`v${currentTemplate.version ?? 1}`} helper={currentTemplate.is_active ? 'Active' : 'Brouillon'} />
            <SalesKpiCard label="Documents générés" value={`${currentTemplate.used_documents_count ?? 0}`} helper="usage observé" />
            <SalesKpiCard label="Historique" value={`${currentTemplateVersions.length}`} helper="versions disponibles" />
            <SalesKpiCard label="Type affiché" value={activeTemplateType === 'RESERVATION_CONTRACT' ? 'Réservation' : 'Souscription'} helper="rubrique active" />
          </SalesKpiGrid>

          {activeEditorTab === 'editor' ? (
            <div className="sales-v21-form">
              <SalesFormSection title="Éditeur de modèle" description="Le payload envoyé au backend reste strictement limité aux champs publics autorisés.">
                <SalesField label="Titre">
                  <input className="sales-v21-input" value={currentTemplate.title} onChange={(event) => updateTemplateDraft(activeTemplateType, (template) => ({ ...template, title: event.target.value }))} />
                </SalesField>
                <SalesField label="En-tête">
                  <textarea className="sales-v21-textarea" rows={4} value={currentTemplate.header_html ?? ''} onChange={(event) => updateTemplateDraft(activeTemplateType, (template) => ({ ...template, header_html: event.target.value }))} />
                </SalesField>
                <SalesField label="Corps du contrat">
                  <textarea
                    ref={editorRef}
                    className="sales-v21-textarea"
                    rows={18}
                    value={currentTemplate.template_body}
                    onChange={(event) => {
                      editorSelectionRef.current = {
                        start: event.target.selectionStart ?? event.target.value.length,
                        end: event.target.selectionEnd ?? event.target.value.length,
                      };
                      updateTemplateDraft(activeTemplateType, (template) => ({ ...template, template_body: event.target.value }));
                    }}
                    onClick={(event) => {
                      editorSelectionRef.current = {
                        start: event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                        end: event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
                      };
                    }}
                    onKeyUp={(event) => {
                      editorSelectionRef.current = {
                        start: event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                        end: event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
                      };
                    }}
                    onSelect={(event) => {
                      editorSelectionRef.current = {
                        start: event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                        end: event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
                      };
                    }}
                  />
                </SalesField>
                <SalesField label="Pied de page">
                  <textarea className="sales-v21-textarea" rows={4} value={currentTemplate.footer_html ?? ''} onChange={(event) => updateTemplateDraft(activeTemplateType, (template) => ({ ...template, footer_html: event.target.value }))} />
                </SalesField>
                <SalesField label="Activation">
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input type="checkbox" checked={currentTemplate.is_active ?? true} onChange={(event) => updateTemplateDraft(activeTemplateType, (template) => ({ ...template, is_active: event.target.checked }))} />
                    <span>Activer cette version à l’enregistrement</span>
                  </label>
                </SalesField>
              </SalesFormSection>

              <SalesSection title="Historique des versions" description="Une modification produit une nouvelle version au lieu d’écraser une version déjà utilisée.">
                {currentTemplateVersions.length ? (
                  <SalesDataTable
                    rowKey={(item) => `${item.id}-${item.version}`}
                    rows={currentTemplateVersions}
                    columns={[
                      { key: 'version', label: 'Version', render: (item) => `v${item.version ?? 1}` },
                      { key: 'status', label: 'Statut', render: (item) => <SalesStatusBadge label={item.is_active ? 'Active' : 'Brouillon'} tone={item.is_active ? 'success' : 'warning'} /> },
                      { key: 'usage', label: 'Utilisée', render: (item) => `${item.used_documents_count ?? 0} document(s)` },
                      { key: 'updated', label: 'Mise à jour', render: (item) => formatDate(item.updated_at) },
                    ]}
                  />
                ) : (
                  <SalesEmptyState title="Aucune version enregistrée" description="Le premier enregistrement créera la version initiale du modèle." />
                )}
              </SalesSection>
            </div>
          ) : null}

          {activeEditorTab === 'variables' ? (
            <div className="sales-v21-form">
              <SalesFilterBar>
                <input className="sales-v21-input" placeholder="Rechercher une variable" value={variableSearch} onChange={(event) => setVariableSearch(event.target.value)} />
              </SalesFilterBar>
              {filteredVariableGroups.map((group) => (
                <SalesSection key={group.title} title={group.title} description="Cliquez sur Insérer pour placer la variable à la position courante du curseur.">
                  <SalesDataTable
                    rowKey={(item) => item.code}
                    rows={group.items}
                    columns={[
                      { key: 'label', label: 'Variable', render: (item) => item.label },
                      { key: 'code', label: 'Code', render: (item) => <code>{item.code}</code> },
                      { key: 'example', label: 'Exemple', render: (item) => item.example },
                      {
                        key: 'actions',
                        label: 'Actions',
                        render: (item) => (
                          <div className="sales-v21-table-actions">
                            <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => void copyVariable(item.code)}>
                              Copier
                            </button>
                            <button className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact" type="button" onClick={() => insertVariable(item.code)}>
                              Insérer
                            </button>
                          </div>
                        ),
                      },
                    ]}
                  />
                </SalesSection>
              ))}
            </div>
          ) : null}

          {activeEditorTab === 'preview' ? (
            <div className="sales-v21-form">
              <SalesFormSection title="Aperçu réel" description="Prévisualisation non contractuelle à partir des données autorisées de l’organisation.">
                {activeTemplateType === 'RESERVATION_CONTRACT' ? (
                  <SalesField label="Réservation de test">
                    <select className="sales-v21-select" value={previewReservationId} onChange={(event) => setPreviewReservationId(event.target.value)}>
                      <option value="">Choisir une réservation</option>
                      {reservations.map((reservation) => (
                        <option key={reservation.id} value={reservation.id}>
                          {reservation.reservation_number} — {reservation.buyer_name || reservation.catalog_title || 'Réservation'}
                        </option>
                      ))}
                    </select>
                  </SalesField>
                ) : (
                  <SalesField label="Souscription de test">
                    <select className="sales-v21-select" value={previewSubscriptionId} onChange={(event) => setPreviewSubscriptionId(event.target.value)}>
                      <option value="">Choisir une souscription</option>
                      {subscriptionPreviewItems.map((subscription) => (
                        <option key={subscription.id} value={subscription.id}>
                          {subscription.subscription_number} — {subscription.buyer_name || subscription.catalog_title || 'Souscription'}
                        </option>
                      ))}
                    </select>
                  </SalesField>
                )}
                <SalesFormActions>
                  <button className="sales-v21-btn sales-v21-btn-secondary" type="button" disabled={previewLoading} onClick={() => void refreshPreview()}>
                    {previewLoading ? 'Actualisation…' : 'Actualiser'}
                  </button>
                  <button className="sales-v21-btn sales-v21-btn-secondary" type="button" disabled={!previewHtml} onClick={openPreviewPrintWindow}>
                    Générer un aperçu PDF
                  </button>
                  <button className="sales-v21-btn sales-v21-btn-primary" type="button" disabled={!previewHtml} onClick={downloadPreviewHtml}>
                    Télécharger l’aperçu
                  </button>
                </SalesFormActions>
                {previewError ? <SalesInlineNotice tone="danger">{previewError}</SalesInlineNotice> : null}
                {previewHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <SalesEmptyState title="Aucun aperçu généré" description="Choisissez une réservation ou une souscription de test puis actualisez l’aperçu." />
                )}
              </SalesFormSection>
            </div>
          ) : null}
        </SalesSection>
      ) : null}
    </SalesModulePage>
  );
}
