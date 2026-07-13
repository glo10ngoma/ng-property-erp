import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { appConfig } from '../../app/config';
import type { AuthUser } from '../api/api.types';
import {
  clearSession,
  login as loginRequest,
  logoutRequest,
  me as meRequest,
  persistUser,
  readActiveOrganizationId,
  readLastActivityAt,
  readOrganizationSelectionRequired,
  readSession,
  readSessionStartedAt,
  switchOrganization as switchOrganizationRequest,
  writeActiveOrganizationId,
  writeLastActivityAt,
  writeOrganizationSelectionRequired,
  writeSessionStartedAt,
} from './auth.service';
import { setAuthToken } from '../api/axios';

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  isBootstrapping: boolean;
  requiresOrganizationSelection: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  setActiveOrganization: (organizationId: number) => Promise<void>;
  refreshUser: () => Promise<void>;
  continueSession: () => void;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'mousemove'];
const ACTIVITY_THROTTLE_MS = 15_000;
const SESSION_RECHECK_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const initial = readSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState<AuthUser | null>(initial.user);
  const [isBootstrapping, setIsBootstrapping] = useState(Boolean(initial.token));
  const [requiresOrganizationSelection, setRequiresOrganizationSelection] = useState(readOrganizationSelectionRequired());
  const [showSessionWarning, setShowSessionWarning] = useState(false);
  const [warningBusy, setWarningBusy] = useState(false);

  const lastActivityRef = useRef(readLastActivityAt() ?? Date.now());
  const sessionStartedAtRef = useRef(readSessionStartedAt() ?? Date.now());
  const lastPersistedActivityRef = useRef(0);
  const lastServerVerificationRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);

  const applySelectionRequirement = useCallback((nextUser: AuthUser, forceSelection = false) => {
    const activeOrganizations = (nextUser.organizations ?? []).filter((organization) => organization.is_active);
    const nextValue = activeOrganizations.length > 1
      ? (forceSelection || readOrganizationSelectionRequired())
      : false;
    writeOrganizationSelectionRequired(nextValue);
    setRequiresOrganizationSelection(nextValue);
    return nextValue;
  }, []);

  const initializeSessionTracking = useCallback((forceNewSession = false) => {
    const now = Date.now();
    const nextStartedAt = forceNewSession ? now : (readSessionStartedAt() ?? now);
    sessionStartedAtRef.current = nextStartedAt;
    lastActivityRef.current = now;
    writeSessionStartedAt(nextStartedAt);
    writeLastActivityAt(now);
    lastPersistedActivityRef.current = now;
    lastServerVerificationRef.current = 0;
  }, []);

  const logoutInternal = useCallback((options?: { remote?: boolean; skipServer?: boolean }) => {
    if (!options?.skipServer) {
      void logoutRequest().catch(() => undefined);
    }
    clearSession();
    setAuthToken(undefined);
    setToken(null);
    setUser(null);
    setRequiresOrganizationSelection(false);
    setShowSessionWarning(false);
    setWarningBusy(false);
    setIsBootstrapping(false);
  }, []);

  const syncCurrentUser = useCallback(async () => {
    try {
      const nextUser = await meRequest();
      setUser(nextUser);
      persistUser(nextUser);
      writeActiveOrganizationId(nextUser.organization_id ?? null);
      applySelectionRequirement(nextUser, false);
      return nextUser;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 403 && readActiveOrganizationId()) {
        writeActiveOrganizationId(null);
        const fallbackUser = await meRequest();
        setUser(fallbackUser);
        persistUser(fallbackUser);
        writeActiveOrganizationId(fallbackUser.organization_id ?? null);
        applySelectionRequirement(fallbackUser, false);
        return fallbackUser;
      }
      throw error;
    }
  }, [applySelectionRequirement]);

  const recordActivity = useCallback((force = false) => {
    if (!token || !user) return;
    const now = Date.now();
    if (!force && now - lastPersistedActivityRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityRef.current = now;
    lastPersistedActivityRef.current = now;
    writeLastActivityAt(now);
    if (showSessionWarning) setShowSessionWarning(false);
  }, [showSessionWarning, token, user]);

  const evaluateSession = useCallback(async (verifyServer = false) => {
    if (!token || !user) return;

    const now = Date.now();
    const warningMs = appConfig.sessionIdleWarningMinutes * 60_000;
    const idleTimeoutMs = appConfig.sessionIdleTimeoutMinutes * 60_000;
    const absoluteTimeoutMs = appConfig.sessionAbsoluteTimeoutHours * 60 * 60_000;
    const inactiveFor = now - lastActivityRef.current;
    const runningFor = now - sessionStartedAtRef.current;

    if (runningFor >= absoluteTimeoutMs || inactiveFor >= idleTimeoutMs) {
      logoutInternal({ skipServer: true });
      return;
    }

    setShowSessionWarning(inactiveFor >= warningMs);

    if (!verifyServer || now - lastServerVerificationRef.current < SESSION_RECHECK_MS) {
      return;
    }

    lastServerVerificationRef.current = now;
    try {
      await syncCurrentUser();
    } catch {
      logoutInternal({ skipServer: true });
    }
  }, [logoutInternal, syncCurrentUser, token, user]);

  useEffect(() => {
    setAuthToken(token ?? undefined);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setIsBootstrapping(false);
      return;
    }

    let cancelled = false;
    initializeSessionTracking(false);
    setIsBootstrapping(true);

    void syncCurrentUser()
      .catch(() => {
        if (cancelled) return;
        logoutInternal({ skipServer: true });
      })
      .finally(() => {
        if (cancelled) return;
        setIsBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initializeSessionTracking, logoutInternal, syncCurrentUser, token]);

  useEffect(() => {
    const listener = (event: Event) => {
      const status = (event as CustomEvent<{ status: number }>).detail?.status;
      if (status === 401) {
        logoutInternal({ remote: true, skipServer: true });
      }
    };

    window.addEventListener('property-erp:auth-error', listener);
    return () => window.removeEventListener('property-erp:auth-error', listener);
  }, [logoutInternal]);

  useEffect(() => {
    if (!token || !user) return;

    recordActivity(true);
    const onActivity = () => recordActivity(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
        hiddenAtRef.current = null;
        const shouldVerifyServer = hiddenFor >= 60_000;
        void evaluateSession(shouldVerifyServer);
      }
    };
    const onFocus = () => {
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      if (hiddenFor >= 60_000) {
        void evaluateSession(true);
      }
    };
    const interval = window.setInterval(() => {
      void evaluateSession(false);
    }, 30_000);

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, onActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [evaluateSession, recordActivity, token, user]);

  useEffect(() => {
    if (!token || !user) return;
    recordActivity(true);
  }, [location.pathname, recordActivity, token, user]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === appConfig.tokenStorageKey && !event.newValue) {
        logoutInternal({ remote: true, skipServer: true });
        return;
      }

      if (
        event.key === appConfig.activeOrganizationStorageKey
        && event.newValue
        && token
        && user
      ) {
        const nextOrganizationId = Number(event.newValue);
        if (Number.isFinite(nextOrganizationId) && nextOrganizationId !== user.organization_id) {
          setIsBootstrapping(true);
          void syncCurrentUser()
            .then(() => {
              window.location.replace(appConfig.defaultRoute);
            })
            .catch(() => {
              logoutInternal({ remote: true, skipServer: true });
            })
            .finally(() => {
              setIsBootstrapping(false);
            });
        }
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [logoutInternal, syncCurrentUser, token, user]);

  const value = useMemo<AuthState>(() => ({
    user,
    token,
    isBootstrapping,
    requiresOrganizationSelection,
    async login(email: string, password: string) {
      const response = await loginRequest(email, password);
      setToken(response.token);
      setUser(response.user);
      initializeSessionTracking(true);
      applySelectionRequirement(response.user, true);
      setShowSessionWarning(false);
      setWarningBusy(false);
      return response.user;
    },
    async refreshUser() {
      setIsBootstrapping(true);
      try {
        await syncCurrentUser();
      } finally {
        setIsBootstrapping(false);
      }
    },
    async setActiveOrganization(organizationId: number) {
      const previousOrganizationId = user?.organization_id ?? readActiveOrganizationId();
      writeActiveOrganizationId(organizationId);
      try {
        const nextUser = await switchOrganizationRequest(organizationId);
        setUser(nextUser);
        persistUser(nextUser);
        writeOrganizationSelectionRequired(false);
        setRequiresOrganizationSelection(false);
        recordActivity(true);
        window.setTimeout(() => {
          window.location.replace(appConfig.defaultRoute);
        }, 0);
      } catch (error) {
        writeActiveOrganizationId(previousOrganizationId ?? null);
        throw error;
      }
    },
    continueSession() {
      setWarningBusy(true);
      recordActivity(true);
      setShowSessionWarning(false);
      window.setTimeout(() => setWarningBusy(false), 120);
    },
    logout() {
      logoutInternal();
    },
    can(permission: string) {
      return Boolean(user?.permissions.includes('*') || user?.permissions.includes(permission));
    },
  }), [
    applySelectionRequirement,
    initializeSessionTracking,
    isBootstrapping,
    logoutInternal,
    recordActivity,
    requiresOrganizationSelection,
    syncCurrentUser,
    token,
    user,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {showSessionWarning && user ? (
        <div className="modal-backdrop no-print">
          <section className="modal session-warning-modal" aria-modal="true" role="dialog" aria-labelledby="session-warning-title">
            <div className="modal-head">
              <h3 id="session-warning-title">Sécurité de session</h3>
            </div>
            <div className="modal-body">
              <p className="settings-intro">
                Votre session va être verrouillée pour des raisons de sécurité.
              </p>
              <p className="settings-intro">
                Sans action, une nouvelle connexion sera demandée automatiquement.
              </p>
            </div>
            <div className="modal-footer session-warning-actions">
              <button className="secondary" type="button" onClick={() => logoutInternal()}>
                Se déconnecter
              </button>
              <button type="button" onClick={() => value.continueSession()} disabled={warningBusy}>
                Continuer la session
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
