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
  activeOrganizationStorageKey: 'property_erp_active_organization',
  sessionStartedAtStorageKey: 'property_erp_session_started_at',
  sessionLastActivityStorageKey: 'property_erp_session_last_activity_at',
  organizationSelectionRequiredStorageKey: 'property_erp_organization_selection_required',
  sessionIdleWarningMinutes: Number(import.meta.env.VITE_SESSION_IDLE_WARNING_MINUTES ?? 10),
  sessionIdleTimeoutMinutes: Number(import.meta.env.VITE_SESSION_IDLE_TIMEOUT_MINUTES ?? 15),
  sessionAbsoluteTimeoutHours: Number(import.meta.env.VITE_SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 8),
};
