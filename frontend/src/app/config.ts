const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim();
const defaultApiBaseUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : 'https://ng-property-erp-production.up.railway.app';
const resolvedApiBaseUrl = (configuredApiBaseUrl || defaultApiBaseUrl).replace(/\/$/, '');

export const appConfig = {
  name: 'Property ERP',
  versionLabel: 'V1 SaaS locale',
  businessLabel: 'Gestion immobili\u00e8re',
  defaultRoute: '/activity',
  apiBaseUrl: `${resolvedApiBaseUrl}/api`,
  tokenStorageKey: 'property_erp_token',
  userStorageKey: 'property_erp_user',
};
