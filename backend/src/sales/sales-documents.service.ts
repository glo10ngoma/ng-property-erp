import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { SalesRepository } from './sales.repository';
import type { SalesDocumentTemplateDto, UpdateSalesDocumentTemplateDto } from './dto';

type SalesDocumentEntityType = 'RESERVATION' | 'SUBSCRIPTION';
type SalesTemplateType = 'RESERVATION_CONTRACT' | 'SUBSCRIPTION_CONTRACT';

const TEMPLATE_INCOMPLETE_CODE = 'SALES_DOCUMENT_TEMPLATE_INCOMPLETE';
const TRUSTED_HTML_VARIABLES = new Set(['installments.table', 'organization.contact_block']);
const ALLOWED_TEMPLATE_TAGS = new Set([
  'a', 'article', 'br', 'div', 'em', 'footer', 'h1', 'h2', 'h3', 'h4', 'header', 'hr',
  'li', 'ol', 'p', 'section', 'small', 'span', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
]);
const ALLOWED_TEMPLATE_ATTRIBUTES = new Set(['class', 'colspan', 'href', 'rel', 'rowspan', 'scope', 'target']);
const SUBSCRIPTION_ORIGIN_LABELS: Record<string, string> = {
  DIRECT: 'Souscription directe',
  RESERVATION: 'Issue d’une réservation',
};
const SUBSCRIPTION_FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
  CUSTOM: 'Personnalisée',
};
const RESERVATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  CONFIRMED: 'Confirmée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
  CONVERTED: 'Convertie',
};
const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  SUBMITTED: 'Soumise',
  APPROVED: 'Approuvée',
  REJECTED: 'Rejetée',
  CANCELLED: 'Annulée',
  CONVERTED: 'Convertie',
};

const AVAILABLE_VARIABLES: Record<SalesTemplateType, string[]> = {
  RESERVATION_CONTRACT: [
    'organization.name',
    'organization.address',
    'organization.phone',
    'organization.email',
    'organization.legal_name',
    'organization.contact_block',
    'organization.party_summary',
    'organization.tax_number',
    'buyer.number',
    'buyer.name',
    'buyer.phone',
    'buyer.email',
    'buyer.address',
    'buyer.identity_number',
    'buyer.party_summary',
    'project.number',
    'project.name',
    'project.location',
    'property.number',
    'property.title',
    'property.type',
    'property.location',
    'property.surface',
    'property.designation',
    'property.surface_note',
    'reservation.number',
    'reservation.date',
    'reservation.expiration_date',
    'reservation.currency',
    'reservation.catalog_price',
    'reservation.negotiated_price',
    'reservation.fee_amount',
    'generation.date',
    'user.name',
  ],
  SUBSCRIPTION_CONTRACT: [
    'organization.name',
    'organization.address',
    'organization.phone',
    'organization.email',
    'organization.legal_name',
    'organization.contact_block',
    'organization.party_summary',
    'organization.tax_number',
    'buyer.number',
    'buyer.name',
    'buyer.phone',
    'buyer.email',
    'buyer.address',
    'buyer.identity_number',
    'buyer.party_summary',
    'project.number',
    'project.name',
    'project.location',
    'property.number',
    'property.title',
    'property.type',
    'property.location',
    'property.surface',
    'property.designation',
    'property.surface_note',
    'reservation.number',
    'subscription.number',
    'subscription.origin',
    'subscription.date',
    'subscription.currency',
    'subscription.catalog_price',
    'subscription.discount',
    'subscription.final_price',
    'subscription.deposit_percentage',
    'subscription.deposit_amount',
    'subscription.financed_balance',
    'subscription.frequency',
    'subscription.installment_count',
    'subscription.first_due_date',
    'generation.date',
    'user.name',
    'installments.table',
  ],
};

const REQUIRED_VARIABLES: Record<SalesTemplateType, string[]> = {
  RESERVATION_CONTRACT: ['buyer.name', 'property.title', 'reservation.number'],
  SUBSCRIPTION_CONTRACT: ['buyer.name', 'property.title', 'subscription.number'],
};

