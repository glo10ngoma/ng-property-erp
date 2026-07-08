import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Building2, CreditCard, Download, FileSpreadsheet, FileWarning, Home, Printer, Receipt, RefreshCw, Users, Wrench, type LucideIcon } from 'lucide-react';
import { api, exportExcel, statusLabel } from '../api';
import { PageHeader } from '../components';

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
  stock_alerts: number;
  maintenance_open: number;
  maintenance_urgent: number;
  revenue_by_building: Array<ChartPoint & { id?: number; city?: string; occupancy_rate?: number }>;
  invoice_statuses: ChartPoint[];
  unit_occupancy: ChartPoint[];
  collections_by_month: ChartPoint[];
  buildings_options?: Array<{ id: number; name: string; city: string; building_type?: string }>;
  cities?: string[];
  trends?: Record<string, number>;
  last_updated_at?: string;
};

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState({ period: 'month', buildingId: '', city: '', manager: '', currency: 'USD' });
  const navigate = useNavigate();

  async function load() {
    const response = await api.get<Summary>('/dashboard', { params: filters });
    setSummary(response.data);
  }

  useEffect(() => {
    load();
  }, [filters]);

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

  const exportRows = useMemo(() => [
    ...(summary?.revenue_by_building ?? []).map((row) => ({ rapport: 'revenus_immeuble', ...row })),
    ...(summary?.invoice_statuses ?? []).map((row) => ({ rapport: 'factures_statut', ...row })),
    ...(summary?.unit_occupancy ?? []).map((row) => ({ rapport: 'occupation', ...row })),
    ...(summary?.collections_by_month ?? []).map((row) => ({ rapport: 'encaissements_mois', ...row })),
  ], [summary]);

  return (
    <section>
      <PageHeader
        title="Tableau de bord BI"
        action={(
          <div className="actions">
            <button className="secondary" onClick={() => window.print()}><Download size={16} />Exporter PDF</button>
            <button className="secondary" onClick={() => exportExcel('dashboard-bi.xls', exportRows)}><FileSpreadsheet size={16} />Exporter Excel</button>
            <button className="secondary" onClick={() => window.print()}><Printer size={16} />Imprimer</button>
            <button onClick={load}><RefreshCw size={16} />Actualiser</button>
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
        <RevenueChart title="Revenus par immeuble" data={summary?.revenue_by_building ?? []} navigate={navigate} currency={filters.currency} />
        <StatusChart title="Factures par statut" data={(summary?.invoice_statuses ?? []).map((item) => ({ ...item, name: statusLabel(item.name) }))} onClick={(item) => navigate(`/invoices?status=${encodeURIComponent(item.name)}`)} />
        <StatusChart title="Occupation" data={(summary?.unit_occupancy ?? []).map((item) => ({ ...item, name: statusLabel(item.name) }))} onClick={(item) => navigate(`/rental-units?status=${encodeURIComponent(item.name)}`)} />
        <BarChart title="Encaissements - 12 derniers mois" data={summary?.collections_by_month ?? []} formatter={(value) => amount(value)} suffix={filters.currency} onClick={() => navigate('/payments')} />
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
      <strong>{amount(value)}</strong>
      <small className={trendValue >= 0 ? 'positive' : 'negative'}>{direction} {Math.abs(trendValue)}%</small>
      <em>{currency}</em>
    </div>
  );
}

function RevenueChart({ title, data, navigate, currency }: { title: string; data: Array<ChartPoint & { id?: number; occupancy_rate?: number }>; navigate: (path: string) => void; currency: string }) {
  const max = Math.max(...data.map((item) => Number(item.value)), 1);
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {data.map((item) => (
        <button className="bar-row chart-clickable" key={item.name} onClick={() => navigate(item.id ? `/buildings/${item.id}/report` : '/reports/buildings')}>
          <span>{item.name}<small>Taux : {Number(item.occupancy_rate ?? 0)}%</small></span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max((Number(item.value) / max) * 100, 4)}%` }} /></div>
          <strong>{amount(item.value)} <em>{currency}</em></strong>
        </button>
      ))}
    </article>
  );
}

function StatusChart({ title, data, onClick }: { title: string; data: ChartPoint[]; onClick: (item: ChartPoint) => void }) {
  const total = data.reduce((sum, item) => sum + Number(item.value), 0) || 1;
  return <BarChart title={title} data={data.map((item) => ({ ...item, percent: Math.round((Number(item.value) / total) * 100) }))} formatter={(value) => String(value)} onClick={onClick} showPercent />;
}

function BarChart({
  title,
  data,
  formatter = (value) => String(value),
  suffix,
  onClick,
  showPercent,
}: {
  title: string;
  data: Array<ChartPoint & { percent?: number }>;
  formatter?: (value: number) => string;
  suffix?: string;
  onClick?: (item: ChartPoint) => void;
  showPercent?: boolean;
}) {
  const max = Math.max(...data.map((item) => Number(item.value)), 1);
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {data.map((item) => (
        <button className="bar-row chart-clickable" key={item.name} onClick={() => onClick?.(item)}>
          <span>{item.name}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max((Number(item.value) / max) * 100, 4)}%` }} /></div>
          <strong>{formatter(Number(item.value))}{showPercent ? ` · ${item.percent}%` : ''}{suffix ? ` ${suffix}` : ''}</strong>
        </button>
      ))}
    </article>
  );
}

function amount(value: unknown) {
  return Number(value ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}
