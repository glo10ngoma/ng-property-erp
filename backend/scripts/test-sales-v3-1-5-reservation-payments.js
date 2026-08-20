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
  const migration = read('../database/20260819_sales_v3_1_5_reservation_payments.sql');
  includesAll(migration, [
    'ALTER TABLE sales_settings',
    'reservation_fee_enabled',
    'CREATE TABLE IF NOT EXISTS sales_reservation_payments',
    'CREATE TABLE IF NOT EXISTS sales_reservation_refunds',
    'CREATE TABLE IF NOT EXISTS sales_reservation_fee_allocations',
    'accounting_treatment_snapshot',
    'RESERVATION_PAYMENT',
    'RESERVATION_REFUND',
    'RESERVATION_RECEIPT',
  ], 'sales v3.1.5 migration');
  assert.ok(!/\bDROP\s+TABLE\b/i.test(migration), 'sales v3.1.5 migration must not drop tables');
  assert.ok(!/\bTRUNCATE\b/i.test(migration), 'sales v3.1.5 migration must not truncate data');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(migration), 'sales v3.1.5 migration must not delete data');

  const repository = read('src/sales/sales.repository.ts');
  includesAll(repository, [
    'listReservationPayments(',
    'findReservationPayment(',
    'createReservationPayment(',
    'createReservationRefund(',
    'createReservationFeeAllocation(',
    'getReservationPaymentReceiptContext(',
    'getReservationRefundReceiptContext(',
    'accounting_treatment_snapshot',
  ], 'sales repository v3.1.5');

  const service = read('src/sales/sales.service.ts');
  includesAll(service, [
    'async createReservationPayment(',
    'async cancelReservationPayment(',
    'async refundReservationPayment(',
    'async regenerateReservationPaymentReceipt(',
    'private async buildReservationFeeSummary(',
    'private async allocateReservationFeeToSubscription(',
    'SALES_RESERVATION_FEE',
    'PAYMENT_ALREADY_ALLOCATED',
    "Inversez d'abord l'allocation avant de rembourser.",
  ], 'sales service v3.1.5');

  const documents = read('src/sales/sales-documents.service.ts');
  includesAll(documents, [
    'RESERVATION_FEE_RECEIPT',
    'regenerateReservationFeeReceiptFromPayment(',
    'regenerateReservationFeeReceiptFromRefund(',
    'generateReservationFeeReceiptDocument(',
  ], 'sales documents v3.1.5');

  const controller = read('src/sales/sales.controller.ts');
  includesAll(controller, [
    "@Get('reservations/:id/payments')",
    "@Post('reservations/:id/payments')",
    "@Get('reservation-payments/:id')",
    "@Post('reservation-payments/:id/cancel')",
    "@Post('reservation-payments/:id/refunds')",
    "@Post('reservation-payments/:id/receipt/regenerate')",
  ], 'sales controller v3.1.5');

  const permissions = read('src/saas/permissions.ts');
  includesAll(permissions, [
    'sales_reservation_payments.read',
    'sales_reservation_payments.create',
    'sales_reservation_payments.cancel',
    'sales_reservation_payments.refund',
    'sales_reservation_receipts.read',
    'sales_reservation_receipts.generate',
  ], 'sales permissions v3.1.5');

  const api = read('../frontend/src/modules/sales/api/sales.api.ts');
  includesAll(api, [
    'createSalesReservationPayment(',
    'cancelSalesReservationPayment(',
    'createSalesReservationRefund(',
    'regenerateSalesReservationPaymentReceipt(',
  ], 'sales frontend api v3.1.5');
})();

console.log('SALES_V3_1_5_RESERVATION_PAYMENTS_TESTS_OK');
