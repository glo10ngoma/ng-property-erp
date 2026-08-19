const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

function includesAll(text, expected, label) {
  for (const item of expected) {
    assert.ok(text.includes(item), `${label} is missing: ${item}`);
  }
}

(function runStaticChecks() {
  const migration = read('../database/20260818_sales_v3_1_core.sql');
  includesAll(migration, [
    'CREATE TABLE IF NOT EXISTS sales_number_sequences',
    'ALTER TABLE sales_settings',
    'buyer_number_format',
    'subscription_contract_number_format',
    'CREATE TABLE IF NOT EXISTS sales_document_templates',
    'CREATE TABLE IF NOT EXISTS sales_document_generations',
  ], 'sales v3.1 migration');
  assert.ok(!/\bDROP\b/i.test(migration), 'sales v3.1 migration must remain additive');
  assert.ok(!/\bTRUNCATE\b/i.test(migration), 'sales v3.1 migration must not truncate data');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(migration), 'sales v3.1 migration must not delete data');

  const repository = read('src/sales/sales.repository.ts');
  includesAll(repository, [
    'nextSequenceValue(',
    'formatSequence(',
    'listDocumentTemplates(',
    'createDocumentGeneration(',
    'markDocumentGenerationSuccess(',
    'getReservationDocumentContext(',
    'getSubscriptionDocumentContext(',
  ], 'sales repository v3.1');

  const documents = read('src/sales/sales-documents.service.ts');
  includesAll(documents, [
    'class SalesDocumentsService',
    'RESERVATION_CONTRACT',
    'SUBSCRIPTION_CONTRACT',
    'generateContract(',
    'markDocumentGenerationFailure(',
    'SALES_DOCUMENT_TEMPLATE_INCOMPLETE',
    'renderTemplateMarkup(',
    'translateSubscriptionFrequency(',
  ], 'sales documents service');

  const service = read('src/sales/sales.service.ts');
  includesAll(service, [
    'generateReference(',
    'resolveSubscriptionSource(',
    'assertReservationAvailability(',
    'assertSubscriptionAvailability(',
    'SALES_PROPERTY_NOT_AVAILABLE',
    'generateReservationDocumentSafely(',
    'generateSubscriptionDocumentSafely(',
    'listDocumentTemplates(',
  ], 'sales service v3.1');

  const controller = read('src/sales/sales.controller.ts');
  includesAll(controller, [
    "@Get('settings/templates')",
    "@Post('settings/templates')",
    "@Get('reservations/:id/documents')",
    "@Post('reservations/:id/documents/regenerate')",
    "@Get('subscriptions/:id/documents')",
    "@Post('subscriptions/:id/documents/regenerate')",
    "@Get('documents/:id/download')",
  ], 'sales controller v3.1');

  const permissions = read('src/saas/permissions.ts');
  includesAll(permissions, [
    'sales_documents.read',
    'sales_documents.generate',
    'sales_documents.regenerate',
    'sales_templates.read',
    'sales_templates.manage',
  ], 'sales permissions v3.1');
})();

console.log('SALES_V3_1_CORE_TESTS_OK');
