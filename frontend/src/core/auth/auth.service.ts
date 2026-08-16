import { appConfig } from '../../app/config';
import { api, setAuthToken } from '../api/axios';
import { endpoints } from '../api/endpoints';
import type { AuthUser } from '../api/api.types';

export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export async function login(email: string, password: string) {
  const response = await api.post<LoginResponse>(endpoints.auth.login, { email, password });
  return response.data;
}

export async function me() {
  const response = await api.get<{ user?: AuthUser } | AuthUser>('/auth/me');
  return ((response.data as { user?: AuthUser }).user ?? response.data) as AuthUser;
}

export async function switchOrganization(organizationId: number) {
  const response = await api.post<LoginResponse>('/auth/switch-organization', {
    organizationId,
  });
  return response.data;
}

export async function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const response = await api.patch<{ message: string; forceLogout?: boolean }>('/auth/change-password', payload);
  return response.data;
}

export async function logoutRequest() {
  await api.post('/auth/logout');
}

export function persistSession(token: string, user: AuthUser, options?: { activeOrganizationId?: number | null }) {
  localStorage.setItem(appConfig.tokenStorageKey, token);
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
  writeOrganizationStorage(options?.activeOrganizationId ?? user.organization_id ?? null);
  setAuthToken(token);
}

export function persistUser(user: AuthUser, options?: { activeOrganizationId?: number | null }) {
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
  writeOrganizationStorage(options?.activeOrganizationId ?? user.organization_id ?? null);
}

export function readSession() {
  const token = localStorage.getItem(appConfig.tokenStorageKey);
  const stored = localStorage.getItem(appConfig.userStorageKey);
  return {
    token,
    user: stored ? JSON.parse(stored) as AuthUser : null,
  };
}

export function clearSession() {
  localStorage.removeItem(appConfig.tokenStorageKey);
  localStorage.removeItem(appConfig.userStorageKey);
  localStorage.removeItem(appConfig.activeOrganizationStorageKey);
  localStorage.removeItem(appConfig.sessionStartedAtStorageKey);
  localStorage.removeItem(appConfig.sessionLastActivityStorageKey);
  localStorage.removeItem(appConfig.organizationSelectionRequiredStorageKey);
  setAuthToken(undefined);
}

export function readActiveOrganizationId() {
  const stored = localStorage.getItem(appConfig.activeOrganizationStorageKey);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function writeActiveOrganizationId(organizationId: number | null) {
  writeOrganizationStorage(organizationId);
}

export function readSessionStartedAt() {
  return readNumberStorageValue(appConfig.sessionStartedAtStorageKey);
}

export function writeSessionStartedAt(timestamp: number | null) {
  writeNumberStorageValue(appConfig.sessionStartedAtStorageKey, timestamp);
}

export function readLastActivityAt() {
  return readNumberStorageValue(appConfig.sessionLastActivityStorageKey);
}

export function writeLastActivityAt(timestamp: number | null) {
  writeNumberStorageValue(appConfig.sessionLastActivityStorageKey, timestamp);
}

export function readOrganizationSelectionRequired() {
  return localStorage.getItem(appConfig.organizationSelectionRequiredStorageKey) === 'true';
}

export function writeOrganizationSelectionRequired(required: boolean) {
  if (!required) {
    localStorage.removeItem(appConfig.organizationSelectionRequiredStorageKey);
    return;
  }
  localStorage.setItem(appConfig.organizationSelectionRequiredStorageKey, 'true');
}

export function canAccessSales(user: AuthUser | null) {
  if (!user) return false;
  const activeModules = user.active_modules ?? [];
  const permissions = user.permissions ?? [];
  return activeModules.includes('SALES') && (permissions.includes('*') || permissions.includes('sales.read'));
}

export function resolvePostAuthDestination(user: AuthUser | null, preferredPath?: string | null) {
  const sanitizedPreferredPath = preferredPath && !['/', '/login', '/select-organization'].includes(preferredPath)
    ? preferredPath
    : null;

  if (sanitizedPreferredPath) {
    if (!sanitizedPreferredPath.startsWith('/sales') || canAccessSales(user)) {
      return sanitizedPreferredPath;
    }
  }

  if (canAccessSales(user)) return '/sales';

  const permissions = user?.permissions ?? [];
  const hasPermission = (permission: string) => permissions.includes('*') || permissions.includes(permission);

  const fallbackRoutes: Array<{ path: string; permission: string | null }> = [
    { path: '/dashboard', permission: 'dashboard.read' },
    { path: '/activity', permission: 'activity.read' },
    { path: '/buildings', permission: 'buildings.read' },
    { path: '/rental-units', permission: 'units.read' },
    { path: '/tenants', permission: 'tenants.read' },
    { path: '/leases', permission: 'documents.read' },
    { path: '/invoices', permission: 'invoices.read' },
    { path: '/payments', permission: 'payments.read' },
    { path: '/cash', permission: 'cash.read' },
    { path: '/maintenance/dashboard', permission: 'maintenance.read' },
    { path: '/stock', permission: 'stock.read' },
    { path: '/reports', permission: 'reports.read' },
    { path: '/settings', permission: 'settings.read' },
    { path: '/profile', permission: null },
  ];

  const firstAllowed = fallbackRoutes.find((candidate) => !candidate.permission || hasPermission(candidate.permission));
  return firstAllowed?.path ?? '/unauthorized';
}

function readNumberStorageValue(key: string) {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function writeNumberStorageValue(key: string, value: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, String(Math.round(value)));
}

function writeOrganizationStorage(organizationId: number | null) {
  if (!organizationId) {
    localStorage.removeItem(appConfig.activeOrganizationStorageKey);
    return;
  }
  localStorage.setItem(appConfig.activeOrganizationStorageKey, String(organizationId));
}
