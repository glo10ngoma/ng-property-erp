import { Activity, Building2, Boxes, BriefcaseBusiness, ChevronDown, ChevronRight, CreditCard, FileText, FolderOpen, Gauge, Home, Layers, MessageSquare, ScrollText, Settings, ShieldCheck, Users, WalletCards, Workflow, Wrench, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';

type NavItem = {
  to?: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  soon?: boolean;
};

type NavGroup = {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: 'Tableau de bord',
    icon: Gauge,
    items: [
      { to: '/activity', label: 'Centre d’activité', icon: Activity, permission: 'activity.read' },
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
      { to: '/cash', label: 'Caisse', icon: WalletCards, permission: 'cash.read' },
      { label: 'Dépenses', icon: WalletCards, permission: 'cash.read', soon: true },
    ],
  },
  {
    label: 'Opérations',
    icon: Wrench,
    items: [
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.read' },
      { to: '/stock', label: 'Stock', icon: Boxes, permission: 'stock.read' },
    ],
  },
  {
    label: 'Ressources humaines',
    icon: BriefcaseBusiness,
    items: [
      { to: '/staff', label: 'Personnel', icon: BriefcaseBusiness, permission: 'staff.read' },
      { label: 'Pointage', icon: Gauge, permission: 'staff.read', soon: true },
      { label: 'Paie', icon: CreditCard, permission: 'staff.read', soon: true },
      { label: 'Avances', icon: WalletCards, permission: 'staff.read', soon: true },
      { label: 'Congés', icon: ScrollText, permission: 'staff.read', soon: true },
    ],
  },
  {
    label: 'Administration',
    icon: Settings,
    items: [
      { to: '/users', label: 'Utilisateurs', icon: ShieldCheck, permission: 'users.read' },
      { label: 'Rôles & permissions', icon: ShieldCheck, permission: 'users.read', soon: true },
      { to: '/communications', label: 'Communications', icon: MessageSquare, permission: 'communication.read' },
      { label: 'Notifications', icon: MessageSquare, permission: 'communication.read', soon: true },
      { to: '/settings', label: 'Paramètres', icon: Settings, permission: 'settings.read' },
      { to: '/documents', label: 'Documents', icon: FolderOpen, permission: 'documents.read' },
      { to: '/workflows', label: 'Workflows', icon: Workflow, permission: 'workflow.read' },
    ],
  },
];

export function Sidebar() {
  const { can } = useAuth();
  const [openGroups, setOpenGroups] = useState<string[]>(['Tableau de bord', 'Gestion immobilière', 'Finance']);

  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.permission || can(item.permission)),
        }))
        .filter((group) => group.items.length > 0),
    [can],
  );

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
          const isOpen = openGroups.includes(group.label);
          return (
            <div className="sidebar-group" key={group.label}>
              <button
                type="button"
                className="sidebar-group-toggle"
                onClick={() => setOpenGroups((current) => current.includes(group.label) ? current.filter((item) => item !== group.label) : [...current, group.label])}
              >
                <span><Icon size={16} />{group.label}</span>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {isOpen && (
                <div className="sidebar-group-items">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    if (item.to) {
                      return (
                        <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} className="sidebar-subitem">
                          <ItemIcon size={16} />
                          {item.label}
                        </NavLink>
                      );
                    }
                    return (
                      <span key={item.label} className="sidebar-subitem sidebar-subitem-soon">
                        <ItemIcon size={16} />
                        {item.label}
                        <small>Bientôt</small>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
