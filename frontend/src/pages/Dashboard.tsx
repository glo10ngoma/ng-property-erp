import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  Building2,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileWarning,
  Home,
  Printer,
  Receipt,
  RefreshCw,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api, exportExcel, statusLabel } from '../api';
import { EmptyState, LoadingState, PageHeader } from '../components';
import { useAuth } from '../auth';

type ChartPoint = { name: string; value: number };

type Summary = {
  buildings: number;
  tenants: number;
  units: number;
  invoices: number;
  payments: number;
  total_invoiced: number;
  total_collected: number;
  total_remaining: number;
  unpaid_invoices: number;
  overdue_invoices: number;
  overdue_amount: number;
  stock_alerts: number;
  maintenance_open: number;
  maintenance_urgent: number;
  period_invoiced: number;
  period_collected: number;
  leases_expiring_30_days: number;
  vacant_units: number;
  tenant_rent_bands?: Array<{ label: string; min: number; max: number; tenant_count: number }>;
  maintenance_by_building?: Array<{ building_id: number; building_name: string; maintenance_count: number; open_count: number; completed_count: number; urgent_count: number }>;
  tenant_solvency?: Array<{ status: string; label: string; tenant_count: number; description: string }>;
  maintenance_by_type?: Array<{ type_name: string; maintenance_count: number; open_count: number; completed_count: number }>;
  revenue_by_building: Array<ChartPoint & { id?: number; city?: string; occupancy_rate?: number }>;
  invoice_statuses: ChartPoint[];
  unit_occupancy: ChartPoint[];
  collections_by_month: ChartPoint[];
  buildings_options?: Array<{ id: number; name: string; city: string; building_type?: string }>;
  cities?: string[];
  trends?: Record<string, number>;
  period_trends?: Record<string, number>;
  last_updated_at?: string;
};

type DonutDatum = {
  key: string;
  label: string;
  rawName?: string;
  value: number;
  color: string;
  path?: string;
  amount?: number;
  subtitle?: string;
};

type RevenueDatum = {
  key: string;
  name: string;
  value: number;
  color: string;
  path: string;
};

type HorizontalBarDatum = {
  key: string;
  label: string;
  value: number;
  subtitle?: string;
  tooltip: string;
  path?: string;
};

const STATUS_COLORS = {
  paid: '#1f7a4d',
  partial: '#946200',
  unpaid: '#a4343a',
  neutral: '#8aa0ad',
  blue: '#255e7e',
  teal: '#2f6f78',
  orange: '#d9822b',
  violet: '#6b4ca5',
  slate: '#5c6f7b',
};

const REVENUE_COLORS = [
  STATUS_COLORS.blue,
  STATUS_COLORS.teal,
  STATUS_COLORS.orange,
  STATUS_COLORS.violet,
  '#2d728f',
  '#8c5e58',
  '#54736b',
  '#9a6f2a',
];

