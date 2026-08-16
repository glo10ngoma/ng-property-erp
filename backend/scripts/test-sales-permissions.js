const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolvePermissionsModule() {
  const candidates = [
    path.resolve(__dirname, '../dist/src/saas/permissions.js'),
    path.resolve(__dirname, '../dist/saas/permissions.js'),
    path.resolve(__dirname, '../src/saas/permissions.ts'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('Permissions module not found. Run the backend build first.');
}

function readTypeScriptFallback(sourcePath) {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const extract = (role) => {
    const blockMatch = text.match(new RegExp(`const\\s+${role}\\s*=\\s*\\[(.*?)\\];`, 's'));
    if (!blockMatch) throw new Error(`Unable to find ${role}`);
    return Array.from(blockMatch[1].matchAll(/'([^']+)'/g)).map((match) => match[1]);
  };
  const rolePermissionsBlock = text.match(/export const ROLE_PERMISSIONS:[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!rolePermissionsBlock) throw new Error('Unable to find ROLE_PERMISSIONS');
  if (!text.includes("ADMIN_CLIENT: ['*']")) {
    throw new Error('ADMIN_CLIENT must keep wildcard permission');
  }

  return {
    permissionSetForRole(role) {
      const map = {
        SALES_MANAGER: extract('salesManagerPermissions'),
        SALES_AGENT: extract('salesAgentPermissions'),
        SALES_ACCOUNTANT: extract('salesAccountantPermissions'),
        SALES_VIEWER: extract('salesViewerPermissions'),
        ADMIN_CLIENT: ['*'],
      };
      return map[String(role).toUpperCase()] ?? [];
    },
    PERMISSIONS: Array.from(text.matchAll(/'([^']+)'/g)).map((match) => match[1]),
  };
}

const modulePath = resolvePermissionsModule();
const permissionsModule = modulePath.endsWith('.ts')
  ? readTypeScriptFallback(modulePath)
  : require(modulePath);

const { permissionSetForRole, PERMISSIONS } = permissionsModule;

function assertHas(role, expected) {
  const permissionSet = permissionSetForRole(role);
  for (const permission of expected) {
    assert.ok(permissionSet.includes(permission), `${role} is missing ${permission}`);
  }
}

function assertMissing(role, unexpected) {
  const permissionSet = permissionSetForRole(role);
  for (const permission of unexpected) {
    assert.ok(!permissionSet.includes(permission), `${role} should not include ${permission}`);
  }
}

(function run() {
  assertHas('SALES_VIEWER', [
    'sales.read',
    'sales_buyers.read',
    'sales_projects.read',
    'sales_catalog.read',
    'sales_reports.read',
  ]);
  assertMissing('SALES_VIEWER', [
    'sales_buyers.create',
    'sales_buyers.update',
    'sales_catalog.archive',
    'sales.settings.manage',
  ]);

  assertHas('SALES_AGENT', [
    'sales.read',
    'sales_buyers.read',
    'sales_buyers.create',
    'sales_buyers.update',
    'sales_projects.read',
    'sales_catalog.read',
    'sales_reservations.read',
    'sales_reservations.create',
    'sales_contracts.read',
    'sales_contracts.create',
  ]);
  assertMissing('SALES_AGENT', [
    'sales_catalog.archive',
    'sales.settings.manage',
    'sales_reports.read',
  ]);

  assertHas('SALES_ACCOUNTANT', [
    'sales.read',
    'sales_buyers.read',
    'sales_projects.read',
    'sales_catalog.read',
    'sales_schedules.read',
    'sales_payments.read',
    'sales_recovery.read',
    'sales_reports.read',
  ]);
  assertMissing('SALES_ACCOUNTANT', [
    'sales_buyers.create',
    'sales_buyers.update',
    'sales_catalog.archive',
  ]);

  assertHas('SALES_MANAGER', [
    'sales.admin',
    'sales.settings.manage',
    'sales_buyers.archive',
    'sales_projects.archive',
    'sales_catalog.archive',
    'sales_payments.allocate',
    'sales_documents.download',
  ]);
  assert.ok(!permissionSetForRole('SALES_MANAGER').includes('*'), 'SALES_MANAGER must not be a wildcard role');
  assert.deepEqual(permissionSetForRole('ADMIN_CLIENT'), ['*'], 'ADMIN_CLIENT must remain unchanged');

  for (const permission of [
    'sales.read',
    'sales_buyers.read',
    'sales_projects.read',
    'sales_catalog.read',
    'sales_reports.read',
  ]) {
    assert.ok(PERMISSIONS.includes(permission), `PERMISSIONS catalog is missing ${permission}`);
  }

  console.log('SALES_PERMISSIONS_TESTS_OK');
})();
