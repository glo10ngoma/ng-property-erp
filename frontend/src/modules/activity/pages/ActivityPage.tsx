import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, PageHeader, SuccessMessage, TableToolbar } from '../../../components';

type ActivityTask = { id: string; title: string; object: string; module: string; due_date?: string; status: string; path: string; priority: string };
type ActivityAlert = { id: string; level: string; title: string; detail: string; due_date?: string; path: string };
type Validation = { id: number; type: string; object: string; requester?: string; priority: string; date: string; status: string };
type RecentEvent = { id: number; date: string; user_name?: string; module: string; action: string };
type SearchResult = { id: number; label: string; type: string; path: string };

type ActivityOverview = {
  validations: Validation[];
  tasks: ActivityTask[];
  alerts: ActivityAlert[];
  recent: RecentEvent[];
  kpis: Record<string, number>;
  today: ActivityTask[];
  week: Array<{ id: number; title: string; module: string; due_date?: string }>;
  progress: { done: number; remaining: number; validations_done: number; total: number; percent: number };
};

export function ActivityPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<ActivityOverview | null>(null);
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  async function load() {
    const response = await api.get<ActivityOverview>('/activity');
    setOverview(response.data);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.get<SearchResult[]>('/activity/search', { params: { q: query } }).then((response) => setResults(response.data));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function workflowAction(id: number, action: 'approve' | 'reject') {
    await api.post(`/workflows/${id}/${action}`, { comment: action === 'approve' ? 'Approuvé depuis le centre d’activité' : 'Rejeté depuis le centre d’activité' });
    setSuccess(action === 'approve' ? 'Validation approuvée.' : 'Validation rejetée.');
    load();
  }

  const kpis = overview?.kpis ?? {};

  return (
    <section>
      <PageHeader title="Centre d'activité" />
      <SuccessMessage message={success} />
      <div className="quick-form">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recherche globale : locataire, bail, facture, immeuble, appartement, employé" />
      </div>
      {!!results.length && (
        <div className="compact-list detail-section">
          {results.map((result) => <button className="secondary" key={`${result.type}-${result.id}`} onClick={() => navigate(result.path)}>{result.type} · {result.label}</button>)}
        </div>
      )}

      <div className="mini-stats">
        {Object.entries(kpis).map(([key, value]) => <div className="mini-stat" key={key}><span>{kpiLabel(key)}</span><strong>{key.includes('amount') || key.includes('balance') || key.includes('today') || key.includes('expenses') ? money(value) : value}</strong></div>)}
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <h3>Progression de la journée</h3>
          <div className="finance-band">
            <div><span>Tâches terminées</span><strong>{overview?.progress.done ?? 0}</strong></div>
            <div><span>Tâches restantes</span><strong>{overview?.progress.remaining ?? 0}</strong></div>
            <div><span>Validations</span><strong>{overview?.validations.length ?? 0}</strong></div>
          </div>
          <div className="bar-track detail-section"><div className="bar-fill" style={{ width: `${overview?.progress.percent ?? 0}%` }} /></div>
        </article>
        <article className="chart-card">
          <h3>Accès rapide</h3>
          <div className="actions">
            {can('invoices.create') && <button className="secondary" onClick={() => navigate('/invoices')}>Créer facture</button>}
            {can('documents.upload') && <button className="secondary" onClick={() => navigate('/leases')}>Créer bail</button>}
            {can('tenants.create') && <button className="secondary" onClick={() => navigate('/tenants')}>Créer locataire</button>}
            {can('payments.create') && <button className="secondary" onClick={() => navigate('/payments')}>Paiement</button>}
            {can('maintenance.create') && <button className="secondary" onClick={() => navigate('/maintenance')}>Maintenance</button>}
            {can('reports.read') && <button className="secondary" onClick={() => navigate('/reports')}>Rapports</button>}
            {can('staff.create') && <button className="secondary" onClick={() => navigate('/staff')}>Employé</button>}
            {can('stock.read') && <button className="secondary" onClick={() => navigate('/stock')}>Stock</button>}
          </div>
        </article>
      </div>

      <section className="detail-section">
        <h4>Mes validations</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Objet</th><th>Demandeur</th><th>Priorité</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>{(overview?.validations ?? []).map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.object}</td><td>{item.requester ?? '-'}</td><td>{priorityLabel(item.priority)}</td><td>{shortDate(item.date)}</td><td>{statusLabel(item.status)}</td><td className="actions"><button className="secondary" onClick={() => navigate('/workflows')}>Voir</button>{can('workflow.approve') && <button className="secondary" onClick={() => workflowAction(item.id, 'approve')}>Approuver</button>}{can('workflow.reject') && <button className="secondary" onClick={() => workflowAction(item.id, 'reject')}>Rejeter</button>}</td></tr>)}</tbody>
          </table>
          {!(overview?.validations ?? []).length && <EmptyState />}
        </div>
      </section>

      <ActivityTable title="Mes tâches" rows={overview?.tasks ?? []} navigate={navigate} />
      <AlertList alerts={overview?.alerts ?? []} navigate={navigate} />
      <ActivityTable title="Aujourd'hui" rows={overview?.today ?? []} navigate={navigate} />
      <WeekList rows={overview?.week ?? []} navigate={navigate} />
      <RecentList rows={overview?.recent ?? []} />
    </section>
  );
}

