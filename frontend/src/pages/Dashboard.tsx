import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Building2, CreditCard, FileWarning, Home, Receipt, Users, Wrench, type LucideIcon } from 'lucide-react';
import { api, money, statusLabel } from '../api';

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
  revenue_by_building: ChartPoint[];
  invoice_statuses: ChartPoint[];
  unit_occupancy: ChartPoint[];
  collections_by_month: ChartPoint[];
};

type ChartPoint = { name: string; value: number };

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Summary>('/dashboard').then((response) => setSummary(response.data));
  }, []);

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

  return (
    <section>
      <div className="metrics-grid">
        {cards.map(([label, value, Icon, path]) => (
          <article className="metric-card clickable" key={label} onClick={() => navigate(path)}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value ?? '-'}</strong>
          </article>
        ))}
      </div>
      <div className="finance-band">
        <div>
          <span>Total facturé</span>
          <strong>{money(summary?.total_invoiced)}</strong>
        </div>
        <div>
          <span>Total encaissé</span>
          <strong>{money(summary?.total_collected)}</strong>
        </div>
        <div>
          <span>Restant dû</span>
          <strong>{money(summary?.total_remaining)}</strong>
        </div>
      </div>
      <div className="chart-grid">
        <BarChart title="Revenus par immeuble" data={summary?.revenue_by_building ?? []} formatter={money} />
        <BarChart title="Factures par statut" data={(summary?.invoice_statuses ?? []).map((item) => ({ ...item, name: statusLabel(item.name) }))} />
        <BarChart title="Appartements occupés vs libres" data={(summary?.unit_occupancy ?? []).map((item) => ({ ...item, name: statusLabel(item.name) }))} />
        <BarChart title="Encaissements par mois" data={summary?.collections_by_month ?? []} formatter={money} />
      </div>
    </section>
  );
}

function BarChart({
  title,
  data,
  formatter = (value) => String(value),
}: {
  title: string;
  data: ChartPoint[];
  formatter?: (value: number) => string;
}) {
  const max = Math.max(...data.map((item) => Number(item.value)), 1);
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      {data.map((item) => (
        <div className="bar-row" key={item.name}>
          <span>{item.name}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max((Number(item.value) / max) * 100, 4)}%` }} />
          </div>
          <strong>{formatter(Number(item.value))}</strong>
        </div>
      ))}
    </article>
  );
}
