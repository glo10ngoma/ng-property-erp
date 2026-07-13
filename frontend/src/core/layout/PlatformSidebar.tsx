import { Activity, Building2, Layers, Settings, ShieldCheck, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { appConfig } from '../../app/config';

const items = [
  { to: '/platform/overview', label: 'Vue d’ensemble', icon: Layers },
  { to: '/platform/organizations', label: 'Organisations', icon: Building2 },
  { to: '/platform/users', label: 'Utilisateurs', icon: Users },
  { to: '/platform/memberships', label: 'Adhésions', icon: ShieldCheck },
  { to: '/platform/roles', label: 'Rôles et permissions', icon: ShieldCheck },
  { to: '/platform/activity', label: 'Activité plateforme', icon: Activity },
  { to: '/platform/settings', label: 'Paramètres plateforme', icon: Settings },
];

export function PlatformSidebar() {
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
          {items.map((item) => {
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
