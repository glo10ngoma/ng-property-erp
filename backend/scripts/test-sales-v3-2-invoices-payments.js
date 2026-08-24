const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function includesAll(haystack, needles, context) {
  for (const needle of needles) {
    assert(haystack.includes(needle), `${context}: missing "${needle}"`);
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const migration = read(path.join(root, '..', 'database', '20260825_sales_v3_2_invoices_payments.sql'));
  const controller = read(path.join(root, 'src', 'sales', 'sales.controller.ts'));
  const service = read(path.join(root, 'src', 'sales', 'sales-financials.service.ts'));
  const guard = read(path.join(root, 'src', 'auth', 'permissions.guard.ts'));
  const permissions = read(path.join(root, 'src', 'saas', 'permissions.ts'));

  assert(!/\bDROP\s+TABLE\b/i.test(migration), 'migration must not contain DROP TABLE');
  assert(!/\bDROP\s+SCHEMA\b/i.test(migration), 'migration must not contain DROP SCHEMA');
  assert(!/\bDROP\s+COLUMN\b/i.test(migration), 'migration must not contain DROP COLUMN');
  assert(!/\bTRUNCATE\b/i.test(migration), 'migration must not contain TRUNCATE');
  assert(!/^\s*DELETE\s+/im.test(migration), 'migration must not contain DELETE statements');
  assert(!/^\s*UPDATE\s+/im.test(migration), 'migration must not contain UPDATE statements');

  includesAll(
    migration,
    [
      'CREATE TABLE IF NOT EXISTS sales_invoices',
      'CREATE TABLE IF NOT EXISTS sales_invoice_items',
      'CREATE TABLE IF NOT EXISTS sales_invoice_payments',
      'CREATE TABLE IF NOT EXISTS sales_invoice_payment_refunds',
      'organization_id',
      'sales_invoices_subscription_installment_active_unique',
      'sales_invoice_payments_idempotency_unique',
      'sales_invoice_payment_refunds_idempotency_unique',
      'ALTER TABLE sales_settings',
      'sales_invoice_number_format',
    ],
    'migration',
  );

  includesAll(
    controller,
    [
      "@Get('invoices')",
      "@Get('invoices/:id')",
      "@Post('subscriptions/:id/installments/:installmentId/invoice')",
      "@Post('invoices/:id/issue')",
      "@Post('invoices/:id/cancel')",
      "@Get('invoices/:id/payments')",
      "@Post('invoices/:id/payments')",
      "@Post('invoice-payments/:id/cancel')",
      "@Post('invoice-payments/:id/refunds')",
      "@Post('invoice-payments/:id/receipt/regenerate')",
      "@Get('subscriptions/:id/financial-summary')",
      "@Get('reports/outstanding')",
      "@Get('reports/overdue')",
    ],
    'controller',
  );

  includesAll(
    service,
    [
      'generateInvoice(',
      'issueInvoice(',
      'cancelInvoice(',
      'createInvoicePayment(',
      'cancelInvoicePayment(',
      'refundInvoicePayment(',
      'generateInvoiceDocument(',
      'generatePaymentReceipt(',
      'refreshInvoiceAggregates(',
      'const configuredInvoiceFormat = String(settings?.sales_invoice_number_format ?? \'\').trim();',
      'const legacyInvoicePrefix = String(settings?.invoice_prefix ?? \'\').trim();',
      "? `${legacyInvoicePrefix}-{YYYY}-{SEQ:5}`",
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
      'PAYMENT_EXCEEDS_BALANCE',
      'CASH_SESSION_CLOSED',
      'BANK_TRANSACTION_RECONCILED',
    ],
    'service',
  );

  assert(
    !service.includes("String(settings?.sales_invoice_number_format ?? settings?.invoice_prefix ?? 'FAC-VTE-{YYYY}-{SEQ:5}')"),
    'service must not use the legacy invoice prefix alone as a full invoice number fallback',
  );

  includesAll(
    guard,
    [
      'sales_invoices.read',
      'sales_invoices.create',
      'sales_invoices.update',
      'sales_invoices.cancel',
      'sales_invoices.send',
      'sales_payments.cancel',
      'sales_payments.refund',
      'sales_reports.balance',
    ],
    'permissions guard',
  );

  includesAll(
    permissions,
    [
      "'sales_invoices.read'",
      "'sales_invoices.create'",
      "'sales_invoices.update'",
      "'sales_invoices.cancel'",
      "'sales_invoices.send'",
      "'sales_payments.cancel'",
      "'sales_payments.refund'",
      "'sales_reports.balance'",
    ],
    'permissions registry',
  );

  console.log('test-sales-v3-2-invoices-payments: OK');
}

try {
  main();
} catch (error) {
  console.error('test-sales-v3-2-invoices-payments: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
