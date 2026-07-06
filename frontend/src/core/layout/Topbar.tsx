import { appConfig } from '../../app/config';
import { useAuth } from '../auth/AuthContext';

export function Topbar() {
  const { user, logout } = useAuth();

  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">{appConfig.businessLabel}</span>
        <h1>Espace de pilotage</h1>
      </div>
      {user && <button className="operator" onClick={logout}>{user.name} · {user.role}</button>}
    </header>
  );
}
