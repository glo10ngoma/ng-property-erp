import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useAuth } from '../auth';

const demoAccounts = [
  ['admin@property-erp.local', 'Administrateur'],
  ['comptable@property-erp.local', 'Comptable'],
  ['agent@property-erp.local', 'Agent écriture'],
  ['directeur@property-erp.local', 'Directeur lecture seule'],
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
      setError('Connexion refusée. Vérifiez le compte et le mot de passe.');
    }
  }

  return (
    <div className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-logo"><LockKeyhole size={24} /></div>
          <div>
            <strong>Property ERP</strong>
            <span>NG ERP Platform</span>
          </div>
        </div>
        <div className="login-heading">
          <h1>Connexion</h1>
          <p>Accedez a votre espace de pilotage immobilier.</p>
        </div>
        <form className="form-grid login-form" onSubmit={submit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@property-erp.local" type="email" autoComplete="email" />
          </label>
          <label>
            Mot de passe
            <div className="password-field">
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" type={showPassword ? 'text' : 'password'} autoComplete="current-password" />
              <button className="icon-btn" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error && <div className="error-message">{error}</div>}
          <button>Se connecter</button>
        </form>
        <div className="detail-section">
          <h4>Comptes démo</h4>
          <div className="compact-list">
            {demoAccounts.map(([account, label]) => (
              <button className="secondary" key={account} onClick={() => { setEmail(account); setPassword('demo'); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
