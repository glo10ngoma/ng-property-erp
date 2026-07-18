import {
  AlertTriangle,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  HardHat,
  Landmark,
  Receipt,
  Search,
  ShieldAlert,
  ShoppingCart,
  Siren,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, shortDate, statusLabel } from '../../../api';
import { useAuth } from '../../../auth';
import { EmptyState, LoadingState, PageHeader, SuccessMessage } from '../../../components';

type ActivityTask = {
  id: string;
  title: string;
  object: string;
  module: string;
  due_date?: string;
  status: string;
  path: string;
  priority: string;
};

type ActivityAlert = {
  id: string;
  level: string;
  title: string;
  detail: string;
  due_date?: string;
  path: string;
};

type Validation = {
  id: number;
  type: string;
  object: string;
  requester?: string;
  priority: string;
  date: string;
  status: string;
};

type RecentEvent = {
  id: number;
  date: string;
  user_name?: string;
  module: string;
  action: string;
};

type SearchResult = {
  id: number;
  label: string;
  type: string;
  path: string;
};

type WeekItem = {
  id: number;
  title: string;
  module: string;
  due_date?: string;
};

type ActivityOverview = {
  validations: Validation[];
  tasks: ActivityTask[];
  alerts: ActivityAlert[];
  recent: RecentEvent[];
  kpis: Record<string, number>;
  today: ActivityTask[];
  week: WeekItem[];
  progress: { done: number; remaining: number; validations_done: number; total: number; percent: number };
};

type TabId =
  | 'alerts'
  | 'approvals'
  | 'tasks'
  | 'today'
  | 'recent'
  | 'deadlines'
  | 'arrears'
  | 'leases'
  | 'maintenance'
  | 'cash'
  | 'hr'
  | 'stock';

type TabDefinition = {
  id: TabId;
  label: string;
  count?: number;
  visible: boolean;
  icon: ReactNode;
};

type QuickAction = {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: ReactNode;
  visible: boolean;
};

const TAB_FALLBACK: TabId = 'alerts';

