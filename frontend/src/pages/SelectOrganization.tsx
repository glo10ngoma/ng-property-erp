import { Building2, CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

function roleLabel(roleCode: string) {
  return (
    {
      SUPER_ADMIN: 'Super administrateur',
      ADMIN_PLATFORM: 'Administrateur plateforme',
      ADMIN: 'Administrateur',
      ADMIN_CLIENT: 'Administrateur client',
      EDITOR_CLIENT: 'Utilisateur en écriture',
      VIEWER_CLIENT: 'Lecture seule',
      ACCOUNTANT: 'Comptable',
      DIRECTOR: 'Direction',
      STAFF: 'Équipe',
    }[String(roleCode).toUpperCase()] ?? roleCode
  );
}

export function SelectOrganization() {
  const location = useLocation();
  const { user, logout, setActiveOrganization } = useAuth();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(user?.organization_id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const organizations = useMemo(
    () => (user?.organizations ?? []).filter((organization) => organization.is_active),
    [user],
  );

  async function handleContinue() {
    if (!selectedOrganizationId) {
      setError('Veuillez sélectionner une organisation.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await setActiveOrganization(selectedOrganizationId);
    } catch (nextError) {
      setError((nextError as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Impossible d’activer cette organisation.');
      setSubmitting(false);
    }
  }

  return (
    <div className="organization-select-screen">
      <section className="organization-select-panel">
        <div className="login-brand">
          <div className="login-logo"><ShieldCheck size={24} /></div>
          <div>
            <strong>NG Property ERP</strong>
            <span>Sélection d’organisation</span>
          </div>
        </div>

        <div className="login-heading">
          <h1>Choisissez une organisation</h1>
          <p>
            {user?.name ?? user?.email ?? 'Utilisateur connecté'}
            {' '}doit sélectionner l’espace à ouvrir avant l’accès aux données.
          </p>
        </div>

        {error ? <div className="error-message">{error}</div> : null}

        <div className="organization-list" role="listbox" aria-label="Organisations accessibles">
          {organizations.map((organization) => {
            const selected = selectedOrganizationId === organization.organization_id;
            return (
              <button
                key={organization.organization_id}
                className={`organization-option${selected ? ' selected' : ''}`}
                type="button"
                onClick={() => setSelectedOrganizationId(organization.organization_id)}
                aria-pressed={selected}
              >
                <div className="organization-option-mark">
                  {selected ? <CheckCircle2 size={18} /> : <Building2 size={18} />}
                </div>
                <div className="organization-option-body">
                  <div className="organization-option-heading">
                    <strong>{organization.organization_name}</strong>
                    {organization.is_default ? <span className="badge active">Par défaut</span> : null}
                  </div>
                  <small>{roleLabel(organization.role_code)}</small>
                  <span>{organization.organization_slug}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="organization-select-actions">
          <button className="secondary" type="button" onClick={logout}>
            <LogOut size={16} /> Se déconnecter
          </button>
          <button type="button" onClick={() => void handleContinue()} disabled={submitting || !selectedOrganizationId}>
            {submitting ? 'Activation…' : 'Continuer'}
          </button>
        </div>

        <footer className="login-footer">
          <span>Accès demandé pour {location.state?.from?.pathname ?? 'votre espace ERP'}</span>
          <small>Les données métier restent masquées tant que l’organisation n’est pas validée.</small>
        </footer>
      </section>
    </div>
  );
}
