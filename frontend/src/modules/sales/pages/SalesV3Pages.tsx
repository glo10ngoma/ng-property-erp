import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../core/auth/AuthContext';
import {
  approveSalesSubscription,
  cancelSalesReservation,
  cancelSalesSubscription,
  confirmSalesReservation,
  convertSalesReservation,
  createSalesReservation,
  createSalesSubscription,
  createSalesDocumentTemplate,
  downloadSalesDocument,
  expireSalesReservation,
  getSalesReservation,
  getSalesSettings,
  getSalesSubscription,
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
  SALES_RESERVATION_STATUSES,
  SALES_SCHEDULE_FREQUENCIES,
  SALES_SUBSCRIPTION_ORIGIN_MODES,
  SALES_SUBSCRIPTION_STATUSES,
  SALES_SUPPORTED_CURRENCIES,
  type CreateSalesReservationInput,
  type CreateSalesSubscriptionInput,
  type CustomInstallmentInput,
  type SalesBuyer,
  type SalesCatalogItem,
  type SalesDocumentGeneration,
  type SalesDocumentTemplate,
  type SalesProject,
  type SalesReservation,
  type SalesSettings,
  type SalesSubscription,
  type SalesSubscriptionInstallment,
  type SalesSubscriptionSimulation,
} from '../types';
import {
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
              <SalesField label="Frais de réservation convenus" hint={settings?.reservation_fee_required ? `Minimum configuré : ${settings.reservation_default_fee ?? 0}` : 'Montant convenu uniquement. L’encaissement sera branché en V3.1.1.'}>
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
  const navigate = useNavigate();
  const { id } = useParams();
  const reservationId = Number(id);
  const { can } = useAuth();
  const [item, setItem] = useState<SalesReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                  { label: 'Projet', value: item.project_name || 'Donnée non disponible' },
                  { label: 'Date de réservation', value: formatDate(item.reservation_date) },
                  { label: 'Expiration', value: formatDate(item.expires_at) },
                  { label: 'Confirmée le', value: formatDate(item.confirmed_at) },
                  { label: 'Annulée le', value: formatDate(item.cancelled_at) },
                ]}
              />
              <p>{item.notes || 'Aucune note complémentaire.'}</p>
            </SalesSection>

            <SalesSection title="Actions métier" description="Transitions autorisées selon le statut et les permissions.">
              <div className="sales-v21-table-actions">
                {can('sales_reservations.approve') && ['ACTIVE', 'DRAFT'].includes(item.status) ? (
                  <button className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact" type="button" disabled={busyAction === 'confirm'} onClick={() => void runAction('confirm', () => confirmSalesReservation(item.id))}>
                    Confirmer
                  </button>
                ) : null}
                {can('sales_reservations.cancel') && ['ACTIVE', 'CONFIRMED', 'DRAFT'].includes(item.status) ? (
                  <button className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact" type="button" disabled={busyAction === 'cancel'} onClick={() => void runAction('cancel', () => cancelSalesReservation(item.id, { reason: 'Annulation manuelle' }))}>
                    Annuler
                  </button>
                ) : null}
                {can('sales_reservations.update') && item.status === 'ACTIVE' ? (
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" disabled={busyAction === 'expire'} onClick={() => void runAction('expire', () => expireSalesReservation(item.id, { reason: 'Expiration manuelle' }))}>
                    Expirer
                  </button>
                ) : null}
                {can('sales_subscriptions.create') && ['ACTIVE', 'CONFIRMED'].includes(item.status) ? (
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" onClick={() => navigate(`/sales/subscriptions/new?reservation_id=${item.id}`)}>
                    Créer la souscription
                  </button>
                ) : null}
                {can('sales_reservations.update') && item.status === 'CONFIRMED' ? (
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" disabled={busyAction === 'convert'} onClick={() => void runAction('convert', () => convertSalesReservation(item.id, { reason: 'Conversion manuelle' }))}>
                    Convertir
                  </button>
                ) : null}
              </div>
            </SalesSection>
          </div>

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
  const navigate = useNavigate();
  const { id } = useParams();
  const subscriptionId = Number(id);
  const { can } = useAuth();
  const [item, setItem] = useState<SalesSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                  { label: 'Bien', value: item.catalog_title || item.catalog_ref || 'Donnée non disponible' },
                  { label: 'Projet', value: item.project_name || 'Donnée non disponible' },
                  { label: 'Réservation liée', value: item.reservation_number || 'Aucune' },
                  { label: 'Fréquence', value: item.frequency },
                  { label: 'Approuvée le', value: formatDate(item.approved_at) },
                ]}
              />
              <p>{item.notes || 'Aucune note contractuelle.'}</p>
            </SalesSection>

            <SalesSection title="Actions métier" description="Validation, rejet ou annulation selon le cycle d’approbation.">
              <div className="sales-v21-table-actions">
                {can('sales_subscriptions.update') && ['DRAFT', 'REJECTED'].includes(item.status) ? (
                  <button className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" type="button" disabled={busyAction === 'submit'} onClick={() => void runAction('submit', () => submitSalesSubscription(item.id, { reason: 'Soumission manuelle' }))}>
                    Soumettre
                  </button>
                ) : null}
                {can('sales_subscriptions.approve') && item.status === 'SUBMITTED' ? (
                  <button className="sales-v21-btn sales-v21-btn-primary sales-v21-btn-compact" type="button" disabled={busyAction === 'approve'} onClick={() => void runAction('approve', () => approveSalesSubscription(item.id, { reason: 'Validation manager' }))}>
                    Approuver
                  </button>
                ) : null}
                {can('sales_subscriptions.update') && item.status === 'SUBMITTED' ? (
                  <button className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact" type="button" disabled={busyAction === 'reject'} onClick={() => void runAction('reject', () => rejectSalesSubscription(item.id, { reason: 'Rejet manuel' }))}>
                    Rejeter
                  </button>
                ) : null}
                {can('sales_subscriptions.cancel') && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(item.status) ? (
                  <button className="sales-v21-btn sales-v21-btn-danger sales-v21-btn-compact" type="button" disabled={busyAction === 'cancel'} onClick={() => void runAction('cancel', () => cancelSalesSubscription(item.id, { reason: 'Annulation manuelle' }))}>
                    Annuler
                  </button>
                ) : null}
              </div>
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
    </SalesModulePage>
  );
}

