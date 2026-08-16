const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const MAIN_REF = 'dtvteqlgpiwacmyxanrt';
const SANDBOX_REF = 'zogdhdirfskrujevfuuk';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3002/api';
const REAL_ORG_NAMES = ['CATALYSE', 'Magic Construction'];

function readEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value.replace(/^"(.*)"$/, '$1');
  }
  return result;
}

function getConfig(modeOverride) {
  const mode = modeOverride || process.env.SALES_TEST_MODE || 'sandbox';
  const defaultEnvPath = mode === 'main'
    ? path.resolve(__dirname, '../.env.sales-main-test')
    : path.resolve(__dirname, '../.env.sales-sandbox');
  return {
    mode,
    envPath: process.env.SALES_TEST_ENV_PATH || defaultEnvPath,
    apiBaseUrl: process.env.SALES_TEST_API_BASE_URL || DEFAULT_API_BASE_URL,
    expectedProjectRef: process.env.SALES_EXPECTED_PROJECT_REF || (mode === 'main' ? MAIN_REF : SANDBOX_REF),
    forbiddenProjectRef: process.env.SALES_FORBIDDEN_PROJECT_REF || (mode === 'main' ? SANDBOX_REF : MAIN_REF),
    email: process.env.SALES_TEST_EMAIL || (mode === 'main' ? 'sales.internal.test@test.local' : 'sales.sandbox.api@test.local'),
    password: process.env.SALES_SANDBOX_TEST_PASSWORD,
    enabledOrgId: Number(process.env.SALES_TEST_ENABLED_ORG_ID || (mode === 'main' ? 7 : 1)),
    organizationName: process.env.SALES_TEST_ORGANIZATION_NAME || (mode === 'main' ? 'SALES Internal Test' : 'SALES_SANDBOX_ENABLED'),
  };
}

function ensureDatabaseTarget(databaseUrl, config) {
  assert.ok(databaseUrl, 'DATABASE_URL is required');
  assert.ok(databaseUrl.includes(config.expectedProjectRef), `Refusing to run outside the expected project ${config.expectedProjectRef}`);
  assert.ok(!databaseUrl.includes(config.forbiddenProjectRef), `Refusing to run against forbidden project ${config.forbiddenProjectRef}`);
}

function extractMessage(body) {
  if (!body) return 'Unknown error';
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.message)) return body.message.join(' | ');
  if (typeof body.error === 'string') return body.error;
  return JSON.stringify(body);
}

async function request(config, method, endpoint, token, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function login(config) {
  assert.ok(config.password, 'SALES_SANDBOX_TEST_PASSWORD must be provided for Sales runtime tests.');
  const response = await request(config, 'POST', '/auth/login', undefined, {
    email: config.email,
    password: config.password,
  });
  assert.ok(response.status >= 200 && response.status < 300, `Login failed: ${response.status} ${extractMessage(response.body)}`);
  return response.body;
}

async function switchOrganization(config, token, organizationId) {
  const response = await request(config, 'POST', '/auth/switch-organization', token, { organizationId });
  assert.ok(response.status >= 200 && response.status < 300, `Switch failed: ${response.status} ${extractMessage(response.body)}`);
  return response.body;
}

async function setRoleCode(pool, organizationId, email, roleCode) {
  await pool.query(
    `UPDATE user_organizations
       SET role_code = $3, updated_at = NOW()
     WHERE organization_id = $1
       AND user_id = (SELECT id FROM app_users WHERE email = $2 LIMIT 1)`,
    [organizationId, email, roleCode],
  );
}

async function getOrganizationRow(pool, organizationId) {
  const result = await pool.query(
    `SELECT id, name, slug
       FROM organizations
      WHERE id = $1`,
    [organizationId],
  );
  return result.rows[0] || null;
}

function assertInternalOrganization(row, expectedId, expectedName) {
  assert.ok(row, `Organization ${expectedId} was not found`);
  assert.equal(Number(row.id), Number(expectedId), 'Unexpected organization id');
  assert.equal(row.name, expectedName, 'Unexpected organization name for Sales main tests');
  assert.ok(!REAL_ORG_NAMES.includes(row.name), 'Refusing to run Sales tests against a real organization');
}

async function getRealOrgModuleStates(pool) {
  const result = await pool.query(
    `SELECT o.id, o.name, COALESCE(om.is_enabled, false) AS sales_enabled
       FROM organizations o
       LEFT JOIN organization_modules om
         ON om.organization_id = o.id
        AND om.module_code = 'SALES'
      WHERE o.name IN ('CATALYSE', 'Magic Construction')
      ORDER BY o.id`,
  );
  return result.rows;
}

module.exports = {
  MAIN_REF,
  SANDBOX_REF,
  REAL_ORG_NAMES,
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
};