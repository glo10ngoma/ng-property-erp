import { useState } from 'react';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';

export function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">{appConfig.businessLabel}</span>
        <h1>{pageTitle(location.pathname)}</h1>
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
                <LogOut size={16} /> Deconnexion
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function pageTitle(pathname: string) {
  if (pathname === '/' || pathname.startsWith('/activity')) return "Centre d'Activite";
  if (pathname.startsWith('/dashboard')) return 'Tableau de bord';
  if (pathname.match(/^\/buildings\/\d+\/report/)) return 'Rapport immeuble';
  if (pathname.startsWith('/buildings')) return 'Immeubles';
  if (pathname.startsWith('/rental-units') || pathname.startsWith('/units')) return 'Appartements';
  if (pathname.match(/^\/tenants\/\d+\/situation/)) return 'Situation locataire';
  if (pathname.startsWith('/tenants')) return 'Locataires';
  if (pathname.startsWith('/leases/new')) return 'Nouveau bail';
  if (pathname.startsWith('/leases')) return 'Baux';
  if (pathname.match(/^\/invoices\/\d+\/print/)) return 'Impression facture';
  if (pathname.match(/^\/invoices\/\d+/)) return 'Detail facture';
  if (pathname.startsWith('/invoices')) return 'Factures';
  if (pathname.startsWith('/payments')) return 'Paiements';
  if (pathname.startsWith('/cash')) return 'Caisse';
  if (pathname.startsWith('/staff')) return 'Personnel';
  if (pathname.startsWith('/stock')) return 'Stock';
  if (pathname.startsWith('/maintenance')) return 'Maintenance';
  if (pathname.startsWith('/reports')) return 'Rapports';
  if (pathname.startsWith('/settings')) return 'Parametres';
  if (pathname.startsWith('/users')) return 'Utilisateurs';
  if (pathname.startsWith('/communications')) return 'Communications';
  if (pathname.startsWith('/documents')) return 'Documents';
  if (pathname.startsWith('/workflows')) return 'Workflows';
  return 'Property ERP';
}

function roleLabel(role: string) {
  return ({
    ADMIN: 'Administrateur',
    ACCOUNTANT: 'Comptable',
    STAFF: 'Agent',
    DIRECTOR: 'Directeur',
  })[role] ?? role;
}
