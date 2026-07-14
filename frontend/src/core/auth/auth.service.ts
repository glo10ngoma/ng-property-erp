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
  persistSession(response.data.token, response.data.user);
  return response.data;
}

export async function me() {
  const response = await api.get<AuthUser & { organization_id: number }>('/auth/me');
  return response.data;
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

export function persistSession(token: string, user: AuthUser) {
  localStorage.setItem(appConfig.tokenStorageKey, token);
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
  if (user.organization_id) {
    localStorage.setItem(appConfig.activeOrganizationStorageKey, String(user.organization_id));
  }
  setAuthToken(token);
}

export function persistUser(user: AuthUser) {
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
  if (user.organization_id) {
    localStorage.setItem(appConfig.activeOrganizationStorageKey, String(user.organization_id));
  }
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
  if (!organizationId) {
    localStorage.removeItem(appConfig.activeOrganizationStorageKey);
    return;
  }
  localStorage.setItem(appConfig.activeOrganizationStorageKey, String(organizationId));
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
