import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogOut, UserCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';

export function Topbar() {
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  function closeMenu() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(false);
  }

  function openMenu() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }

  function closeMenuWithDelay() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 180);
  }

  function handleLogout() {
    closeMenu();
    logout();
    navigate('/login', { replace: true });
  }

  const activeOrganizationLabel = user?.organization_name ?? `Organisation ${user?.organization_id ?? 1}`;
  const organizationRoleLabel = useMemo(
    () => roleLabel(user?.organization_role ?? user?.role ?? ''),
    [user?.organization_role, user?.role],
  );

  async function handlePasswordSubmit(formData: FormData) {
    const currentPassword = String(formData.get('currentPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    setPasswordError('');
    setPasswordSuccess('');
    setPasswordSubmitting(true);

    try {
      const response = await changePassword({ currentPassword, newPassword, confirmPassword });
      setPasswordSuccess(response.message);
      closeMenu();
      window.setTimeout(() => {
        logout();
        navigate('/login', { replace: true });
      }, 900);
    } catch (error) {
      setPasswordError(extractApiError(error));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-org-slot">
        {user ? (
          <div className="topbar-org-readonly" aria-label="Organisation active">
            <span>Organisation active</span>
            <strong>{activeOrganizationLabel}</strong>
          </div>
        ) : null}
      </div>

      {user ? (
        <div className="user-menu" ref={menuRef} onMouseEnter={openMenu} onMouseLeave={closeMenuWithDelay}>
          <button
            className="operator"
            type="button"
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeMenu();
            }}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls="user-menu-panel"
          >
            <UserCircle size={18} />
            <span>
              <strong>{user.name}</strong>
              <small>{organizationRoleLabel} - {activeOrganizationLabel}</small>
            </span>
            <ChevronDown size={16} />
          </button>
          {open ? (
            <div id="user-menu-panel" className="user-menu-panel" role="menu" onMouseEnter={openMenu} onMouseLeave={closeMenuWithDelay}>
              <button className="menu-item" type="button" role="menuitem" onClick={() => { closeMenu(); navigate('/profile'); }}>
                <UserCircle size={16} /> Mon profil
              </button>
              <button
                className="menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setPasswordError('');
                  setPasswordSuccess('');
                  setChangingPassword(true);
                }}
              >
                <KeyRound size={16} /> Changer mon mot de passe
              </button>
              <button className="menu-item danger" type="button" role="menuitem" onClick={handleLogout}>
                <LogOut size={16} /> Déconnexion
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {changingPassword ? (
        <Modal
          title="Changer mon mot de passe"
          className="change-password-modal"
          onClose={() => {
            if (passwordSubmitting) return;
            setChangingPassword(false);
            setPasswordError('');
            setPasswordSuccess('');
          }}
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void handlePasswordSubmit(new FormData(event.currentTarget));
            }}
          >
            {passwordError ? <div className="error-message">{passwordError}</div> : null}
            {passwordSuccess ? <div className="success-message">{passwordSuccess}</div> : null}
            <label>
              Mot de passe actuel
              <input name="currentPassword" type="password" autoComplete="current-password" required />
            </label>
            <label>
              Nouveau mot de passe
              <input name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              Confirmer le nouveau mot de passe
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <div className="change-password-hint">
              Au moins 12 caractères avec majuscule, minuscule, chiffre et caractère spécial.
            </div>
            <div className="modal-footer modal-footer-sticky">
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setChangingPassword(false);
                  setPasswordError('');
                  setPasswordSuccess('');
                }}
                disabled={passwordSubmitting}
              >
                Annuler
              </button>
              <button type="submit" disabled={passwordSubmitting}>
                {passwordSubmitting ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
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

function extractApiError(error: unknown) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (Array.isArray(response?.message)) return response.message.join(' | ');
  if (typeof response?.message === 'string') return response.message;
  return 'Impossible de modifier le mot de passe.';
}
