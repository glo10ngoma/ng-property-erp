import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { resolvePostAuthDestination } from './auth.service';

function devLog(message: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.info(message, payload);
}

export function ProtectedRoute() {
  const { user, isBootstrapping, requiresOrganizationSelection } = useAuth();
  const location = useLocation();
  const requestedPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? null;
  const authStatus = isBootstrapping
    ? 'loading'
    : !user
      ? 'unauthenticated'
      : requiresOrganizationSelection
        ? 'selectingOrganization'
        : 'authenticated';

  devLog('[AUTH_CONTEXT_DEV]', {
    pathname: location.pathname,
    authStatus,
    organizationId: user?.organization_id ?? null,
    activeModules: user?.active_modules ?? [],
    permissionsCount: user?.permissions.length ?? 0,
    requestedPath,
  });

  if (isBootstrapping && !user) {
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
    return <Navigate to={resolvePostAuthDestination(user, requestedPath)} replace />;
  }

  return <Outlet />;
}