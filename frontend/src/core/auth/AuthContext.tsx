import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { appConfig } from '../../app/config';
import type { AuthUser } from '../api/api.types';
import {
  changePassword as changePasswordRequest,
  clearSession,
  login as loginRequest,
  logoutRequest,
  me as meRequest,
  persistSession,
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
  setActiveOrganization: (organizationId: number) => Promise<AuthUser>;
  changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) => Promise<{ message: string; forceLogout?: boolean }>;
  refreshUser: () => Promise<void>;
  continueSession: () => void;
  can: (permission: string) => boolean;
  hasModule: (moduleCode: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'mousemove'];
const ACTIVITY_THROTTLE_MS = 15_000;
const SESSION_RECHECK_MS = 30_000;

let authMeSingleFlightPromise: Promise<AuthUser> | null = null;
let authMeSingleFlightKey = '';

function devLog(message: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.info(message, payload);
}

function isAbortLikeError(error: unknown) {
  const candidate = error as { code?: string; name?: string; message?: string } | null;
  return candidate?.code === 'ERR_CANCELED' || candidate?.name === 'CanceledError' || candidate?.message === 'canceled';
}

function getActiveOrganizations(nextUser: AuthUser) {
  return (nextUser.organizations ?? []).filter((organization) => organization.is_active);
}

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
  const latestPathnameRef = useRef(location.pathname);
  const latestUserRef = useRef<AuthUser | null>(initial.user);
  const authEpochRef = useRef(0);
  const skipNextTokenBootstrapRef = useRef(false);

  latestPathnameRef.current = location.pathname;
  latestUserRef.current = user;

  const applySelectionRequirement = useCallback((nextUser: AuthUser, forceSelection = false, activeOrganizationId?: number | null) => {
    const activeOrganizations = getActiveOrganizations(nextUser);
    const resolvedOrganizationId = activeOrganizationId ?? readActiveOrganizationId();
    const nextValue = forceSelection || (activeOrganizations.length > 1 && !resolvedOrganizationId);
    writeOrganizationSelectionRequired(nextValue);
    setRequiresOrganizationSelection(nextValue);
    return nextValue;
  }, []);

  const applyAuthSnapshot = useCallback((nextToken: string | null, nextUser: AuthUser | null, options?: { persist?: boolean; activeOrganizationId?: number | null; forceSelection?: boolean }) => {
    setAuthToken(nextToken ?? undefined);
    setToken(nextToken);
    setUser(nextUser);

    if (!nextToken || !nextUser) return;

    const requiresSelection = applySelectionRequirement(nextUser, options?.forceSelection ?? false, options?.activeOrganizationId);
    const nextOrganizationId = requiresSelection ? null : (options?.activeOrganizationId ?? nextUser.organization_id ?? null);

    if (options?.persist !== false) {
      persistSession(nextToken, nextUser, { activeOrganizationId: nextOrganizationId });
    } else {
      persistUser(nextUser, { activeOrganizationId: nextOrganizationId });
      setAuthToken(nextToken);
    }

    if (requiresSelection) {
      writeActiveOrganizationId(null);
    }
  }, [applySelectionRequirement]);

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
    authEpochRef.current += 1;
    skipNextTokenBootstrapRef.current = false;
    if (!options?.skipServer) {
      void logoutRequest().catch(() => undefined);
    }
    clearSession();
    authMeSingleFlightPromise = null;
    authMeSingleFlightKey = '';
    setAuthToken(undefined);
    setToken(null);
    setUser(null);
    setRequiresOrganizationSelection(false);
    setShowSessionWarning(false);
    setWarningBusy(false);
    setIsBootstrapping(false);
    devLog('[AUTH_CONTEXT_DEV]', {
      pathname: latestPathnameRef.current,
      authStatus: 'unauthenticated',
      organizationId: null,
      activeModules: [],
      permissionsCount: 0,
      requestEnd: 'logout',
    });
  }, []);

  const syncCurrentUser = useCallback(async (reason: string) => {
    const currentToken = localStorage.getItem(appConfig.tokenStorageKey);
    const activeOrganizationId = readActiveOrganizationId();
    const requestKey = `${currentToken ?? ''}:${activeOrganizationId ?? ''}`;
    const requestEpoch = authEpochRef.current;
    const currentUser = latestUserRef.current;

    if (authMeSingleFlightPromise && authMeSingleFlightKey === requestKey) {
      devLog('[AUTH_CONTEXT_DEV]', {
        pathname: latestPathnameRef.current,
        authStatus: currentToken ? 'loading' : 'unauthenticated',
        organizationId: activeOrganizationId,
        activeModules: currentUser?.active_modules ?? [],
        permissionsCount: currentUser?.permissions.length ?? 0,
        requestStart: reason,
        singleFlight: true,
      });
      return authMeSingleFlightPromise;
    }

    devLog('[AUTH_CONTEXT_DEV]', {
      pathname: latestPathnameRef.current,
      authStatus: currentToken ? 'loading' : 'unauthenticated',
      organizationId: activeOrganizationId,
      activeModules: currentUser?.active_modules ?? [],
      permissionsCount: currentUser?.permissions.length ?? 0,
      requestStart: reason,
      singleFlight: false,
    });

    const requestPromise = (async () => {
      try {
        const nextUser = await meRequest();
        const latestToken = localStorage.getItem(appConfig.tokenStorageKey);
        const latestOrganizationId = readActiveOrganizationId();
        const latestKey = `${latestToken ?? ''}:${latestOrganizationId ?? ''}`;

        if (requestEpoch !== authEpochRef.current || latestKey !== requestKey) {
          devLog('[AUTH_CONTEXT_DEV]', {
            pathname: latestPathnameRef.current,
            authStatus: latestToken ? 'authenticated' : 'unauthenticated',
            organizationId: latestOrganizationId,
            activeModules: latestUserRef.current?.active_modules ?? [],
            permissionsCount: latestUserRef.current?.permissions.length ?? 0,
            requestEnd: reason,
            stale: true,
          });
          return latestUserRef.current ?? nextUser;
        }

        applyAuthSnapshot(currentToken, nextUser, {
          persist: false,
          activeOrganizationId: activeOrganizationId ?? null,
          forceSelection: false,
        });
        devLog('[AUTH_CONTEXT_DEV]', {
          pathname: latestPathnameRef.current,
          authStatus: 'authenticated',
          organizationId: nextUser.organization_id ?? activeOrganizationId ?? null,
          activeModules: nextUser.active_modules ?? [],
          permissionsCount: nextUser.permissions.length,
          requestEnd: reason,
          aborted: false,
        });
        return nextUser;
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        const aborted = isAbortLikeError(error);
        const latestToken = localStorage.getItem(appConfig.tokenStorageKey);
        const latestOrganizationId = readActiveOrganizationId();
        const latestKey = `${latestToken ?? ''}:${latestOrganizationId ?? ''}`;

        if ((requestEpoch !== authEpochRef.current || latestKey !== requestKey) && latestUserRef.current) {
          devLog('[AUTH_CONTEXT_DEV]', {
            pathname: latestPathnameRef.current,
            authStatus: 'authenticated',
            organizationId: latestUserRef.current.organization_id ?? latestOrganizationId ?? null,
            activeModules: latestUserRef.current.active_modules ?? [],
            permissionsCount: latestUserRef.current.permissions.length,
            requestEnd: reason,
            stale: true,
            status: status ?? null,
          });
          return latestUserRef.current;
        }

        if (aborted && latestUserRef.current) {
          devLog('[AUTH_CONTEXT_DEV]', {
            pathname: latestPathnameRef.current,
            authStatus: 'authenticated',
            organizationId: latestUserRef.current.organization_id ?? activeOrganizationId ?? null,
            activeModules: latestUserRef.current.active_modules ?? [],
            permissionsCount: latestUserRef.current.permissions.length,
            requestEnd: reason,
            aborted: true,
            status: status ?? null,
          });
          return latestUserRef.current;
        }

        if (status === 403 && activeOrganizationId) {
          writeActiveOrganizationId(null);
          const fallbackUser = await meRequest();
          applyAuthSnapshot(currentToken, fallbackUser, {
            persist: false,
            activeOrganizationId: null,
            forceSelection: getActiveOrganizations(fallbackUser).length > 1,
          });
          devLog('[AUTH_CONTEXT_DEV]', {
            pathname: latestPathnameRef.current,
            authStatus: 'selecting-organization',
            organizationId: null,
            activeModules: fallbackUser.active_modules ?? [],
            permissionsCount: fallbackUser.permissions.length,
            requestEnd: `${reason}:fallback`,
            aborted,
          });
          return fallbackUser;
        }

        devLog('[AUTH_CONTEXT_DEV]', {
          pathname: latestPathnameRef.current,
          authStatus: currentToken ? 'loading' : 'unauthenticated',
          organizationId: activeOrganizationId,
          activeModules: currentUser?.active_modules ?? [],
          permissionsCount: currentUser?.permissions.length ?? 0,
          requestEnd: reason,
          aborted,
          status: status ?? null,
        });
        throw error;
      }
    })();

    authMeSingleFlightKey = requestKey;
    authMeSingleFlightPromise = requestPromise;

    try {
      return await requestPromise;
    } finally {
      if (authMeSingleFlightPromise === requestPromise) {
        authMeSingleFlightPromise = null;
        authMeSingleFlightKey = '';
      }
    }
  }, [applyAuthSnapshot]);

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
      await syncCurrentUser('session-recheck');
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

    if (skipNextTokenBootstrapRef.current) {
      skipNextTokenBootstrapRef.current = false;
      setIsBootstrapping(false);
      return;
    }

    let cancelled = false;
    initializeSessionTracking(false);
    setIsBootstrapping(true);

    void syncCurrentUser('bootstrap')
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
          void syncCurrentUser('storage-organization-change')
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
      authEpochRef.current += 1;
      skipNextTokenBootstrapRef.current = true;
      initializeSessionTracking(true);

      const activeOrganizations = getActiveOrganizations(response.user);
      const requiresSelection = activeOrganizations.length > 1;
      let resolvedUser = response.user;

      if (requiresSelection) {
        applyAuthSnapshot(response.token, response.user, {
          persist: true,
          activeOrganizationId: null,
          forceSelection: true,
        });
      } else if (response.user.organization_id) {
        localStorage.setItem(appConfig.tokenStorageKey, response.token);
        writeActiveOrganizationId(response.user.organization_id);
        setAuthToken(response.token);
        setToken(response.token);
        devLog('[AUTH_CONTEXT_DEV]', {
          pathname: latestPathnameRef.current,
          authStatus: 'login-single-org-me-start',
          organizationId: response.user.organization_id,
          activeModules: response.user.active_modules ?? [],
          permissionsCount: response.user.permissions?.length ?? 0,
        });
        resolvedUser = await meRequest();
        devLog('[AUTH_CONTEXT_DEV]', {
          pathname: latestPathnameRef.current,
          authStatus: 'login-single-org-me-end',
          organizationId: resolvedUser.organization_id ?? response.user.organization_id,
          activeModules: resolvedUser.active_modules ?? [],
          permissionsCount: resolvedUser.permissions?.length ?? 0,
        });
        applyAuthSnapshot(response.token, resolvedUser, {
          persist: true,
          activeOrganizationId: resolvedUser.organization_id ?? response.user.organization_id,
          forceSelection: false,
        });
      } else {
        applyAuthSnapshot(response.token, response.user, {
          persist: true,
          activeOrganizationId: null,
          forceSelection: false,
        });
      }

      setShowSessionWarning(false);
      setWarningBusy(false);
      return resolvedUser;
    },
    async refreshUser() {
      setIsBootstrapping(true);
      try {
        await syncCurrentUser('refresh-user');
      } finally {
        setIsBootstrapping(false);
      }
    },
    async setActiveOrganization(organizationId: number) {
      const previousOrganizationId = user?.organization_id ?? readActiveOrganizationId();
      const previousSelectionRequired = readOrganizationSelectionRequired();
      const previousUser = latestUserRef.current;
      const previousToken = token;

      authEpochRef.current += 1;
      authMeSingleFlightPromise = null;
      authMeSingleFlightKey = '';
      writeActiveOrganizationId(null);

      try {
        const response = await switchOrganizationRequest(organizationId);
        skipNextTokenBootstrapRef.current = true;
        applyAuthSnapshot(response.token, response.user, {
          persist: true,
          activeOrganizationId: organizationId,
          forceSelection: false,
        });

        const refreshedUser = await meRequest();
        applyAuthSnapshot(response.token, refreshedUser, {
          persist: true,
          activeOrganizationId: refreshedUser.organization_id ?? organizationId,
          forceSelection: false,
        });
        writeOrganizationSelectionRequired(false);
        setRequiresOrganizationSelection(false);
        recordActivity(true);
        return refreshedUser;
      } catch (error) {
        authEpochRef.current += 1;
        if (previousToken && previousUser) {
          applyAuthSnapshot(previousToken, previousUser, {
            persist: true,
            activeOrganizationId: previousOrganizationId ?? null,
            forceSelection: previousSelectionRequired,
          });
        } else {
          writeActiveOrganizationId(previousOrganizationId ?? null);
          writeOrganizationSelectionRequired(previousSelectionRequired);
          setRequiresOrganizationSelection(previousSelectionRequired);
        }
        throw error;
      }
    },
    async changePassword(payload) {
      return changePasswordRequest(payload);
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
    hasModule(moduleCode: string) {
      return Boolean(user?.active_modules?.includes(String(moduleCode ?? '').trim().toUpperCase()));
    },
  }), [
    applyAuthSnapshot,
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