export function ActivityPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<ActivityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [alertLevelFilter, setAlertLevelFilter] = useState<'ALL' | 'CRITICAL' | 'ATTENTION' | 'INFO'>('ALL');
  const [taskFilter, setTaskFilter] = useState<'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE'>('ALL');
  const [recentModuleFilter, setRecentModuleFilter] = useState<string>('ALL');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<ActivityOverview>('/activity');
      setOverview(response.data);
    } catch (nextError) {
      setError(apiErrorMessage(nextError, "Impossible de charger le Centre d'activité."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchError('');
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      try {
        const response = await api.get<SearchResult[]>('/activity/search', { params: { q: query } });
        if (!cancelled) setResults(response.data);
      } catch (nextError) {
        if (!cancelled) {
          setResults([]);
          setSearchError(apiErrorMessage(nextError, 'Recherche indisponible.'));
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function workflowAction(id: number, action: 'approve' | 'reject') {
    await api.post(`/workflows/${id}/${action}`, {
      comment: action === 'approve'
        ? "Approuvé depuis le Centre d'activité"
        : "Rejeté depuis le Centre d'activité",
    });
    setSuccess(action === 'approve' ? 'Validation approuvée.' : 'Validation rejetée.');
    void load();
  }

  const kpis = overview?.kpis ?? {};
  const alerts = overview?.alerts ?? [];
  const validations = overview?.validations ?? [];
  const tasks = overview?.tasks ?? [];
  const today = overview?.today ?? [];
  const week = overview?.week ?? [];
  const recent = overview?.recent ?? [];
  const progress = overview?.progress ?? { done: 0, remaining: 0, validations_done: 0, total: 0, percent: 0 };

  const alertCountByLevel = useMemo(() => ({
    CRITICAL: alerts.filter((item) => alertLevel(item.level) === 'CRITICAL').length,
    ATTENTION: alerts.filter((item) => alertLevel(item.level) === 'ATTENTION').length,
    INFO: alerts.filter((item) => alertLevel(item.level) === 'INFO').length,
  }), [alerts]);

  const filteredAlerts = useMemo(() => {
    if (alertLevelFilter === 'ALL') return alerts;
    return alerts.filter((item) => alertLevel(item.level) === alertLevelFilter);
  }, [alertLevelFilter, alerts]);

  const taskGroups = useMemo(() => {
    const grouped = {
      overdue: [] as ActivityTask[],
      today: [] as ActivityTask[],
      upcoming: [] as ActivityTask[],
      done: [] as ActivityTask[],
    };

    tasks.forEach((task) => {
      const normalizedStatus = String(task.status ?? '').toUpperCase();
      if (['DONE', 'COMPLETED', 'CLOSED', 'RESOLVED', 'PAID', 'APPROVED'].includes(normalizedStatus)) {
        grouped.done.push(task);
        return;
      }

      const relation = dueDateRelation(task.due_date);
      if (relation === 'OVERDUE') {
        grouped.overdue.push(task);
      } else if (relation === 'TODAY') {
        grouped.today.push(task);
      } else {
        grouped.upcoming.push(task);
      }
    });

    return grouped;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    switch (taskFilter) {
      case 'OVERDUE':
        return taskGroups.overdue;
      case 'TODAY':
        return taskGroups.today;
      case 'UPCOMING':
        return taskGroups.upcoming;
      case 'DONE':
        return taskGroups.done;
      default:
        return tasks;
    }
  }, [taskFilter, taskGroups, tasks]);

  const todayTimeline = useMemo(
    () => [
      ...today.map((item) => ({
        id: `today-${item.id}`,
        title: item.title,
        module: item.module,
        detail: item.object,
        date: item.due_date,
        path: item.path,
      })),
      ...week.map((item) => ({
        id: `week-${item.id}`,
        title: item.title,
        module: item.module,
        detail: moduleLabel(item.module),
        date: item.due_date,
        path: modulePath(item.module),
      })),
    ],
    [today, week],
  );

  const recentModuleOptions = useMemo(
    () => ['ALL', ...Array.from(new Set(recent.map((item) => moduleLabel(item.module))))],
    [recent],
  );

  const filteredRecent = useMemo(
    () => recentModuleFilter === 'ALL'
      ? recent
      : recent.filter((item) => moduleLabel(item.module) === recentModuleFilter),
    [recent, recentModuleFilter],
  );

  const deadlineItems = useMemo(
    () => week.map((item) => ({
      ...item,
      path: modulePath(item.module),
    })),
    [week],
  );

  const arrearsItems = useMemo(
    () => alerts.filter((item) => looksLikeArrears(item)),
    [alerts],
  );

  const leaseItems = useMemo(
    () => [
      ...tasks.filter((item) => isLeaseModule(item.module) || looksLikeLeaseText(item.title) || looksLikeLeaseText(item.object)),
      ...week.filter((item) => isLeaseModule(item.module) || looksLikeLeaseText(item.title)),
      ...alerts.filter((item) => looksLikeLeaseText(item.title) || looksLikeLeaseText(item.detail)),
    ],
    [alerts, tasks, week],
  );

  const maintenanceItems = useMemo(
    () => [
      ...tasks.filter((item) => isMaintenanceModule(item.module)),
      ...alerts.filter((item) => isMaintenanceText(item.title) || isMaintenanceText(item.detail)),
      ...recent.filter((item) => isMaintenanceModule(item.module)),
    ],
    [alerts, recent, tasks],
  );

  const cashItems = useMemo(
    () => [
      ...tasks.filter((item) => isCashText(item.title) || isCashText(item.object) || isCashText(item.module)),
      ...alerts.filter((item) => isCashText(item.title) || isCashText(item.detail)),
      ...recent.filter((item) => isCashText(item.module) || isCashText(rowSentence(item))),
    ],
    [alerts, recent, tasks],
  );

  const hrItems = useMemo(
    () => [
      ...week.filter((item) => isHrModule(item.module)),
      ...alerts.filter((item) => isHrText(item.title) || isHrText(item.detail)),
      ...recent.filter((item) => isHrModule(item.module)),
    ],
    [alerts, recent, week],
  );

  const stockItems = useMemo(
    () => [
      ...tasks.filter((item) => isStockModule(item.module)),
      ...alerts.filter((item) => isStockText(item.title) || isStockText(item.detail)),
      ...recent.filter((item) => isStockModule(item.module)),
    ],
    [alerts, recent, tasks],
  );

  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'tenant-create',
      label: 'Nouveau locataire',
      description: 'Ouvrir le module Locataires',
      path: '/tenants',
      icon: <UserPlus size={16} />,
      visible: can('tenants.create'),
    },
    {
      id: 'lease-create',
      label: 'Nouveau bail',
      description: 'Créer un bail',
      path: '/leases/new',
      icon: <FileText size={16} />,
      visible: can('documents.upload'),
    },
    {
      id: 'invoice-create',
      label: 'Nouvelle facture',
      description: 'Ouvrir la facturation',
      path: '/invoices',
      icon: <Receipt size={16} />,
      visible: can('invoices.create'),
    },
    {
      id: 'payment-create',
      label: 'Nouveau paiement',
      description: 'Ouvrir les paiements',
      path: '/payments',
      icon: <CreditCard size={16} />,
      visible: can('payments.create'),
    },
    {
      id: 'cash-open',
      label: 'Ouvrir la caisse',
      description: 'Aller au module Caisse',
      path: '/cash',
      icon: <Landmark size={16} />,
      visible: can('cash.create') || can('cash.read'),
    },
    {
      id: 'expense-create',
      label: 'Enregistrer une dépense',
      description: 'Aller au module Caisse',
      path: '/cash',
      icon: <WalletCards size={16} />,
      visible: can('cash.create') || can('cash.read'),
    },
    {
      id: 'employee-create',
      label: 'Nouvel employé',
      description: 'Ouvrir le personnel',
      path: '/personnel/employees',
      icon: <Users size={16} />,
      visible: can('staff.create'),
    },
    {
      id: 'stock-purchase-create',
      label: 'Nouvel achat stock',
      description: 'Ouvrir les achats fournisseurs',
      path: '/stock/purchases',
      icon: <ShoppingCart size={16} />,
      visible: can('stock.read'),
    },
    {
      id: 'maintenance-create',
      label: 'Nouvelle maintenance',
      description: 'Ouvrir la maintenance',
      path: '/maintenance',
      icon: <HardHat size={16} />,
      visible: can('maintenance.create') || can('maintenance.read'),
    },
    {
      id: 'arrears-open',
      label: 'Voir les impayés',
      description: 'Consulter les factures',
      path: '/invoices',
      icon: <ShieldAlert size={16} />,
      visible: can('invoices.read'),
    },
    {
      id: 'renewal-open',
      label: 'Contrats à renouveler',
      description: 'Consulter les baux',
      path: '/leases',
      icon: <Clock3 size={16} />,
      visible: can('documents.read'),
    },
    {
      id: 'approvals-open',
      label: 'Validations en attente',
      description: 'Ouvrir les workflows',
      path: '/workflows',
      icon: <FileCheck2 size={16} />,
      visible: can('workflow.read'),
    },
  ].filter((item) => item.visible), [can]);

  const overviewCards = useMemo(
    () => [
      { label: "Paiements aujourd'hui", value: money(kpis.payments_today ?? 0), tone: 'positive' },
      { label: "Dépenses aujourd'hui", value: money(kpis.expenses_today ?? 0), tone: 'neutral' },
      { label: 'Impayés', value: money(kpis.unpaid_amount ?? 0), tone: Number(kpis.unpaid_amount ?? 0) > 0 ? 'warning' : 'neutral' },
      { label: 'Alertes actives', value: alerts.length, tone: alerts.length ? 'critical' : 'neutral' },
      { label: 'Validations', value: validations.length, tone: validations.length ? 'attention' : 'neutral' },
      { label: 'Maintenance ouverte', value: Number(kpis.maintenance_open ?? 0), tone: Number(kpis.maintenance_open ?? 0) > 0 ? 'attention' : 'neutral' },
      { label: 'Stock critique', value: Number(kpis.stock_critical ?? 0), tone: Number(kpis.stock_critical ?? 0) > 0 ? 'warning' : 'neutral' },
      { label: 'Tâches restantes', value: progress.remaining, tone: progress.remaining ? 'attention' : 'positive' },
    ],
    [alerts.length, kpis, progress.remaining, validations.length],
  );

  const tabs = useMemo<TabDefinition[]>(() => [
    { id: 'alerts', label: 'Alertes', count: alerts.length, visible: true, icon: <Siren size={15} /> },
    { id: 'approvals', label: 'Mes validations', count: validations.length, visible: true, icon: <FileCheck2 size={15} /> },
    { id: 'tasks', label: 'Mes tâches', count: tasks.length, visible: true, icon: <CheckCircle2 size={15} /> },
    { id: 'today', label: "Aujourd'hui", count: todayTimeline.length, visible: true, icon: <Clock3 size={15} /> },
    { id: 'recent', label: 'Activité récente', count: recent.length, visible: true, icon: <CircleAlert size={15} /> },
    { id: 'deadlines', label: 'Échéances', count: deadlineItems.length, visible: deadlineItems.length > 0, icon: <Clock3 size={15} /> },
    { id: 'arrears', label: 'Impayés', count: arrearsItems.length, visible: arrearsItems.length > 0 || Number(kpis.unpaid_amount ?? 0) > 0, icon: <ShieldAlert size={15} /> },
    { id: 'leases', label: 'Contrats et baux', count: leaseItems.length, visible: leaseItems.length > 0, icon: <Building2 size={15} /> },
    { id: 'maintenance', label: 'Maintenance', count: maintenanceItems.length, visible: maintenanceItems.length > 0, icon: <HardHat size={15} /> },
    { id: 'cash', label: 'Caisse', count: cashItems.length, visible: cashItems.length > 0 || can('cash.read'), icon: <Landmark size={15} /> },
    { id: 'hr', label: 'RH', count: hrItems.length, visible: hrItems.length > 0, icon: <Briefcase size={15} /> },
    { id: 'stock', label: 'Stock', count: stockItems.length, visible: stockItems.length > 0, icon: <Boxes size={15} /> },
  ], [
    alerts.length,
    arrearsItems.length,
    can,
    cashItems.length,
    deadlineItems.length,
    hrItems.length,
    kpis.unpaid_amount,
    leaseItems.length,
    maintenanceItems.length,
    recent.length,
    stockItems.length,
    tasks.length,
    todayTimeline.length,
    validations.length,
  ]);

  const visibleTabs = tabs.filter((item) => item.visible);
  const activeTabParam = searchParams.get('tab');
  const activeTab = visibleTabs.some((item) => item.id === activeTabParam) ? activeTabParam as TabId : visibleTabs[0]?.id ?? TAB_FALLBACK;

  useEffect(() => {
    if (!visibleTabs.length) return;
    if (searchParams.get('tab') !== activeTab) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('tab', activeTab);
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams, visibleTabs]);

  function changeTab(tab: TabId) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  }

  return (
    <section className="activity-page">
      <PageHeader title="Centre d'activité" />
      <SuccessMessage message={success} />

      <div className="activity-greeting">
        <strong>Bonjour {user?.name ?? 'Utilisateur'}</strong>
        <span>
          {validations.length} validation{validations.length > 1 ? 's' : ''},
          {' '} {alerts.length} alerte{alerts.length > 1 ? 's' : ''},
          {' '} {progress.remaining} tâche{progress.remaining > 1 ? 's' : ''} à traiter aujourd'hui.
        </span>
      </div>

      <div className="activity-search-panel detail-section">
        <div className="activity-panel-head">
          <div>
            <h4>Recherche rapide</h4>
            <p>Retrouvez un locataire, un bail, une facture, un immeuble ou un employé sans quitter votre cockpit.</p>
          </div>
        </div>
        <div className="activity-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un immeuble, un locataire, une facture..."
          />
        </div>
        {searchLoading ? <LoadingState message="Recherche en cours..." /> : null}
        {searchError ? <div className="error-message">{searchError}</div> : null}
        {results.length ? (
          <div className="activity-results">
            {results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                className="secondary activity-result-pill"
                onClick={() => navigate(result.path)}
              >
                <span>{result.type}</span>
                <strong>{result.label}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="activity-kpi-grid">
        {overviewCards.map((item) => (
          <article className={`activity-kpi-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>

      <div className="activity-two-column">
        <section className="detail-section activity-panel">
          <div className="activity-panel-head">
            <div>
              <h4>Accès rapides</h4>
              <p>Les raccourcis affichés dépendent uniquement des permissions de l'utilisateur connecté.</p>
            </div>
          </div>
          {quickActions.length ? (
            <div className="activity-quick-grid">
              {quickActions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="activity-quick-card"
                  onClick={() => navigate(item.path)}
                >
                  <span className="activity-quick-icon">{item.icon}</span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun accès rapide disponible."
              message="Vos permissions actuelles ne donnent accès à aucune action directe depuis ce Centre d'activité."
            />
          )}
        </section>

        <section className="detail-section activity-panel">
          <div className="activity-panel-head">
            <div>
              <h4>Progression du jour</h4>
              <p>Suivi compact des tâches, validations et actions déjà clôturées.</p>
            </div>
          </div>
          <div className="activity-progress-grid">
            <div><span>Tâches terminées</span><strong>{progress.done}</strong></div>
            <div><span>Tâches restantes</span><strong>{progress.remaining}</strong></div>
            <div><span>Validations traitées</span><strong>{progress.validations_done}</strong></div>
            <div><span>Objectif atteint</span><strong>{progress.percent}%</strong></div>
          </div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${progress.percent}%` }} /></div>
        </section>
      </div>

      <section className="detail-section activity-panel">
        <div className="activity-panel-head">
          <div>
            <h4>Navigation par rubriques</h4>
            <p>Une seule rubrique active à la fois, avec un lien partageable via l'URL.</p>
          </div>
        </div>

        <div className="activity-tabbar" role="tablist" aria-label="Navigation du Centre d'activité">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'activity-tab active' : 'activity-tab'}
              onClick={() => changeTab(tab.id)}
            >
              <span className="activity-tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
              {typeof tab.count === 'number' ? <strong>{tab.count}</strong> : null}
            </button>
          ))}
        </div>

        <div className="activity-tabpanel" role="tabpanel">
          {loading ? (
            <LoadingState message="Chargement de la rubrique active..." />
          ) : error ? (
            <div className="activity-local-state">
              <div className="error-message">{error}</div>
              <button type="button" className="secondary" onClick={() => void load()}>Réessayer</button>
            </div>
          ) : (
            <ActivityTabContent
              activeTab={activeTab}
              alerts={filteredAlerts}
              allAlertsCount={alerts.length}
              alertLevelFilter={alertLevelFilter}
              alertCountByLevel={alertCountByLevel}
              onAlertFilterChange={setAlertLevelFilter}
              validations={validations}
              tasks={filteredTasks}
              allTasksCount={tasks.length}
              taskFilter={taskFilter}
              taskGroups={taskGroups}
              onTaskFilterChange={setTaskFilter}
              todayTimeline={todayTimeline}
              recent={filteredRecent}
              allRecentCount={recent.length}
              recentModuleFilter={recentModuleFilter}
              recentModuleOptions={recentModuleOptions}
              onRecentModuleFilterChange={setRecentModuleFilter}
              deadlines={deadlineItems}
              arrears={arrearsItems}
              leaseItems={leaseItems}
              maintenanceItems={maintenanceItems}
              cashItems={cashItems}
              hrItems={hrItems}
              stockItems={stockItems}
              kpis={kpis}
              navigate={navigate}
              workflowAction={workflowAction}
              canApprove={can('workflow.approve')}
              canReject={can('workflow.reject')}
            />
          )}
        </div>
      </section>
    </section>
  );
}

function ActivityTabContent({
  activeTab,
  alerts,
  allAlertsCount,
  alertLevelFilter,
  alertCountByLevel,
  onAlertFilterChange,
  validations,
  tasks,
  allTasksCount,
  taskFilter,
  taskGroups,
  onTaskFilterChange,
  todayTimeline,
  recent,
  allRecentCount,
  recentModuleFilter,
  recentModuleOptions,
  onRecentModuleFilterChange,
  deadlines,
  arrears,
  leaseItems,
  maintenanceItems,
  cashItems,
  hrItems,
  stockItems,
  kpis,
  navigate,
  workflowAction,
  canApprove,
  canReject,
}: {
  activeTab: TabId;
  alerts: ActivityAlert[];
  allAlertsCount: number;
  alertLevelFilter: 'ALL' | 'CRITICAL' | 'ATTENTION' | 'INFO';
  alertCountByLevel: { CRITICAL: number; ATTENTION: number; INFO: number };
  onAlertFilterChange: (value: 'ALL' | 'CRITICAL' | 'ATTENTION' | 'INFO') => void;
  validations: Validation[];
  tasks: ActivityTask[];
  allTasksCount: number;
  taskFilter: 'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE';
  taskGroups: { overdue: ActivityTask[]; today: ActivityTask[]; upcoming: ActivityTask[]; done: ActivityTask[] };
  onTaskFilterChange: (value: 'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'DONE') => void;
  todayTimeline: Array<{ id: string; title: string; module: string; detail: string; date?: string; path: string }>;
  recent: RecentEvent[];
  allRecentCount: number;
  recentModuleFilter: string;
  recentModuleOptions: string[];
  onRecentModuleFilterChange: (value: string) => void;
  deadlines: Array<WeekItem & { path: string }>;
  arrears: ActivityAlert[];
  leaseItems: Array<ActivityTask | WeekItem | ActivityAlert>;
  maintenanceItems: Array<ActivityTask | RecentEvent | ActivityAlert>;
  cashItems: Array<ActivityTask | RecentEvent | ActivityAlert>;
  hrItems: Array<WeekItem | RecentEvent | ActivityAlert>;
  stockItems: Array<ActivityTask | RecentEvent | ActivityAlert>;
  kpis: Record<string, number>;
  navigate: (path: string) => void;
  workflowAction: (id: number, action: 'approve' | 'reject') => Promise<void>;
  canApprove: boolean;
  canReject: boolean;
}) {
  if (activeTab === 'alerts') {
    return (
      <div className="activity-content-grid">
        <div className="activity-inline-filters">
          <FilterChip active={alertLevelFilter === 'ALL'} label={`Toutes (${allAlertsCount})`} onClick={() => onAlertFilterChange('ALL')} />
          <FilterChip active={alertLevelFilter === 'CRITICAL'} label={`Critique (${alertCountByLevel.CRITICAL})`} onClick={() => onAlertFilterChange('CRITICAL')} />
          <FilterChip active={alertLevelFilter === 'ATTENTION'} label={`Attention (${alertCountByLevel.ATTENTION})`} onClick={() => onAlertFilterChange('ATTENTION')} />
          <FilterChip active={alertLevelFilter === 'INFO'} label={`Information (${alertCountByLevel.INFO})`} onClick={() => onAlertFilterChange('INFO')} />
        </div>
        {alerts.length ? (
          <div className="activity-list">
            {alerts.map((alert) => (
              <button
                key={alert.id}
                type="button"
                className={`activity-list-card ${alertToneClass(alert.level)}`}
                onClick={() => navigate(alert.path)}
              >
                <div className="activity-list-head">
                  <span className="activity-list-title">
                    <PriorityDot value={alert.level} />
                    {alert.title}
                  </span>
                  <StatusPill value={alertLevelLabel(alert.level)} tone={alertToneClass(alert.level)} />
                </div>
                <p>{alert.detail}</p>
                <small>{alert.due_date ? `Échéance : ${shortDate(alert.due_date)}` : 'Accès direct au détail'}</small>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune alerte active."
            message="Les urgences, retards et seuils critiques apparaîtront ici."
          />
        )}
      </div>
    );
  }

  if (activeTab === 'approvals') {
    return validations.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Objet</th>
              <th>Demandeur</th>
              <th>Priorité</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {validations.map((item) => (
              <tr key={item.id} className="clickable-row" onClick={() => navigate('/workflows')}>
                <td>{item.type}</td>
                <td>{item.object}</td>
                <td>{item.requester ?? '-'}</td>
                <td><PriorityBadge value={item.priority} /></td>
                <td>{shortDate(item.date)}</td>
                <td><StatusBadgeText value={item.status} /></td>
                <td className="actions" onClick={(event) => event.stopPropagation()}>
                  <IconAction title="Voir" onClick={() => navigate('/workflows')} icon={<FileText size={15} />} />
                  {canApprove ? <IconAction title="Approuver" onClick={() => void workflowAction(item.id, 'approve')} icon={<CheckCircle2 size={15} />} /> : null}
                  {canReject ? <IconAction title="Rejeter" onClick={() => void workflowAction(item.id, 'reject')} icon={<AlertTriangle size={15} />} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <EmptyState
        title="Aucune validation en attente."
        message="Les éléments à approuver apparaîtront ici pour votre organisation."
      />
    );
  }

  if (activeTab === 'tasks') {
    return (
      <div className="activity-content-grid">
        <div className="activity-inline-filters">
          <FilterChip active={taskFilter === 'ALL'} label={`Toutes (${allTasksCount})`} onClick={() => onTaskFilterChange('ALL')} />
          <FilterChip active={taskFilter === 'OVERDUE'} label={`En retard (${taskGroups.overdue.length})`} onClick={() => onTaskFilterChange('OVERDUE')} />
          <FilterChip active={taskFilter === 'TODAY'} label={`Aujourd'hui (${taskGroups.today.length})`} onClick={() => onTaskFilterChange('TODAY')} />
          <FilterChip active={taskFilter === 'UPCOMING'} label={`À venir (${taskGroups.upcoming.length})`} onClick={() => onTaskFilterChange('UPCOMING')} />
          <FilterChip active={taskFilter === 'DONE'} label={`Terminées (${taskGroups.done.length})`} onClick={() => onTaskFilterChange('DONE')} />
        </div>
        {tasks.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tâche</th>
                  <th>Objet</th>
                  <th>Module</th>
                  <th>Priorité</th>
                  <th>Échéance</th>
                  <th>Statut</th>
                  <th>Accès</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="clickable-row" onClick={() => navigate(task.path)}>
                    <td>{task.title}</td>
                    <td>{task.object}</td>
                    <td>{moduleLabel(task.module)}</td>
                    <td><PriorityBadge value={task.priority} /></td>
                    <td>{task.due_date ? shortDate(task.due_date) : '-'}</td>
                    <td><StatusBadgeText value={task.status} /></td>
                    <td className="actions" onClick={(event) => event.stopPropagation()}>
                      <IconAction title="Ouvrir" onClick={() => navigate(task.path)} icon={<FileText size={15} />} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aucune tâche pour cette rubrique."
            message="Les éléments actionnables déjà disponibles dans l'ERP apparaîtront ici."
          />
        )}
      </div>
    );
  }

  if (activeTab === 'today') {
    return (
      <div className="activity-content-grid">
        <div className="activity-today-kpis">
          <article><span>Paiements reçus</span><strong>{money(kpis.payments_today ?? 0)}</strong></article>
          <article><span>Dépenses du jour</span><strong>{money(kpis.expenses_today ?? 0)}</strong></article>
          <article><span>Nouveaux baux</span><strong>{Number(kpis.new_leases_today ?? 0)}</strong></article>
          <article><span>Contrats à suivre</span><strong>{Number(kpis.contracts_due ?? 0)}</strong></article>
        </div>
        {todayTimeline.length ? (
          <div className="activity-timeline">
            {todayTimeline.map((item) => (
              <button key={item.id} type="button" className="activity-timeline-row" onClick={() => navigate(item.path)}>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <small>{item.date ? shortDate(item.date) : moduleLabel(item.module)}</small>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune activité prévue aujourd'hui."
            message="Les échéances du jour et les rendez-vous importants apparaîtront ici."
          />
        )}
      </div>
    );
  }

  if (activeTab === 'recent') {
    return (
      <div className="activity-content-grid">
        <div className="activity-inline-filters">
          {recentModuleOptions.map((option) => (
            <FilterChip
              key={option}
              active={recentModuleFilter === option}
              label={option === 'ALL' ? `Tous (${allRecentCount})` : option}
              onClick={() => onRecentModuleFilterChange(option)}
            />
          ))}
        </div>
        {recent.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Module</th>
                  <th>Événement</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td>{shortDate(row.date)}</td>
                    <td>{row.user_name ?? '-'}</td>
                    <td>{moduleLabel(row.module)}</td>
                    <td>{rowSentence(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Aucune activité récente."
            message="Les dernières actions importantes de l'organisation apparaîtront ici."
          />
        )}
      </div>
    );
  }

  if (activeTab === 'deadlines') {
    return renderDeadlineList(deadlines, navigate);
  }

  if (activeTab === 'arrears') {
    return (
      <div className="activity-content-grid">
        <div className="activity-today-kpis">
          <article><span>Montant impayé</span><strong>{money(kpis.unpaid_amount ?? 0)}</strong></article>
          <article><span>Factures en retard</span><strong>{arrears.length}</strong></article>
        </div>
        {renderAlertOrEmpty(arrears, navigate, 'Aucun impayé détecté.', 'Les factures et garanties en retard apparaîtront ici.')}
      </div>
    );
  }

  if (activeTab === 'leases') {
    return renderMixedList(
      leaseItems,
      navigate,
      'Aucune échéance bail / contrat.',
      'Les renouvellements, garanties et baux à suivre apparaîtront ici.',
    );
  }

  if (activeTab === 'maintenance') {
    return renderMixedList(
      maintenanceItems,
      navigate,
      'Aucune maintenance prioritaire.',
      'Les interventions urgentes et récentes apparaîtront ici.',
    );
  }

  if (activeTab === 'cash') {
    return renderMixedList(
      cashItems,
      navigate,
      'Aucune alerte de caisse.',
      "Les ouvertures, fermetures et anomalies de caisse apparaîtront ici.",
    );
  }

  if (activeTab === 'hr') {
    return renderMixedList(
      hrItems,
      navigate,
      'Aucune information RH à afficher.',
      'Les éléments RH visibles depuis le Centre d’activité apparaîtront ici.',
    );
  }

  return renderMixedList(
    stockItems,
    navigate,
    'Aucune alerte stock.',
    'Les seuils critiques, achats et mouvements récents apparaîtront ici.',
  );
}

function renderDeadlineList(
  items: Array<WeekItem & { path: string }>,
  navigate: (path: string) => void,
) {
  return items.length ? (
    <div className="activity-timeline">
      {items.map((item) => (
        <button key={`${item.module}-${item.id}`} type="button" className="activity-timeline-row" onClick={() => navigate(item.path)}>
          <div>
            <strong>{item.title}</strong>
            <p>{moduleLabel(item.module)}</p>
          </div>
          <small>{item.due_date ? shortDate(item.due_date) : 'À suivre'}</small>
        </button>
      ))}
    </div>
  ) : (
    <EmptyState
      title="Aucune échéance proche."
      message="Les baux, contrats et autres éléments arrivant à échéance apparaîtront ici."
    />
  );
}

function renderAlertOrEmpty(
  items: ActivityAlert[],
  navigate: (path: string) => void,
  title: string,
  message: string,
) {
  return items.length ? (
    <div className="activity-list">
      {items.map((alert) => (
        <button key={alert.id} type="button" className={`activity-list-card ${alertToneClass(alert.level)}`} onClick={() => navigate(alert.path)}>
          <div className="activity-list-head">
            <span className="activity-list-title">
              <PriorityDot value={alert.level} />
              {alert.title}
            </span>
            <StatusPill value={alertLevelLabel(alert.level)} tone={alertToneClass(alert.level)} />
          </div>
          <p>{alert.detail}</p>
          <small>{alert.due_date ? shortDate(alert.due_date) : 'Accès direct au détail'}</small>
        </button>
      ))}
    </div>
  ) : (
    <EmptyState title={title} message={message} />
  );
}

function renderMixedList(
  items: Array<ActivityTask | RecentEvent | ActivityAlert | WeekItem>,
  navigate: (path: string) => void,
  title: string,
  message: string,
) {
  return items.length ? (
    <div className="activity-timeline">
      {items.map((item, index) => {
        const normalized = normalizeMixedItem(item);
        return (
          <button key={`${normalized.kind}-${index}-${normalized.title}`} type="button" className="activity-timeline-row" onClick={() => navigate(normalized.path)}>
            <div>
              <strong>{normalized.title}</strong>
              <p>{normalized.detail}</p>
            </div>
            <small>{normalized.date ? shortDate(normalized.date) : normalized.module}</small>
          </button>
        );
      })}
    </div>
  ) : (
    <EmptyState title={title} message={message} />
  );
}

function normalizeMixedItem(item: ActivityTask | RecentEvent | ActivityAlert | WeekItem) {
  if ('detail' in item && 'level' in item) {
    return {
      kind: 'alert',
      title: item.title,
      detail: item.detail,
      path: item.path,
      date: item.due_date,
      module: 'Alertes',
    };
  }

  if ('action' in item) {
    return {
      kind: 'recent',
      title: rowSentence(item),
      detail: item.user_name ? `Par ${item.user_name}` : moduleLabel(item.module),
      path: modulePath(item.module),
      date: item.date,
      module: moduleLabel(item.module),
    };
  }

  if ('object' in item && 'path' in item) {
    return {
      kind: 'task',
      title: item.title,
      detail: item.object,
      path: item.path,
      date: item.due_date,
      module: moduleLabel(item.module),
    };
  }

  return {
    kind: 'week',
    title: item.title,
    detail: moduleLabel(item.module),
    path: modulePath(item.module),
    date: item.due_date,
    module: moduleLabel(item.module),
  };
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={active ? 'activity-filter-chip active' : 'activity-filter-chip'} onClick={onClick}>
      {label}
    </button>
  );
}

function StatusPill({ value, tone }: { value: string; tone: string }) {
  return <span className={`badge activity-status-pill ${tone}`}>{value}</span>;
}

function IconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" className="icon-btn" title={title} onClick={onClick}>{icon}</button>;
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

function alertLevel(rawValue: string) {
  const value = String(rawValue ?? '').toUpperCase();
  if (['CRITICAL', 'URGENT', 'HIGH'].includes(value)) return 'CRITICAL';
  if (['WARNING', 'MEDIUM', 'ATTENTION'].includes(value)) return 'ATTENTION';
  return 'INFO';
}

function alertLevelLabel(rawValue: string) {
  return ({ CRITICAL: 'Critique', ATTENTION: 'Attention', INFO: 'Information' } as Record<string, string>)[alertLevel(rawValue)];
}

function alertToneClass(rawValue: string) {
  return ({ CRITICAL: 'overdue', ATTENTION: 'partial', INFO: 'paid' } as Record<string, string>)[alertLevel(rawValue)];
}

function priorityClass(value: string) {
  return ({ CRITICAL: 'overdue', HIGH: 'overdue', URGENT: 'overdue', WARNING: 'partial', NORMAL: 'partial', LOW: 'paid', INFO: 'paid' } as Record<string, string>)[String(value ?? '').toUpperCase()] ?? '';
}

function statusClass(value: string) {
  return ({ PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid', OVERDUE: 'overdue', PENDING: 'partial', APPROVED: 'paid', REJECTED: 'unpaid' } as Record<string, string>)[String(value ?? '').toUpperCase()] ?? '';
}

function priorityLabel(value: string) {
  return ({ CRITICAL: 'Urgent', HIGH: 'Urgent', URGENT: 'Urgent', WARNING: 'Attention', NORMAL: 'Normal', LOW: 'Faible' } as Record<string, string>)[String(value ?? '').toUpperCase()] ?? value;
}

function dueDateRelation(value?: string) {
  if (!value) return 'UPCOMING';
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetDate = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) return 'UPCOMING';
  const target = targetDate.getTime();
  if (target < current) return 'OVERDUE';
  if (target === current) return 'TODAY';
  return 'UPCOMING';
}

function looksLikeArrears(item: Pick<ActivityAlert, 'title' | 'detail'>) {
  const text = `${item.title} ${item.detail}`.toLowerCase();
  return ['impaye', 'retard', 'garantie', 'loyer', 'facture'].some((keyword) => text.includes(keyword));
}

function looksLikeLeaseText(value: string) {
  return ['bail', 'contrat', 'garantie', 'renouvel'].some((keyword) => value.toLowerCase().includes(keyword));
}

function isLeaseModule(value: string) {
  return ['leases', 'baux'].includes(String(value ?? '').toLowerCase());
}

function isMaintenanceModule(value: string) {
  return ['maintenance'].includes(String(value ?? '').toLowerCase());
}

function isMaintenanceText(value: string) {
  return ['maintenance', 'intervention', 'panne'].some((keyword) => value.toLowerCase().includes(keyword));
}

function isCashText(value: string) {
  return ['caisse', 'cash', 'session'].some((keyword) => value.toLowerCase().includes(keyword));
}

function isHrModule(value: string) {
  return ['personnel', 'staff', 'hr'].includes(String(value ?? '').toLowerCase());
}

function isHrText(value: string) {
  return ['personnel', 'employ', 'rh', 'congé', 'absence', 'paie'].some((keyword) => value.toLowerCase().includes(keyword));
}

function isStockModule(value: string) {
  return ['stock'].includes(String(value ?? '').toLowerCase());
}

function isStockText(value: string) {
  return ['stock', 'inventaire', 'achat', 'rupture'].some((keyword) => value.toLowerCase().includes(keyword));
}

function rowSentence(row: RecentEvent) {
  const action = row.action.toUpperCase();
  const module = moduleLabel(row.module);
  if (action.includes('CREATE') || action.includes('CREATED')) return `Ajout ${module}`;
  if (action.includes('UPDATE') || action.includes('UPDATED')) return `Modification ${module}`;
  if (action.includes('DELETE') || action.includes('DELETED')) return `Suppression ${module}`;
  if (action.includes('PAYMENT')) return 'Paiement enregistré';
  if (action.includes('INVOICE')) return 'Facture traitée';
  return `${module} - ${row.action.replace(/_/g, ' ').toLowerCase()}`;
}

function moduleLabel(module: string) {
  return ({
    leases: 'Baux',
    baux: 'Baux',
    payments: 'Paiements',
    invoices: 'Factures',
    buildings: 'Immeubles',
    units: 'Appartements',
    tenants: 'Locataires',
    stock: 'Stock',
    maintenance: 'Maintenance',
    personnel: 'Personnel',
    staff: 'RH',
    hr: 'RH',
    workflows: 'Workflows',
  } as Record<string, string>)[String(module ?? '').toLowerCase()] ?? module;
}

function modulePath(module: string) {
  return ({
    Baux: '/leases',
    leases: '/leases',
    Stock: '/stock',
    stock: '/stock',
    Personnel: '/personnel/employees',
    staff: '/personnel/employees',
    RH: '/personnel/employees',
    Maintenance: '/maintenance',
    maintenance: '/maintenance',
    Paiements: '/payments',
    payments: '/payments',
    Factures: '/invoices',
    invoices: '/invoices',
    tenants: '/tenants',
    Locataires: '/tenants',
    buildings: '/buildings',
    Immeubles: '/buildings',
    workflows: '/workflows',
    Workflows: '/workflows',
  } as Record<string, string>)[module] ?? '/activity';
}

function apiErrorMessage(error: unknown, fallback: string) {
  const responseMessage = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(responseMessage)) return responseMessage.join(' ');
  return responseMessage || (error instanceof Error ? error.message : fallback);
}
