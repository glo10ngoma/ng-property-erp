import { useState } from 'react';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="topbar">
      <div />
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
                <LogOut size={16} /> Deconnexion
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function roleLabel(role: string) {
  return ({
    ADMIN: 'Administrateur',
    EDITOR: 'Utilisateur en écriture',
    VIEWER: 'Lecture seule',
    ACCOUNTANT: 'Utilisateur en écriture',
    STAFF: 'Utilisateur en écriture',
    DIRECTOR: 'Lecture seule',
    DIRECTEUR: 'Lecture seule',
    AGENT: 'Utilisateur en écriture',
    GESTIONNAIRE: 'Utilisateur en écriture',
    COMPTABLE: 'Utilisateur en écriture',
  })[role] ?? role;
}
