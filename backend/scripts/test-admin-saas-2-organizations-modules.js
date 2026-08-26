const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function includesAll(source, needles, label) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label}: missing "${needle}"`);
  }
}

function main() {
  const backendRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(backendRoot, '..');

  const controller = read(backendRoot, 'src/saas/saas.controllers.ts');
  const service = read(backendRoot, 'src/saas/saas.service.ts');
  const dto = read(backendRoot, 'src/saas/settings.dto.ts');
  const permissions = read(backendRoot, 'src/saas/permissions.ts');
  const orgAccess = read(backendRoot, 'src/auth/organization-access.service.ts');
  const router = read(repoRoot, 'frontend/src/app/router.tsx');
  const pages = read(repoRoot, 'frontend/src/modules/platform/pages/PlatformPages.tsx');
  const sidebar = read(repoRoot, 'frontend/src/core/layout/PlatformSidebar.tsx');
  const migration = read(repoRoot, 'database/20260827_admin_saas_2_organizations_modules.sql');

  includesAll(
    dto,
    [
      'export class PlatformOrganizationListQueryDto',
      'export class SuspendPlatformOrganizationDto',
      'export class ReactivatePlatformOrganizationDto',
      'export class DisablePlatformOrganizationModuleDto',
      'PLATFORM_MODULE_CODES',
      'PLATFORM_ORGANIZATION_SORT_FIELDS',
    ],
    'admin saas 2 dto',
  );

  includesAll(
    permissions,
    [
      "'platform.modules.read'",
      "'platform.modules.manage'",
      "'platform.audit.read'",
    ],
    'admin saas 2 permissions',
  );

  includesAll(
    controller,
    [
      "organizationDetail(@Param('id', ParseIntPipe) id: number)",
      "suspendOrganization(@Param('id', ParseIntPipe) id: number, @Body() body: SuspendPlatformOrganizationDto)",
      "reactivateOrganization(@Param('id', ParseIntPipe) id: number, @Body() body: ReactivatePlatformOrganizationDto)",
      "organizationActivity(@Param('id', ParseIntPipe) id: number)",
      "@Get('modules')",
      "@Get('organizations/:id/modules')",
      "@Post('organizations/:id/modules/:code/enable')",
      "@Post('organizations/:id/modules/:code/disable')",
    ],
    'admin saas 2 controller',
  );

  includesAll(
    service,
    [
      'async platformOrganizationDetail(id: number)',
      'async platformOrganizationActivity(id: number)',
      'async platformModulesCatalog()',
      'async platformOrganizationModules(id: number)',
      'async platformSuspendOrganization(id: number, body: SuspendPlatformOrganizationDto)',
      'async platformReactivateOrganization(id: number, body: ReactivatePlatformOrganizationDto)',
      'async platformEnableOrganizationModule(id: number, code: string)',
      'async platformDisableOrganizationModule(id: number, code: string, body: DisablePlatformOrganizationModuleDto)',
      'private normalizePlatformModuleCode(value: string)',
      'private normalizeModuleDependencies(value: unknown)',
      'private async getPlatformModuleDefinition(moduleCode: string)',
      'private async ensurePlatformModuleExists(moduleCode: string)',
      'PLATFORM_MODULE_INACTIVE',
      'PLATFORM_MODULE_NOT_ASSIGNABLE',
      'PLATFORM_MODULE_DEPENDENCIES_MISSING',
      'PLATFORM_MODULE_DEPENDENTS_ACTIVE',
      'PLATFORM_MODULE_CORE_REQUIRED',
      'PLATFORM_MODULE_DISABLE_REASON_REQUIRED',
      'ORGANIZATION_MODULE_ENABLED',
      'ORGANIZATION_MODULE_DISABLED',
      'ORGANIZATION_SUSPENDED',
      'ORGANIZATION_REACTIVATED',
    ],
    'admin saas 2 service',
  );

  includesAll(
    orgAccess,
    [
      "this.isOrganizationAccessibleStatus(row.status)",
      "this.isOrganizationAccessibleStatus(fallbackOrganization.status)",
      "this.isOrganizationAccessibleStatus(row.status)",
      "normalized === 'ACTIVE' || normalized === 'TEST'",
      'throw this.organizationAccessDenied();',
    ],
    'admin saas 2 organization access',
  );

  includesAll(
    service,
    [
      'private isAccessibleOrganizationStatus(status: unknown)',
      "normalized === 'ACTIVE' || normalized === 'TEST'",
      '!this.isAccessibleOrganizationStatus(organization.status)',
    ],
    'admin saas 2 service accessible status',
  );

  includesAll(
    dto,
    [
      "['ACTIVE', 'TEST', 'SUSPENDED', 'INACTIVE', 'ARCHIVED']",
    ],
    'admin saas 2 dto TEST status',
  );

  includesAll(
    router,
    [
      'PlatformModulesPage',
      'PlatformOrganizationDetailPage',
      'path="organizations/:id"',
      'path="modules"',
    ],
    'admin saas 2 router',
  );

  includesAll(
    pages,
    [
      'export function PlatformOrganizationDetailPage()',
      'export function PlatformModulesPage()',
      '/platform/organizations/${organizationId}/modules',
      '/platform/organizations/${organizationId}/activity',
    ],
    'admin saas 2 platform pages',
  );

  includesAll(
    sidebar,
    [
      "/platform/modules",
      'label: \'Modules\'',
    ],
    'admin saas 2 platform sidebar',
  );

  includesAll(
    migration,
    [
      'CREATE TABLE IF NOT EXISTS modules_catalog',
      'icon TEXT NULL',
      'is_core BOOLEAN NOT NULL DEFAULT FALSE',
      'is_assignable BOOLEAN NOT NULL DEFAULT TRUE',
      "dependencies JSONB NOT NULL DEFAULT '[]'::jsonb",
      'modules_catalog_code_format_chk',
      'modules_catalog_sort_order_chk',
      'modules_catalog_dependencies_array_chk',
      'ALTER TABLE modules_catalog ENABLE ROW LEVEL SECURITY',
      'organization_modules_module_code_fk',
      "Unknown organization_modules.module_code values",
      'ALTER TABLE organizations',
      'ALTER TABLE organization_modules',
      'ON CONFLICT (code) DO NOTHING',
    ],
    'admin saas 2 migration',
  );

  assert(!/\bDROP\b/i.test(migration), 'migration must not contain DROP');
  assert(!/\bTRUNCATE\b/i.test(migration), 'migration must not contain TRUNCATE');
  assert(!/^\s*DELETE\s+/im.test(migration), 'migration must not contain DELETE statements');
  assert(!/GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON\s+modules_catalog/i.test(migration), 'migration must not grant public access on modules_catalog');
  assert(!/CREATE\s+POLICY/i.test(migration), 'migration must not create permissive policies on modules_catalog');
  assert(!/UPDATE\s+[a-z_]+\s+SET\s+[^\n;]+;/i.test(migration), 'migration must not contain broad UPDATE statements');

  console.log('test-admin-saas-2-organizations-modules: OK');
}

try {
  main();
} catch (error) {
  console.error('test-admin-saas-2-organizations-modules: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
