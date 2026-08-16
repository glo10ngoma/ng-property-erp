import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../core/components/ConfirmDialog';
import {
  archiveSalesBuyer,
  archiveSalesCatalogItem,
  archiveSalesProject,
  createSalesBuyer,
  createSalesCatalogItem,
  createSalesProject,
  getSalesBootstrap,
  getSalesBuyer,
  getSalesCatalogItem,
  getSalesProject,
  listSalesBuyers,
  listSalesCatalog,
  listSalesProjects,
  updateSalesBuyer,
  updateSalesCatalogItem,
  updateSalesProject,
} from '../api/sales.api';
import type {
  CreateSalesBuyerInput,
  CreateSalesCatalogInput,
  CreateSalesProjectInput,
  SalesBootstrap,
  SalesBuyer,
  SalesCatalogItem,
  SalesProject,
} from '../types';
import {
  SALES_BUYER_STATUSES,
  SALES_BUYER_TYPES,
  SALES_COMMERCIAL_STATUSES,
  SALES_PROJECT_STATUSES,
  SALES_SUPPORTED_CURRENCIES,
} from '../types';
import {
  SalesDataTable,
  SalesEmptyState,
  SalesEntityCard,
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

type PendingArchive =
  | { scope: 'buyer'; id: number; label: string }
  | { scope: 'project'; id: number; label: string }
  | { scope: 'catalog'; id: number; label: string };

type BuyerFormState = {
  buyer_ref: string;
  buyer_type: string;
  full_name: string;
  company_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  country: string;
  id_document_type: string;
  id_document_number: string;
  tax_number: string;
  status: string;
};

type ProjectFormState = {
  project_ref: string;
  name: string;
  description: string;
  location_label: string;
  status: string;
  launch_date: string;
  closing_date: string;
};

type CatalogFormState = {
  catalog_ref: string;
  property_type: string;
  title: string;
  description: string;
  project_id: string;
  building_id: string;
  unit_id: string;
  list_price: string;
  minimum_price: string;
  currency: string;
  commercial_status: string;
  availability_date: string;
  surface_area: string;
  location_label: string;
};

const BUYER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Actif',
  ARCHIVED: 'Archivé',
};

const BUYER_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Particulier',
  COMPANY: 'Entreprise',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Actif',
  PAUSED: 'En pause',
  COMPLETED: 'Terminé',
  ARCHIVED: 'Archivé',
};

const CATALOG_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  AVAILABLE: 'Disponible',
  RESERVED: 'Réservé',
  SOLD: 'Vendu',
  WITHDRAWN: 'Retiré',
  BLOCKED: 'Bloqué',
};

function emptyBuyerForm(): BuyerFormState {
  return {
    buyer_ref: '',
    buyer_type: 'INDIVIDUAL',
    full_name: '',
    company_name: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    city: '',
    country: '',
    id_document_type: '',
    id_document_number: '',
    tax_number: '',
    status: 'ACTIVE',
  };
}

function emptyProjectForm(): ProjectFormState {
  return {
    project_ref: '',
    name: '',
    description: '',
    location_label: '',
    status: 'DRAFT',
    launch_date: '',
    closing_date: '',
  };
}

function emptyCatalogForm(): CatalogFormState {
  return {
    catalog_ref: '',
    property_type: '',
    title: '',
    description: '',
    project_id: '',
    building_id: '',
    unit_id: '',
    list_price: '',
    minimum_price: '',
    currency: 'USD',
    commercial_status: 'DRAFT',
    availability_date: '',
    surface_area: '',
    location_label: '',
  };
}

function mapBuyerToForm(buyer: SalesBuyer): BuyerFormState {
  return {
    buyer_ref: buyer.buyer_ref ?? '',
    buyer_type: buyer.buyer_type ?? 'INDIVIDUAL',
    full_name: buyer.full_name ?? '',
    company_name: buyer.company_name ?? '',
    phone: buyer.phone ?? '',
    whatsapp: buyer.whatsapp ?? '',
    email: buyer.email ?? '',
    address: buyer.address ?? '',
    city: buyer.city ?? '',
    country: buyer.country ?? '',
    id_document_type: buyer.id_document_type ?? '',
    id_document_number: buyer.id_document_number ?? '',
    tax_number: buyer.tax_number ?? '',
    status: buyer.status ?? 'ACTIVE',
  };
}

function mapProjectToForm(project: SalesProject): ProjectFormState {
  return {
    project_ref: project.project_ref ?? '',
    name: project.name ?? '',
    description: project.description ?? '',
    location_label: project.location_label ?? '',
    status: project.status ?? 'DRAFT',
    launch_date: toDateInput(project.launch_date),
    closing_date: toDateInput(project.closing_date),
  };
}

function mapCatalogToForm(item: SalesCatalogItem): CatalogFormState {
  return {
    catalog_ref: item.catalog_ref ?? '',
    property_type: item.property_type ?? '',
    title: item.title ?? '',
    description: item.description ?? '',
    project_id: item.project_id ? String(item.project_id) : '',
    building_id: item.building_id ? String(item.building_id) : '',
    unit_id: item.unit_id ? String(item.unit_id) : '',
    list_price: item.list_price != null ? String(item.list_price) : '',
    minimum_price: item.minimum_price != null ? String(item.minimum_price) : '',
    currency: item.currency ?? 'USD',
    commercial_status: item.commercial_status ?? 'DRAFT',
    availability_date: toDateInput(item.availability_date),
    surface_area: item.surface_area != null ? String(item.surface_area) : '',
    location_label: item.location_label ?? '',
  };
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
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

function formatOptional(value?: string | number | null) {
  if (value == null || value === '') return 'Donnée non disponible';
  return String(value);
}

function getBuyerLabel(buyer: SalesBuyer) {
  return buyer.buyer_type === 'COMPANY'
    ? buyer.company_name || buyer.full_name || buyer.buyer_ref
    : buyer.full_name || buyer.company_name || buyer.buyer_ref;
}

function getBuyerSecondary(buyer: SalesBuyer) {
  return [buyer.phone, buyer.email, buyer.city].filter(Boolean).join(' ⬢ ') || 'Coordonnées à compléter';
}

function getStatusTone(status?: string | null): SalesStatusTone {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE':
    case 'AVAILABLE':
    case 'COMPLETED':
      return 'success';
    case 'RESERVED':
    case 'PAUSED':
      return 'warning';
    case 'SOLD':
    case 'ARCHIVED':
    case 'WITHDRAWN':
      return 'neutral';
    case 'BLOCKED':
      return 'danger';
    default:
      return 'info';
  }
}

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