export function SalesSettingsPage() {
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const [templates, setTemplates] = useState<SalesDocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [settingsResponse, templatesResponse] = await Promise.all([
          getSalesSettings(),
          listSalesDocumentTemplates(),
        ]);
        if (cancelled) return;
        setSettings(settingsResponse);
        setTemplates([
          ...templatesResponse,
          ...(['RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT'] as const)
            .filter((type) => !templatesResponse.some((item) => item.template_type === type))
            .map((template_type) => ({
              id: 0,
              organization_id: 0,
              template_type,
              title: template_type === 'RESERVATION_CONTRACT' ? 'Contrat de réservation' : 'Contrat de souscription',
              template_body: '',
              variables_schema: [],
            })),
        ]);
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

  async function saveTemplate(template: SalesDocumentTemplate) {
    setSaving(true);
    setError(null);
    try {
      const saved = template.id
        ? await updateSalesDocumentTemplate(template.id, template)
        : await createSalesDocumentTemplate(template);
      setTemplates((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
      });
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const reservationTemplate = templates.find((item) => item.template_type === 'RESERVATION_CONTRACT')
    ?? {
      id: 0,
      organization_id: 0,
      template_type: 'RESERVATION_CONTRACT',
      title: 'Contrat de réservation',
      template_body: '',
      variables_schema: [],
    };
  const subscriptionTemplate = templates.find((item) => item.template_type === 'SUBSCRIPTION_CONTRACT')
    ?? {
      id: 0,
      organization_id: 0,
      template_type: 'SUBSCRIPTION_CONTRACT',
      title: 'Contrat de souscription',
      template_body: '',
      variables_schema: [],
    };

  return (
    <SalesModulePage
      title="Paramètres métier"
      subtitle="Formats de numérotation, gabarits contractuels et réglages de cadence pour Sales V3.1."
      activeTab="settings"
    >
      {loading ? <SalesInlineNotice>Chargement des paramètres…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}
      {settings ? (
        <form className="sales-v21-form" onSubmit={saveSettings}>
          <SalesFormSection title="Numérotation" description="Formats générés automatiquement pour les entités commerciales.">
            <SalesField label="Acquéreurs">
              <input className="sales-v21-input" value={settings.buyer_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, buyer_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Projets">
              <input className="sales-v21-input" value={settings.project_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, project_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Biens">
              <input className="sales-v21-input" value={settings.catalog_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, catalog_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Réservations">
              <input className="sales-v21-input" value={settings.reservation_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, reservation_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Souscriptions">
              <input className="sales-v21-input" value={settings.subscription_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, subscription_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Contrat de réservation">
              <input className="sales-v21-input" value={settings.reservation_contract_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, reservation_contract_number_format: event.target.value } : current)} />
            </SalesField>
            <SalesField label="Contrat de souscription">
              <input className="sales-v21-input" value={settings.subscription_contract_number_format ?? ''} onChange={(event) => setSettings((current) => current ? { ...current, subscription_contract_number_format: event.target.value } : current)} />
            </SalesField>
          </SalesFormSection>

          <SalesFormSection title="Règles opérationnelles" description="Conserver le champ de frais convenus sans encore brancher l’encaissement.">
            <SalesField label="Durée par défaut de réservation (jours)">
              <input className="sales-v21-input" inputMode="numeric" value={String(settings.reservation_default_duration_days ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, reservation_default_duration_days: Number(event.target.value || 0) } : current)} />
            </SalesField>
            <SalesField label="Frais de réservation minimum">
              <input className="sales-v21-input" inputMode="decimal" value={String(settings.reservation_default_fee ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, reservation_default_fee: Number(event.target.value || 0) } : current)} />
            </SalesField>
            <SalesField label="Fréquence par défaut">
              <select className="sales-v21-select" value={settings.default_installment_frequency ?? 'MONTHLY'} onChange={(event) => setSettings((current) => current ? { ...current, default_installment_frequency: event.target.value } : current)}>
                {SALES_SCHEDULE_FREQUENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </SalesField>
            <SalesField label="Échéances maximum">
              <input className="sales-v21-input" inputMode="numeric" value={String(settings.maximum_installment_count ?? '')} onChange={(event) => setSettings((current) => current ? { ...current, maximum_installment_count: Number(event.target.value || 0) } : current)} />
            </SalesField>
          </SalesFormSection>

          <SalesFormActions>
            <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}</button>
          </SalesFormActions>
        </form>
      ) : null}

      <SalesSection title="Gabarit contrat de réservation" description="Variables disponibles : organisation, acquéreur, projet, bien, prix et frais convenus.">
        <SalesField label="Titre">
          <input className="sales-v21-input" value={reservationTemplate.title} onChange={(event) => setTemplates((current) => current.map((item) => item.template_type === 'RESERVATION_CONTRACT' ? { ...item, title: event.target.value } : item))} />
        </SalesField>
        <SalesField label="Corps HTML simplifié">
          <textarea className="sales-v21-textarea" rows={10} value={reservationTemplate.template_body} onChange={(event) => setTemplates((current) => current.map((item) => item.template_type === 'RESERVATION_CONTRACT' ? { ...item, template_body: event.target.value } : item))} />
        </SalesField>
        <SalesFormActions>
          <button className="sales-v21-btn sales-v21-btn-secondary" type="button" disabled={saving} onClick={() => void saveTemplate(reservationTemplate)}>
            Enregistrer le gabarit
          </button>
        </SalesFormActions>
      </SalesSection>

      <SalesSection title="Gabarit contrat de souscription" description="Variables disponibles : souscription, acompte, échéancier et prix final.">
        <SalesField label="Titre">
          <input className="sales-v21-input" value={subscriptionTemplate.title} onChange={(event) => setTemplates((current) => current.map((item) => item.template_type === 'SUBSCRIPTION_CONTRACT' ? { ...item, title: event.target.value } : item))} />
        </SalesField>
        <SalesField label="Corps HTML simplifié">
          <textarea className="sales-v21-textarea" rows={10} value={subscriptionTemplate.template_body} onChange={(event) => setTemplates((current) => current.map((item) => item.template_type === 'SUBSCRIPTION_CONTRACT' ? { ...item, template_body: event.target.value } : item))} />
        </SalesField>
        <SalesFormActions>
          <button className="sales-v21-btn sales-v21-btn-secondary" type="button" disabled={saving} onClick={() => void saveTemplate(subscriptionTemplate)}>
            Enregistrer le gabarit
          </button>
        </SalesFormActions>
      </SalesSection>
    </SalesModulePage>
  );
}