export function Dashboard() {
  const { can } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ period: 'month', buildingId: '', city: '', manager: '', currency: 'USD' });
  const navigate = useNavigate();
  const canSeeTenantRentAnalytics = can('tenants.read') && can('leases.read');
  const canSeeTenantSolvency = can('tenants.read') && can('invoices.read') && can('payments.read');
  const canSeeMaintenanceAnalytics = can('maintenance.read');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<Summary>('/dashboard', { params: filters });
      setSummary(response.data);
    } catch (nextError) {
      setError(apiErrorMessage(nextError, "Impossible de charger le Dashboard."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filters.period, filters.buildingId, filters.city, filters.manager, filters.currency]);

  const cards: Array<[string, string | number | undefined, LucideIcon, string]> = [
    ['Immeubles', summary?.buildings, Building2, '/buildings'],
    ['Locataires', summary?.tenants, Users, '/tenants'],
    ['Appartements', summary?.units, Home, '/rental-units'],
    ['Factures', summary?.invoices, Receipt, '/invoices'],
    ['Impayés / retards', summary?.overdue_invoices ?? summary?.unpaid_invoices, FileWarning, '/invoices?filter=impayes'],
    ['Alertes stock', summary?.stock_alerts, Boxes, '/stock'],
    ['Maintenance ouverte', summary?.maintenance_open, Wrench, '/maintenance'],
    ['Paiements', summary?.payments, CreditCard, '/payments'],
  ];

  const revenueByBuilding = useMemo<RevenueDatum[]>(
    () => (summary?.revenue_by_building ?? [])
      .filter((item) => Number(item.value ?? 0) > 0)
      .map((item, index) => ({
        key: `building-${item.id ?? item.name}`,
        name: item.name,
        value: Number(item.value ?? 0),
        color: REVENUE_COLORS[index % REVENUE_COLORS.length],
        path: item.id ? `/buildings/${item.id}/report` : '/reports/buildings',
      })),
    [summary],
  );

  const invoiceDonut = useMemo<DonutDatum[]>(
    () => (summary?.invoice_statuses ?? [])
      .filter((item) => Number(item.value ?? 0) > 0)
      .map((item, index) => ({
        key: `invoice-${item.name}`,
        label: invoiceStatusLabel(item.name),
        rawName: item.name,
        value: Number(item.value ?? 0),
        color: invoiceStatusColor(item.name, index),
        path: `/invoices?status=${encodeURIComponent(item.name)}`,
      })),
    [summary],
  );

  const occupancyDonut = useMemo<DonutDatum[]>(
    () => (summary?.unit_occupancy ?? [])
      .filter((item) => Number(item.value ?? 0) > 0)
      .map((item, index) => ({
        key: `occupancy-${item.name}`,
        label: occupancyStatusLabel(item.name),
        rawName: item.name,
        value: Number(item.value ?? 0),
        color: occupancyStatusColor(item.name, index),
        path: `/rental-units?status=${encodeURIComponent(item.name)}`,
      })),
    [summary],
  );

  const collectionsByMonth = useMemo(
    () => (summary?.collections_by_month ?? []).map((item) => ({
      ...item,
      value: Number(item.value ?? 0),
      label: monthLabel(item.name),
      tooltip: `${monthLabel(item.name)} - ${formatMoney(item.value)} ${filters.currency}`,
    })),
    [filters.currency, summary],
  );

  const exportRows = useMemo(
    () => [
      ...(summary?.revenue_by_building ?? []).map((row) => ({ rapport: 'revenus_immeuble', ...row })),
      ...(summary?.invoice_statuses ?? []).map((row) => ({ rapport: 'factures_statut', ...row })),
      ...(summary?.unit_occupancy ?? []).map((row) => ({ rapport: 'occupation', ...row })),
      ...(summary?.collections_by_month ?? []).map((row) => ({ rapport: 'encaissements_mois', ...row })),
      ...(summary?.tenant_rent_bands ?? []).map((row) => ({ rapport: 'locataires_tranches_loyer', ...row })),
      ...(summary?.maintenance_by_building ?? []).map((row) => ({ rapport: 'maintenances_immeuble', ...row })),
      ...(summary?.tenant_solvency ?? []).map((row) => ({ rapport: 'solvabilite_locataires', ...row })),
      ...(summary?.maintenance_by_type ?? []).map((row) => ({ rapport: 'maintenances_type', ...row })),
    ],
    [summary],
  );

  const occupancyRate = useMemo(() => {
    const occupied = sumByStatus(summary?.unit_occupancy, ['OCCUPIED']);
    const total = (summary?.unit_occupancy ?? []).reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    return total ? roundTo((occupied / total) * 100, 1) : 0;
  }, [summary]);

  const collectionInsight = useMemo(() => {
    const invoiced = Number(summary?.period_invoiced ?? 0);
    const collected = Number(summary?.period_collected ?? 0);
    const remaining = Math.max(invoiced - collected, 0);
    const rate = invoiced > 0 ? roundTo((collected / invoiced) * 100, 2) : 0;
    const trend = Number(summary?.period_trends?.collection_rate ?? 0);
    let status = 'Excellent';
    if (rate < 50) status = 'Critique';
    else if (rate < 75) status = 'À surveiller';
    else if (rate < 90) status = 'Bon';

    return { invoiced, collected, remaining, rate, status, trend };
  }, [summary]);

  const rentalRiskInsight = useMemo(() => {
    const overdueInvoices = Number(summary?.overdue_invoices ?? 0);
    const overdueAmount = Number(summary?.overdue_amount ?? 0);
    const expiringLeases = Number(summary?.leases_expiring_30_days ?? 0);
    const vacantUnits = Number(summary?.vacant_units ?? 0);
    const immediateAttentionCount = overdueInvoices + Number(summary?.maintenance_urgent ?? 0) + Number(summary?.stock_alerts ?? 0);

    let message = 'Aucun risque majeur détecté';
    if (overdueInvoices > 0) message = 'Des factures en retard nécessitent un suivi';
    else if (expiringLeases > 0) message = "Des baux arrivent bientôt à échéance";
    else if (vacantUnits > 0) message = 'Plusieurs unités restent vacantes';
    else if (immediateAttentionCount > 0) message = 'Plusieurs alertes nécessitent une action';

    return { overdueInvoices, overdueAmount, expiringLeases, vacantUnits, immediateAttentionCount, message };
  }, [summary]);

  const tenantRentBands = useMemo(
    () => (summary?.tenant_rent_bands ?? []).map((band) => ({
      ...band,
      value: Number(band.tenant_count ?? 0),
      name: band.label,
      tooltip: `${band.label} - ${band.tenant_count} locataire${band.tenant_count > 1 ? 's' : ''} - ${formatPercent(
        rentBandPercentage(band.tenant_count, summary?.tenant_rent_bands ?? []),
      )} % - ${filters.currency}`,
    })),
    [filters.currency, summary],
  );

  const maintenanceByBuilding = useMemo<HorizontalBarDatum[]>(
    () => (summary?.maintenance_by_building ?? []).map((row) => ({
      key: `maintenance-building-${row.building_id}`,
      label: row.building_name,
      value: Number(row.maintenance_count ?? 0),
      subtitle: `Ouvertes : ${row.open_count} · Terminées : ${row.completed_count}${Number(row.urgent_count ?? 0) > 0 ? ` · Urgentes : ${row.urgent_count}` : ''}`,
      tooltip: `${row.building_name} - ${row.maintenance_count} maintenances - ouvertes ${row.open_count} - terminées ${row.completed_count} - urgentes ${row.urgent_count}`,
      path: `/maintenance?building_id=${row.building_id}`,
    })),
    [summary],
  );

  const tenantSolvency = useMemo<DonutDatum[]>(
    () => (summary?.tenant_solvency ?? [])
      .filter((row) => Number(row.tenant_count ?? 0) > 0)
      .map((row, index) => ({
        key: `solvency-${row.status}`,
        label: row.label,
        rawName: row.status,
        value: Number(row.tenant_count ?? 0),
        color: solvencyColor(row.status, index),
        subtitle: row.description,
      })),
    [summary],
  );

  const evaluatedTenants = useMemo(
    () => tenantSolvency
      .filter((row) => row.rawName !== 'UNASSESSED')
      .reduce((sum, row) => sum + row.value, 0),
    [tenantSolvency],
  );

  const maintenanceByType = useMemo<DonutDatum[]>(
    () => (summary?.maintenance_by_type ?? [])
      .filter((row) => Number(row.maintenance_count ?? 0) > 0)
      .map((row, index) => ({
        key: `maintenance-type-${row.type_name}-${index}`,
        label: row.type_name,
        value: Number(row.maintenance_count ?? 0),
        color: maintenanceTypeColor(index),
        subtitle: `Ouvertes : ${row.open_count} · Terminées : ${row.completed_count}`,
      })),
    [summary],
  );

  return (
    <section>
      <PageHeader
        title="Tableau de bord BI"
        action={(
          <div className="actions">
            <button className="secondary" onClick={() => window.print()}><Download size={16} />Exporter PDF</button>
            <button className="secondary" onClick={() => exportExcel('dashboard-bi.xls', exportRows)}><FileSpreadsheet size={16} />Exporter Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
            <button onClick={() => void load()}><RefreshCw size={16} />Actualiser</button>
          </div>
        )}
      />

      <div className="quick-form dashboard-filters">
        <select value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })}>
          <option value="month">Période : mois courant</option>
          <option value="quarter">Trimestre</option>
          <option value="year">Année</option>
        </select>
        <select value={filters.buildingId} onChange={(event) => setFilters({ ...filters, buildingId: event.target.value })}>
          <option value="">Tous les immeubles</option>
          {(summary?.buildings_options ?? []).map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
        <select value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })}>
          <option value="">Toutes les villes</option>
          {(summary?.cities ?? []).map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
        <input value={filters.manager} onChange={(event) => setFilters({ ...filters, manager: event.target.value })} placeholder="Gestionnaire" />
        <input className="locked-field" value={filters.currency} readOnly aria-label="Devise" />
      </div>

      {error ? (
        <div className="error-message dashboard-error-banner">
          {error}
          <button type="button" className="secondary" onClick={() => void load()}>Réessayer</button>
        </div>
      ) : null}

      <div className="finance-band dashboard-finance">
        <FinanceKpi label="Total facturé" value={summary?.total_invoiced} trend={summary?.trends?.total_invoiced} currency={filters.currency} />
        <FinanceKpi label="Total encaissé" value={summary?.total_collected} trend={summary?.trends?.total_collected} currency={filters.currency} />
        <FinanceKpi label="Restant dû" value={summary?.total_remaining} trend={summary?.trends?.total_remaining} currency={filters.currency} />
      </div>

      <div className="metrics-grid dashboard-metrics">
        {cards.map(([label, value, Icon, path]) => (
          <article className="metric-card clickable kpi-button" key={label} onClick={() => navigate(path)}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value ?? '-'}</strong>
          </article>
        ))}
      </div>

      <div className="dashboard-updated">Dernière mise à jour : {summary?.last_updated_at ? new Date(summary.last_updated_at).toLocaleString('fr-FR') : '-'}</div>

      <div className="chart-grid dashboard-chart-grid">
        <article className="chart-card dashboard-analytics-card">
          <h3>Revenus par immeuble</h3>
          {loading && !summary ? (
            <LoadingState message="Chargement des revenus..." />
          ) : revenueByBuilding.length ? (
            <PieDonutChart
              data={revenueByBuilding.map((item) => ({
                key: item.key,
                label: item.name,
                value: item.value,
                color: item.color,
                path: item.path,
              }))}
              centerTitle="Revenus"
              centerValue={formatMoney(revenueByBuilding.reduce((sum, item) => sum + item.value, 0))}
              centerFooter={filters.currency}
              onClick={(item) => item.path ? navigate(item.path) : undefined}
              valueFormatter={(value) => `${formatMoney(value)} ${filters.currency}`}
            />
          ) : (
            <EmptyState title="Aucune donnée de revenus par immeuble sur la période sélectionnée." />
          )}
        </article>

        <article className="chart-card dashboard-analytics-card">
          <h3>Encaissements - 12 derniers mois</h3>
          {loading && !summary ? (
            <LoadingState message="Chargement des encaissements..." />
          ) : collectionsByMonth.some((item) => item.value > 0) ? (
            <VerticalBarChart
              data={collectionsByMonth}
              onClick={() => navigate('/payments')}
              valueLabelFormatter={(value) => value > 0 ? `${formatMoney(value)} ${filters.currency}` : '0'}
            />
          ) : (
            <EmptyState title="Aucun encaissement enregistré durant les 12 derniers mois." />
          )}
        </article>

        <article className="chart-card dashboard-analytics-card">
          <h3>Factures par statut</h3>
          {loading && !summary ? (
            <LoadingState message="Chargement des statuts de facture..." />
          ) : invoiceDonut.length ? (
            <PieDonutChart
              data={invoiceDonut}
              centerTitle="Factures"
              centerValue={String(invoiceDonut.reduce((sum, item) => sum + item.value, 0))}
              centerFooter="sur la période"
              onClick={(item) => item.path ? navigate(item.path) : undefined}
              valueFormatter={(value) => `${value} facture${value > 1 ? 's' : ''}`}
            />
          ) : (
            <EmptyState title="Aucune facture sur la période sélectionnée." />
          )}
        </article>

        <article className="chart-card dashboard-analytics-card">
          <h3>Occupation</h3>
          {loading && !summary ? (
            <LoadingState message="Chargement de l'occupation..." />
          ) : occupancyDonut.length ? (
            <PieDonutChart
              data={occupancyDonut}
              centerTitle="Taux d'occupation"
              centerValue={`${formatPercent(occupancyRate)} %`}
              centerFooter={`${occupancyDonut.reduce((sum, item) => sum + item.value, 0)} unités`}
              onClick={(item) => item.path ? navigate(item.path) : undefined}
              valueFormatter={(value) => `${value} unité${value > 1 ? 's' : ''}`}
            />
          ) : (
            <EmptyState title="Aucune unité immobilière disponible pour calculer l'occupation." />
          )}
        </article>

        {canSeeTenantRentAnalytics ? (
          <article className="chart-card dashboard-analytics-card">
            <h3>Locataires par niveau de loyer</h3>
            <p className="dashboard-card-subtitle">Tranches calculées dans la devise affichée du Dashboard.</p>
            {loading && !summary ? (
              <LoadingState message="Chargement des tranches de loyer..." />
            ) : tenantRentBands.length ? (
              <VerticalBarChart
                data={tenantRentBands.map((band) => ({
                  name: band.label,
                  label: band.label,
                  value: band.value,
                  tooltip: band.tooltip,
                }))}
                onClick={() => navigate('/tenants')}
                valueLabelFormatter={(value) => `${value} locataire${value > 1 ? 's' : ''}`}
                axisFormatter={(value) => String(Math.round(value))}
              />
            ) : (
              <EmptyState title="Aucun locataire avec un bail actif pour la période et les filtres sélectionnés." />
            )}
          </article>
        ) : null}

        {canSeeMaintenanceAnalytics ? (
          <article className="chart-card dashboard-analytics-card">
            <h3>Immeubles par nombre de maintenances</h3>
            <p className="dashboard-card-subtitle">{maintenanceByBuilding.length >= 10 ? 'Top 10 des immeubles les plus sollicités.' : 'Classement des immeubles les plus sollicités.'}</p>
            {loading && !summary ? (
              <LoadingState message="Chargement des maintenances par immeuble..." />
            ) : maintenanceByBuilding.length ? (
              <HorizontalBarChart data={maintenanceByBuilding} onClick={(item) => item.path ? navigate(item.path) : undefined} />
            ) : (
              <EmptyState title="Aucune maintenance enregistrée par immeuble sur la période sélectionnée." />
            )}
          </article>
        ) : null}

        {canSeeTenantSolvency ? (
          <article className="chart-card dashboard-analytics-card">
            <h3>Locataires par solvabilité</h3>
            <p className="dashboard-card-subtitle">Analyse déterministe sur la période filtrée du Dashboard.</p>
            {loading && !summary ? (
              <LoadingState message="Chargement de la solvabilité..." />
            ) : tenantSolvency.length ? (
              <PieDonutChart
                data={tenantSolvency}
                centerTitle="Locataires évalués"
                centerValue={String(evaluatedTenants)}
                centerFooter="sur la période"
                onClick={() => navigate('/tenants')}
                valueFormatter={(value) => `${value} locataire${value > 1 ? 's' : ''}`}
              />
            ) : (
              <EmptyState title="Aucune donnée financière suffisante pour évaluer la solvabilité des locataires." />
            )}
          </article>
        ) : null}

        {canSeeMaintenanceAnalytics ? (
          <article className="chart-card dashboard-analytics-card">
            <h3>Maintenances par type</h3>
            <p className="dashboard-card-subtitle">Les catégories sans libellé exploitable sont regroupées dans « Autres ».</p>
            {loading && !summary ? (
              <LoadingState message="Chargement des types de maintenance..." />
            ) : maintenanceByType.length ? (
              <PieDonutChart
                data={maintenanceByType}
                centerTitle="Maintenances"
                centerValue={String(maintenanceByType.reduce((sum, item) => sum + item.value, 0))}
                centerFooter="catégorisées"
                onClick={() => navigate('/maintenance')}
                valueFormatter={(value) => `${value} maintenance${value > 1 ? 's' : ''}`}
              />
            ) : (
              <EmptyState title="Aucune maintenance catégorisée sur la période sélectionnée." />
            )}
          </article>
        ) : null}

        <InsightCard title="Performance des encaissements" icon={TrendingUp}>
          {loading && !summary ? (
            <LoadingState message="Chargement de la performance..." />
          ) : (
            <>
              <div className="dashboard-insight-grid">
                <InsightMetric label="Montant facturé" value={`${formatMoney(collectionInsight.invoiced)} ${filters.currency}`} />
                <InsightMetric label="Montant encaissé" value={`${formatMoney(collectionInsight.collected)} ${filters.currency}`} />
                <InsightMetric label="Taux d'encaissement" value={`${formatPercent(collectionInsight.rate)} %`} />
                <InsightMetric label="Restant à encaisser" value={`${formatMoney(collectionInsight.remaining)} ${filters.currency}`} />
              </div>
              <div className="dashboard-insight-summary">
                <strong>{collectionInsight.status}</strong>
                <span>
                  Évolution vs période précédente : {collectionInsight.trend >= 0 ? '+' : ''}{formatPercent(collectionInsight.trend)} %
                </span>
              </div>
              <div className="dashboard-insight-actions">
                {can('invoices.read') ? (
                  <button type="button" className="secondary" onClick={() => navigate('/invoices?filter=impayes')}>
                    Voir les impayés
                  </button>
                ) : null}
              </div>
            </>
          )}
        </InsightCard>

        <InsightCard title="Risque locatif et échéances" icon={AlertTriangle}>
          {loading && !summary ? (
            <LoadingState message="Chargement du risque locatif..." />
          ) : (
            <>
              <div className="dashboard-insight-grid">
                <InsightMetric label="Factures en retard" value={String(rentalRiskInsight.overdueInvoices)} />
                <InsightMetric label="Montant en retard" value={`${formatMoney(rentalRiskInsight.overdueAmount)} ${filters.currency}`} />
                <InsightMetric label="Baux expirant sous 30 jours" value={String(rentalRiskInsight.expiringLeases)} />
                <InsightMetric label="Unités vacantes" value={String(rentalRiskInsight.vacantUnits)} />
                <InsightMetric label="Attention immédiate" value={String(rentalRiskInsight.immediateAttentionCount)} />
              </div>
              <div className="dashboard-insight-summary">
                <strong>{rentalRiskInsight.message}</strong>
              </div>
              <div className="dashboard-insight-actions">
                {can('invoices.read') ? <button type="button" className="secondary" onClick={() => navigate('/invoices?filter=impayes')}>Voir les impayés</button> : null}
                {can('documents.read') ? <button type="button" className="secondary" onClick={() => navigate('/leases')}>Voir les baux à renouveler</button> : null}
                {can('units.read') ? <button type="button" className="secondary" onClick={() => navigate('/rental-units?status=VACANT')}>Voir les unités vacantes</button> : null}
              </div>
            </>
          )}
        </InsightCard>
      </div>
    </section>
  );
}

