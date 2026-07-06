export const appConfig = {
  name: 'Property ERP',
  versionLabel: 'V1 SaaS locale',
  businessLabel: 'Gestion immobilière',
  defaultRoute: '/activity',
  apiBaseUrl: `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`,
  tokenStorageKey: 'property_erp_token',
  userStorageKey: 'property_erp_user',
};
