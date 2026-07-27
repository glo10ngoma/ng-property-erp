import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { RequestContext } from '../auth/request-context';
import { SaasService } from '../saas/saas.service';
import { InvoicesService } from './invoices.service';

export type InvoicePdfDocument = {
  invoice: Record<string, any>;
  pdfBuffer: Buffer;
  attachmentFileName: string;
  contentType: string;
};

@Injectable()
export class InvoicePdfService {
  private readonly pdfRenderer = new PdfRendererService();

  constructor(
    private readonly invoices: InvoicesService,
    private readonly db: DatabaseService,
    private readonly context: RequestContext,
    private readonly saasService: SaasService,
  ) {}

  async buildDocument(id: number): Promise<InvoicePdfDocument> {
    const invoice = await this.loadInvoiceDocument(id);
    const pdfBuffer = await this.pdfRenderer.renderA4Pdf(this.renderInvoicePdfHtml(invoice));
    return {
      invoice,
      pdfBuffer,
      attachmentFileName: `Facture_${invoice.invoice_number}.pdf`,
      contentType: 'application/pdf',
    };
  }

  private async loadInvoiceDocument(id: number): Promise<Record<string, any>> {
    const invoice = (await this.invoices.findOne(id)) as Record<string, any>;
    if (!invoice) {
      throw new NotFoundException('Facture introuvable');
    }

    const [{ rows: organizationRows }, companySettings] = await Promise.all([
      this.db.query(
        `SELECT id, name, slug
         FROM organizations
         WHERE id = $1 AND deleted_at IS NULL`,
        [this.context.organizationId()],
      ),
      this.saasService.companySettings(),
    ]);

    const organization = organizationRows[0] ?? {};
    const company = companySettings as Record<string, any>;

    return {
      ...invoice,
      tenant_email: invoice.email,
      organization_name: organization.name ?? invoice.organization_name ?? '',
      organization_slug: organization.slug ?? invoice.organization_slug ?? '',
      company_display_name: company.company_legal_name_resolved ?? company.company_legal_name ?? company.company_name ?? company.legal_name ?? '',
      company_legal_name: company.company_legal_name ?? '',
      legal_name: company.legal_name ?? '',
      company_name: company.company_name ?? '',
      company_address: company.company_address ?? '',
      address: company.address ?? '',
      company_phone: company.phone ?? '',
      company_email: company.email ?? '',
      logo_url: company.logo_file_url ?? company.logo_url ?? '',
      company_legal_name_resolved: company.company_legal_name_resolved ?? '',
      company_address_resolved: company.company_address_resolved ?? '',
    };
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
        <td>${escapeHtml(this.itemLabel(String(item.description ?? '-')))}</td>
        <td class="right">${this.money(item.amount)}</td>
      </tr>`).join('');
    const paymentRows = (invoice.payments ?? []).map((payment: Record<string, any>) => `
      <div class="compact-item">
        <span>${escapeHtml(String(payment.receipt_number ?? (String(payment.payment_type ?? '').toUpperCase() === 'TENANT_CREDIT_ALLOCATION' ? 'Paiement par crédit locataire' : 'Recu')))} - ${this.formatDate(payment.payment_date)} - ${escapeHtml(this.paymentMethodLabel(String(payment.payment_method ?? '-')))}</span>
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
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; padding: 0; background: #f4f7f9; }
    body { font-family: Arial, sans-serif; color: #172033; font-size: 12px; }
    .print-invoice { background: white; border: 1px solid #dce5eb; border-radius: 8px; padding: 18px; max-width: 1040px; margin: 0 auto; }
    .print-invoice header { display: grid; grid-template-columns: ${titleOnlyInvoiceHeader ? '1fr auto' : '48px 1fr auto'}; gap: 12px; align-items: start; border-bottom: 2px solid #203845; padding-bottom: 10px; }
    .print-invoice header h2 { margin: 0 0 4px; font-size: 18px; }
    .print-invoice header p { margin: 1px 0; font-size: 12px; color: #526a78; line-height: 1.25; }
    .print-invoice header.invoice-header-title-only { grid-template-columns: 1fr auto; }
    .invoice-title-only h2 { text-transform: uppercase; letter-spacing: .02em; }
    .invoice-logo { width: 48px; height: 48px; border-radius: 7px; display: grid; place-items: center; background: #203845; color: white; font-weight: 800; font-size: 15px; overflow: hidden; }
    .invoice-logo span { display: inline-grid; place-items: center; width: 100%; height: 100%; }
    .invoice-logo-image { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; display: block; background: white; }
    .invoice-meta { display: grid; gap: 5px; justify-items: end; font-size: 12px; text-align: right; }
    .invoice-meta strong { font-size: 14px; }
    .invoice-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
    .invoice-parties div { border: 1px solid #e1e8ed; border-radius: 8px; padding: 11px; }
    .invoice-parties span { color: #637783; display: block; margin-bottom: 6px; }
    .invoice-parties p { margin: 3px 0; font-size: 12px; color: #526a78; }
    .badge { display: inline-flex; align-items: center; min-height: 21px; border-radius: 999px; padding: 0 8px; font-size: 11px; font-weight: 700; background: #e8eef2; color: #425466; }
    .badge.paid { background: #e0f2e9; color: #1f7a4d; }
    .badge.partial { background: #fff0cf; color: #946200; }
    .badge.unpaid, .badge.overdue, .badge.cancelled { background: #fbe3e3; color: #a4343a; }
    .print-invoice table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .print-invoice th, .print-invoice td { padding: 6px 10px; border-bottom: 1px solid #edf1f4; text-align: left; vertical-align: middle; white-space: nowrap; font-size: 13.5px; }
    .print-invoice th { background: #f8fafb; color: #5a6d78; font-size: 11px; text-transform: uppercase; }
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
    .compact-empty { color: #637783; background: #f8fafb; border: 1px dashed #d6e0e6; border-radius: 6px; padding: 8px 10px; font-size: 13px; }
    .thanks { margin-top: 18px; color: #526a78; }
    .print-invoice tfoot td { font-weight: 900; font-size: 19px; border-top: 2px solid #dce5eb; }
    .print-invoice-footer { margin-top: 22px; text-align: center; font-size: 11px; color: #7a8d99; }
    .invoice-accordion-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }
    .invoice-accordion-grid details { border: 1px solid #dce5eb; border-radius: 6px; background: white; padding: 8px; }
    .invoice-accordion-grid summary { cursor: pointer; font-weight: 800; color: #255e7e; }
    .invoice-accordion-grid .compact-list { margin-top: 8px; max-height: 220px; }
    .print-invoice { border: 0; border-radius: 0; max-width: none; min-height: calc(100vh - 24mm); padding-bottom: 18mm; position: relative; }
    .print-invoice-footer { position: fixed; left: 0; right: 0; bottom: 0; margin: 0; text-align: center; font-size: 10px; color: #6b7f8b; background: white; }
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
        <span class="badge ${escapeHtml(String(invoice.status ?? '').toLowerCase())}">${escapeHtml(displayStatus)}</span>
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

  private money(value: number | string | null | undefined) {
    return `${Number(value ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $US`;
  }

  private formatDate(value?: string | null) {
    if (!value) return '';
    const [yearText, monthText, dayText] = String(value).slice(0, 10).split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return new Intl.DateTimeFormat('fr-FR').format(new Date(value));
    }
    return new Intl.DateTimeFormat('fr-FR').format(new Date(year, month - 1, day));
  }

  private periodLabel(month: number, year: number) {
    if (!month || !year) return '-';
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 0);
    return `${this.monthLabel(month)} ${year} (${this.formatDate(start.toISOString())} - ${this.formatDate(end.toISOString())})`;
  }

  private monthLabel(month: number) {
    const months = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
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
    if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
      return '';
    }
    return trimmed || '';
  }

  private isTitleOnlyInvoiceHeaderOrganization(slug?: string | null) {
    return ['catalyse', 'magic-construction'].includes(String(slug ?? '').trim().toLowerCase());
  }

  private companyDisplayName(row: Record<string, any>, organizationName?: string) {
    return (
      this.cleanPrintValue(row.company_legal_name)
      || this.cleanPrintValue(row.company_name)
      || this.cleanPrintValue(row.company_legal_name_resolved)
      || this.cleanPrintValue(row.legal_name)
      || this.cleanPrintValue(organizationName)
    );
  }

  private companyAddressLine(row: Record<string, any>) {
    return this.cleanPrintValue(row.company_address) || this.cleanPrintValue(row.company_address_resolved) || this.cleanPrintValue(row.address);
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

  private itemLabel(value: string) {
    return ({
      'Monthly rent': 'Loyer mensuel',
      Syndic: 'Syndic',
      Water: 'Eau',
      Electricity: 'Électricité',
      Maintenance: 'Maintenance',
      Parking: 'Parking',
      Internet: 'Internet',
      'Common charges': 'Charges communes',
      Other: 'Autres',
    } as Record<string, string>)[value] ?? value;
  }

  private paymentMethodLabel(value: string) {
    return ({
      CASH: 'Espèces',
      BANK: 'Banque',
      MOBILE_MONEY: 'Mobile Money',
      TENANT_CREDIT: 'Crédit locataire',
    } as Record<string, string>)[value] ?? value;
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
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