function validateBuyerForm(form: BuyerFormState) {
  const errors: Partial<Record<keyof BuyerFormState, string>> = {};
  if (!form.buyer_ref.trim()) errors.buyer_ref = 'La référence est obligatoire.';
  if (form.buyer_type === 'COMPANY') {
    if (!form.company_name.trim()) errors.company_name = 'Le nom de la société est obligatoire.';
  } else if (!form.full_name.trim()) {
    errors.full_name = 'Le nom complet est obligatoire.';
  }
  return errors;
}

function validateProjectForm(form: ProjectFormState) {
  const errors: Partial<Record<keyof ProjectFormState, string>> = {};
  if (!form.project_ref.trim()) errors.project_ref = 'La référence est obligatoire.';
  if (!form.name.trim()) errors.name = 'Le nom du projet est obligatoire.';
  return errors;
}

function validateCatalogForm(form: CatalogFormState) {
  const errors: Partial<Record<keyof CatalogFormState, string>> = {};
  if (!form.catalog_ref.trim()) errors.catalog_ref = 'La référence est obligatoire.';
  if (!form.property_type.trim()) errors.property_type = 'Le type de bien est obligatoire.';
  if (!form.title.trim()) errors.title = 'Le titre est obligatoire.';
  return errors;
}

function buildBuyerPayload(form: BuyerFormState): CreateSalesBuyerInput {
  return {
    buyer_ref: form.buyer_ref.trim(),
    buyer_type: form.buyer_type,
    full_name: trimOrUndefined(form.full_name),
    company_name: trimOrUndefined(form.company_name),
    phone: trimOrUndefined(form.phone),
    whatsapp: trimOrUndefined(form.whatsapp),
    email: trimOrUndefined(form.email),
    address: trimOrUndefined(form.address),
    city: trimOrUndefined(form.city),
    country: trimOrUndefined(form.country),
    id_document_type: trimOrUndefined(form.id_document_type),
    id_document_number: trimOrUndefined(form.id_document_number),
    tax_number: trimOrUndefined(form.tax_number),
    status: form.status,
  };
}

function buildProjectPayload(form: ProjectFormState): CreateSalesProjectInput {
  return {
    project_ref: form.project_ref.trim(),
    name: form.name.trim(),
    description: trimOrUndefined(form.description),
    location_label: trimOrUndefined(form.location_label),
    status: form.status,
    launch_date: trimOrUndefined(form.launch_date),
    closing_date: trimOrUndefined(form.closing_date),
  };
}

function buildCatalogPayload(form: CatalogFormState): CreateSalesCatalogInput {
  return {
    catalog_ref: form.catalog_ref.trim(),
    property_type: form.property_type.trim(),
    title: form.title.trim(),
    description: trimOrUndefined(form.description),
    project_id: parseOptionalNumber(form.project_id),
    building_id: parseOptionalNumber(form.building_id),
    unit_id: parseOptionalNumber(form.unit_id),
    list_price: parseOptionalNumber(form.list_price),
    minimum_price: parseOptionalNumber(form.minimum_price),
    currency: trimOrUndefined(form.currency),
    commercial_status: form.commercial_status,
    availability_date: trimOrUndefined(form.availability_date),
    surface_area: parseOptionalNumber(form.surface_area),
    location_label: trimOrUndefined(form.location_label),
  };
}

