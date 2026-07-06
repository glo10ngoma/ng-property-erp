import { useAuth } from '../auth/AuthContext';

export function usePermissions() {
  const { can, user } = useAuth();
  return { can, role: user?.role, permissions: user?.permissions ?? [] };
}
