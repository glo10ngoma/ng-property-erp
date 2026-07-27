import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { RequestContext } from '../auth/request-context';
import { formatInvoiceDocumentDate } from '../invoices/invoice-document-format';
import { InvoicePdfService } from '../invoices/invoice-pdf.service';
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
    private readonly invoicePdfService: InvoicePdfService,
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
    const document = await this.invoicePdfService.buildDocument(id);
    const invoice = document.invoice;
    const emailContent = this.getInvoiceEmailContent(invoice.invoice_type);
    return {
      documentType: DocumentType.INVOICE,
      documentId: id,
      recipientFallback: invoice.tenant_email,
      subjectFallback: emailContent.subject,
      attachmentFileName: `Facture_${invoice.invoice_number}.pdf`,
      templateName: 'invoice.html',
      templateVariables: {
        document_label: emailContent.title,
        main_text: emailContent.mainText,
        recipient_name: this.formatRecipientName(invoice),
        reference: String(invoice.invoice_number ?? ''),
        amount: this.money(invoice.total),
        due_date: this.formatDate(invoice.due_date),
        message_body: escapeHtml(this.normalizeInvoiceMessage(message, emailContent.mainText)),
      },
      pdfBuffer: document.pdfBuffer,
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
    return formatInvoiceDocumentDate(value);
  }

  private getInvoiceEmailContent(invoiceType?: string | null) {
    const normalized = String(invoiceType ?? 'RENT').trim().toUpperCase();
    if (normalized === 'RENT' || normalized === 'LOYER') {
      return {
        subject: 'Votre facture de loyer',
        title: 'Votre facture de loyer',
        mainText: 'Veuillez trouver ci-joint votre facture de loyer.',
      };
    }

    return {
      subject: 'Votre facture maintenance et des autres charges',
      title: 'Votre facture maintenance et des autres charges',
      mainText: 'Veuillez trouver ci-joint votre facture maintenance et des autres charges.',
    };
  }

  private formatRecipientName(invoice: Record<string, any>) {
    const name = String(invoice.tenant_name ?? '').trim();
    const civility = this.civilityLabel(invoice.tenant_civility);
    return [civility, name].filter(Boolean).join(' ') || name;
  }

  private civilityLabel(value?: string | null) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'MR') return 'Monsieur';
    if (normalized === 'MRS') return 'Madame';
    return this.cleanPrintValue(value);
  }

  private normalizeInvoiceMessage(value: string, fallback: string) {
    return String(value ?? '').trim() || fallback;
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