function ActivityTable({ title, rows, navigate }: { title: string; rows: ActivityTask[]; navigate: (path: string) => void }) {
  return (
    <section className="detail-section">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tâche</th><th>Objet</th><th>Priorité</th><th>Échéance</th><th>Module</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((task) => <tr key={task.id}><td>{task.title}</td><td>{task.object}</td><td>{priorityLabel(task.priority)}</td><td>{task.due_date ? shortDate(task.due_date) : '-'}</td><td>{task.module}</td><td>{statusLabel(task.status)}</td><td className="actions"><button className="secondary" onClick={() => navigate(task.path)}>Ouvrir</button><button className="secondary">Terminer</button><button className="secondary">Reporter</button></td></tr>)}</tbody>
        </table>
        {!rows.length && <EmptyState />}
      </div>
    </section>
  );
}

function AlertList({ alerts, navigate }: { alerts: ActivityAlert[]; navigate: (path: string) => void }) {
  return (
    <section className="detail-section">
      <h4>Alertes</h4>
      <div className="compact-list">
        {alerts.map((alert) => <button className="compact-item" key={alert.id} onClick={() => navigate(alert.path)}><span>{alertLevelLabel(alert.level)} · {alert.title}</span><strong>{alert.detail}</strong></button>)}
        {!alerts.length && <div className="empty">Aucune alerte.</div>}
      </div>
    </section>
  );
}

function WeekList({ rows, navigate }: { rows: Array<{ id: number; title: string; module: string; due_date?: string }>; navigate: (path: string) => void }) {
  return (
    <section className="detail-section">
      <h4>Cette semaine</h4>
      <div className="compact-list">
        {rows.map((row) => <button className="compact-item" key={`${row.module}-${row.id}`} onClick={() => navigate(modulePath(row.module))}><span>{row.module} · {row.title}</span><strong>{row.due_date ? shortDate(row.due_date) : '-'}</strong></button>)}
        {!rows.length && <div className="empty">Aucune action prévue cette semaine.</div>}
      </div>
    </section>
  );
}

function RecentList({ rows }: { rows: RecentEvent[] }) {
  return (
    <section className="detail-section">
      <h4>Activité récente</h4>
      <div className="table-wrap">
        <table><thead><tr><th>Date</th><th>Utilisateur</th><th>Module</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(row.date)}</td><td>{row.user_name ?? '-'}</td><td>{row.module}</td><td>{row.action}</td></tr>)}</tbody></table>
        {!rows.length && <EmptyState />}
      </div>
    </section>
  );
}

function kpiLabel(key: string) {
  return ({
    unpaid_amount: 'Impayés',
    cash_balance: 'Trésorerie',
    occupancy_rate: 'Taux occupation',
    stock_critical: 'Stock critique',
    maintenance_open: 'Maintenance ouverte',
    payments_today: "Paiements aujourd'hui",
    expenses_today: 'Dépenses',
    pending_invoices: 'Factures en attente',
    new_leases_today: 'Nouveaux baux',
    contracts_due: 'Contrats',
    active_tenants: 'Locataires',
    vacant_units: 'Disponibilités',
  })[key] ?? key;
}

function priorityLabel(value: string) {
  return ({ CRITICAL: 'Critique', HIGH: 'Haute', NORMAL: 'Normale', LOW: 'Basse', URGENT: 'Urgente' })[value] ?? value;
}

function alertLevelLabel(value: string) {
  return ({ CRITICAL: 'Critique', HIGH: 'Haute', NORMAL: 'Normale', LOW: 'Basse' })[value] ?? value;
}

function modulePath(module: string) {
  return ({ Baux: '/leases', Stock: '/stock', Personnel: '/staff', Maintenance: '/maintenance' })[module] ?? '/activity';
}
