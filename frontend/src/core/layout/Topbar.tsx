import { useState } from 'react';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Topbar() {
  const { user, logout, setActiveOrganization } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [switchingOrganization, setSwitchingOrganization] = useState(false);

  async function handleOrganizationChange(value: string) {
    const organizationId = Number(value);
    if (!Number.isFinite(organizationId) || !user || organizationId === user.organization_id) return;
    setSwitchingOrganization(true);
    try {
      await setActiveOrganization(organizationId);
    } finally {
      setSwitchingOrganization(false);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const organizations = user?.organizations ?? [];
  const isPlatformSpace = location.pathname.startsWith('/platform');

  return (
    <header className="topbar">
      <div className="topbar-org-slot">
        {user && organizations.length > 1 && !isPlatformSpace ? (
          <label className="topbar-org-switcher">
            <span>Organisation active</span>
            <select
              value={String(user.organization_id ?? '')}
              onChange={(event) => void handleOrganizationChange(event.target.value)}
              disabled={switchingOrganization}
            >
              {organizations.map((organization) => (
                <option key={organization.organization_id} value={organization.organization_id}>
                  {organization.organization_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {user && (
        <div className="user-menu">
          <button className="operator" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
            <UserCircle size={18} />
            <span>
              <strong>{user.name}</strong>
              <small>{roleLabel(user.role)} - {user.organization_name ?? `Organisation ${user.organization_id ?? 1}`}</small>
            </span>
            <ChevronDown size={16} />
          </button>
          {open && (
            <div className="user-menu-panel" role="menu">
              <button className="menu-item" onClick={() => { setOpen(false); navigate('/settings'); }}>
                <UserCircle size={16} /> Mon profil
              </button>
              <button className="menu-item danger" onClick={handleLogout}>
                <LogOut size={16} /> Déconnexion
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function roleLabel(role: string) {
  return (
    {
      SUPER_ADMIN: 'Super administrateur',
      ADMIN: 'Administrateur plateforme',
      ADMIN_PLATFORM: 'Administrateur plateforme',
      ADMIN_CLIENT: 'Administrateur client',
      EDITOR: 'Utilisateur en écriture',
      EDITOR_CLIENT: 'Utilisateur en écriture',
      VIEWER: 'Lecture seule',
      VIEWER_CLIENT: 'Lecture seule',
      ACCOUNTANT: 'Utilisateur en écriture',
      STAFF: 'Utilisateur en écriture',
      DIRECTOR: 'Lecture seule',
      DIRECTEUR: 'Lecture seule',
      AGENT: 'Utilisateur en écriture',
      GESTIONNAIRE: 'Utilisateur en écriture',
      COMPTABLE: 'Utilisateur en écriture',
    }[role.toUpperCase()] ?? role
  );
}
