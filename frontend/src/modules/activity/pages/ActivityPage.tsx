import { Check, Clock, Eye, Pause, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, PageHeader, SuccessMessage } from '../../../components';

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
  const { can, user } = useAuth();
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
    await api.post(`/workflows/${id}/${action}`, { comment: action === 'approve' ? 'Approuve depuis le centre activite' : 'Rejete depuis le centre activite' });
    setSuccess(action === 'approve' ? 'Validation approuvee.' : 'Validation rejetee.');
    load();
  }

  const kpis = overview?.kpis ?? {};
  const alerts = overview?.alerts ?? [];
  const validations = overview?.validations ?? [];
  const tasks = overview?.tasks ?? [];
  const today = overview?.today ?? [];
  const week = overview?.week ?? [];
  const progress = overview?.progress ?? { done: 0, remaining: 0, validations_done: 0, total: 0, percent: 0 };
  const kpiCards = [
    { label: "Recettes aujourd'hui", value: money(kpis.payments_today ?? 0), path: '/payments' },
    { label: "Depenses aujourd'hui", value: money(kpis.expenses_today ?? 0), path: '/cash' },
    { label: 'Impayes', value: money(kpis.unpaid_amount ?? 0), path: '/invoices?filter=impayes', tone: 'danger' },
    { label: 'Alertes', value: alerts.length, anchor: 'alerts', tone: alerts.length ? 'warning' : undefined },
    { label: 'Validations', value: validations.length, anchor: 'validations' },
    { label: 'Maintenance ouverte', value: kpis.maintenance_open ?? 0, path: '/maintenance' },
    { label: 'Stock critique', value: kpis.stock_critical ?? 0, path: '/stock', tone: Number(kpis.stock_critical ?? 0) > 0 ? 'warning' : undefined },
    { label: 'Taches restantes', value: progress.remaining, anchor: 'tasks' },
  ];

  return (
    <section>
      <PageHeader title="Centre d'activite" />
      <SuccessMessage message={success} />
      <div className="activity-greeting">
        <strong>Bonjour {user?.name ?? 'Utilisateur'}</strong>
        <span>Aujourd'hui : {kpis.pending_invoices ?? 0} factures a suivre, {kpis.payments_today ?? 0} paiements recus, {validations.length} validations, {alerts.length} alertes.</span>
      </div>

      <div className="activity-search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un immeuble, un locataire, une facture..." />
      </div>
      {!!results.length && (
        <div className="activity-results">
          {results.map((result) => <button className="secondary" key={`${result.type}-${result.id}`} onClick={() => navigate(result.path)}>{result.type} - {result.label}</button>)}
        </div>
      )}

      <div className="mini-stats activity-focus">
        {kpiCards.map((item) => (
          <button
            className={`mini-stat kpi-button ${item.tone ?? ''}`}
            key={item.label}
            onClick={() => item.path ? navigate(item.path) : document.getElementById(item.anchor ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </button>
        ))}
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <h3>Progression de la journee</h3>
          <div className="progress-summary">
            <div><span>Taches terminees</span><strong>{progress.done}</strong></div>
            <div><span>Taches restantes</span><strong>{progress.remaining}</strong></div>
            <div><span>Validations</span><strong>{validations.length}</strong></div>
            <div><span>Objectif atteint</span><strong>{progress.percent}%</strong></div>
          </div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${progress.percent}%` }} /></div>
        </article>
        <article className="chart-card">
          <h3>Acces rapide</h3>
          <div className="quick-cards">
            {can('invoices.create') && <QuickCard label="Creer facture" onClick={() => navigate('/invoices')} />}
            {can('documents.upload') && <QuickCard label="Creer bail" onClick={() => navigate('/leases/new')} />}
            {can('tenants.create') && <QuickCard label="Creer locataire" onClick={() => navigate('/tenants')} />}
            {can('payments.create') && <QuickCard label="Paiement" onClick={() => navigate('/payments')} />}
            {can('maintenance.create') && <QuickCard label="Maintenance" onClick={() => navigate('/maintenance')} />}
            {can('reports.read') && <QuickCard label="Rapports" onClick={() => navigate('/reports')} />}
            {can('staff.create') && <QuickCard label="Employes" onClick={() => navigate('/staff')} />}
            {can('stock.read') && <QuickCard label="Stock" onClick={() => navigate('/stock')} />}
          </div>
        </article>
      </div>

      <AlertList alerts={alerts} navigate={navigate} />
      <section className="detail-section" id="validations">
        <h4>Mes validations</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Objet</th><th>Demandeur</th><th>Priorite</th><th>Date</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>{validations.map((item) => <tr className="clickable-row" key={item.id} onClick={() => navigate('/workflows')}><td>{item.type}</td><td>{item.object}</td><td>{item.requester ?? '-'}</td><td><PriorityBadge value={item.priority} /></td><td>{shortDate(item.date)}</td><td><StatusBadgeText value={item.status} /></td><td className="actions" onClick={(event) => event.stopPropagation()}><IconAction title="Voir" onClick={() => navigate('/workflows')} icon={<Eye size={15} />}/>{can('workflow.approve') && <IconAction title="Approuver" onClick={() => workflowAction(item.id, 'approve')} icon={<ThumbsUp size={15} />}/>} {can('workflow.reject') && <IconAction title="Rejeter" onClick={() => workflowAction(item.id, 'reject')} icon={<ThumbsDown size={15} />}/>}</td></tr>)}</tbody>
          </table>
          {!validations.length && <EmptyState title="Aucune validation en attente." message="Les demandes a approuver apparaitront ici." />}
        </div>
      </section>

      <ActivityTable title="Mes taches" rows={tasks} navigate={navigate} />
      <TodayList rows={[...today, ...week.map((item) => ({ id: `week-${item.module}-${item.id}`, title: item.title, object: item.module, module: item.module, due_date: item.due_date, status: 'PENDING', path: modulePath(item.module), priority: 'NORMAL' }))]} navigate={navigate} />
      <RecentList rows={overview?.recent ?? []} />
    </section>
  );
}

function QuickCard({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="quick-card" onClick={onClick}>{label}</button>;
}

function IconAction({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
  return <button className="icon-btn" title={title} onClick={onClick}>{icon}</button>;
}

function ActivityTable({ title, rows, navigate }: { title: string; rows: ActivityTask[]; navigate: (path: string) => void }) {
  return (
    <section className="detail-section" id="tasks">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tache</th><th>Objet</th><th>Priorite</th><th>Echeance</th><th>Module</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((task) => <tr className="clickable-row" key={task.id} onClick={() => navigate(task.path)}><td>{task.title}</td><td>{task.object}</td><td><PriorityBadge value={task.priority} /></td><td>{task.due_date ? shortDate(task.due_date) : '-'}</td><td>{task.module}</td><td><StatusBadgeText value={task.status} /></td><td className="actions" onClick={(event) => event.stopPropagation()}><IconAction title="Ouvrir" onClick={() => navigate(task.path)} icon={<Eye size={15} />} /><IconAction title="Terminer" onClick={() => undefined} icon={<Check size={15} />} /><IconAction title="Reporter" onClick={() => undefined} icon={<Clock size={15} />} /></td></tr>)}</tbody>
        </table>
        {!rows.length && <EmptyState title="Aucune tache en attente." message="Les taches du jour apparaitront ici." />}
      </div>
    </section>
  );
}

function AlertList({ alerts, navigate }: { alerts: ActivityAlert[]; navigate: (path: string) => void }) {
  const visibleAlerts = alerts.slice(0, 5);
  return (
    <section className="detail-section" id="alerts">
      <h4>Alertes</h4>
      <div className="alert-list">
        {visibleAlerts.map((alert) => <button className="alert-row" key={alert.id} onClick={() => navigate(alert.path)}><PriorityDot value={alert.level} /><span>{alert.title}</span><strong>{alert.detail}</strong></button>)}
        {!alerts.length && <EmptyState title="Aucune alerte active." message="Les retards, urgences et seuils critiques apparaitront ici." />}
      </div>
      {alerts.length > 5 && <button className="secondary compact-action" onClick={() => navigate('/activity')}>Voir toutes</button>}
    </section>
  );
}

function TodayList({ rows, navigate }: { rows: ActivityTask[]; navigate: (path: string) => void }) {
  return (
    <section className="detail-section">
      <h4>Aujourd'hui</h4>
      <div className="compact-list">
        {rows.slice(0, 10).map((row) => <button className="compact-item" key={row.id} onClick={() => navigate(row.path)}><span>{row.title}</span><strong>{row.due_date ? shortDate(row.due_date) : row.module}</strong></button>)}
        {!rows.length && <EmptyState title="Aucune tache prevue aujourd'hui." message="Les echeances, paiements attendus et rendez-vous apparaitront ici." />}
      </div>
    </section>
  );
}

function RecentList({ rows }: { rows: RecentEvent[] }) {
  return (
    <section className="detail-section">
      <h4>Activite recente</h4>
      <div className="table-wrap">
        <table><thead><tr><th>Date</th><th>Utilisateur</th><th>Evenement</th></tr></thead><tbody>{rows.map((row) => <tr className="clickable-row" key={row.id}><td>{shortDate(row.date)}</td><td>{row.user_name ?? '-'}</td><td>{recentSentence(row)}</td></tr>)}</tbody></table>
        {!rows.length && <EmptyState title="Aucune activite recente." message="Les dernieres operations apparaitront ici." />}
      </div>
    </section>
  );
}

function PriorityBadge({ value }: { value: string }) {
  return <span className={`badge ${priorityClass(value)}`}>{priorityLabel(value)}</span>;
}

function StatusBadgeText({ value }: { value: string }) {
  return <span className={`badge ${statusClass(value)}`}>{statusLabel(value)}</span>;
}

function PriorityDot({ value }: { value: string }) {
  return <span className={`priority-dot ${priorityClass(value)}`} />;
}

function priorityClass(value: string) {
  return ({ CRITICAL: 'overdue', HIGH: 'unpaid', URGENT: 'overdue', NORMAL: 'partial', LOW: 'paid' })[value] ?? '';
}

function statusClass(value: string) {
  return ({ PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid', OVERDUE: 'overdue', PENDING: 'partial', APPROVED: 'paid', REJECTED: 'unpaid' })[value] ?? '';
}

function priorityLabel(value: string) {
  return ({ CRITICAL: 'Urgent', HIGH: 'Urgent', NORMAL: 'Normal', LOW: 'Faible', URGENT: 'Urgent' })[value] ?? value;
}

function recentSentence(row: RecentEvent) {
  const action = row.action.toUpperCase();
  const module = moduleLabel(row.module);
  if (action.includes('CREATE') || action.includes('CREATED')) return `Ajout ${module}`;
  if (action.includes('UPDATE') || action.includes('UPDATED')) return `Modification ${module}`;
  if (action.includes('DELETE') || action.includes('DELETED')) return `Suppression ${module}`;
  if (action.includes('PAYMENT')) return `Paiement enregistre`;
  if (action.includes('INVOICE')) return `Facture traitee`;
  return `${module} - ${row.action.replace(/_/g, ' ').toLowerCase()}`;
}

function moduleLabel(module: string) {
  return ({ leases: 'bail', payments: 'paiement', invoices: 'facture', buildings: 'immeuble', units: 'appartement', tenants: 'locataire', stock: 'stock', maintenance: 'maintenance' })[module.toLowerCase()] ?? module;
}

function modulePath(module: string) {
  return ({ Baux: '/leases', Stock: '/stock', Personnel: '/staff', Maintenance: '/maintenance' })[module] ?? '/activity';
}
