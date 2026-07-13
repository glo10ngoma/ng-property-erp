import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { appConfig } from '../../app/config';

export function ProtectedRoute() {
  const { user, isBootstrapping, requiresOrganizationSelection } = useAuth();
  const location = useLocation();
  if (isBootstrapping) {
    return (
      <div className="auth-bootstrap-screen">
        <div className="auth-bootstrap-panel">
          <div className="spinner" />
          <strong>Vérification de la session…</strong>
          <span>Chargement sécurisé de votre espace.</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (requiresOrganizationSelection && location.pathname !== '/select-organization') {
    return <Navigate to="/select-organization" replace state={{ from: location }} />;
  }
  if (!requiresOrganizationSelection && location.pathname === '/select-organization') {
    return <Navigate to={appConfig.defaultRoute} replace />;
  }
  return <Outlet />;
}
