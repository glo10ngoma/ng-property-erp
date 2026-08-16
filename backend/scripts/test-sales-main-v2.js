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
  getOrganizationRow,
  assertInternalOrganization,
  getRealOrgModuleStates,
} = require('./sales-test-helpers');

function getOrganizations(user) {
  return Array.isArray(user?.organizations) ? user.organizations : [];
}

async function getSession(config) {
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
  const config = getConfig('main');
  const env = readEnvFile(config.envPath);
  ensureDatabaseTarget(env.DATABASE_URL, config);

  const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const created = { buyerId: null, projectId: null, catalogId: null };

  try {
    const orgRow = await getOrganizationRow(pool, config.enabledOrgId);
    assertInternalOrganization(orgRow, config.enabledOrgId, config.organizationName);

    const session = await getSession(config);
    const bootstrap = await request(config, 'GET', '/sales/bootstrap', session.token);
    assert.equal(bootstrap.status, 200, '/sales/bootstrap must succeed for the internal Sales test org');

    const buyerCreate = await request(config, 'POST', '/sales/buyers', session.token, {
      buyer_ref: `MAIN-IT-BUY-${Date.now()}`,
      buyer_type: 'INDIVIDUAL',
      full_name: 'INTERNAL TEST Buyer Main',
      phone: '+243810000777',
      city: 'Kinshasa',
      country: 'RDC',
      status: 'ACTIVE',
    });
    assert.ok(buyerCreate.status >= 200 && buyerCreate.status < 300, `Buyer create failed: ${buyerCreate.status} ${extractMessage(buyerCreate.body)}`);
    created.buyerId = buyerCreate.body?.id ?? null;

    const buyerUpdate = await request(config, 'PATCH', `/sales/buyers/${created.buyerId}`, session.token, {
      whatsapp: '+243810000778',
    });

    const projectCreate = await request(config, 'POST', '/sales/projects', session.token, {
      project_ref: `MAIN-IT-PRJ-${Date.now()}`,
      name: 'INTERNAL TEST Project Main',
      location_label: 'Kinshasa Centre',
      description: 'INTERNAL TEST project',
      status: 'ACTIVE',
    });
    assert.ok(projectCreate.status >= 200 && projectCreate.status < 300, `Project create failed: ${projectCreate.status} ${extractMessage(projectCreate.body)}`);
    created.projectId = projectCreate.body?.id ?? null;

    const projectUpdate = await request(config, 'PATCH', `/sales/projects/${created.projectId}`, session.token, {
      description: 'INTERNAL TEST project updated',
    });

    const catalogCreate = await request(config, 'POST', '/sales/catalog', session.token, {
      catalog_ref: `MAIN-IT-CAT-${Date.now()}`,
      property_type: 'APARTMENT',
      title: 'INTERNAL TEST Catalog Main',
      project_id: created.projectId,
      list_price: 150000,
      minimum_price: 145000,
      currency: 'USD',
      commercial_status: 'AVAILABLE',
      surface_area: 130,
      location_label: 'Kinshasa Centre',
    });
    assert.ok(catalogCreate.status >= 200 && catalogCreate.status < 300, `Catalog create failed: ${catalogCreate.status} ${extractMessage(catalogCreate.body)}`);
    created.catalogId = catalogCreate.body?.id ?? null;

    const catalogUpdate = await request(config, 'PATCH', `/sales/catalog/${created.catalogId}`, session.token, {
      minimum_price: 140000,
    });

    const settingsUpdate = await request(config, 'PATCH', '/sales/settings', session.token, {
      default_currency: 'USD',
      secondary_currency: 'CDF',
      quotation_prefix: 'SLS-IT',
    });

    const archiveBuyer = await request(config, 'PATCH', `/sales/buyers/${created.buyerId}/archive`, session.token);
    const archiveProject = await request(config, 'PATCH', `/sales/projects/${created.projectId}/archive`, session.token);
    const archiveCatalog = await request(config, 'PATCH', `/sales/catalog/${created.catalogId}/archive`, session.token);

    const verification = await pool.query(
      `SELECT
         (SELECT organization_id FROM sales_buyers WHERE id = $1) AS buyer_org_id,
         (SELECT organization_id FROM sales_projects WHERE id = $2) AS project_org_id,
         (SELECT organization_id FROM sales_property_catalog WHERE id = $3) AS catalog_org_id,
         (SELECT archived_at IS NOT NULL FROM sales_buyers WHERE id = $1) AS buyer_archived,
         (SELECT archived_at IS NOT NULL FROM sales_projects WHERE id = $2) AS project_archived,
         (SELECT archived_at IS NOT NULL FROM sales_property_catalog WHERE id = $3) AS catalog_archived`,
      [created.buyerId, created.projectId, created.catalogId],
    );

    const row = verification.rows[0];
    assert.equal(Number(row.buyer_org_id), config.enabledOrgId, 'Buyer escaped the internal test organization');
    assert.equal(Number(row.project_org_id), config.enabledOrgId, 'Project escaped the internal test organization');
    assert.equal(Number(row.catalog_org_id), config.enabledOrgId, 'Catalog item escaped the internal test organization');

    const realOrgStates = await getRealOrgModuleStates(pool);
    for (const realOrg of realOrgStates) {
      assert.equal(realOrg.sales_enabled, false, `${realOrg.name} must keep SALES disabled`);
    }

    console.log(JSON.stringify({
      mode: config.mode,
      projectRef: config.expectedProjectRef,
      organization: { id: orgRow.id, name: orgRow.name, slug: orgRow.slug },
      switched: session.switched,
      endpoints: {
        bootstrap: bootstrap.status,
        buyerCreate: buyerCreate.status,
        buyerUpdate: buyerUpdate.status,
        projectCreate: projectCreate.status,
        projectUpdate: projectUpdate.status,
        catalogCreate: catalogCreate.status,
        catalogUpdate: catalogUpdate.status,
        settingsUpdate: settingsUpdate.status,
        archiveBuyer: archiveBuyer.status,
        archiveProject: archiveProject.status,
        archiveCatalog: archiveCatalog.status,
      },
      created,
      verification: row,
      realOrganizations: realOrgStates,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});