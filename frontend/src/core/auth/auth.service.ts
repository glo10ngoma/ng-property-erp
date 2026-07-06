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

export function persistSession(token: string, user: AuthUser) {
  localStorage.setItem(appConfig.tokenStorageKey, token);
  localStorage.setItem(appConfig.userStorageKey, JSON.stringify(user));
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
  setAuthToken(undefined);
}
