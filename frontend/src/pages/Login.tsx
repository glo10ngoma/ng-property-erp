import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../auth';

const demoAccounts = [
  ['admin@property-erp.local', 'Administrateur'],
  ['comptable@property-erp.local', 'Comptable'],
  ['agent@property-erp.local', 'Agent'],
  ['directeur@property-erp.local', 'Directeur'],
];

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@property-erp.local');
  const [password, setPassword] = useState('demo');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError('');
      await login(email, password);
      navigate('/activity', { replace: true });
    } catch {
      setError('Adresse e-mail ou mot de passe incorrect.');
    }
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-logo"><LockKeyhole size={24} /></div>
          <div>
            <strong>NG Property ERP</strong>
            <span>Gestion Immobiliere</span>
          </div>
        </div>
        <div className="login-heading">
          <h1>Connexion</h1>
          <p>Connectez-vous a votre espace de gestion.</p>
        </div>
        <form className="form-grid login-form" onSubmit={submit}>
          <label>
            Adresse e-mail
            <div className="field-with-icon">
              <Mail size={16} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@property-erp.local" type="email" autoComplete="email" />
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
          {error && <div className="error-message">{error}</div>}
          <button>Connexion</button>
        </form>
        <div className="login-demo">
          <span>Comptes demo</span>
          <div className="login-demo-actions">
            {demoAccounts.map(([account, label]) => (
              <button className="secondary" key={account} onClick={() => { setEmail(account); setPassword('demo'); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <footer className="login-footer">
          <span>NG Property ERP SaaS V1</span>
          <small>© 2026 NG ERP Platform</small>
        </footer>
      </section>
    </div>
  );
}
