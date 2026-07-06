import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { EmptyState } from '../components/EmptyState';

export function PermissionGuard({
  permission,
  children,
  redirectTo,
}: {
  permission: string;
  children: ReactNode;
  redirectTo?: string;
}) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  if (redirectTo) return <Navigate to={redirectTo} replace />;
  return <EmptyState message="Accès non autorisé pour ce profil." />;
}
