import axios from 'axios';
import { appConfig } from '../../app/config';

export const api = axios.create({
  baseURL: appConfig.apiBaseUrl,
});

export function setAuthToken(token?: string) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(appConfig.tokenStorageKey);
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  const activeOrganizationId = localStorage.getItem(appConfig.activeOrganizationStorageKey);
  if (activeOrganizationId) {
    config.headers['x-organization-id'] = activeOrganizationId;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      localStorage.removeItem(appConfig.tokenStorageKey);
      localStorage.removeItem(appConfig.userStorageKey);
      localStorage.removeItem(appConfig.activeOrganizationStorageKey);
      localStorage.removeItem(appConfig.sessionStartedAtStorageKey);
      localStorage.removeItem(appConfig.sessionLastActivityStorageKey);
      localStorage.removeItem(appConfig.organizationSelectionRequiredStorageKey);
      window.dispatchEvent(new CustomEvent('property-erp:auth-error', { detail: { status } }));
    }
    return Promise.reject(error);
  },
);
