import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../api/api.types';
import { clearSession, login as loginRequest, readSession } from './auth.service';
import { setAuthToken } from '../api/axios';

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = readSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState<AuthUser | null>(initial.user);

  useEffect(() => {
    setAuthToken(token ?? undefined);
  }, [token]);

  useEffect(() => {
    const listener = (event: Event) => {
      const status = (event as CustomEvent<{ status: number }>).detail?.status;
      if (status === 401) {
        setToken(null);
        setUser(null);
      }
    };
    window.addEventListener('property-erp:auth-error', listener);
    return () => window.removeEventListener('property-erp:auth-error', listener);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    token,
    async login(email: string, password: string) {
      const response = await loginRequest(email, password);
      setToken(response.token);
      setUser(response.user);
    },
    logout() {
      clearSession();
      setToken(null);
      setUser(null);
    },
    can(permission: string) {
      return Boolean(user?.permissions.includes('*') || user?.permissions.includes(permission));
    },
  }), [token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
