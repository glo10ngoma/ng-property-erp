import {
  Activity,
  Archive,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileText,
  FolderOpen,
  Gauge,
  Home,
  Layers,
  MessageSquare,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  WalletCards,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';
import { isPlatformSuperAdmin } from '../auth/PlatformRoute';

type NavLinkItem = {
  type?: 'link';
  to?: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  soon?: boolean;
  superAdminOnly?: boolean;
};

type NavSubgroup = {
  type: 'subgroup';
  label: string;
  icon: LucideIcon;
  items: NavLinkItem[];
};

type NavEntry = NavLinkItem | NavSubgroup;

type NavGroup = {
  label: string;
  icon: LucideIcon;
  items: NavEntry[];
};

const STORAGE_KEY = 'ng-property-erp.sidebar.open-groups';
const STOCK_GROUP_KEY = 'Stock';

const stockItems: NavLinkItem[] = [
  { to: '/stock/articles', label: 'Articles', icon: Boxes, permission: 'stock.read' },
  { to: '/stock', label: 'État du stock', icon: Boxes, permission: 'stock.read' },
  { to: '/stock/movements', label: 'Mouvements', icon: Boxes, permission: 'stock.read' },
  { to: '/stock/inventories', label: 'Inventaires', icon: Boxes, permission: 'stock.read' },
  { to: '/stock/purchases', label: 'Achats fournisseurs', icon: Boxes, permission: 'stock.read' },
  { to: '/stock/report', label: 'Rapports', icon: FileText, permission: 'reports.read' },
];

const navGroups: NavGroup[] = [
  {
    label: 'Tableau de bord',
    icon: Gauge,
    items: [
      { to: '/activity', label: "Centre d’activité", icon: Activity, permission: 'activity.read' },
      { to: '/dashboard', label: 'Dashboard BI', icon: Gauge, permission: 'dashboard.read' },
      { to: '/reports', label: 'Rapports', icon: FileText, permission: 'reports.read' },
    ],
  },
  {
    label: 'Gestion immobilière',
    icon: Building2,
    items: [
      { to: '/buildings', label: 'Immeubles', icon: Building2, permission: 'buildings.read' },
      { to: '/rental-units', label: 'Appartements', icon: Home, permission: 'units.read' },
      { to: '/tenants', label: 'Locataires', icon: Users, permission: 'tenants.read' },
      { to: '/leases', label: 'Baux & contrats', icon: ScrollText, permission: 'documents.read' },
    ],
  },
  {
    label: 'Finance',
    icon: CreditCard,
    items: [
      { to: '/invoices', label: 'Factures', icon: FileText, permission: 'invoices.read' },
      { to: '/payments', label: 'Paiements', icon: CreditCard, permission: 'payments.read' },
      { to: '/tenant-credits', label: 'Crédits locataires', icon: WalletCards, permission: 'payments.read' },
      { to: '/cash', label: 'Caisse principale', icon: WalletCards, permission: 'cash.read' },
      { to: '/guarantee-cash', label: 'Caisse garanties locatives', icon: WalletCards, permission: 'guarantee_cash.read' },
    ],
  },
  {
    label: 'Opérations',
    icon: Wrench,
    items: [
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.read' },
    ],
  },
  {
    label: STOCK_GROUP_KEY,
    icon: Wrench,
    items: stockItems,
  },
  {
    label: 'Ressources humaines',
    icon: BriefcaseBusiness,
    items: [
      { to: '/personnel/employees', label: 'Employés', icon: BriefcaseBusiness, permission: 'staff.read' },
      { to: '/personnel/contracts', label: 'Contrats', icon: ScrollText, permission: 'staff.read' },
      { to: '/personnel/attendance', label: 'Pointage', icon: Gauge, permission: 'staff.read' },
      { to: '/personnel/advances', label: 'Avances', icon: WalletCards, permission: 'staff.read' },
      { to: '/personnel/leaves', label: 'Congés', icon: ReceiptText, permission: 'staff.read' },
      { to: '/personnel/payroll', label: 'Paie', icon: CreditCard, permission: 'staff.read' },
      { to: '/personnel/reports', label: 'Rapports', icon: FileText, permission: 'staff.read' },
    ],
  },
  {
    label: 'Administration',
    icon: Settings,
    items: [
      { to: '/users', label: 'Utilisateurs', icon: ShieldCheck, permission: 'users.read', superAdminOnly: true },
      { to: '/communications', label: 'Communications', icon: MessageSquare, permission: 'communication.read' },
      { label: 'Notifications', icon: MessageSquare, permission: 'communication.read', soon: true },
      { to: '/trash', label: 'Corbeille', icon: Trash2, permission: 'leases.trash.read' },
      { to: '/archives', label: 'Archives', icon: Archive, permission: 'leases.archives.read' },
      { to: '/settings', label: 'Paramètres', icon: Settings, permission: 'settings.read' },
      { to: '/documents', label: 'Documents', icon: FolderOpen, permission: 'documents.read' },
      { to: '/workflows', label: 'Workflows', icon: Workflow, permission: 'workflow.read' },
    ],
  },
];

const defaultOpenGroups = ['Tableau de bord', 'Gestion immobilière', 'Finance', 'Opérations', 'Ressources humaines'];

export function Sidebar() {
  const { can, user } = useAuth();
  const location = useLocation();
  const hasPermission = (permission?: string) => !permission || can(permission);
  const superAdmin = isPlatformSuperAdmin(user);
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaultOpenGroups;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultOpenGroups;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : defaultOpenGroups;
    } catch {
      return defaultOpenGroups;
    }
  });

  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: filterEntries(group.items, hasPermission, superAdmin),
        }))
        .filter((group) => group.items.length > 0),
    [can, superAdmin],
  );

  const requiredOpenGroups = useMemo(
    () => collectRequiredOpenGroups(location.pathname, visibleGroups),
    [location.pathname, visibleGroups],
  );

  const effectiveOpenGroups = useMemo(
    () => Array.from(new Set([...openGroups, ...requiredOpenGroups])),
    [openGroups, requiredOpenGroups],
  );

  useEffect(() => {
    if (!requiredOpenGroups.length) return;
    setOpenGroups((current) => {
      const next = Array.from(new Set([...current, ...requiredOpenGroups]));
      return next.length === current.length && next.every((value, index) => value === current[index]) ? current : next;
    });
  }, [requiredOpenGroups]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Layers size={26} />
        <div>
          <strong>{appConfig.name}</strong>
          <span>{appConfig.versionLabel}</span>
        </div>
      </div>
      <nav className="sidebar-groups">
        {visibleGroups.map((group) => {
          const Icon = group.icon;
          const isOpen = effectiveOpenGroups.includes(group.label);
          const groupActive = entryListHasActiveRoute(location.pathname, group.items);

          return (
            <div className="sidebar-group" key={group.label}>
              <button
                type="button"
                className={`sidebar-group-toggle${groupActive ? ' active' : ''}`}
                onClick={() => toggleOpenKey(group.label, setOpenGroups)}
              >
                <span><Icon size={16} />{group.label}</span>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {isOpen && (
                <div className="sidebar-group-items">
                  {group.items.map((entry) =>
                    entry.type === 'subgroup' ? (
                      <SidebarSubgroup
                        key={entry.label}
                        entry={entry}
                        pathname={location.pathname}
                        openKeys={effectiveOpenGroups}
                        setOpenKeys={setOpenGroups}
                      />
                    ) : (
                      <SidebarLink key={entry.to ?? entry.label} item={entry} pathname={location.pathname} />
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function SidebarSubgroup({
  entry,
  pathname,
  openKeys,
  setOpenKeys,
}: {
  entry: NavSubgroup;
  pathname: string;
  openKeys: string[];
  setOpenKeys: Dispatch<SetStateAction<string[]>>;
}) {
  const Icon = entry.icon;
  const isOpen = openKeys.includes(entry.label);
  const isActive = entry.items.some((item) => item.to && isRouteActive(pathname, item.to));

  return (
    <div className="sidebar-nested-group">
      <button
        type="button"
        className={`sidebar-nested-toggle${isActive ? ' active' : ''}`}
        onClick={() => toggleOpenKey(entry.label, setOpenKeys)}
      >
        <span><Icon size={15} />{entry.label}</span>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isOpen && (
        <div className="sidebar-nested-items">
          {entry.items.map((item) => <SidebarLink key={item.to ?? item.label} item={item} pathname={pathname} nested />)}
        </div>
      )}
    </div>
  );
}

function SidebarLink({ item, pathname, nested = false }: { item: NavLinkItem; pathname: string; nested?: boolean }) {
  const ItemIcon = item.icon;
  const className = nested ? 'sidebar-subitem sidebar-subitem-nested' : 'sidebar-subitem';
  const isActive = Boolean(item.to && isRouteActive(pathname, item.to));

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        end={isEndRoute(item.to)}
        className={() => (isActive ? `${className} active` : className)}
      >
        <ItemIcon size={16} />
        {item.label}
      </NavLink>
    );
  }

  return (
    <span className={`${className} sidebar-subitem-soon`}>
      <ItemIcon size={16} />
      {item.label}
      <small>Bientôt</small>
    </span>
  );
}

function filterEntries(entries: NavEntry[], can: (permission?: string) => boolean, superAdmin: boolean): NavEntry[] {
  return entries
    .map((entry) => {
      if (entry.type === 'subgroup') {
        const items = entry.items.filter((item) => (!item.permission || can(item.permission)) && (!item.superAdminOnly || superAdmin));
        return { ...entry, items };
      }
      return entry;
    })
    .filter((entry) =>
      entry.type === 'subgroup'
        ? entry.items.length > 0
        : (!entry.permission || can(entry.permission)) && (!entry.superAdminOnly || superAdmin),
    );
}

function collectRequiredOpenGroups(pathname: string, groups: NavGroup[]) {
  const required = new Set<string>();

  for (const group of groups) {
    if (!entryListHasActiveRoute(pathname, group.items)) continue;
    required.add(group.label);
    for (const entry of group.items) {
      if (entry.type === 'subgroup' && entry.items.some((item) => item.to && isRouteActive(pathname, item.to))) {
        required.add(entry.label);
      }
    }
  }

  if (pathname.startsWith('/stock')) {
    required.add(STOCK_GROUP_KEY);
  }

  return Array.from(required);
}

function entryListHasActiveRoute(pathname: string, entries: NavEntry[]) {
  return entries.some((entry) =>
    entry.type === 'subgroup'
      ? entry.items.some((item) => item.to && isRouteActive(pathname, item.to))
      : Boolean(entry.to && isRouteActive(pathname, entry.to)),
  );
}

function toggleOpenKey(label: string, setOpenKeys: Dispatch<SetStateAction<string[]>>) {
  setOpenKeys((current) =>
    current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
  );
}

function isEndRoute(route: string) {
  return route === '/dashboard' || route === '/stock' || route === '/personnel/employees';
}

function isRouteActive(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

