const assert = require('node:assert/strict');
const { DocumentResolverService } = require('../dist/communication/document-resolver.service');
const { PaymentsService } = require('../dist/payments/payments.service');

async function main() {
  const resolver = new DocumentResolverService({}, {}, {});
  const html = resolver.renderPaymentReceiptPdfHtml({
    receipt_number: 'RCPT-2026-0001',
    payment_date: '2026-09-17',
    payment_method: 'CASH',
    amount: 100,
    amount_usd: 100,
    amount_cdf: 0,
    total_equivalent_usd: 100,
    invoice_items: [
      { invoice_number: 'INV-001', description: 'Loyer <septembre>', amount: 90 },
      { invoice_number: 'INV-001', description: 'Syndic', amount: 10 },
    ],
  });
  assert.match(html, /Détail de la facture/);
  assert.match(html, /Loyer &lt;septembre&gt;/);
  assert.match(html, /Syndic/);
  assert.doesNotMatch(html, /Loyer <septembre>/);

  const legacyHtml = resolver.renderPaymentReceiptPdfHtml({
    receipt_number: 'RCPT-LEGACY',
    payment_date: '2026-09-17',
    payment_method: 'CASH',
    amount: 100,
    invoice_items: [],
  });
  assert.doesNotMatch(legacyHtml, /Détail de la facture/);

  let queryParams;
  const payments = new PaymentsService(
    {
      query: async (_sql, params) => {
        queryParams = params;
        return { rows: [{ id: 1, invoice_id: 12, invoice_number: 'INV-012', description: 'Loyer', amount: 100 }] };
      },
    },
    {},
    {},
    {},
    {},
  );
  const items = await payments.loadInvoiceItemsForPayment(
    { invoice_id: 12 },
    [{ invoice_id: 12 }, { invoice_id: 13 }, { invoice_id: 0 }],
    5,
  );
  assert.deepEqual(queryParams, [[12, 13], 5]);
  assert.equal(items.length, 1);

  console.log('payment receipt invoice items: OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
