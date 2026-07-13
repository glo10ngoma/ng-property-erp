import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function PlatformRoute() {
  const { user } = useAuth();
  const location = useLocation();
  const platformRole = String(user?.platform_role ?? user?.role ?? '').toUpperCase();
  if (platformRole === 'SUPER_ADMIN' || platformRole === 'ADMIN_PLATFORM') {
    return <Outlet />;
  }
  return <Navigate to="/app/activity" replace state={{ from: location }} />;
}