function useProjectOptions() {
  const [projects, setProjects] = useState<SalesProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    listSalesProjects({ page: 1, pageSize: 100, sortBy: 'name', sortOrder: 'asc' })
      .then((response) => {
        if (!cancelled) setProjects(response.items);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return projects;
}

function ArchiveDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingArchive | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  return (
    <ConfirmDialog
      title="Archiver cet élément"
      message={`Confirmez-vous l'archivage de ${pending.label} ?`}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function SalesHomePage() {
  const [bootstrap, setBootstrap] = useState<SalesBootstrap | null>(null);
  const [buyersTotal, setBuyersTotal] = useState<number | null>(null);
  const [projectsTotal, setProjectsTotal] = useState<number | null>(null);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [recentBuyers, setRecentBuyers] = useState<SalesBuyer[]>([]);
  const [recentProjects, setRecentProjects] = useState<SalesProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [boot, buyers, projects, catalog] = await Promise.all([
          getSalesBootstrap(),
          listSalesBuyers({ page: 1, pageSize: 4, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesProjects({ page: 1, pageSize: 4, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesCatalog({ page: 1, pageSize: 1 }),
        ]);
        if (cancelled) return;
        setBootstrap(boot);
        setBuyersTotal(buyers.total);
        setProjectsTotal(projects.total);
        setCatalogTotal(catalog.total);
        setRecentBuyers(buyers.items);
        setRecentProjects(projects.items);
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

  return (
    <SalesModulePage
      title="Ventes"
      subtitle="Pilotage commercial compact, lisible et orienté exécution pour les équipes de vente immobilière."
      activeTab="overview"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/buyers/new">Nouvel acquéreur</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      <SalesKpiGrid>
        <SalesKpiCard label="Module" value={bootstrap?.module || 'SALES'} helper="Organisation courante" />
        <SalesKpiCard label="Acquéreurs" value={loading ? '…' : buyersTotal ?? '—'} helper="Base commerciale" />
        <SalesKpiCard label="Projets" value={loading ? '…' : projectsTotal ?? '—'} helper="Pipeline disponible" />
        <SalesKpiCard label="Biens à vendre" value={loading ? '…' : catalogTotal ?? '—'} helper="Catalogue exploitable" />
      </SalesKpiGrid>

      <div className="sales-v21-two-columns">
        <SalesSection title="Acquéreurs récents" description="Derniers dossiers mis à jour dans le module ventes.">
          {recentBuyers.length ? (
            <div className="sales-v21-card-list">
              {recentBuyers.map((buyer) => (
                <SalesEntityCard
                  key={buyer.id}
                  title={getBuyerLabel(buyer)}
                  subtitle={buyer.buyer_ref}
                  status={<SalesStatusBadge label={BUYER_STATUS_LABELS[buyer.status] || buyer.status} tone={getStatusTone(buyer.status)} />}
                  footer={<Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/buyers/${buyer.id}`}>Voir le dossier</Link>}
                >
                  <p>{getBuyerSecondary(buyer)}</p>
                </SalesEntityCard>
              ))}
            </div>
          ) : (
            <SalesEmptyState
              title="Aucun acquéreur récent"
              description="Les nouveaux dossiers apparaîtront ici dès qu'ils seront créés."
            />
          )}
        </SalesSection>

        <SalesSection title="Projets actifs" description="Programmes immobiliers suivis par l'équipe commerciale.">
          {recentProjects.length ? (
            <div className="sales-v21-card-list">
              {recentProjects.map((project) => (
                <SalesEntityCard
                  key={project.id}
                  title={project.name}
                  subtitle={project.project_ref}
                  status={<SalesStatusBadge label={PROJECT_STATUS_LABELS[project.status] || project.status} tone={getStatusTone(project.status)} />}
                  footer={<Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/projects/${project.id}`}>Ouvrir le projet</Link>}
                >
                  <p>{project.location_label || 'Localisation à compléter'}</p>
                </SalesEntityCard>
              ))}
            </div>
          ) : (
            <SalesEmptyState
              title="Aucun projet récent"
              description="Les projets actifs et en préparation apparaîtront dans ce volet."
            />
          )}
        </SalesSection>
      </div>
    </SalesModulePage>
  );
}

export function SalesBuyersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [buyers, setBuyers] = useState<SalesBuyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesBuyers({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'updated_at',
          sortOrder: 'desc',
        });
        if (!cancelled) setBuyers(response.items);
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

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'buyer') return;
    await archiveSalesBuyer(pendingArchive.id);
    setPendingArchive(null);
    const response = await listSalesBuyers({ page: 1, pageSize: 100, search: search || undefined, status: status || undefined });
    setBuyers(response.items);
  }

  return (
    <SalesModulePage
      title="Acquéreurs"
      subtitle="Suivi commercial compact des prospects, clients et sociétés engagés dans vos ventes."
      activeTab="buyers"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/buyers/new">Créer un acquéreur</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      <SalesSection title="Portefeuille acquéreurs" description="Recherche rapide, lecture dense et actions directes sans surcharge visuelle.">
        <SalesFilterBar>
          <input
            className="sales-v21-input"
            placeholder="Rechercher un acquéreur"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {SALES_BUYER_STATUSES.map((item) => (
              <option key={item} value={item}>{BUYER_STATUS_LABELS[item] || item}</option>
            ))}
          </select>
        </SalesFilterBar>

        {loading ? <SalesInlineNotice>Chargement des acquéreurs…</SalesInlineNotice> : null}

        {!loading && !buyers.length ? (
          <SalesEmptyState
            title="Aucun acquéreur trouvé"
            description="Affinez la recherche ou créez un nouveau dossier commercial."
            action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/buyers/new">Créer un acquéreur</Link>}
          />
        ) : null}

        {!!buyers.length && (
          <>
            <SalesDataTable
              rowKey={(buyer) => buyer.id}
              rows={buyers}
              columns={[
                {
                  key: 'identity',
                  label: 'Acquéreur',
                  render: (buyer) => (
                    <div>
                      <strong>{getBuyerLabel(buyer)}</strong>
                      <p className="sales-v21-cell-subtitle">{buyer.buyer_ref} ⬢ {BUYER_TYPE_LABELS[buyer.buyer_type] || buyer.buyer_type}</p>
                    </div>
                  ),
                },
                {
                  key: 'contact',
                  label: 'Coordonnées',
                  render: (buyer) => <span>{getBuyerSecondary(buyer)}</span>,
                },
                {
                  key: 'status',
                  label: 'Statut',
                  render: (buyer) => (
                    <SalesStatusBadge label={BUYER_STATUS_LABELS[buyer.status] || buyer.status} tone={getStatusTone(buyer.status)} />
                  ),
                },
                {
                  key: 'updated',
                  label: 'Mis à jour',
                  render: (buyer) => formatDate(buyer.updated_at || buyer.created_at),
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  className: 'sales-v21-actions-cell',
                  render: (buyer) => (
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/buyers/${buyer.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/buyers/${buyer.id}/edit`}>Modifier</Link>
                      <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'buyer', id: buyer.id, label: getBuyerLabel(buyer) })}>
                        Archiver
                      </button>
                    </div>
                  ),
                },
              ]}
            />

            <div className="sales-v21-mobile-list">
              {buyers.map((buyer) => (
                <SalesEntityCard
                  key={buyer.id}
                  title={getBuyerLabel(buyer)}
                  subtitle={`${buyer.buyer_ref} ⬢ ${BUYER_TYPE_LABELS[buyer.buyer_type] || buyer.buyer_type}`}
                  status={<SalesStatusBadge label={BUYER_STATUS_LABELS[buyer.status] || buyer.status} tone={getStatusTone(buyer.status)} />}
                  footer={
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/buyers/${buyer.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/buyers/${buyer.id}/edit`}>Modifier</Link>
                    </div>
                  }
                >
                  <p>{getBuyerSecondary(buyer)}</p>
                </SalesEntityCard>
              ))}
            </div>
          </>
        )}
      </SalesSection>

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}

export function SalesBuyerFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const [form, setForm] = useState<BuyerFormState>(emptyBuyerForm());
  const [errors, setErrors] = useState<Partial<Record<keyof BuyerFormState, string>>>({});
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const buyer = await getSalesBuyer(editingId!);
        if (!cancelled) setForm(mapBuyerToForm(buyer));
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validation = validateBuyerForm(form);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildBuyerPayload(form);
      const buyer = editingId ? await updateSalesBuyer(editingId, payload) : await createSalesBuyer(payload);
      navigate(`/sales/buyers/${buyer.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={editingId ? 'Modifier un acquéreur' : 'Nouvel acquéreur'}
      subtitle="Une fiche claire, structurée et compacte pour conserver des dossiers commerciaux propres dès la saisie."
      activeTab="buyers"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/buyers/${editingId}` : '/sales/buyers'}>Retour</Link>}
    >
      <SalesSection title="Informations du dossier" description="Complétez uniquement les champs utiles au suivi commercial et à la qualification client.">
        {loading ? <SalesInlineNotice>Chargement du dossier…</SalesInlineNotice> : null}
        {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

        {!loading && (
          <form className="sales-v21-form" onSubmit={handleSubmit}>
            <SalesFormSection title="Identité" description="Référence commerciale et identification de l'acquéreur.">
              <SalesField label="Référence" error={errors.buyer_ref}>
                <input className="sales-v21-input" value={form.buyer_ref} onChange={(event) => setForm((current) => ({ ...current, buyer_ref: event.target.value }))} />
              </SalesField>
              <SalesField label="Type d'acquéreur">
                <select className="sales-v21-select" value={form.buyer_type} onChange={(event) => setForm((current) => ({ ...current, buyer_type: event.target.value }))}>
                  {SALES_BUYER_TYPES.map((item) => <option key={item} value={item}>{BUYER_TYPE_LABELS[item] || item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Nom complet" error={errors.full_name}>
                <input className="sales-v21-input" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} />
              </SalesField>
              <SalesField label="Société" error={errors.company_name}>
                <input className="sales-v21-input" value={form.company_name} onChange={(event) => setForm((current) => ({ ...current, company_name: event.target.value }))} />
              </SalesField>
              <SalesField label="Statut">
                <select className="sales-v21-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  {SALES_BUYER_STATUSES.map((item) => <option key={item} value={item}>{BUYER_STATUS_LABELS[item] || item}</option>)}
                </select>
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Coordonnées" description="Canaux de contact utilisés par l'équipe commerciale.">
              <SalesField label="Téléphone">
                <input className="sales-v21-input" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </SalesField>
              <SalesField label="WhatsApp">
                <input className="sales-v21-input" value={form.whatsapp} onChange={(event) => setForm((current) => ({ ...current, whatsapp: event.target.value }))} />
              </SalesField>
              <SalesField label="Email">
                <input className="sales-v21-input" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </SalesField>
              <SalesField label="Adresse">
                <input className="sales-v21-input" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
              </SalesField>
              <SalesField label="Ville">
                <input className="sales-v21-input" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
              </SalesField>
              <SalesField label="Pays">
                <input className="sales-v21-input" value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Conformité" description="Informations administratives utiles lorsque le dossier avance vers la contractualisation.">
              <SalesField label="Type de pièce">
                <input className="sales-v21-input" value={form.id_document_type} onChange={(event) => setForm((current) => ({ ...current, id_document_type: event.target.value }))} />
              </SalesField>
              <SalesField label="Numéro de pièce">
                <input className="sales-v21-input" value={form.id_document_number} onChange={(event) => setForm((current) => ({ ...current, id_document_number: event.target.value }))} />
              </SalesField>
              <SalesField label="Numéro fiscal">
                <input className="sales-v21-input" value={form.tax_number} onChange={(event) => setForm((current) => ({ ...current, tax_number: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormActions>
              <Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/buyers/${editingId}` : '/sales/buyers'}>Annuler</Link>
              <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </SalesFormActions>
          </form>
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesBuyerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const buyerId = Number(id);
  const [buyer, setBuyer] = useState<SalesBuyer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesBuyer(buyerId);
        if (!cancelled) setBuyer(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (buyerId) void load();
    return () => {
      cancelled = true;
    };
  }, [buyerId]);

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'buyer') return;
    await archiveSalesBuyer(pendingArchive.id);
    navigate('/sales/buyers');
  }

  return (
    <SalesModulePage
      title={buyer ? getBuyerLabel(buyer) : 'Dossier acquéreur'}
      subtitle="Lecture 360° d'un dossier commercial, avec informations utiles immédiatement visibles pour l'équipe de vente."
      activeTab="buyers"
      action={
        <div className="sales-v21-header-actions">
          <Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/buyers">Retour à la liste</Link>
          {buyer ? <Link className="sales-v21-btn sales-v21-btn-primary" to={`/sales/buyers/${buyer.id}/edit`}>Modifier</Link> : null}
        </div>
      }
    >
      {loading ? <SalesInlineNotice>Chargement du dossier…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      {buyer ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Référence" value={buyer.buyer_ref} helper={BUYER_TYPE_LABELS[buyer.buyer_type] || buyer.buyer_type} />
            <SalesKpiCard label="Téléphone" value={formatOptional(buyer.phone)} helper="Canal principal" />
            <SalesKpiCard label="Email" value={formatOptional(buyer.email)} helper="Suivi commercial" />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={BUYER_STATUS_LABELS[buyer.status] || buyer.status} tone={getStatusTone(buyer.status)} />} helper="État du dossier" />
          </SalesKpiGrid>

          <div className="sales-v21-two-columns">
            <SalesSection title="Profil" description="Synthèse d'identification et informations de contact.">
              <SalesInfoList
                items={[
                  { label: 'Nom complet', value: formatOptional(buyer.full_name) },
                  { label: 'Société', value: formatOptional(buyer.company_name) },
                  { label: 'Téléphone', value: formatOptional(buyer.phone) },
                  { label: 'WhatsApp', value: formatOptional(buyer.whatsapp) },
                  { label: 'Email', value: formatOptional(buyer.email) },
                  { label: 'Adresse', value: formatOptional(buyer.address) },
                  { label: 'Ville', value: formatOptional(buyer.city) },
                  { label: 'Pays', value: formatOptional(buyer.country) },
                ]}
              />
            </SalesSection>

            <SalesSection title="Conformité" description="Pièces et données administratives associées à l'acquéreur.">
              <SalesInfoList
                items={[
                  { label: 'Type de pièce', value: formatOptional(buyer.id_document_type) },
                  { label: 'Numéro de pièce', value: formatOptional(buyer.id_document_number) },
                  { label: 'Numéro fiscal', value: formatOptional(buyer.tax_number) },
                  { label: 'Créé le', value: formatDate(buyer.created_at) },
                  { label: 'Dernière mise à jour', value: formatDate(buyer.updated_at) },
                ]}
              />
            </SalesSection>
          </div>

          <SalesFormActions>
            <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'buyer', id: buyer.id, label: getBuyerLabel(buyer) })}>
              Archiver le dossier
            </button>
          </SalesFormActions>
        </>
      ) : null}

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}

export function SalesProjectsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [projects, setProjects] = useState<SalesProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesProjects({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'updated_at',
          sortOrder: 'desc',
        });
        if (!cancelled) setProjects(response.items);
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

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'project') return;
    await archiveSalesProject(pendingArchive.id);
    setPendingArchive(null);
    const response = await listSalesProjects({ page: 1, pageSize: 100, search: search || undefined, status: status || undefined });
    setProjects(response.items);
  }

  return (
    <SalesModulePage
      title="Projets commerciaux"
      subtitle="Organisation claire des programmes, lancements et chantiers reliés à votre pipeline de vente."
      activeTab="projects"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/projects/new">Créer un projet</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      <SalesSection title="Portefeuille projets" description="Vue compacte sur les références, la localisation et l'état commercial des programmes.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher un projet" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {SALES_PROJECT_STATUSES.map((item) => <option key={item} value={item}>{PROJECT_STATUS_LABELS[item] || item}</option>)}
          </select>
        </SalesFilterBar>

        {loading ? <SalesInlineNotice>Chargement des projets…</SalesInlineNotice> : null}

        {!loading && !projects.length ? (
          <SalesEmptyState
            title="Aucun projet trouvé"
            description="Créez un projet pour structurer vos ventes, vos biens et vos campagnes."
            action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/projects/new">Créer un projet</Link>}
          />
        ) : null}

        {!!projects.length && (
          <>
            <SalesDataTable
              rowKey={(project) => project.id}
              rows={projects}
              columns={[
                {
                  key: 'project',
                  label: 'Projet',
                  render: (project) => (
                    <div>
                      <strong>{project.name}</strong>
                      <p className="sales-v21-cell-subtitle">{project.project_ref}</p>
                    </div>
                  ),
                },
                {
                  key: 'location',
                  label: 'Localisation',
                  render: (project) => formatOptional(project.location_label),
                },
                {
                  key: 'period',
                  label: 'Période',
                  render: (project) => `${formatDate(project.launch_date)}  ·  ${formatDate(project.closing_date)}`,
                },
                {
                  key: 'status',
                  label: 'Statut',
                  render: (project) => <SalesStatusBadge label={PROJECT_STATUS_LABELS[project.status] || project.status} tone={getStatusTone(project.status)} />,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  className: 'sales-v21-actions-cell',
                  render: (project) => (
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/projects/${project.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/projects/${project.id}/edit`}>Modifier</Link>
                      <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'project', id: project.id, label: project.name })}>
                        Archiver
                      </button>
                    </div>
                  ),
                },
              ]}
            />

            <div className="sales-v21-mobile-list">
              {projects.map((project) => (
                <SalesEntityCard
                  key={project.id}
                  title={project.name}
                  subtitle={project.project_ref}
                  status={<SalesStatusBadge label={PROJECT_STATUS_LABELS[project.status] || project.status} tone={getStatusTone(project.status)} />}
                  footer={
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/projects/${project.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/projects/${project.id}/edit`}>Modifier</Link>
                    </div>
                  }
                >
                  <p>{project.location_label || 'Localisation à compléter'}</p>
                </SalesEntityCard>
              ))}
            </div>
          </>
        )}
      </SalesSection>

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}

export function SalesProjectFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm());
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectFormState, string>>>({});
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const project = await getSalesProject(editingId!);
        if (!cancelled) setForm(mapProjectToForm(project));
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validation = validateProjectForm(form);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildProjectPayload(form);
      const project = editingId ? await updateSalesProject(editingId, payload) : await createSalesProject(payload);
      navigate(`/sales/projects/${project.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={editingId ? 'Modifier un projet' : 'Nouveau projet'}
      subtitle="Un formulaire dense mais lisible pour cadrer la commercialisation sans alourdir le parcours utilisateur."
      activeTab="projects"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/projects/${editingId}` : '/sales/projects'}>Retour</Link>}
    >
      <SalesSection title="Configuration du projet" description="Références, période et positionnement commercial du programme.">
        {loading ? <SalesInlineNotice>Chargement du projet…</SalesInlineNotice> : null}
        {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

        {!loading && (
          <form className="sales-v21-form" onSubmit={handleSubmit}>
            <SalesFormSection title="Référencement" description="Informations visibles dans les vues liste et détail.">
              <SalesField label="Référence" error={errors.project_ref}>
                <input className="sales-v21-input" value={form.project_ref} onChange={(event) => setForm((current) => ({ ...current, project_ref: event.target.value }))} />
              </SalesField>
              <SalesField label="Nom" error={errors.name}>
                <input className="sales-v21-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </SalesField>
              <SalesField label="Localisation">
                <input className="sales-v21-input" value={form.location_label} onChange={(event) => setForm((current) => ({ ...current, location_label: event.target.value }))} />
              </SalesField>
              <SalesField label="Statut">
                <select className="sales-v21-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  {SALES_PROJECT_STATUSES.map((item) => <option key={item} value={item}>{PROJECT_STATUS_LABELS[item] || item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Lancement">
                <input className="sales-v21-input" type="date" value={form.launch_date} onChange={(event) => setForm((current) => ({ ...current, launch_date: event.target.value }))} />
              </SalesField>
              <SalesField label="Clôture">
                <input className="sales-v21-input" type="date" value={form.closing_date} onChange={(event) => setForm((current) => ({ ...current, closing_date: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Narratif" description="Description visible par l'équipe lors du suivi des offres et lots.">
              <SalesField label="Description">
                <textarea className="sales-v21-textarea" rows={6} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormActions>
              <Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/projects/${editingId}` : '/sales/projects'}>Annuler</Link>
              <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </SalesFormActions>
          </form>
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const projectId = Number(id);
  const [project, setProject] = useState<SalesProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesProject(projectId);
        if (!cancelled) setProject(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (projectId) void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'project') return;
    await archiveSalesProject(pendingArchive.id);
    navigate('/sales/projects');
  }

  return (
    <SalesModulePage
      title={project?.name || 'Projet commercial'}
      subtitle="Vision synthétique d'un programme de vente, avec ses dates clés, sa localisation et son état d'avancement."
      activeTab="projects"
      action={
        <div className="sales-v21-header-actions">
          <Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/projects">Retour à la liste</Link>
          {project ? <Link className="sales-v21-btn sales-v21-btn-primary" to={`/sales/projects/${project.id}/edit`}>Modifier</Link> : null}
        </div>
      }
    >
      {loading ? <SalesInlineNotice>Chargement du projet…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      {project ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Référence" value={project.project_ref} helper="Repère commercial" />
            <SalesKpiCard label="Localisation" value={formatOptional(project.location_label)} helper="Zone couverte" />
            <SalesKpiCard label="Lancement" value={formatDate(project.launch_date)} helper="Date cible" />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={PROJECT_STATUS_LABELS[project.status] || project.status} tone={getStatusTone(project.status)} />} helper="État actuel" />
          </SalesKpiGrid>

          <div className="sales-v21-two-columns">
            <SalesSection title="Résumé du projet" description="Structure de lecture rapide pour les commerciaux et responsables d'équipe.">
              <SalesInfoList
                items={[
                  { label: 'Nom', value: project.name },
                  { label: 'Référence', value: project.project_ref },
                  { label: 'Localisation', value: formatOptional(project.location_label) },
                  { label: 'Lancement', value: formatDate(project.launch_date) },
                  { label: 'Clôture', value: formatDate(project.closing_date) },
                  { label: 'Créé le', value: formatDate(project.created_at) },
                ]}
              />
            </SalesSection>

            <SalesSection title="Description" description="Contexte et objectifs du programme immobilier.">
              <p>{project.description || 'Aucune description fournie pour ce projet.'}</p>
            </SalesSection>
          </div>

          <SalesFormActions>
            <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'project', id: project.id, label: project.name })}>
              Archiver le projet
            </button>
          </SalesFormActions>
        </>
      ) : null}

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}

export function SalesCatalogPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [catalog, setCatalog] = useState<SalesCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await listSalesCatalog({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          sortBy: 'updated_at',
          sortOrder: 'desc',
        });
        if (!cancelled) setCatalog(response.items);
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

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'catalog') return;
    await archiveSalesCatalogItem(pendingArchive.id);
    setPendingArchive(null);
    const response = await listSalesCatalog({ page: 1, pageSize: 100, search: search || undefined, status: status || undefined });
    setCatalog(response.items);
  }

  return (
    <SalesModulePage
      title="Biens à vendre"
      subtitle="Catalogue commercial compact, lisible et prêt pour la qualification rapide des opportunités."
      activeTab="catalog"
      action={<Link className="sales-v21-btn sales-v21-btn-primary" to="/sales/catalog/new">Ajouter un bien</Link>}
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      <SalesSection title="Catalogue commercial" description="Références, contexte, prix et disponibilité dans une grille plus dense et plus premium.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher un bien" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            {SALES_COMMERCIAL_STATUSES.map((item) => <option key={item} value={item}>{CATALOG_STATUS_LABELS[item] || item}</option>)}
          </select>
        </SalesFilterBar>

        {loading ? <SalesInlineNotice>Chargement du catalogue…</SalesInlineNotice> : null}

        {!loading && !catalog.length ? (
          <SalesEmptyState
            title="Aucun bien trouvé"
            description="Créez un article de catalogue pour lancer la commercialisation d'un lot ou d'un programme."
            action={<Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/catalog/new">Ajouter un bien</Link>}
          />
        ) : null}

        {!!catalog.length && (
          <>
            <SalesDataTable
              rowKey={(item) => item.id}
              rows={catalog}
              columns={[
                {
                  key: 'asset',
                  label: 'Bien',
                  render: (item) => (
                    <div>
                      <strong>{item.title}</strong>
                      <p className="sales-v21-cell-subtitle">{item.catalog_ref} ⬢ {item.property_type}</p>
                    </div>
                  ),
                },
                {
                  key: 'context',
                  label: 'Contexte',
                  render: (item) => (
                    <span>
                      {[item.project_name, item.building_name, item.unit_number ? `Unité ${item.unit_number}` : null, item.location_label]
                        .filter(Boolean)
                        .join(' ⬢ ') || 'Donnée non disponible'}
                    </span>
                  ),
                },
                {
                  key: 'pricing',
                  label: 'Prix',
                  render: (item) => (
                    <div>
                      <strong>{formatCurrency(item.list_price, item.currency)}</strong>
                      <p className="sales-v21-cell-subtitle">Minimum : {formatCurrency(item.minimum_price, item.currency)}</p>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  label: 'Statut',
                  render: (item) => <SalesStatusBadge label={CATALOG_STATUS_LABELS[item.commercial_status] || item.commercial_status} tone={getStatusTone(item.commercial_status)} />,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  className: 'sales-v21-actions-cell',
                  render: (item) => (
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/catalog/${item.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/catalog/${item.id}/edit`}>Modifier</Link>
                      <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'catalog', id: item.id, label: item.title })}>
                        Archiver
                      </button>
                    </div>
                  ),
                },
              ]}
            />

            <div className="sales-v21-mobile-list">
              {catalog.map((item) => (
                <SalesEntityCard
                  key={item.id}
                  title={item.title}
                  subtitle={`${item.catalog_ref} ⬢ ${item.property_type}`}
                  status={<SalesStatusBadge label={CATALOG_STATUS_LABELS[item.commercial_status] || item.commercial_status} tone={getStatusTone(item.commercial_status)} />}
                  footer={
                    <div className="sales-v21-table-actions">
                      <Link className="sales-v21-btn sales-v21-btn-ghost" to={`/sales/catalog/${item.id}`}>Voir</Link>
                      <Link className="sales-v21-btn sales-v21-btn-secondary" to={`/sales/catalog/${item.id}/edit`}>Modifier</Link>
                    </div>
                  }
                >
                  <p>{[item.project_name, item.building_name, item.unit_number ? `Unité ${item.unit_number}` : null].filter(Boolean).join(' ⬢ ') || 'Contexte à compléter'}</p>
                  <p>{formatCurrency(item.list_price, item.currency)}</p>
                </SalesEntityCard>
              ))}
            </div>
          </>
        )}
      </SalesSection>

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}

export function SalesCatalogFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editingId = id ? Number(id) : null;
  const [form, setForm] = useState<CatalogFormState>(emptyCatalogForm());
  const [errors, setErrors] = useState<Partial<Record<keyof CatalogFormState, string>>>({});
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectOptions = useProjectOptions();

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const item = await getSalesCatalogItem(editingId!);
        if (!cancelled) setForm(mapCatalogToForm(item));
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validation = validateCatalogForm(form);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setSaving(true);
    setError(null);
    try {
      const payload = buildCatalogPayload(form);
      const item = editingId ? await updateSalesCatalogItem(editingId, payload) : await createSalesCatalogItem(payload);
      navigate(`/sales/catalog/${item.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SalesModulePage
      title={editingId ? 'Modifier un bien' : 'Nouveau bien à vendre'}
      subtitle="Une fiche commerciale structurée pour publier, qualifier et mettre à jour le catalogue sans perte d'information."
      activeTab="catalog"
      action={<Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/catalog/${editingId}` : '/sales/catalog'}>Retour</Link>}
    >
      <SalesSection title="Configuration de l'article" description="Référence, rattachement et conditions commerciales du bien mis en vente.">
        {loading ? <SalesInlineNotice>Chargement du bien…</SalesInlineNotice> : null}
        {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

        {!loading && (
          <form className="sales-v21-form" onSubmit={handleSubmit}>
            <SalesFormSection title="Identification" description="Informations visibles en priorité dans le catalogue.">
              <SalesField label="Référence" error={errors.catalog_ref}>
                <input className="sales-v21-input" value={form.catalog_ref} onChange={(event) => setForm((current) => ({ ...current, catalog_ref: event.target.value }))} />
              </SalesField>
              <SalesField label="Type de bien" error={errors.property_type}>
                <input className="sales-v21-input" value={form.property_type} onChange={(event) => setForm((current) => ({ ...current, property_type: event.target.value }))} />
              </SalesField>
              <SalesField label="Titre" error={errors.title}>
                <input className="sales-v21-input" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </SalesField>
              <SalesField label="Projet">
                <select className="sales-v21-select" value={form.project_id} onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value }))}>
                  <option value="">Aucun projet</option>
                  {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </SalesField>
              <SalesField label="ID immeuble" hint="Optionnel lorsque le lot est rattaché à un immeuble existant.">
                <input className="sales-v21-input" inputMode="numeric" value={form.building_id} onChange={(event) => setForm((current) => ({ ...current, building_id: event.target.value }))} />
              </SalesField>
              <SalesField label="ID unité" hint="Optionnel pour relier un appartement ou un lot précis.">
                <input className="sales-v21-input" inputMode="numeric" value={form.unit_id} onChange={(event) => setForm((current) => ({ ...current, unit_id: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Commercialisation" description="Prix, statut de vente et disponibilité.">
              <SalesField label="Prix catalogue">
                <input className="sales-v21-input" inputMode="decimal" value={form.list_price} onChange={(event) => setForm((current) => ({ ...current, list_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Prix minimum">
                <input className="sales-v21-input" inputMode="decimal" value={form.minimum_price} onChange={(event) => setForm((current) => ({ ...current, minimum_price: event.target.value }))} />
              </SalesField>
              <SalesField label="Devise">
                <select className="sales-v21-select" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>
                  {SALES_SUPPORTED_CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Statut commercial">
                <select className="sales-v21-select" value={form.commercial_status} onChange={(event) => setForm((current) => ({ ...current, commercial_status: event.target.value }))}>
                  {SALES_COMMERCIAL_STATUSES.map((item) => <option key={item} value={item}>{CATALOG_STATUS_LABELS[item] || item}</option>)}
                </select>
              </SalesField>
              <SalesField label="Disponible à partir du">
                <input className="sales-v21-input" type="date" value={form.availability_date} onChange={(event) => setForm((current) => ({ ...current, availability_date: event.target.value }))} />
              </SalesField>
              <SalesField label="Surface (m²)">
                <input className="sales-v21-input" inputMode="decimal" value={form.surface_area} onChange={(event) => setForm((current) => ({ ...current, surface_area: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormSection title="Contexte de vente" description="Texte marketing, emplacement et précision de l'offre.">
              <SalesField label="Localisation courte">
                <input className="sales-v21-input" value={form.location_label} onChange={(event) => setForm((current) => ({ ...current, location_label: event.target.value }))} />
              </SalesField>
              <SalesField label="Description">
                <textarea className="sales-v21-textarea" rows={6} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </SalesField>
            </SalesFormSection>

            <SalesFormActions>
              <Link className="sales-v21-btn sales-v21-btn-secondary" to={editingId ? `/sales/catalog/${editingId}` : '/sales/catalog'}>Annuler</Link>
              <button className="sales-v21-btn sales-v21-btn-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </SalesFormActions>
          </form>
        )}
      </SalesSection>
    </SalesModulePage>
  );
}

export function SalesCatalogDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const catalogId = Number(id);
  const [item, setItem] = useState<SalesCatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesCatalogItem(catalogId);
        if (!cancelled) setItem(response);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (catalogId) void load();
    return () => {
      cancelled = true;
    };
  }, [catalogId]);

  async function confirmArchive() {
    if (!pendingArchive || pendingArchive.scope !== 'catalog') return;
    await archiveSalesCatalogItem(pendingArchive.id);
    navigate('/sales/catalog');
  }

  const contextLabel = useMemo(() => {
    if (!item) return 'Donnée non disponible';
    return [
      item.project_name,
      item.building_name,
      item.unit_number ? `Unité ${item.unit_number}` : null,
      item.location_label,
    ]
      .filter(Boolean)
      .join(' ⬢ ') || 'Donnée non disponible';
  }, [item]);

  return (
    <SalesModulePage
      title={item?.title || 'Fiche commerciale'}
      subtitle="Présentation compacte d'un bien à vendre, avec contexte, prix et rattachements immédiatement lisibles."
      activeTab="catalog"
      action={
        <div className="sales-v21-header-actions">
          <Link className="sales-v21-btn sales-v21-btn-secondary" to="/sales/catalog">Retour au catalogue</Link>
          {item ? <Link className="sales-v21-btn sales-v21-btn-primary" to={`/sales/catalog/${item.id}/edit`}>Modifier</Link> : null}
        </div>
      }
    >
      {loading ? <SalesInlineNotice>Chargement du bien…</SalesInlineNotice> : null}
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      {item ? (
        <>
          <SalesKpiGrid>
            <SalesKpiCard label="Référence" value={item.catalog_ref} helper={item.property_type} />
            <SalesKpiCard label="Prix catalogue" value={formatCurrency(item.list_price, item.currency)} helper="Montant affiché" />
            <SalesKpiCard label="Prix minimum" value={formatCurrency(item.minimum_price, item.currency)} helper="Seuil de négociation" />
            <SalesKpiCard label="Statut" value={<SalesStatusBadge label={CATALOG_STATUS_LABELS[item.commercial_status] || item.commercial_status} tone={getStatusTone(item.commercial_status)} />} helper="Commercialisation" />
          </SalesKpiGrid>

          <div className="sales-v21-two-columns">
            <SalesSection title="Contexte commercial" description="Positionnement du bien dans le programme et dans le parc immobilier.">
              <SalesInfoList
                items={[
                  { label: 'Titre', value: item.title },
                  { label: 'Type', value: item.property_type },
                  { label: 'Projet', value: formatOptional(item.project_name) },
                  { label: 'Immeuble', value: formatOptional(item.building_name) },
                  { label: 'Unité', value: item.unit_number ? `Unité ${item.unit_number}` : 'Donnée non disponible' },
                  { label: 'Contexte', value: contextLabel },
                ]}
              />
            </SalesSection>

            <SalesSection title="Commercialisation" description="Conditions actuelles et informations de disponibilité.">
              <SalesInfoList
                items={[
                  { label: 'Disponibilité', value: formatDate(item.availability_date) },
                  { label: 'Surface', value: item.surface_area ? `${item.surface_area} m²` : 'Donnée non disponible' },
                  { label: 'Créé le', value: formatDate(item.created_at) },
                  { label: 'Dernière mise à jour', value: formatDate(item.updated_at) },
                ]}
              />
              <p>{item.description || 'Aucune description marketing fournie pour ce bien.'}</p>
            </SalesSection>
          </div>

          <SalesFormActions>
            <button className="sales-v21-btn sales-v21-btn-danger" type="button" onClick={() => setPendingArchive({ scope: 'catalog', id: item.id, label: item.title })}>
              Archiver le bien
            </button>
          </SalesFormActions>
        </>
      ) : null}

      <ArchiveDialog pending={pendingArchive} onCancel={() => setPendingArchive(null)} onConfirm={() => void confirmArchive()} />
    </SalesModulePage>
  );
}