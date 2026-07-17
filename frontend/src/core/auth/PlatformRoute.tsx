import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function isPlatformSuperAdmin(user: { platform_role?: string | null; role?: string | null } | null | undefined) {
  return String(user?.platform_role ?? user?.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN';
}

export function hasPlatformAccess(user: { platform_role?: string | null; role?: string | null } | null | undefined) {
  const platformRole = String(user?.platform_role ?? user?.role ?? '').trim().toUpperCase();
  return platformRole === 'SUPER_ADMIN' || platformRole === 'ADMIN_PLATFORM';
}

export function PlatformRoute() {
  const { user } = useAuth();
  const location = useLocation();
  if (hasPlatformAccess(user)) {
    return <Outlet />;
  }
  return <Navigate to="/app/activity" replace state={{ from: location }} />;
}

export function SuperAdminRoute() {
  const { user } = useAuth();
  const location = useLocation();
  if (isPlatformSuperAdmin(user)) {
    return <Outlet />;
  }
  return <Navigate to="/app/activity" replace state={{ from: location }} />;
}