const REQUIRED_RENDER_VALUES: Record<SalesTemplateType, string[]> = {
  RESERVATION_CONTRACT: [
    'organization.legal_name',
    'buyer.name',
    'project.name',
    'property.title',
    'property.number',
    'reservation.number',
    'reservation.date',
    'reservation.expiration_date',
    'reservation.negotiated_price',
  ],
  SUBSCRIPTION_CONTRACT: [
    'organization.legal_name',
    'buyer.name',
    'project.name',
    'property.title',
    'property.number',
    'subscription.number',
    'subscription.date',
    'subscription.final_price',
    'subscription.frequency',
    'subscription.installment_count',
  ],
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasHtmlMarkup(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function isSafeTemplateUrl(value: string) {
  return /^(https?:|mailto:|tel:|#|\/)/i.test(value);
}

function sanitizeTemplateMarkup(markup: string) {
  const withoutDangerousBlocks = markup
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math)[^>]*\/?\s*>/gi, '');

  return withoutDangerousBlocks.replace(/<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi, (_, closing: string, tagName: string, rawAttributes: string) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TEMPLATE_TAGS.has(tag)) return '';
    if (closing) return `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;

    const attributes: string[] = [];
    rawAttributes.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (_, name: string, __: string, quotedDouble: string, quotedSingle: string, unquoted: string) => {
      const attributeName = name.toLowerCase();
      if (!ALLOWED_TEMPLATE_ATTRIBUTES.has(attributeName) || attributeName.startsWith('on')) return '';
      const rawValue = quotedDouble ?? quotedSingle ?? unquoted ?? '';
      if ((attributeName === 'href' || attributeName === 'src') && !isSafeTemplateUrl(rawValue)) return '';
      if (attributeName === 'target' && rawValue !== '_blank') return '';
      if (attributeName === 'rel') {
        attributes.push('rel="noopener noreferrer"');
        return '';
      }
      attributes.push(`${attributeName}="${escapeHtml(rawValue)}"`);
      return '';
    });
    if (rawAttributes && /target\s*=\s*(['"]?)_blank\1/i.test(rawAttributes) && !attributes.some((attribute) => attribute.startsWith('rel='))) {
      attributes.push('rel="noopener noreferrer"');
    }
    return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
  });
}

function renderPlainTextMarkup(value: string) {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br />')}</p>`)
    .join('\n');
}

function compactSegments(parts: Array<unknown>, separator = ', ') {
  return parts
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(separator);
}

