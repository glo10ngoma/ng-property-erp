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
  'leases.delete',
  'leases.trash.read',
  'leases.restore',
  'leases.hard_delete',
  'leases.archive',
  'leases.archives.read',
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
  'guarantee_cash.read',
  'guarantee_cash.create',
  'guarantee_cash.expense',
  'guarantee_cash.export',
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
  'leases.trash.read',
  'leases.archives.read',
  'invoices.read',
  'payments.read',
  'cash.read',
  'guarantee_cash.read',
  'guarantee_cash.export',
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
  SUPER_ADMIN: 'ADMIN',
  ADMIN: 'ADMIN',
  ADMIN_PLATFORM: 'ADMIN',
  ADMIN_CLIENT: 'ADMIN',
  EDITOR: 'EDITOR',
  EDITOR_CLIENT: 'EDITOR',
  VIEWER: 'VIEWER',
  VIEWER_CLIENT: 'VIEWER',
  ACCOUNTANT: 'EDITOR',
  STAFF: 'EDITOR',
  AGENT: 'EDITOR',
  GESTIONNAIRE: 'EDITOR',
  COMPTABLE: 'EDITOR',
  DIRECTOR: 'VIEWER',
  DIRECTEUR: 'VIEWER',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super administrateur',
  ADMIN: 'Administrateur plateforme',
  ADMIN_PLATFORM: 'Administrateur plateforme',
  ADMIN_CLIENT: 'Administrateur client',
  EDITOR: 'Utilisateur en écriture',
  EDITOR_CLIENT: 'Utilisateur en écriture',
  VIEWER: 'Lecture seule',
  VIEWER_CLIENT: 'Lecture seule',
  ACCOUNTANT: 'Utilisateur en écriture',
  STAFF: 'Utilisateur en écriture',
  AGENT: 'Utilisateur en écriture',
  GESTIONNAIRE: 'Utilisateur en écriture',
  COMPTABLE: 'Utilisateur en écriture',
  DIRECTOR: 'Lecture seule',
  DIRECTEUR: 'Lecture seule',
};

export function normalizeRole(role?: string | null): CanonicalRole {
  const candidate = String(role ?? '').toUpperCase();
  return ROLE_ALIASES[candidate] ?? 'VIEWER';
}

export function roleDisplayName(role?: string | null) {
  const value = String(role ?? '').toUpperCase();
  return ROLE_LABELS[value] ?? ROLE_LABELS[normalizeRole(role)];
}

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['*'],
  ADMIN_PLATFORM: ['*'],
  ADMIN_CLIENT: ['*'],
  EDITOR: editorPermissions,
  EDITOR_CLIENT: editorPermissions,
  VIEWER: viewerPermissions,
  VIEWER_CLIENT: viewerPermissions,
  ACCOUNTANT: editorPermissions,
  STAFF: editorPermissions,
  AGENT: editorPermissions,
  GESTIONNAIRE: editorPermissions,
  COMPTABLE: editorPermissions,
  DIRECTOR: viewerPermissions,
  DIRECTEUR: viewerPermissions,
};

export const PERMISSIONS = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat().filter((item) => item !== '*')));

export function permissionSetForRole(role?: string | null) {
  const value = String(role ?? '').toUpperCase();
  return ROLE_PERMISSIONS[value] ?? ROLE_PERMISSIONS[normalizeRole(role)] ?? [];
}

export function isPlatformRole(role?: string | null) {
  const value = String(role ?? '').toUpperCase();
  return value === 'SUPER_ADMIN' || value === 'ADMIN' || value === 'ADMIN_PLATFORM';
}
