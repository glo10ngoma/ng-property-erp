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
  const response = await api.post<AuthUser & { organization_id: number }>('/auth/switch-organization', {
    organizationId,
  });
  return response.data;
}

export function persistSession(token: string, user: AuthUser) {
  localStorage.setItem(appConfig.tokenStorageKey, token);
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
  if (user.organization_id) {
    localStorage.setItem(appConfig.activeOrganizationStorageKey, String(user.organization_id));
  }
  setAuthToken(token);
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
