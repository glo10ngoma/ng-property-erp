import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
        <div className="brand">
          <strong>Property ERP</strong>
          <span>V1 SaaS locale</span>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" type="password" />
          {error && <div className="empty">{error}</div>}
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
