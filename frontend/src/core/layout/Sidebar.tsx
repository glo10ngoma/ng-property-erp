import { Building2, Boxes, BriefcaseBusiness, CreditCard, FileText, Gauge, Home, Layers, ScrollText, ShieldCheck, Users, WalletCards, Wrench, MessageSquare, Workflow, Activity, Settings, FolderOpen } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';

export const navItems = [
  { to: '/dashboard', label: 'Tableau de bord', icon: Gauge, permission: 'dashboard.read' },
  { to: '/activity', label: 'Activité', icon: Activity, permission: 'activity.read' },
  { to: '/buildings', label: 'Immeubles', icon: Building2, permission: 'buildings.read' },
  { to: '/rental-units', label: 'Appartements', icon: Home, permission: 'units.read' },
  { to: '/tenants', label: 'Locataires', icon: Users, permission: 'tenants.read' },
  { to: '/leases', label: 'Baux', icon: ScrollText, permission: 'documents.read' },
  { to: '/invoices', label: 'Factures', icon: FileText, permission: 'invoices.read' },
  { to: '/payments', label: 'Paiements', icon: CreditCard, permission: 'payments.read' },
  { to: '/cash', label: 'Caisse', icon: WalletCards, permission: 'cash.read' },
  { to: '/staff', label: 'Personnel', icon: BriefcaseBusiness, permission: 'staff.read' },
  { to: '/stock', label: 'Stock', icon: Boxes, permission: 'stock.read' },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.read' },
  { to: '/reports', label: 'Rapports', icon: FileText, permission: 'reports.read' },
  { to: '/documents', label: 'Documents', icon: FolderOpen, permission: 'documents.read' },
  { to: '/communications', label: 'Communications', icon: MessageSquare, permission: 'communication.read' },
  { to: '/workflows', label: 'Workflows', icon: Workflow, permission: 'workflow.read' },
  { to: '/users', label: 'Utilisateurs', icon: ShieldCheck, permission: 'users.read' },
  { to: '/settings', label: 'Paramètres', icon: Settings, permission: 'settings.read' },
];

export function Sidebar() {
  const { can } = useAuth();
  const visibleNav = navItems.filter((item) => can(item.permission));

  return (
    <aside className="sidebar">
      <div className="brand">
        <Layers size={26} />
        <div>
          <strong>{appConfig.name}</strong>
          <span>{appConfig.versionLabel}</span>
        </div>
      </div>
      <nav>
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'}>
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
