const assert = require('node:assert/strict');
const { Pool } = require('pg');
const {
  readEnvFile,
  getConfig,
  ensureDatabaseTarget,
  extractMessage,
  request,
  login,
  switchOrganization,
  setRoleCode,
  getOrganizationRow,
  assertInternalOrganization,
  getRealOrgModuleStates,
} = require('./sales-test-helpers');

function getOrganizations(user) {
  return Array.isArray(user?.organizations) ? user.organizations : [];
}

async function getSessionToken(config) {
  const loginPayload = await login(config);
  const loginUser = loginPayload?.user ?? {};
  const organizations = getOrganizations(loginUser);
  if (Number(loginUser.organization_id) === Number(config.enabledOrgId) && organizations.length === 1) {
    return { token: loginPayload.token, user: loginUser, switched: false };
  }
  const switched = await switchOrganization(config, loginPayload.token, config.enabledOrgId);
  return { token: switched.token, user: switched?.user ?? loginUser, switched: true };
}

async function run() {
  const config = getConfig();
  const env = readEnvFile(config.envPath);
  ensureDatabaseTarget(env.DATABASE_URL, config);

  const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    const orgRow = await getOrganizationRow(pool, config.enabledOrgId);
    assertInternalOrganization(orgRow, config.enabledOrgId, config.organizationName);

    const realOrgStates = await getRealOrgModuleStates(pool);
    assert.equal(realOrgStates.length, 2, 'Expected to find CATALYSE and Magic Construction');
    for (const row of realOrgStates) {
      assert.equal(row.sales_enabled, false, `${row.name} must keep SALES disabled`);
    }

    await setRoleCode(pool, config.enabledOrgId, config.email, 'VIEWER_CLIENT');
    let session = await getSessionToken(config);
    const noPermissionBootstrap = await request(config, 'GET', '/sales/bootstrap', session.token);
    const noPermissionModules = Array.isArray(session?.user?.active_modules) ? session.user.active_modules : [];
    const noPermissionPermissions = Array.isArray(session?.user?.permissions) ? session.user.permissions : [];

    await setRoleCode(pool, config.enabledOrgId, config.email, 'SALES_MANAGER');
    session = await getSessionToken(config);
    const allowedBootstrap = await request(config, 'GET', '/sales/bootstrap', session.token);
    const meResponse = await request(config, 'GET', '/auth/me', session.token);
    const meUser = meResponse.body?.user ?? meResponse.body ?? {};
    const allowedModules = Array.isArray(meUser?.active_modules) ? meUser.active_modules : [];
    const allowedPermissions = Array.isArray(meUser?.permissions) ? meUser.permissions : [];

    assert.equal(noPermissionBootstrap.status, 403, 'VIEWER_CLIENT must be denied on /sales/bootstrap');
    assert.ok(!noPermissionPermissions.includes('sales.read') && !noPermissionPermissions.includes('*'), 'VIEWER_CLIENT must not receive sales.read on the internal org');
    assert.equal(allowedBootstrap.status, 200, 'SALES_MANAGER must access /sales/bootstrap');
    assert.equal(meResponse.status, 200, '/auth/me must succeed for the internal org');
    assert.ok(allowedModules.includes('SALES'), 'The internal test org must expose SALES when the module is enabled');
    assert.ok(allowedPermissions.includes('sales.read') || allowedPermissions.includes('*'), 'SALES_MANAGER must receive sales.read or *');

    console.log(JSON.stringify({
      mode: config.mode,
      projectRef: config.expectedProjectRef,
      organization: { id: orgRow.id, name: orgRow.name, slug: orgRow.slug },
      enabledWithoutPermission: {
        roleCode: 'VIEWER_CLIENT',
        bootstrapStatus: noPermissionBootstrap.status,
        bootstrapCode: noPermissionBootstrap.body?.code ?? null,
        bootstrapMessage: extractMessage(noPermissionBootstrap.body),
      },
      enabledWithPermission: {
        roleCode: 'SALES_MANAGER',
        bootstrapStatus: allowedBootstrap.status,
        meStatus: meResponse.status,
        confirmedOrganizationId: meUser?.organization_id ?? null,
        organizationConfirmed: meUser?.organization_confirmed ?? null,
        activeModules: allowedModules,
        permissionsCount: allowedPermissions.length,
      },
      realOrganizations: realOrgStates,
    }, null, 2));
  } finally {
    try {
      await setRoleCode(pool, config.enabledOrgId, config.email, 'SALES_MANAGER');
    } catch {}
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});