function FinanceKpi({ label, value, trend, currency }: { label: string; value?: number; trend?: number; currency: string }) {
  const trendValue = Number(trend ?? 0);
  const direction = trendValue >= 0 ? '▲' : '▼';
  return (
    <div>
      <span>{label}</span>
      <strong>{formatMoney(value)}</strong>
      <small className={trendValue >= 0 ? 'positive' : 'negative'}>{direction} {Math.abs(trendValue)}%</small>
      <em>{currency}</em>
    </div>
  );
}

function PieDonutChart({
  data,
  centerTitle,
  centerValue,
  centerFooter,
  onClick,
  valueFormatter,
}: {
  data: DonutDatum[];
  centerTitle: string;
  centerValue: string;
  centerFooter: string;
  onClick?: (item: DonutDatum) => void;
  valueFormatter: (value: number) => string;
}) {
  const total = data.reduce((sum, item) => sum + Number(item.value), 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-content dashboard-donut-content">
      <svg className="donut-svg dashboard-donut-svg" viewBox="0 0 120 120" role="img" aria-label={centerTitle}>
        <circle cx="60" cy="60" r={radius} className="donut-bg" />
        {data.map((item) => {
          const ratio = total ? Number(item.value) / total : 0;
          const length = ratio * circumference;
          const percent = total ? roundTo((Number(item.value) / total) * 100, 1) : 0;
          const tooltip = `${item.label} - ${valueFormatter(item.value)} - ${percent}%`;
          const segment = (
            <circle
              key={item.key}
              cx="60"
              cy="60"
              r={radius}
              className="donut-segment"
              stroke={item.color}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              onClick={() => onClick?.(item)}
            >
              <title>{tooltip}</title>
            </circle>
          );
          offset += length;
          return segment;
        })}
        <text x="60" y="46" textAnchor="middle" className="dashboard-donut-center-title">{centerTitle}</text>
        <text x="60" y="64" textAnchor="middle" className="dashboard-donut-center-value">{centerValue}</text>
        <text x="60" y="79" textAnchor="middle" className="dashboard-donut-center-footer">{centerFooter}</text>
      </svg>
      <div className="donut-legend dashboard-donut-legend">
        {data.map((item) => {
          const percent = total ? roundTo((Number(item.value) / total) * 100, 1) : 0;
          return (
            <button
              key={item.key}
              type="button"
              className="donut-legend-row dashboard-donut-legend-row"
              onClick={() => onClick?.(item)}
              title={`${item.label} - ${valueFormatter(item.value)} - ${percent}%`}
            >
              <span className="donut-dot" style={{ background: item.color }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{percent}%</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VerticalBarChart({
  data,
  onClick,
  valueLabelFormatter,
  axisFormatter = formatMoney,
}: {
  data: Array<ChartPoint & { label: string; tooltip: string }>;
  onClick?: () => void;
  valueLabelFormatter?: (value: number) => string;
  axisFormatter?: (value: number) => string;
}) {
  const max = Math.max(...data.map((item) => Number(item.value ?? 0)), 1);
  const steps = buildAxisSteps(max);

  return (
    <div className="dashboard-vertical-chart">
      <div className="dashboard-vertical-grid">
        {steps.map((step) => (
          <div key={step} className="dashboard-vertical-gridline">
            <span>{axisFormatter(step)}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-vertical-bars" style={{ gridTemplateColumns: `repeat(${Math.max(data.length, 1)}, minmax(0, 1fr))` }}>
        {data.map((item) => {
          const height = max > 0 ? (Number(item.value ?? 0) / max) * 100 : 0;
          return (
            <button
              key={item.name}
              type="button"
              className="dashboard-vertical-bar"
              onClick={onClick}
              title={item.tooltip}
            >
              <span className="dashboard-vertical-bar-value">{valueLabelFormatter ? valueLabelFormatter(Number(item.value ?? 0)) : String(item.value ?? 0)}</span>
              <div className="dashboard-vertical-bar-track">
                <div className="dashboard-vertical-bar-fill" style={{ height: `${height}%` }} />
              </div>
              <strong>{item.label}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HorizontalBarChart({
  data,
  onClick,
}: {
  data: HorizontalBarDatum[];
  onClick?: (item: HorizontalBarDatum) => void;
}) {
  const max = Math.max(...data.map((item) => Number(item.value ?? 0)), 1);
  return (
    <div className="dashboard-horizontal-bars">
      {data.map((item) => (
        <button
          key={item.key}
          type="button"
          className="bar-row chart-clickable dashboard-horizontal-bar"
          onClick={() => onClick?.(item)}
          title={item.tooltip}
        >
          <span>
            {item.label}
            {item.subtitle ? <small>{item.subtitle}</small> : null}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max((Number(item.value ?? 0) / max) * 100, 4)}%` }} />
          </div>
          <strong>{item.value}</strong>
        </button>
      ))}
    </div>
  );
}

function InsightCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <article className="chart-card dashboard-insight-card">
      <div className="dashboard-insight-head">
        <h3>{title}</h3>
        <span className="dashboard-insight-icon"><Icon size={18} /></span>
      </div>
      {children}
    </article>
  );
}

function InsightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-insight-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function invoiceStatusLabel(value: string) {
  const normalized = String(value ?? '').toUpperCase();
  return ({
    DRAFT: 'Brouillon',
    ISSUED: 'Émise',
    SENT: 'Émise',
    PARTIAL: 'Partiellement payée',
    PARTIALLY_PAID: 'Partiellement payée',
    PAID: 'Payée',
    OVERDUE: 'En retard',
    CANCELLED: 'Annulée',
    UNPAID: 'Non payée',
    NOT_PAID: 'Non payée',
  } as Record<string, string>)[normalized] ?? statusLabel(value);
}

function invoiceStatusColor(value: string, index: number) {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'PAID') return STATUS_COLORS.paid;
  if (normalized === 'PARTIAL' || normalized === 'PARTIALLY_PAID') return STATUS_COLORS.partial;
  if (normalized === 'OVERDUE') return STATUS_COLORS.unpaid;
  if (normalized === 'UNPAID' || normalized === 'NOT_PAID') return '#c95a63';
  if (normalized === 'DRAFT') return STATUS_COLORS.slate;
  if (normalized === 'ISSUED' || normalized === 'SENT') return STATUS_COLORS.blue;
  if (normalized === 'CANCELLED') return '#7b8794';
  return REVENUE_COLORS[index % REVENUE_COLORS.length];
}

function occupancyStatusLabel(value: string) {
  const normalized = String(value ?? '').toUpperCase();
  return ({
    OCCUPIED: 'Occupées',
    VACANT: 'Vacantes',
    AVAILABLE: 'Vacantes',
    RESERVED: 'Réservées',
    MAINTENANCE: 'En maintenance',
    UNAVAILABLE: 'Indisponibles',
  } as Record<string, string>)[normalized] ?? statusLabel(value);
}

function occupancyStatusColor(value: string, index: number) {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'OCCUPIED') return STATUS_COLORS.paid;
  if (normalized === 'VACANT' || normalized === 'AVAILABLE') return STATUS_COLORS.unpaid;
  if (normalized === 'MAINTENANCE') return STATUS_COLORS.partial;
  if (normalized === 'RESERVED') return STATUS_COLORS.blue;
  return REVENUE_COLORS[index % REVENUE_COLORS.length];
}

function solvencyColor(value: string, index: number) {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'SOLVENT') return STATUS_COLORS.paid;
  if (normalized === 'WATCH') return STATUS_COLORS.partial;
  if (normalized === 'AT_RISK') return STATUS_COLORS.unpaid;
  if (normalized === 'UNASSESSED') return STATUS_COLORS.slate;
  return REVENUE_COLORS[index % REVENUE_COLORS.length];
}

function maintenanceTypeColor(index: number) {
  return REVENUE_COLORS[index % REVENUE_COLORS.length];
}

function sumByStatus(data: ChartPoint[] = [], statuses: string[]) {
  return data
    .filter((item) => statuses.includes(String(item.name).toUpperCase()))
    .reduce((sum, item) => sum + Number(item.value ?? 0), 0);
}

function rentBandPercentage(count: number, bands: Array<{ tenant_count: number }> = []) {
  const total = bands.reduce((sum, band) => sum + Number(band.tenant_count ?? 0), 0);
  return total > 0 ? (count / total) * 100 : 0;
}

function monthLabel(value: string) {
  const [year, month] = String(value).split('-').map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

function buildAxisSteps(max: number) {
  return [1, 0.75, 0.5, 0.25, 0].map((ratio) => roundTo(max * ratio, 0));
}

function formatMoney(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

function formatPercent(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function apiErrorMessage(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(responseMessage)) return responseMessage.join(' ');
  return responseMessage || (error instanceof Error ? error.message : fallback);
}
