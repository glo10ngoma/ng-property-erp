import { Activity, Building2, Layers, Settings, ShieldCheck, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';
import { isPlatformSuperAdmin } from '../auth/PlatformRoute';

const items = [
  { to: '/platform/overview', label: 'Vue d’ensemble', icon: Layers },
  { to: '/platform/organizations', label: 'Organisations', icon: Building2 },
  { to: '/platform/users', label: 'Utilisateurs', icon: Users, superAdminOnly: true },
  { to: '/platform/memberships', label: 'Adhésions', icon: ShieldCheck },
  { to: '/platform/roles', label: 'Rôles et permissions', icon: ShieldCheck, superAdminOnly: true },
  { to: '/platform/activity', label: 'Activité plateforme', icon: Activity },
  { to: '/platform/settings', label: 'Paramètres plateforme', icon: Settings },
];

export function PlatformSidebar() {
  const { user } = useAuth();
  const superAdmin = isPlatformSuperAdmin(user);
  const visibleItems = items.filter((item) => !item.superAdminOnly || superAdmin);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Layers size={26} />
        <div>
          <strong>{appConfig.name}</strong>
          <span>Console plateforme</span>
        </div>
      </div>
      <nav className="sidebar-groups">
        <div className="sidebar-group-items">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end className={({ isActive }) => (isActive ? 'sidebar-subitem active' : 'sidebar-subitem')}>
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
