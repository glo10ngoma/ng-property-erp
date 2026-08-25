import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../core/auth/AuthContext';
import { getSalesCollections, listSalesProjects, listSalesBuyers, sendSalesInvoiceReminder } from '../api/sales.api';
import type { SalesBuyer, SalesCollectionInvoice, SalesProject } from '../types';
import {
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

function reminderStatusTone(status?: string | null): SalesStatusTone {
  switch ((status || '').toUpperCase()) {
    case 'PAID':
      return 'success';
    case 'PARTIALLY_PAID':
    case 'ISSUED':
      return 'warning';
    case 'OVERDUE':
      return 'danger';
    default:
      return 'info';
  }
}

function invoiceStatusLabel(status?: string | null) {
  switch ((status || '').toUpperCase()) {
    case 'DRAFT': return 'Brouillon';
    case 'ISSUED': return 'Émise';
    case 'PARTIALLY_PAID': return 'Partiellement payée';
    case 'PAID': return 'Payée';
    case 'OVERDUE': return 'En retard';
    case 'CANCELLED': return 'Annulée';
    default: return status || '—';
  }
}

export function SalesCollectionsV33Page() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [buyerId, setBuyerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [minOverdueDays, setMinOverdueDays] = useState('');
  const [buyers, setBuyers] = useState<SalesBuyer[]>([]);
  const [projects, setProjects] = useState<SalesProject[]>([]);
  const [items, setItems] = useState<SalesCollectionInvoice[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadLookups() {
      try {
        const [buyersResponse, projectsResponse] = await Promise.all([
          listSalesBuyers({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
          listSalesProjects({ page: 1, pageSize: 100, sortBy: 'updated_at', sortOrder: 'desc' }),
        ]);
        if (cancelled) return;
        setBuyers(buyersResponse.items);
        setProjects(projectsResponse.items);
      } catch {
        if (!cancelled) {
          setBuyers([]);
          setProjects([]);
        }
      }
    }
    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCollections() {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesCollections({
          page: 1,
          pageSize: 100,
          search: search || undefined,
          status: status || undefined,
          currency: currency || undefined,
          buyer_id: buyerId ? Number(buyerId) : undefined,
          project_id: projectId ? Number(projectId) : undefined,
          min_overdue_days: minOverdueDays ? Number(minOverdueDays) : undefined,
        } as any);
        if (cancelled) return;
        setSummary(response.summary);
        setItems(response.items);
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCollections();
    return () => {
      cancelled = true;
    };
  }, [search, status, currency, buyerId, projectId, minOverdueDays]);

  const affectedBuyers = useMemo(() => Number(summary?.buyers_with_balance ?? 0), [summary]);

  return (
    <SalesModulePage
      title="Recouvrement"
      subtitle="Pilotage compact des factures Sales à encaisser, des retards et des relances déjà journalisées."
      activeTab="collections"
    >
      {error ? <SalesInlineNotice tone="danger">{error}</SalesInlineNotice> : null}

      <SalesKpiGrid>
        <SalesKpiCard label="Total à recevoir" value={formatCurrency(summary?.total_balance_due, 'USD')} helper="Montants consolidés du périmètre filtré" />
        <SalesKpiCard label="Échu" value={formatCurrency(summary?.overdue_balance, 'USD')} helper={`${Number(summary?.overdue_invoices ?? 0)} facture(s) en retard`} />
        <SalesKpiCard label="À échoir" value={formatCurrency(summary?.upcoming_balance, 'USD')} helper="Solde non encore arrivé à échéance" />
        <SalesKpiCard label="Acquéreurs concernés" value={affectedBuyers} helper={`Encaissements du mois : ${formatCurrency(summary?.collected_this_month, 'USD')}`} />
      </SalesKpiGrid>

      <SalesSection title="File de recouvrement" description="Recherche, filtres métier et actions rapides sans quitter le tableau.">
        <SalesFilterBar>
          <input className="sales-v21-input" placeholder="Rechercher une facture, un acquéreur ou un bien" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className="sales-v21-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="ISSUED">Émise</option>
            <option value="PARTIALLY_PAID">Partiellement payée</option>
            <option value="OVERDUE">En retard</option>
            <option value="PAID">Payée</option>
            <option value="CANCELLED">Annulée</option>
          </select>
        </SalesFilterBar>
        <div className="sales-v21-rule-grid">
          <SalesField label="Acquéreur">
            <select className="sales-v21-select" value={buyerId} onChange={(event) => setBuyerId(event.target.value)}>
              <option value="">Tous</option>
              {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.full_name || buyer.company_name || buyer.buyer_ref}</option>)}
            </select>
          </SalesField>
          <SalesField label="Projet">
            <select className="sales-v21-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Tous</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </SalesField>
          <SalesField label="Devise">
            <select className="sales-v21-select" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option value="">Toutes</option>
              <option value="USD">USD</option>
              <option value="CDF">CDF</option>
            </select>
          </SalesField>
          <SalesField label="Retard minimum (jours)">
            <input className="sales-v21-input" inputMode="numeric" value={minOverdueDays} onChange={(event) => setMinOverdueDays(event.target.value)} />
          </SalesField>
        </div>

        {loading ? <SalesInlineNotice>Chargement des échéances à recouvrer…</SalesInlineNotice> : null}
        {!loading && !items.length ? (
          <SalesEmptyState title="Aucune facture à suivre" description="Les factures émises et partiellement payées apparaîtront ici avec leurs relances." />
        ) : null}
        {!!items.length && (
          <SalesDataTable
            rowKey={(row) => row.id}
            rows={items}
            rowHref={(row) => `/sales/invoices/${row.id}`}
            rowAriaLabel={(row) => `Ouvrir la facture ${row.invoice_number}`}
            columns={[
              {
                key: 'invoice',
                label: 'Facture',
                render: (row) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{row.invoice_number}</strong>
                    <span className="sales-v21-cell-subtitle">{row.subscription_number || 'Souscription'}</span>
                  </div>
                ),
              },
              { key: 'buyer', label: 'Acquéreur', render: (row) => row.buyer_name || 'Donnée non disponible' },
              {
                key: 'asset',
                label: 'Projet / bien',
                render: (row) => (
                  <div className="sales-v21-cell-stack">
                    <strong className="sales-v21-cell-primary">{row.project_name || 'Projet non disponible'}</strong>
                    <span className="sales-v21-cell-subtitle">{row.catalog_title || 'Bien non disponible'}</span>
                  </div>
                ),
              },
              { key: 'due', label: 'Échéance', render: (row) => formatDate(row.due_date) },
              { key: 'total', label: 'Total', render: (row) => formatCurrency(row.total_amount, row.currency) },
              { key: 'paid', label: 'Payé', render: (row) => formatCurrency(row.paid_amount, row.currency) },
              { key: 'balance', label: 'Solde', render: (row) => formatCurrency(row.balance_due, row.currency) },
              { key: 'late', label: 'Retard', render: (row) => `${Number(row.overdue_days ?? 0)} j` },
              { key: 'last', label: 'Dernière relance', render: (row) => row.last_reminder_at ? formatDate(row.last_reminder_at) : 'Aucune' },
              { key: 'status', label: 'Statut', render: (row) => <SalesStatusBadge label={invoiceStatusLabel(row.status)} tone={reminderStatusTone(row.status)} /> },
              {
                key: 'actions',
                label: 'Actions',
                className: 'sales-v21-actions-cell',
                render: (row) => (
                  <div className="sales-v21-table-actions">
                    <Link className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact" data-row-action="true" to={`/sales/invoices/${row.id}`}>
                      Ouvrir
                    </Link>
                    <button
                      className="sales-v21-btn sales-v21-btn-secondary sales-v21-btn-compact"
                      data-row-action="true"
                      type="button"
                      disabled={!can('sales_invoices.send') || busyId === row.id}
                      onClick={async (event) => {
                        event.stopPropagation();
                        setBusyId(row.id);
                        setError(null);
                        try {
                          await sendSalesInvoiceReminder(row.id, {
                            reminder_type: Number(row.overdue_days ?? 0) > 0 ? 'OVERDUE' : 'UPCOMING_DUE',
                            reminder_stage: 'MANUAL',
                            reason: 'Relance manuelle depuis la page Recouvrement',
                          });
                        } catch (actionError) {
                          setError(getErrorMessage(actionError));
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {busyId === row.id ? 'Envoi…' : 'Relancer'}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </SalesSection>
    </SalesModulePage>
  );
}
