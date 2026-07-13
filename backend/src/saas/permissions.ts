type CanonicalRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

const editorPermissions = [
  'dashboard.read',
  'activity.read',
  'buildings.read',
  'buildings.create',
  'buildings.update',
  'units.read',
  'units.create',
  'units.update',
  'tenants.read',
  'tenants.create',
  'tenants.update',
  'leases.read',
  'leases.create',
  'leases.update',
  'invoices.read',
  'invoices.create',
  'invoices.update',
  'payments.read',
  'payments.create',
  'payments.update',
  'cash.read',
  'cash.create',
  'cash.update',
  'cash.close',
  'stock.read',
  'stock.create',
  'stock.update',
  'stock.receive',
  'stock.inventory',
  'maintenance.read',
  'maintenance.create',
  'maintenance.update',
  'maintenance.assign',
  'maintenance.validate',
  'maintenance.close',
  'maintenance.report',
  'staff.read',
  'staff.create',
  'staff.update',
  'payroll.read',
  'payroll.create',
  'payroll.update',
  'documents.read',
  'documents.upload',
  'communication.read',
  'communication.send',
  'communication.logs.read',
  'notifications.read',
  'notifications.update',
  'automations.read',
  'reports.read',
  'reports.export',
  'workflow.read',
  'workflow.create',
  'workflow.approve',
  'workflow.reject',
];

const viewerPermissions = [
  'dashboard.read',
  'activity.read',
  'buildings.read',
  'units.read',
  'tenants.read',
  'leases.read',
  'invoices.read',
  'payments.read',
  'cash.read',
  'stock.read',
  'maintenance.read',
  'maintenance.report',
  'staff.read',
  'documents.read',
  'communication.read',
  'communication.logs.read',
  'notifications.read',
  'notifications.update',
  'automations.read',
  'reports.read',
  'reports.export',
  'settings.read',
  'reference_data.read',
  'publisher_settings.read',
  'workflow.read',
];

export const ROLE_ALIASES: Record<string, CanonicalRole> = {
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
  ACCOUNTANT: 'EDITOR',
  STAFF: 'EDITOR',
  AGENT: 'EDITOR',
  GESTIONNAIRE: 'EDITOR',
  COMPTABLE: 'EDITOR',
  DIRECTOR: 'VIEWER',
  DIRECTEUR: 'VIEWER',
};

export const ROLE_LABELS: Record<CanonicalRole, string> = {
  ADMIN: 'Administrateur',
  EDITOR: 'Utilisateur en écriture',
  VIEWER: 'Lecture seule',
};

export function normalizeRole(role?: string | null): CanonicalRole {
  const candidate = String(role ?? '').toUpperCase();
  return ROLE_ALIASES[candidate] ?? 'VIEWER';
}

export function roleDisplayName(role?: string | null) {
  return ROLE_LABELS[normalizeRole(role)];
}

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['*'],
  EDITOR: editorPermissions,
  VIEWER: viewerPermissions,
  ACCOUNTANT: editorPermissions,
  STAFF: editorPermissions,
  AGENT: editorPermissions,
  GESTIONNAIRE: editorPermissions,
  COMPTABLE: editorPermissions,
  DIRECTOR: viewerPermissions,
  DIRECTEUR: viewerPermissions,
};

export const PERMISSIONS = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat().filter((item) => item !== '*')));
