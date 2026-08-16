const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function includesAll(text, expected, label) {
  for (const item of expected) {
    assert.ok(text.includes(item), `${label} is missing: ${item}`);
  }
}

(function run() {
  const migrationFlags = read('../database/20260815_organization_modules.sql');
  includesAll(migrationFlags, [
    'CREATE TABLE IF NOT EXISTS organization_modules',
    'module_code',
    'is_enabled BOOLEAN NOT NULL DEFAULT FALSE',
    'UNIQUE (organization_id, module_code)',
  ], 'organization_modules migration');
  assert.ok(!/\bINSERT\b/i.test(migrationFlags), 'organization_modules migration must not seed organizations');
  assert.ok(!/\bDROP\b/i.test(migrationFlags), 'organization_modules migration must be additive');

  const foundations = read('../database/20260815_sales_v1_foundations.sql');
  includesAll(foundations, [
    'CREATE TABLE IF NOT EXISTS sales_settings',
    'CREATE TABLE IF NOT EXISTS sales_buyers',
    'CREATE TABLE IF NOT EXISTS sales_projects',
    'CREATE TABLE IF NOT EXISTS sales_property_catalog',
    'CREATE TABLE IF NOT EXISTS sales_audit_events',
  ], 'sales foundations migration');
  assert.ok(!/\bDROP\b/i.test(foundations), 'sales foundations migration must not drop objects');
  assert.ok(!/\bTRUNCATE\b/i.test(foundations), 'sales foundations migration must not truncate data');

  const permissions = read('src/saas/permissions.ts');
  includesAll(permissions, [
    'sales.read',
    'sales.admin',
    'sales.settings.manage',
    'sales_buyers.archive',
    'sales_projects.archive',
    'sales_catalog.archive',
  ], 'permissions catalog');

  const guard = read('src/auth/permissions.guard.ts');
  includesAll(guard, [
    'MODULE_NOT_ENABLED',
    'ORGANIZATION_MODULE_METADATA_KEY',
    '/^\\/api\\/sales(?:\\/|$)/',
  ], 'permissions guard');

  const repository = read('src/sales/sales.repository.ts');
  const scopedQueries = (repository.match(/organization_id = \$[0-9]+/g) ?? []).length;
  assert.ok(scopedQueries >= 10, 'sales repository must scope operations by organization_id');

  console.log('SALES_FOUNDATIONS_TESTS_OK');
})();
