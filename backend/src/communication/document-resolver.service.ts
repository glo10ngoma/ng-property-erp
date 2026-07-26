import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { RequestContext } from '../auth/request-context';
import { DocumentType } from './shared/enums/document-type.enum';

export type ResolvedDocument = {
  documentType: DocumentType;
  documentId: number;
  recipientFallback?: string | null;
  subjectFallback: string;
  attachmentFileName: string;
  templateName: string;
  templateVariables: Record<string, string>;
  pdfBuffer: Buffer;
};

@Injectable()
export class DocumentResolverService {
  private readonly pdfRenderer = new PdfRendererService();

  constructor(
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
  ) {}

  async resolve(args: { documentType: DocumentType; documentId: number; message: string }) {
    switch (args.documentType) {
      case DocumentType.INVOICE:
        return this.resolveInvoice(args.documentId, args.message);
      case DocumentType.PAYMENT_RECEIPT:
        return this.resolvePaymentReceipt(args.documentId, args.message);
      case DocumentType.TENANT_CREDIT_RECEIPT:
        return this.resolveTenantCreditReceipt(args.documentId, args.message);
      case DocumentType.LEASE_CONTRACT:
      case DocumentType.MAINTENANCE_REPORT:
        throw new BadRequestException(`Document type not implemented yet: ${args.documentType}`);
      default:
        throw new BadRequestException(`Unsupported document type: ${String(args.documentType)}`);
    }
  }

  private async resolveInvoice(id: number, message: string): Promise<ResolvedDocument> {
    const invoice = await this.loadInvoiceDocument(id);
    return {
      documentType: DocumentType.INVOICE,
      documentId: id,
      recipientFallback: invoice.tenant_email,
      subjectFallback: `Votre facture ${invoice.invoice_number}`,
      attachmentFileName: `Facture_${invoice.invoice_number}.pdf`,
      templateName: 'invoice.html',
      templateVariables: {
        document_label: 'Facture de loyer',
        recipient_name: String(invoice.tenant_name ?? ''),
        reference: String(invoice.invoice_number ?? ''),
        amount: this.money(invoice.total),
        due_date: this.formatDate(invoice.due_date),
        message_body: escapeHtml(this.normalizeMessage(message)),
      },
      pdfBuffer: await this.pdfRenderer.renderA4Pdf(this.renderInvoicePdfHtml(invoice)),
    };
  }

  private async resolvePaymentReceipt(id: number, message: string): Promise<ResolvedDocument> {
    const payment = await this.loadPaymentDocument(id);
    return {
      documentType: DocumentType.PAYMENT_RECEIPT,
      documentId: id,
      recipientFallback: payment.tenant_email,
      subjectFallback: `Votre reçu de paiement ${payment.receipt_number}`,
      attachmentFileName: `Recu_${payment.receipt_number}.pdf`,
      templateName: 'payment_receipt.html',
      templateVariables: {
        document_label: 'Reçu de paiement',
        recipient_name: String(payment.tenant_name ?? ''),
        reference: String(payment.receipt_number ?? ''),
        amount: this.money(payment.total_equivalent_usd),
        due_date: this.formatDate(payment.payment_date),
        message_body: escapeHtml(this.normalizeMessage(message)),
      },
      pdfBuffer: await this.pdfRenderer.renderA4Pdf(this.renderPaymentReceiptPdfHtml(payment)),
    };
  }

  private async resolveTenantCreditReceipt(id: number, message: string): Promise<ResolvedDocument> {
    const credit = await this.loadTenantCreditDocument(id);
    return {
      documentType: DocumentType.TENANT_CREDIT_RECEIPT,
      documentId: id,
      recipientFallback: credit.tenant_email,
      subjectFallback: `Votre reçu de crédit locataire ${credit.receipt_number}`,
      attachmentFileName: `Recu_credit_${credit.receipt_number}.pdf`,
      templateName: 'tenant_credit_receipt.html',
      templateVariables: {
        document_label: 'Reçu de crédit locataire',
        recipient_name: String(credit.tenant_name ?? ''),
        reference: String(credit.receipt_number ?? ''),
        amount: credit.currency === 'CDF' ? this.moneyCdf(credit.original_amount) : this.money(credit.original_amount),
        due_date: this.formatDate(credit.payment_date),
        message_body: escapeHtml(this.normalizeMessage(message)),
      },
      pdfBuffer: await this.pdfRenderer.renderA4Pdf(this.renderTenantCreditReceiptPdfHtml(credit)),
    };
  }