function flatten(prefix: string, value: unknown, target: Record<string, string>) {
  if (value == null) {
    target[prefix] = '';
    return;
  }
  if (Array.isArray(value)) {
    target[prefix] = value.map((item) => String(item ?? '')).join(', ');
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}.${key}` : key, entry, target);
    }
    return;
  }
  target[prefix] = String(value);
}

@Injectable()
export class SalesDocumentsService {
  private readonly pdfRenderer = new PdfRendererService();

  constructor(private readonly repository: SalesRepository) {}

  getAvailableVariables(templateType: SalesTemplateType) {
    return AVAILABLE_VARIABLES[templateType] ?? [];
  }

  async listTemplates(organizationId: number) {
    return this.repository.listDocumentTemplates(organizationId);
  }

  async createTemplate(organizationId: number, userId: number | null, payload: SalesDocumentTemplateDto) {
    this.validateTemplatePayload(payload.template_type as SalesTemplateType, payload);
    return this.repository.createDocumentTemplate(organizationId, userId, payload as unknown as Record<string, unknown>);
  }

  async updateTemplate(organizationId: number, templateId: number, userId: number | null, payload: UpdateSalesDocumentTemplateDto) {
    const current = await this.repository.findDocumentTemplate(organizationId, templateId);
    if (!current) {
      throw new NotFoundException('Template introuvable');
    }
    const nextTemplateType = (payload.template_type ?? current.template_type) as SalesTemplateType;
    const nextPayload = {
      template_type: nextTemplateType,
      title: payload.title ?? current.title,
      template_body: payload.template_body ?? current.template_body,
      header_html: payload.header_html ?? current.header_html,
      footer_html: payload.footer_html ?? current.footer_html,
      variables_schema: payload.variables_schema ?? current.variables_schema ?? [],
      clause_order: payload.clause_order ?? current.clause_order ?? [],
      is_active: payload.is_active ?? current.is_active ?? true,
    };
    this.validateTemplatePayload(nextTemplateType, nextPayload);
    const updated = await this.repository.updateDocumentTemplate(organizationId, templateId, userId, payload as unknown as Record<string, unknown>);
    if (!updated) {
      throw new NotFoundException('Template introuvable');
    }
    return updated;
  }

  async listReservationDocuments(organizationId: number, reservationId: number) {
    return this.repository.listDocumentGenerations(organizationId, 'RESERVATION', reservationId);
  }

  async listSubscriptionDocuments(organizationId: number, subscriptionId: number) {
    return this.repository.listDocumentGenerations(organizationId, 'SUBSCRIPTION', subscriptionId);
  }

  async regenerateReservationContract(organizationId: number, reservationId: number, userId: number | null) {
    return this.generateContract(organizationId, 'RESERVATION', reservationId, 'RESERVATION_CONTRACT', userId);
  }

  async regenerateSubscriptionContract(organizationId: number, subscriptionId: number, userId: number | null) {
    return this.generateContract(organizationId, 'SUBSCRIPTION', subscriptionId, 'SUBSCRIPTION_CONTRACT', userId);
  }

  async downloadDocument(organizationId: number, documentId: number) {
    const document = await this.repository.findDocumentGeneration(organizationId, documentId);
    if (!document) {
      throw new NotFoundException('Document introuvable');
    }
    if (!document.pdf_base64) {
      throw new NotFoundException('Aucun PDF généré pour ce document');
    }
    return {
      fileName: document.file_name || `${document.document_number}.pdf`,
      mimeType: document.mime_type || 'application/pdf',
      buffer: Buffer.from(document.pdf_base64, 'base64'),
    };
  }

  async generateContract(
    organizationId: number,
    entityType: SalesDocumentEntityType,
    entityId: number,
    templateType: SalesTemplateType,
    userId: number | null,
  ) {
    const settings = await this.repository.findSettings(organizationId);
    const context = entityType === 'RESERVATION'
      ? await this.repository.getReservationDocumentContext(organizationId, entityId)
      : await this.repository.getSubscriptionDocumentContext(organizationId, entityId);
    if (!context) {
      throw new NotFoundException('Entité contractuelle introuvable');
    }
    if (entityType === 'SUBSCRIPTION') {
      context.installments = await this.repository.listSubscriptionInstallments(organizationId, entityId);
    }

    const template = await this.repository.ensureDefaultTemplate(
      organizationId,
      templateType,
      userId,
      this.buildDefaultTemplate(templateType),
      this.getAvailableVariables(templateType),
    );

    const year = new Date().getUTCFullYear();
    const sequence = await this.repository.nextSequenceValue(organizationId, templateType, year, null as any);
    const documentNumber = this.repository.formatSequence(
      templateType === 'RESERVATION_CONTRACT'
        ? settings?.reservation_contract_number_format || 'CR-{YYYY}-{SEQ:5}'
        : settings?.subscription_contract_number_format || 'CV-{YYYY}-{SEQ:5}',
      sequence,
      year,
    );

    const snapshot = this.buildSnapshot(context, entityType, userId);
    this.assertTemplateCompleteness(snapshot, templateType);
    const generation = await this.repository.createDocumentGeneration(organizationId, {
      entity_type: entityType,
      entity_id: entityId,
      template_type: templateType,
      template_id: template.id,
      version: template.version,
      document_number: documentNumber,
      file_name: `${documentNumber}.pdf`,
      variables_snapshot: snapshot,
      generated_by: userId,
    });

    try {
      const html = this.renderTemplate(template, snapshot, templateType);
      const pdfBuffer = await this.pdfRenderer.renderA4Pdf(html);
      return await this.repository.markDocumentGenerationSuccess(organizationId, generation.id, {
        pdf_base64: pdfBuffer.toString('base64'),
        mime_type: 'application/pdf',
        generated_by: userId,
      });
    } catch (error: any) {
      return this.repository.markDocumentGenerationFailure(
        organizationId,
        generation.id,
        error?.message || 'PDF generation failed',
        userId,
      );
    }
  }

  private buildSnapshot(context: any, entityType: SalesDocumentEntityType, userId: number | null) {
    const generatedOn = new Date();
    const organizationName = context.organization_name;
    const organizationAddress = context.organization_address;
    const organizationPhone = context.organization_phone;
    const organizationEmail = context.organization_email;
    const buyerNumber = context.buyer_ref;
    const buyerName = context.buyer_name;
    const buyerPhone = context.buyer_phone;
    const buyerIdentityNumber = context.buyer_identity_number;
    const propertyNumber = context.catalog_ref;
    const propertyTitle = context.catalog_title;
    const propertyType = context.property_type;
    const propertyLocation = context.catalog_location;
    const propertySurface = this.formatSurface(context.catalog_surface_area);
    const organizationContactLines = [organizationAddress, organizationPhone, organizationEmail]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    const organizationPartySummary = compactSegments([
      organizationName,
      organizationAddress ? `sise à ${organizationAddress}` : '',
      compactSegments([
        organizationPhone ? `joignable au ${organizationPhone}` : '',
        organizationEmail ? `à l’adresse ${organizationEmail}` : '',
      ], ' et '),
    ]);
    const buyerPartySummary = compactSegments([
      buyerName,
      buyerNumber ? `référence dossier ${buyerNumber}` : '',
      buyerPhone ? `joignable au ${buyerPhone}` : '',
      buyerIdentityNumber ? `identifié sous le numéro ${buyerIdentityNumber}` : '',
    ]);
    const propertyDesignation = compactSegments([
      propertyTitle,
      propertyNumber ? `référence ${propertyNumber}` : '',
      propertyType ? `de type ${propertyType}` : '',
      propertyLocation ? `situé à ${propertyLocation}` : '',
    ]);
    const raw = entityType === 'RESERVATION'
      ? {
          organization: {
            name: organizationName,
            address: organizationAddress,
            phone: organizationPhone,
            email: organizationEmail,
            legal_name: organizationName,
            contact_block: organizationContactLines.length ? `<br />${organizationContactLines.map(escapeHtml).join('<br />')}` : '',
            party_summary: organizationPartySummary,
            tax_number: context.organization_tax_number,
          },
          buyer: {
            number: buyerNumber,
            name: buyerName,
            phone: buyerPhone,
            email: context.buyer_email,
            address: context.buyer_address,
            identity_number: buyerIdentityNumber,
            party_summary: buyerPartySummary,
          },
          project: {
            number: context.project_ref,
            name: context.project_name,
            location: context.project_location,
          },
          property: {
            number: propertyNumber,
            title: propertyTitle,
            type: propertyType,
            location: propertyLocation,
            surface: propertySurface,
            designation: propertyDesignation,
            surface_note: propertySurface ? `Surface indicative : ${propertySurface}.` : '',
          },
          reservation: {
            number: context.reservation_number,
            date: this.formatDate(context.reservation_date),
            expiration_date: this.formatDate(context.expires_at),
            status: this.translateReservationStatus(context.status),
            currency: context.currency,
            catalog_price: this.formatMoney(context.catalog_price, context.currency),
            negotiated_price: this.formatMoney(context.negotiated_price, context.currency),
            fee_amount: this.formatMoney(context.reservation_fee, context.currency),
          },
          generation: {
            date: this.formatDate(generatedOn.toISOString()),
          },
          user: {
            name: userId ? `Utilisateur #${userId}` : '',
          },
        }
      : {
          organization: {
            name: organizationName,
            address: organizationAddress,
            phone: organizationPhone,
            email: organizationEmail,
            legal_name: organizationName,
            contact_block: organizationContactLines.length ? `<br />${organizationContactLines.map(escapeHtml).join('<br />')}` : '',
            party_summary: organizationPartySummary,
            tax_number: context.organization_tax_number,
          },
          buyer: {
            number: buyerNumber,
            name: buyerName,
            phone: buyerPhone,
            email: context.buyer_email,
            address: context.buyer_address,
            identity_number: buyerIdentityNumber,
            party_summary: buyerPartySummary,
          },
          project: {
            number: context.project_ref,
            name: context.project_name,
            location: context.project_location,
          },
          property: {
            number: propertyNumber,
            title: propertyTitle,
            type: propertyType,
            location: propertyLocation,
            surface: propertySurface,
            designation: propertyDesignation,
            surface_note: propertySurface ? `Surface indicative : ${propertySurface}.` : '',
          },
          reservation: {
            number: context.reservation_number,
          },
          subscription: {
            number: context.subscription_number,
            origin: this.translateSubscriptionOrigin(context.reservation_number ? 'RESERVATION' : 'DIRECT'),
            date: this.formatDate(context.created_at),
            status: this.translateSubscriptionStatus(context.status),
            currency: context.currency,
            catalog_price: this.formatMoney(context.catalog_price, context.currency),
            discount: this.formatMoney(context.discount_amount, context.currency),
            final_price: this.formatMoney(context.final_sale_price, context.currency),
            deposit_percentage: context.deposit_percentage != null ? `${Number(context.deposit_percentage).toFixed(0)} %` : '',
            deposit_amount: this.formatMoney(context.deposit_amount, context.currency),
            financed_balance: this.formatMoney(context.financed_balance, context.currency),
            frequency: this.translateSubscriptionFrequency(context.frequency),
            installment_count: context.installment_count,
            first_due_date: this.formatDate(context.first_due_date),
          },
          generation: {
            date: this.formatDate(generatedOn.toISOString()),
          },
          user: {
            name: userId ? `Utilisateur #${userId}` : '',
          },
          installments: {
            table: this.buildInstallmentsTableMarkup(context.currency, context.installments ?? []),
          },
        };

    return raw;
  }

  private renderTemplate(template: any, snapshot: Record<string, unknown>, templateType: SalesTemplateType) {
    const flat: Record<string, string> = {};
    flatten('', snapshot, flat);
    const body = this.renderTemplateMarkup(template.template_body, flat);
    const header = this.renderTemplateMarkup(template.header_html, flat);
    const footer = this.renderTemplateMarkup(template.footer_html, flat);
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 18mm 16mm 20mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #12243d; font-size: 11.5px; line-height: 1.6; margin: 0; }
    p { margin: 0 0 10px; text-align: justify; }
    h1 { margin: 0 0 16px; font-size: 22px; line-height: 1.2; color: #10233f; }
    h2 { margin: 0 0 8px; font-size: 13px; line-height: 1.35; color: #10233f; text-transform: uppercase; letter-spacing: 0.04em; }
    h3 { margin: 0 0 6px; font-size: 11.5px; color: #10233f; }
    ul, ol { margin: 0 0 12px 18px; padding: 0; }
    li { margin-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 0; }
    th, td { border: 1px solid #d8e0ea; padding: 8px 10px; vertical-align: top; text-align: left; }
    th { background: #f4f8fc; color: #39506b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
    .contract-shell { display: grid; gap: 16px; }
    .contract-head, .contract-foot { color: #5d6f86; font-size: 10px; }
    .contract-panel { border: 1px solid #d9e2ec; border-radius: 14px; padding: 16px 18px; background: #ffffff; }
    .contract-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .contract-meta > div { border: 1px solid #e4eaf1; border-radius: 10px; padding: 10px 12px; background: #f8fbff; }
    .contract-label { display: block; color: #63758d; font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
    .contract-value { font-weight: 700; color: #10233f; }
    .contract-section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; }
    .contract-section:last-child { margin-bottom: 0; }
    .contract-note { color: #5d6f86; font-size: 10px; }
    .contract-signatures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
    .contract-signature { border-top: 1px solid #cdd8e4; padding-top: 10px; min-height: 70px; }
    .contract-signature strong { display: block; margin-bottom: 18px; }
  </style>
</head>
<body>
  <div class="contract-shell">
    ${header ? `<header class="contract-head">${header}</header>` : ''}
    <section class="contract-panel">
      <h1>${escapeHtml(template.title || (templateType === 'RESERVATION_CONTRACT' ? 'Contrat de réservation' : 'Contrat de souscription'))}</h1>
      <div class="contract-body">${body}</div>
    </section>
    ${footer ? `<footer class="contract-foot">${footer}</footer>` : ''}
  </div>
</body>
</html>`;
  }

  private buildDefaultTemplate(templateType: SalesTemplateType) {
    if (templateType === 'RESERVATION_CONTRACT') {
      return {
        title: 'Contrat de réservation',
        template_body: `
<div class="contract-meta">
  <div>
    <span class="contract-label">Numéro de réservation</span>
    <span class="contract-value">{{reservation.number}}</span>
  </div>
  <div>
    <span class="contract-label">Date d’édition</span>
    <span class="contract-value">{{generation.date}}</span>
  </div>
  <div>
    <span class="contract-label">Projet</span>
    <span class="contract-value">{{project.name}}</span>
  </div>
  <div>
    <span class="contract-label">Bien réservé</span>
    <span class="contract-value">{{property.title}}</span>
  </div>
</div>
<section class="contract-section">
  <h2>1. Parties au contrat</h2>
  <p>Entre <strong>{{organization.party_summary}}</strong>, ci-après dénommée « le Vendeur ».</p>
  <p>Et <strong>{{buyer.party_summary}}</strong>, ci-après dénommé « l’Acquéreur ».</p>
</section>
<section class="contract-section">
  <h2>2. Objet de la réservation</h2>
  <p>Le Vendeur réserve à l’Acquéreur le bien <strong>{{property.designation}}</strong> dans le projet <strong>{{project.name}}</strong>.</p>
  <p class="contract-note">{{property.surface_note}}</p>
</section>
<section class="contract-section">
  <h2>3. Conditions financières</h2>
  <p>Le prix catalogue du bien est de <strong>{{reservation.catalog_price}}</strong>. Le prix négocié retenu pour cette réservation est de <strong>{{reservation.negotiated_price}}</strong>.</p>
  <p>Les frais de réservation convenus s’élèvent à <strong>{{reservation.fee_amount}}</strong> dans la devise {{reservation.currency}}.</p>
</section>
<section class="contract-section">
  <h2>4. Durée et validité</h2>
  <p>La présente réservation prend effet le <strong>{{reservation.date}}</strong> et demeure valable jusqu’au <strong>{{reservation.expiration_date}}</strong>, sauf confirmation, conversion ou annulation anticipée conformément aux règles commerciales en vigueur.</p>
</section>
<section class="contract-section">
  <h2>5. Engagements des parties</h2>
  <ul>
    <li>Le Vendeur s’engage à maintenir le bien indisponible à la vente pendant la période de réservation validée.</li>
    <li>L’Acquéreur s’engage à compléter les formalités de souscription dans le délai prévu ou à notifier toute difficulté majeure au Vendeur.</li>
    <li>Les documents et informations transmis dans le cadre du dossier doivent rester exacts, complets et à jour.</li>
  </ul>
</section>
<section class="contract-section">
  <h2>6. Signatures</h2>
  <p>Fait à Kinshasa, le {{generation.date}}, en deux exemplaires de même valeur probante.</p>
  <div class="contract-signatures">
    <div class="contract-signature">
      <strong>Pour le Vendeur</strong>
      Nom, fonction et signature
    </div>
    <div class="contract-signature">
      <strong>Pour l’Acquéreur</strong>
      {{buyer.name}}
    </div>
  </div>
</section>`,
      };
    }

    return {
      title: 'Contrat de souscription',
        template_body: `
<div class="contract-meta">
  <div>
    <span class="contract-label">Numéro de souscription</span>
    <span class="contract-value">{{subscription.number}}</span>
  </div>
  <div>
    <span class="contract-label">Origine</span>
    <span class="contract-value">{{subscription.origin}}</span>
  </div>
  <div>
    <span class="contract-label">Projet</span>
    <span class="contract-value">{{project.name}}</span>
  </div>
  <div>
    <span class="contract-label">Bien souscrit</span>
    <span class="contract-value">{{property.title}}</span>
  </div>
</div>
<section class="contract-section">
  <h2>1. Parties au contrat</h2>
  <p>Entre <strong>{{organization.party_summary}}</strong>, ci-après dénommée « le Vendeur ».</p>
  <p>Et <strong>{{buyer.party_summary}}</strong>, ci-après dénommé « l’Acquéreur ».</p>
</section>
<section class="contract-section">
  <h2>2. Objet de la souscription</h2>
  <p>Le présent contrat confirme la souscription du bien <strong>{{property.designation}}</strong>, au sein du projet <strong>{{project.name}}</strong>.</p>
  <p class="contract-note">{{property.surface_note}}</p>
</section>
<section class="contract-section">
  <h2>3. Conditions financières</h2>
  <p>Le prix catalogue est fixé à <strong>{{subscription.catalog_price}}</strong>. La remise commerciale consentie s’élève à <strong>{{subscription.discount}}</strong>.</p>
  <p>Le prix final de vente est arrêté à <strong>{{subscription.final_price}}</strong>. L’acompte attendu représente {{subscription.deposit_percentage}} soit <strong>{{subscription.deposit_amount}}</strong>.</p>
  <p>Le solde financé restant dû après acompte est de <strong>{{subscription.financed_balance}}</strong>.</p>
</section>
<section class="contract-section">
  <h2>4. Modalités de paiement</h2>
  <p>La souscription est traitée selon une fréquence <strong>{{subscription.frequency}}</strong> avec <strong>{{subscription.installment_count}}</strong> échéances à compter du <strong>{{subscription.first_due_date}}</strong>.</p>
  {{installments.table}}
</section>
<section class="contract-section">
  <h2>5. Dispositions finales</h2>
  <ul>
    <li>Tout retard, ajustement ou changement de statut doit être formalisé dans le dossier commercial de l’organisation.</li>
    <li>Les clauses particulières, annexes et justificatifs approuvés font partie intégrante du présent contrat.</li>
    <li>Les signatures ci-dessous valent accord sur les montants, la fréquence et l’échéancier ci-dessus.</li>
  </ul>
</section>
<section class="contract-section">
  <h2>6. Signatures</h2>
  <p>Fait à Kinshasa, le {{generation.date}}.</p>
  <div class="contract-signatures">
    <div class="contract-signature">
      <strong>Pour le Vendeur</strong>
      Nom, fonction et signature
    </div>
    <div class="contract-signature">
      <strong>Pour l’Acquéreur</strong>
      {{buyer.name}}
    </div>
  </div>
</section>`,
    };
  }

  private validateTemplatePayload(templateType: SalesTemplateType, payload: {
    title?: string | null;
    template_body?: string | null;
    is_active?: boolean | null;
  }) {
    const title = String(payload.title ?? '').trim();
    const body = String(payload.template_body ?? '').trim();
    if (!title || !body) {
      throw new BadRequestException('Le modèle doit contenir au minimum un titre et un corps contractuel.');
    }
    const detected = this.extractTemplateVariables(body);
    const available = new Set(this.getAvailableVariables(templateType));
    const unknown = detected.filter((token) => !available.has(token));
    if (unknown.length && payload.is_active !== false) {
      throw new BadRequestException(`Variable inconnue : {{${unknown[0]}}}`);
    }
    const missingRequired = REQUIRED_VARIABLES[templateType].filter((token) => !detected.includes(token));
    if (missingRequired.length && payload.is_active !== false) {
      throw new BadRequestException('Le modèle doit contenir au minimum un corps contractuel et les informations des parties.');
    }
  }

  private extractTemplateVariables(content: string) {
    const matches = content.match(/\{\{\s*([^}]+?)\s*\}\}/g) ?? [];
    return [...new Set(matches.map((entry) => entry.replace(/^\{\{\s*|\s*\}\}$/g, '').trim()))];
  }

  private assertTemplateCompleteness(snapshot: Record<string, unknown>, templateType: SalesTemplateType) {
    const flat: Record<string, string> = {};
    flatten('', snapshot, flat);
    const missing = REQUIRED_RENDER_VALUES[templateType].filter((token) => !stripHtml(String(flat[token] ?? '')).trim());
    if (missing.length) {
      throw new BadRequestException({
        code: TEMPLATE_INCOMPLETE_CODE,
        message: `Le modèle ne peut pas être généré car des données obligatoires sont absentes : ${missing.join(', ')}`,
      });
    }
  }

  private renderTemplateMarkup(content: unknown, flat: Record<string, string>) {
    const raw = String(content ?? '').trim();
    if (!raw) return '';
    const placeholders = new Map<string, string>();
    let index = 0;
    const withTokens = raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token: string) => {
      const key = token.trim();
      if (TRUSTED_HTML_VARIABLES.has(key)) {
        const placeholder = `__SALES_RAW_HTML_${index += 1}__`;
        placeholders.set(placeholder, flat[key] ?? '');
        return placeholder;
      }
      return escapeHtml(flat[key] ?? '');
    });
    const rendered = hasHtmlMarkup(withTokens) ? sanitizeTemplateMarkup(withTokens) : renderPlainTextMarkup(withTokens);
    let finalMarkup = rendered;
    for (const [placeholder, value] of placeholders.entries()) {
      finalMarkup = finalMarkup.replaceAll(placeholder, value);
    }
    return finalMarkup;
  }

  private formatMoney(value: unknown, currency: unknown) {
    const amount = Number(value ?? 0);
    const code = String(currency || 'USD').toUpperCase();
    if (!Number.isFinite(amount)) return '';
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ` ${code}`;
  }

  private formatDate(value: unknown) {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date);
  }

  private formatSurface(value: unknown) {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount)} m²`;
  }

  private buildInstallmentsTableMarkup(currency: unknown, installments: Array<Record<string, unknown>>) {
    if (!Array.isArray(installments) || !installments.length) {
      return '<p class="contract-note">Aucun échéancier disponible.</p>';
    }
    const rows = installments.map((item) => `
      <tr>
        <td>${escapeHtml(item.sequence_number ?? '')}</td>
        <td>${escapeHtml(item.label ?? 'Échéance')}</td>
        <td>${escapeHtml(this.formatDate(item.due_date))}</td>
        <td>${escapeHtml(this.formatMoney(item.amount, currency))}</td>
      </tr>
    `).join('');
    return `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Libellé</th>
            <th>Échéance</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private translateSubscriptionOrigin(value: unknown) {
    const code = String(value ?? '').toUpperCase();
    return SUBSCRIPTION_ORIGIN_LABELS[code] ?? String(value ?? '');
  }

  private translateSubscriptionFrequency(value: unknown) {
    const code = String(value ?? '').toUpperCase();
    return SUBSCRIPTION_FREQUENCY_LABELS[code] ?? String(value ?? '');
  }

  private translateReservationStatus(value: unknown) {
    const code = String(value ?? '').toUpperCase();
    return RESERVATION_STATUS_LABELS[code] ?? String(value ?? '');
  }

  private translateSubscriptionStatus(value: unknown) {
    const code = String(value ?? '').toUpperCase();
    return SUBSCRIPTION_STATUS_LABELS[code] ?? String(value ?? '');
  }
}
