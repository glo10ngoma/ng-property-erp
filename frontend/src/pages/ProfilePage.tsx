import { KeyRound, RefreshCw, ShieldCheck, UserCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appConfig } from '../app/config';
import { useAuth } from '../auth';
import { LoadingState, Modal, PageHeader, StatusBadge } from '../components';
import type { AuthUser } from '../core/api/api.types';
import { changePassword as changePasswordRequest, me as meRequest } from '../core/auth/auth.service';

export function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AuthUser | null>(user);
  const [loading, setLoading] = useState(true);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const initialUserRef = useRef(user);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await meRequest();
        if (!active) return;
        setProfile(response);
        await refreshUser();
      } catch (err) {
        if (!active) return;
        setProfile(initialUserRef.current);
        setError(extractMessage(err, 'Impossible de charger le profil.'));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [refreshUser]);

  const organizations = useMemo(() => profile?.organizations ?? [], [profile]);

  async function submitPassword(formData: FormData) {
    const currentPassword = String(formData.get('currentPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    setSavingPassword(true);
    setError('');
    setSuccess('');

    try {
      const response = await changePasswordRequest({ currentPassword, newPassword, confirmPassword });
      setSuccess(response.message);
      setPasswordOpen(false);
      window.setTimeout(() => {
        logout();
        navigate('/login', { replace: true });
      }, 1000);
    } catch (err) {
      setError(extractMessage(err, 'Impossible de modifier le mot de passe.'));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <section className="profile-page">
      <PageHeader
        title="Mon profil"
        action={
          <button className="secondary" type="button" onClick={() => navigate(appConfig.defaultRoute)}>
            <RefreshCw size={16} />
            Retour à l'application
          </button>
        }
      />

      {loading ? <LoadingState message="Chargement du profil..." /> : null}
      {error ? <div className="error-message">{error}</div> : null}
      {success ? <div className="success-message">{success}</div> : null}

      {!loading && profile ? (
        <div className="profile-grid">
          <div className="detail-section report-section">
            <h4>
              <UserCircle size={16} />
              Identité
            </h4>
            <div className="profile-details">
              <span>Nom complet</span>
              <strong>{profile.name}</strong>
              <span>Email</span>
              <strong>{profile.email}</strong>
              <span>Statut</span>
              <strong>
                <StatusBadge value={profile.status ?? 'ACTIVE'} />
              </strong>
              <span>Rôle plateforme</span>
              <strong>{profile.platform_role ?? '—'}</strong>
              <span>Rôle organisation</span>
              <strong>{profile.organization_role ?? '—'}</strong>
              <span>Organisation active</span>
              <strong>{profile.organization_name ?? '—'}</strong>
              <span>Date de création</span>
              <strong>{dateText(profile.created_at)}</strong>
              <span>Dernière connexion</span>
              <strong>{dateText(profile.last_login_at)}</strong>
            </div>
          </div>

          <div className="detail-section report-section">
            <h4>
              <ShieldCheck size={16} />
              Organisations accessibles
            </h4>
            {organizations.length ? (
              <div className="profile-org-list">
                {organizations.map((organization) => (
                  <div className="compact-item" key={organization.organization_id}>
                    <span>
                      {organization.organization_name} <small>({organization.organization_slug})</small>
                    </span>
                    <strong>
                      {organization.role_code}
                      {organization.is_default ? ' · Défaut' : ''}
                      {organization.is_active ? '' : ' · Inactive'}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="compact-empty">Aucune organisation disponible.</div>
            )}
          </div>

          <div className="detail-section report-section profile-actions">
            <h4>
              <KeyRound size={16} />
              Actions
            </h4>
            <div className="actions-row">
              <button type="button" onClick={() => setPasswordOpen(true)}>
                <KeyRound size={16} />
                Changer mon mot de passe
              </button>
              <button type="button" className="secondary" onClick={() => navigate(appConfig.defaultRoute)}>
                Retour à l'application
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordOpen ? (
        <Modal title="Changer mon mot de passe" onClose={() => !savingPassword && setPasswordOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPassword(new FormData(event.currentTarget));
            }}
          >
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
            <div className="modal-footer modal-footer-sticky">
              <button type="button" className="secondary" onClick={() => setPasswordOpen(false)} disabled={savingPassword}>
                Annuler
              </button>
              <button type="submit" disabled={savingPassword}>
                {savingPassword ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function dateText(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('fr-FR');
}

function extractMessage(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  if (Array.isArray(response?.message)) return response.message.join(' | ');
  if (typeof response?.message === 'string') return response.message;
  return fallback;
}