  private async loadInvoiceDocument(id: number): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.month, i.year, i.billing_month, i.billing_year,
              i.period_start, i.period_end, i.total, i.status, i.invoice_type, i.generated_automatically, i.generation_source,
              i.discount_amount, i.public_notes, i.internal_notes, i.attachment_file_name, i.attachment_file_url,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, t.first_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.first_name, t.last_name, t.tenant_type, t.company_name, t.post_name, t.phone, t.email,
              b.name AS building_name,
              b.address AS building_address,
              b.city AS building_city,
              u.number AS unit_number,
              u.monthly_rent,
              u.monthly_syndic_amount AS unit_monthly_syndic_amount,
              l.start_date AS lease_start_date,
              l.end_date AS lease_end_date,
              l.monthly_rent AS lease_monthly_rent,
              l.maintenance_fee_amount,
              l.monthly_syndic_amount,
              COALESCE(l.lease_number, l.id) AS lease_number,
              COALESCE(s.paid_amount, 0)::FLOAT AS paid_amount,
              COALESCE(s.remaining_amount, i.total)::FLOAT AS remaining_amount,
              o.name AS organization_name,
              o.slug AS organization_slug,
              COALESCE(NULLIF(TRIM(cs.company_legal_name), ''), NULLIF(TRIM(cs.legal_name), ''), NULLIF(TRIM(cs.company_name), ''), NULLIF(TRIM(o.name), '')) AS company_display_name,
              COALESCE(NULLIF(TRIM(cs.company_address), ''), NULLIF(TRIM(cs.address), '')) AS company_address,
              NULLIF(TRIM(cs.phone), '') AS company_phone,
              NULLIF(TRIM(cs.email), '') AS company_email,
              COALESCE(NULLIF(TRIM(cs.logo_file_url), ''), NULLIF(TRIM(cs.logo_url), '')) AS logo_url
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN leases l ON l.id = i.lease_id
       LEFT JOIN units u ON u.id = COALESCE(i.unit_id, l.unit_id, t.unit_id)
       LEFT JOIN buildings b ON b.id = COALESCE(i.building_id, u.building_id)
       LEFT JOIN invoice_payment_summary s ON s.invoice_id = i.id
       LEFT JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN company_settings cs ON cs.organization_id = i.organization_id AND cs.deleted_at IS NULL
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('Facture introuvable');
    const items = await this.db.query(
      `SELECT description, item_type, amount
       FROM invoice_items
       WHERE invoice_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       ORDER BY id`,
      [id, this.context.organizationId()],
    );
    const payments = await this.db.query(
      `SELECT p.*
       FROM payments p
       WHERE p.invoice_id = $1
         AND p.organization_id = $2
         AND p.deleted_at IS NULL
       ORDER BY p.payment_date DESC, p.id DESC`,
      [id, this.context.organizationId()],
    );
    return { ...invoice, tenant_email: invoice.email, items: items.rows, payments: payments.rows };
  }

  private async loadPaymentDocument(id: number): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT p.id, p.payment_date, p.payment_method, p.reference, p.receipt_number,
              p.amount, p.amount_usd, p.amount_cdf, p.total_equivalent_usd,
              i.invoice_number,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, t.first_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.email AS tenant_email
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
       WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const payment = rows[0];
    if (!payment) throw new NotFoundException('Paiement introuvable');
    if (!payment.receipt_number) {
      throw new BadRequestException('Aucun reçu PDF n’est disponible pour ce paiement.');
    }
    return payment;
  }

  private async loadTenantCreditDocument(id: number): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT tc.id, tc.payment_date, tc.currency, tc.original_amount, tc.reference,
              p.receipt_number, p.payment_method,
              CASE WHEN t.tenant_type = 'COMPANY' THEN COALESCE(t.company_name, t.first_name, '')
                   ELSE TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', COALESCE(t.last_name, ''), ' ', COALESCE(t.post_name, '')))
              END AS tenant_name,
              t.email AS tenant_email,
              l.lease_number,
              u.number AS unit_number,
              b.name AS building_name
       FROM tenant_credits tc
       JOIN payments p ON p.id = tc.source_payment_id AND p.organization_id = tc.organization_id AND p.deleted_at IS NULL
       JOIN tenants t ON t.id = tc.tenant_id AND t.organization_id = tc.organization_id AND t.deleted_at IS NULL
       LEFT JOIN leases l ON l.id = tc.lease_id AND l.organization_id = tc.organization_id AND l.deleted_at IS NULL
       LEFT JOIN units u ON u.id = l.unit_id AND u.organization_id = tc.organization_id AND u.deleted_at IS NULL
       LEFT JOIN buildings b ON b.id = u.building_id AND b.organization_id = tc.organization_id AND b.deleted_at IS NULL
       WHERE tc.id = $1 AND tc.organization_id = $2 AND tc.deleted_at IS NULL`,
      [id, this.context.organizationId()],
    );
    const credit = rows[0];
    if (!credit) throw new NotFoundException('Crédit locataire introuvable');
    if (!credit.receipt_number) {
      throw new BadRequestException('Aucun reçu PDF n’est disponible pour ce crédit locataire.');
    }
    return credit;
  }

  private renderInvoicePdfHtml(invoice: Record<string, any>) {
    const isRentInvoice = String(invoice.invoice_type ?? 'RENT').toUpperCase() === 'RENT';
    const titleOnlyInvoiceHeader = this.isTitleOnlyInvoiceHeaderOrganization(String(invoice.organization_slug ?? null));
    const companyName = this.companyDisplayName(invoice, invoice.organization_name);
    const companyAddress = this.companyAddressLine(invoice);
    const companyContact = this.companyContactLine(invoice);
    const logoUrl = this.cleanPrintValue(invoice.logo_url);
    const invoicePrintTitle = isRentInvoice ? 'FACTURE LOYER' : 'FACTURE MAINTENANCE ET AUTRES CHARGES';
    const billingMonth = Number(invoice.billing_month ?? invoice.month);
    const billingYear = Number(invoice.billing_year ?? invoice.year);
    const issueMonthLabel = this.issueDateMonthLabel(invoice.issue_date);
    const issueMonthYearLabel = this.issueDateMonthYearLabel(invoice.issue_date);
    const issueYearLabel = this.issueDateYearLabel(invoice.issue_date);
    const displayStatus = this.clientInvoiceStatusLabel(String(invoice.status ?? ''));
    const creditAppliedAmount = (invoice.payments ?? [])
      .filter((payment: Record<string, any>) => String(payment.payment_type ?? '').toUpperCase() === 'TENANT_CREDIT_ALLOCATION')
      .reduce((sum: number, payment: Record<string, any>) => sum + Number(payment.amount ?? 0), 0);
    const rows = (invoice.items ?? []).map((item: Record<string, any>) => `
      <tr>
        <td>${escapeHtml(String(item.description ?? '-'))}</td>
        <td class="right">${this.money(item.amount)}</td>
      </tr>`).join('');
    const paymentRows = (invoice.payments ?? []).map((payment: Record<string, any>) => `
      <div class="compact-item">
        <span>${escapeHtml(String(payment.receipt_number ?? (String(payment.payment_type ?? '').toUpperCase() === 'TENANT_CREDIT_ALLOCATION' ? 'Paiement par crédit locataire' : 'Reçu')))} - ${this.formatDate(payment.payment_date)} - ${escapeHtml(String(payment.payment_method ?? '-'))}</span>
        <strong>${this.money(payment.amount)}</strong>
      </div>`).join('');
    const logoMarkup = logoUrl && /^https?:\/\//i.test(logoUrl)
      ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName ? `Logo ${companyName}` : 'Logo organisation')}" class="invoice-logo-image" />`
      : `<span>${escapeHtml(this.companyInitials(invoice, invoice.organization_name))}</span>`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 2.5cm; }
    html, body { margin: 0; padding: 0; background: #f4f7f9; }
    body { font-family: Arial, sans-serif; color: #172033; font-size: 12px; }
    .no-print { display: none !important; }
    .print-invoice { background: white; border: 1px solid #dce5eb; border-radius: 8px; padding: 18px; max-width: 1040px; margin: 0 auto; }
    .print-invoice header { display: grid; grid-template-columns: ${titleOnlyInvoiceHeader ? '1fr auto' : '48px 1fr auto'}; gap: 12px; align-items: start; border-bottom: 2px solid #203845; padding-bottom: 10px; }
    .print-invoice header h2 { margin: 0 0 4px; font-size: 18px; }
    .print-invoice header p { margin: 1px 0; font-size: 12px; color: #526a78; line-height: 1.25; }
    .print-invoice header.invoice-header-title-only { grid-template-columns: 1fr auto; }
    .invoice-title-only { width: 100%; }
    .invoice-title-only h2 { margin: 0; text-transform: uppercase; letter-spacing: .02em; }
    .invoice-logo { width: 48px; height: 48px; border-radius: 7px; display: grid; place-items: center; background: #203845; color: white; font-weight: 800; font-size: 15px; overflow: hidden; }
    .invoice-logo span { display: inline-grid; place-items: center; width: 100%; height: 100%; }
    .invoice-logo-image { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; display: block; background: white; }
    .invoice-meta { display: grid; gap: 5px; justify-items: end; font-size: 12px; text-align: right; }
    .invoice-meta strong { font-size: 14px; }
    .invoice-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
    .invoice-parties div { border: 1px solid #e1e8ed; border-radius: 8px; padding: 11px; }
    .invoice-parties span { color: #637783; display: block; margin-bottom: 6px; }
    .invoice-parties p { margin: 3px 0; font-size: 12px; color: #526a78; }
    .print-invoice table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .print-invoice th, .print-invoice td { border: 1px solid #d9dfeb; padding: 8px 10px; text-align: left; vertical-align: top; }
    .print-invoice th { background: #f6f8fc; }
    .print-invoice tbody tr:nth-child(even) { background: #f8fafb; }
    .print-invoice tbody td { border-bottom: 1px solid #edf1f4; }
    .right { text-align: right; }
    .summary-band { background: white; border: 1px solid #dde5ea; border-radius: 8px; padding: 7px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 14px; margin-bottom: 8px; }
    .summary-item { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; }
    .summary-item span { color: #637783; font-size: 11px; text-transform: uppercase; }
    .summary-item strong { color: #1f2933; font-size: 13px; font-weight: 800; overflow-wrap: anywhere; }
    .summary-item-wide { flex: 1 1 260px; }
    .compact-list { display: grid; gap: 6px; max-height: 260px; overflow: auto; }
    .compact-item { display: flex; justify-content: space-between; gap: 10px; border: 1px solid #e1e8ed; border-radius: 6px; padding: 7px 9px; }
    .thanks { margin-top: 18px; color: #526a78; }
    .print-invoice tfoot td { font-weight: 900; font-size: 19px; border-top: 2px solid #dce5eb; }
    .print-invoice-footer { margin-top: 22px; text-align: center; font-size: 11px; color: #7a8d99; }
    .invoice-accordion-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }
    .invoice-accordion-grid details { border: 1px solid #dce5eb; border-radius: 6px; background: white; padding: 8px; }
    .invoice-accordion-grid summary { cursor: pointer; font-weight: 800; color: #255e7e; }
    .invoice-accordion-grid .compact-list { margin-top: 8px; max-height: 220px; }
    @media print {
      .print-invoice { border: 0; border-radius: 0; max-width: none; min-height: calc(100vh - 24mm); padding-bottom: 18mm; position: relative; }
      .print-invoice-footer { position: fixed; left: 0; right: 0; bottom: 0; margin: 0; text-align: center; font-size: 10px; color: #6b7f8b; background: white; }
    }
  </style>
</head>
<body>
  <article class="print-invoice">
    <header class="${titleOnlyInvoiceHeader ? 'invoice-header-title-only' : ''}">
      ${
        titleOnlyInvoiceHeader
          ? `
            <div class="invoice-title-only">
              <h2>${escapeHtml(invoicePrintTitle)}</h2>
            </div>
          `
          : `
            <div class="invoice-logo">
              ${logoMarkup}
            </div>
            <div>
              <h2>${escapeHtml(companyName || '—')}</h2>
              ${companyAddress ? `<p>${escapeHtml(companyAddress)}</p>` : ''}
              ${companyContact ? `<p>${escapeHtml(companyContact)}</p>` : ''}
            </div>
          `
      }
      <div class="invoice-meta">
        <strong>Facture ${escapeHtml(String(invoice.invoice_number ?? '-'))}</strong>
        <span>Date: ${this.formatDate(invoice.issue_date)}</span>
        <span>Echeance: ${this.formatDate(invoice.due_date)}</span>
        ${isRentInvoice ? `<span>Periode: ${escapeHtml(this.periodLabel(billingMonth, billingYear))}</span>` : `<span>Mois de facture: ${escapeHtml(issueMonthYearLabel)}</span>`}
        <span>${escapeHtml(displayStatus)}</span>
      </div>
    </header>

    <div class="summary-band no-print">
      <div class="summary-item"><span>Date de facture</span><strong>${this.formatDate(invoice.issue_date)}</strong></div>
      <div class="summary-item"><span>Date d'echeance</span><strong>${this.formatDate(invoice.due_date)}</strong></div>
      <div class="summary-item"><span>Type</span><strong>${escapeHtml(this.invoiceTypeLabel(invoice.invoice_type))}</strong></div>
      ${isRentInvoice ? `<div class="summary-item"><span>Mois du loyer</span><strong>${escapeHtml(this.monthLabel(billingMonth))}</strong></div>` : `<div class="summary-item"><span>Mois de facture</span><strong>${escapeHtml(issueMonthLabel)}</strong></div>`}
      ${isRentInvoice ? `<div class="summary-item"><span>Annee du loyer</span><strong>${billingYear}</strong></div>` : `<div class="summary-item"><span>Annee de facture</span><strong>${escapeHtml(issueYearLabel)}</strong></div>`}
      <div class="summary-item"><span>Email</span><strong>${escapeHtml(String(invoice.email_delivery_status ?? 'NON ENVOYE').toUpperCase())}</strong></div>
      <div class="summary-item"><span>WhatsApp</span><strong>${escapeHtml(String(invoice.whatsapp_delivery_status ?? 'NON ENVOYE').toUpperCase())}</strong></div>
      ${isRentInvoice ? `<div class="summary-item summary-item-wide"><span>Periode facturee</span><strong>${escapeHtml(this.periodLabel(billingMonth, billingYear))}</strong></div>` : ''}
      <div class="summary-item"><span>Réglé par crédit</span><strong>${this.money(creditAppliedAmount)}</strong></div>
      <div class="summary-item"><span>Solde restant</span><strong>${this.money(invoice.remaining_amount)}</strong></div>
      <div class="summary-item summary-item-wide"><span>Origine</span><strong>${escapeHtml(String(invoice.generated_automatically ? 'Generation automatique de fin de mois' : 'Creation manuelle'))}</strong></div>
    </div>

    <div class="invoice-parties">
      <div>
        <span>Locataire</span>
        <strong>${escapeHtml(String(invoice.tenant_name || `${String(invoice.first_name ?? '').trim()} ${String(invoice.last_name ?? '').trim()}`.trim()))}</strong>
        <p>Telephone: ${escapeHtml(String(invoice.phone || '-'))}</p>
        <p>Email: ${escapeHtml(String(invoice.email || '-'))}</p>
        <p>Reference client: CL-${String(invoice.tenant_id ?? invoice.id).padStart(4, '0')}</p>
        <p>Type: ${escapeHtml(String(invoice.tenant_type === 'COMPANY' ? 'Societe' : 'Personne physique'))}</p>
      </div>
      <div>
        <span>Appartement</span>
        <strong>${escapeHtml(String(invoice.unit_number || '-'))}</strong>
        <p>Bail: ${invoice.lease_id ? escapeHtml(this.formatLeaseReference(invoice.lease_number, invoice.lease_id)) : '-'}</p>
        <p>Immeuble: ${escapeHtml(String(invoice.building_name || '-'))}</p>
        <p>Appartement: ${escapeHtml(String(invoice.unit_number || '-'))}</p>
        <p>Adresse: ${escapeHtml([invoice.building_address, invoice.building_city].filter(Boolean).join(', ') || '-')}</p>
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="right">Montant</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2">Aucune ligne.</td></tr>'}</tbody>
      <tfoot>
        ${Number(invoice.discount_amount ?? 0) > 0 ? `<tr><td>Remise</td><td class="right">- ${this.money(invoice.discount_amount)}</td></tr>` : ''}
        <tr><td>Total</td><td class="right">${this.money(invoice.total)}</td></tr>
      </tfoot>
    </table>

    <div class="compact-list">
      <div class="compact-item"><span>Montant réglé par crédit</span><strong>${this.money(creditAppliedAmount)}</strong></div>
      <div class="compact-item"><span>Solde restant</span><strong>${this.money(invoice.remaining_amount)}</strong></div>
    </div>

    ${invoice.public_notes ? `<p class="thanks">${escapeHtml(String(invoice.public_notes))}</p>` : ''}
    <p class="thanks">Merci pour votre confiance.</p>
    <footer class="print-invoice-footer">Powered by Property ERP</footer>

    <div class="no-print">
      <div class="invoice-accordion-grid">
        <details>
          <summary>Paiements (${Array.isArray(invoice.payments) ? invoice.payments.length : 0})</summary>
          <div class="compact-list">
            ${paymentRows || '<div class="compact-empty">Aucun paiement enregistre.</div>'}
          </div>
        </details>
        <details>
          <summary>Notes</summary>
          <div class="compact-list">
            ${invoice.internal_notes ? `<div class="compact-item"><span>Notes internes</span><strong>${escapeHtml(String(invoice.internal_notes))}</strong></div>` : '<div class="compact-empty">Aucune note interne.</div>'}
          </div>
        </details>
      </div>
    </div>
  </article>
</body>
</html>`;
  }

  private renderPaymentReceiptPdfHtml(payment: Record<string, any>) {
    return this.renderPdfShell(`Reçu ${payment.receipt_number}`, `
      <div class="meta">Date: ${this.formatDate(payment.payment_date)} | Mode: ${escapeHtml(String(payment.payment_method ?? '-'))}</div>
      <div class="grid">
        <div class="card"><span class="label">Locataire</span><strong>${escapeHtml(String(payment.tenant_name ?? '-'))}</strong><div>${escapeHtml(String(payment.tenant_email ?? '-'))}</div></div>
        <div class="card"><span class="label">Référence</span><strong>${escapeHtml(String(payment.reference ?? payment.receipt_number ?? '-'))}</strong><div>Facture ${escapeHtml(String(payment.invoice_number ?? '-'))}</div></div>
      </div>
      <table>
        <thead><tr><th>Document</th><th>Devise</th><th class="right">Montant</th></tr></thead>
        <tbody>
          <tr><td>Montant payé (USD)</td><td>USD</td><td class="right">${this.money(payment.amount_usd ?? payment.amount)}</td></tr>
          <tr><td>Montant payé (CDF)</td><td>CDF</td><td class="right">${this.moneyCdf(payment.amount_cdf)}</td></tr>
          <tr><td>Équivalent total</td><td>USD</td><td class="right">${this.money(payment.total_equivalent_usd ?? payment.amount)}</td></tr>
        </tbody>
      </table>
    `);
  }

  private renderTenantCreditReceiptPdfHtml(credit: Record<string, any>) {
    return this.renderPdfShell(`Reçu crédit locataire ${credit.receipt_number}`, `
      <div class="meta">Date: ${this.formatDate(credit.payment_date)} | Mode: ${escapeHtml(String(credit.payment_method ?? '-'))}</div>
      <div class="grid">
        <div class="card"><span class="label">Locataire</span><strong>${escapeHtml(String(credit.tenant_name ?? '-'))}</strong><div>${escapeHtml(String(credit.tenant_email ?? '-'))}</div></div>
        <div class="card"><span class="label">Bail</span><strong>${escapeHtml(String(credit.lease_number ?? '-'))}</strong><div>${escapeHtml(String(credit.building_name ?? '-'))} - ${escapeHtml(String(credit.unit_number ?? '-'))}</div></div>
      </div>
      <table>
        <thead><tr><th>Référence</th><th>Devise</th><th class="right">Montant</th></tr></thead>
        <tbody>
          <tr><td>${escapeHtml(String(credit.reference ?? credit.receipt_number ?? '-'))}</td><td>${escapeHtml(String(credit.currency ?? 'USD'))}</td><td class="right">${credit.currency === 'CDF' ? this.moneyCdf(credit.original_amount) : this.money(credit.original_amount)}</td></tr>
        </tbody>
      </table>
    `);
  }

  private renderPdfShell(title: string, content: string) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 2.5cm; }
    body { font-family: Arial, sans-serif; color: #172033; font-size: 12px; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    h2 { font-size: 13px; margin: 24px 0 8px; }
    .meta { color: #5b6476; margin-bottom: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
    .card { border: 1px solid #d9dfeb; border-radius: 8px; padding: 14px; }
    .label { display: block; font-size: 11px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d9dfeb; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f6f8fc; }
    .right { text-align: right; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${content}
</body>
</html>`;
  }

  private money(value: number | string | null | undefined) {
    return `${Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $US`;
  }

  private moneyCdf(value: number | string | null | undefined) {
    return `${Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} CDF`;
  }

  private formatDate(value?: string | null) {
    if (!value) return '-';
    return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  }

  private periodLabel(month: number, year: number) {
    const months = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    const normalizedMonth = Number(month) >= 1 && Number(month) <= 12 ? Number(month) : 1;
    return `${months[normalizedMonth - 1]} ${Number(year) || new Date().getFullYear()}`;
  }

  private monthLabel(month: number) {
    const months = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    const normalizedMonth = Number(month) >= 1 && Number(month) <= 12 ? Number(month) : 1;
    return months[normalizedMonth - 1];
  }

  private issueDateMonthLabel(value?: string | null) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'Africa/Kinshasa' });
  }

  private issueDateMonthYearLabel(value?: string | null) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });
  }

  private issueDateYearLabel(value?: string | null) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('fr-FR', { year: 'numeric', timeZone: 'Africa/Kinshasa' });
  }

  private cleanPrintValue(value?: string | null) {
    const trimmed = String(value ?? '').trim();
    return trimmed || '';
  }

  private isTitleOnlyInvoiceHeaderOrganization(slug?: string | null) {
    return ['catalyse', 'magic-construction'].includes(String(slug ?? '').trim().toLowerCase());
  }

  private companyDisplayName(row: Record<string, any>, organizationName?: string) {
    return (
      this.cleanPrintValue(row.company_display_name)
      || this.cleanPrintValue(row.company_legal_name)
      || this.cleanPrintValue(row.legal_name)
      || this.cleanPrintValue(row.company_name)
      || this.cleanPrintValue(organizationName)
    );
  }

  private companyAddressLine(row: Record<string, any>) {
    return this.cleanPrintValue(row.company_address) || this.cleanPrintValue(row.address);
  }

  private companyContactLine(row: Record<string, any>) {
    const parts = [this.cleanPrintValue(row.company_phone), this.cleanPrintValue(row.company_email)].filter(Boolean);
    return parts.join(' | ');
  }

  private companyInitials(row: Record<string, any>, organizationName?: string) {
    const label = this.companyDisplayName(row, organizationName);
    if (!label) return '—';
    const parts = label.split(/\s+/).filter(Boolean).slice(0, 2);
    const initials = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
    return initials || label.slice(0, 2).toUpperCase();
  }

  private invoiceTypeLabel(type?: string) {
    const normalized = String(type ?? 'OTHER').toUpperCase();
    if (normalized === 'RENT') return 'Facture de loyer';
    return 'Facture autres charges';
  }

  private clientInvoiceStatusLabel(status: string) {
    return ({
      PAID: 'Facture acquittée',
      PARTIAL: 'Paiement partiel',
      UNPAID: 'À payer',
      OVERDUE: 'En retard',
      DRAFT: 'Brouillon',
      CANCELLED: 'Annulée',
    } as Record<string, string>)[String(status ?? '').toUpperCase()] ?? String(status ?? '-');
  }

  private formatLeaseReference(leaseNumber?: unknown, fallbackId?: unknown): string {
    const normalizedLeaseNumber = Number(leaseNumber);
    if (Number.isInteger(normalizedLeaseNumber) && normalizedLeaseNumber > 0) {
      return `B-${String(normalizedLeaseNumber).padStart(5, '0')}`;
    }

    const normalizedFallbackId = Number(fallbackId);
    if (Number.isInteger(normalizedFallbackId) && normalizedFallbackId > 0) {
      return `B-${String(normalizedFallbackId).padStart(5, '0')}`;
    }

    return 'Bail sans reference';
  }

  private normalizeMessage(value: string) {
    return String(value ?? '').trim() || 'Veuillez trouver ci-joint votre document.';
  }
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
