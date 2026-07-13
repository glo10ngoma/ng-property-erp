import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../auth';
import { appConfig } from '../app/config';

export function Login() {
  const { login, user, requiresOrganizationSelection } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (requiresOrganizationSelection) {
      navigate('/select-organization', { replace: true });
      return;
    }
    const nextPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    navigate(nextPath && nextPath !== '/login' ? nextPath : appConfig.defaultRoute, { replace: true });
  }, [location.state, navigate, requiresOrganizationSelection, user]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError('');
      setSubmitting(true);
      const authenticatedUser = await login(email, password);
      const activeOrganizations = (authenticatedUser.organizations ?? []).filter((organization) => organization.is_active);
      if (activeOrganizations.length > 1) {
        navigate('/select-organization', { replace: true, state: { from: location.state?.from } });
        return;
      }
      const nextPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(nextPath && nextPath !== '/login' ? nextPath : appConfig.defaultRoute, { replace: true });
    } catch (nextError) {
      setError((nextError as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Adresse e-mail ou mot de passe incorrect.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-logo"><LockKeyhole size={24} /></div>
          <div>
            <strong>NG Property ERP</strong>
            <span>Gestion immobilière</span>
          </div>
        </div>
        <div className="login-heading">
          <h1>Connexion</h1>
          <p>Connectez-vous à votre espace de gestion.</p>
        </div>
        <form className="form-grid login-form" onSubmit={submit}>
          <label>
            Adresse e-mail
            <div className="field-with-icon">
              <Mail size={16} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vous@entreprise.com" type="email" autoComplete="email" />
            </div>
          </label>
          <label>
            Mot de passe
            <div className="password-field">
              <div className="field-with-icon">
                <LockKeyhole size={16} />
                <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" type={showPassword ? 'text' : 'password'} autoComplete="current-password" />
              </div>
              <button className="icon-btn" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error ? <div className="error-message">{error}</div> : null}
          {resetMessage ? <div className="info-message">{resetMessage}</div> : null}
          <button disabled={submitting}>{submitting ? 'Connexion…' : 'Se connecter'}</button>
          <button
            className="login-link"
            type="button"
            onClick={() => setResetMessage('Veuillez contacter l’administrateur pour réinitialiser votre mot de passe.')}
          >
            Mot de passe oublié ?
          </button>
        </form>
        <footer className="login-footer">
          <span>NG Property ERP SaaS V1</span>
          <small>© 2026 NG ERP Platform</small>
        </footer>
      </section>
    </div>
  );
}
