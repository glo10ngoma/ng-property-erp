import { Injectable, NotFoundException } from '@nestjs/common';
import { PdfRendererService } from '../documents/pdf-renderer.service';
import { SalesRepository } from './sales.repository';

type SalesDocumentEntityType = 'RESERVATION' | 'SUBSCRIPTION';
type SalesTemplateType = 'RESERVATION_CONTRACT' | 'SUBSCRIPTION_CONTRACT';

const AVAILABLE_VARIABLES: Record<SalesTemplateType, string[]> = {
  RESERVATION_CONTRACT: [
    'organisation.name',
    'organisation.address',
    'acquereur.name',
    'acquereur.reference',
    'projet.name',
    'bien.reference',
    'bien.title',
    'reservation.number',
    'reservation.date',
    'reservation.expiration_date',
    'prix.catalogue',
    'prix.negocie',
    'frais.reservation_convenus',
    'utilisateur.id',
  ],
  SUBSCRIPTION_CONTRACT: [
    'organisation.name',
    'organisation.address',
    'acquereur.name',
    'acquereur.reference',
    'projet.name',
    'bien.reference',
    'bien.title',
    'reservation.number',
    'souscription.number',
    'prix.catalogue',
    'prix.final',
    'acompte.montant',
    'echeancier.resume',
    'utilisateur.id',
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

  async createTemplate(organizationId: number, userId: number | null, payload: Record<string, unknown>) {
    return this.repository.createDocumentTemplate(organizationId, userId, payload);
  }

  async updateTemplate(organizationId: number, templateId: number, userId: number | null, payload: Record<string, unknown>) {
    const updated = await this.repository.updateDocumentTemplate(organizationId, templateId, userId, payload);
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
    const raw = entityType === 'RESERVATION'
      ? {
          organisation: {
            name: context.organization_name,
            address: context.organization_address,
          },
          acquereur: {
            name: context.buyer_name,
            reference: context.buyer_ref,
          },
          projet: {
            name: context.project_name,
          },
          bien: {
            reference: context.catalog_ref,
            title: context.catalog_title,
          },
          reservation: {
            number: context.reservation_number,
            date: context.reservation_date,
            expiration_date: context.expires_at,
          },
          prix: {
            catalogue: context.catalog_price,
            negocie: context.negotiated_price,
            devise: context.currency,
          },
          frais: {
            reservation_convenus: context.reservation_fee,
          },
          utilisateur: {
            id: userId ?? '',
          },
        }
      : {
          organisation: {
            name: context.organization_name,
            address: context.organization_address,
          },
          acquereur: {
            name: context.buyer_name,
            reference: context.buyer_ref,
          },
          projet: {
            name: context.project_name,
          },
          bien: {
            reference: context.catalog_ref,
            title: context.catalog_title,
          },
          reservation: {
            number: context.reservation_number,
          },
          souscription: {
            number: context.subscription_number,
            statut: context.status,
          },
          prix: {
            catalogue: context.catalog_price,
            final: context.final_sale_price,
            devise: context.currency,
          },
          acompte: {
            montant: context.deposit_amount,
            type: context.deposit_type,
          },
          echeancier: {
            resume: `${context.installment_count ?? 0} échéances / ${context.frequency ?? 'MONTHLY'}`,
          },
          utilisateur: {
            id: userId ?? '',
          },
        };

    return raw;
  }

  private renderTemplate(template: any, snapshot: Record<string, unknown>, templateType: SalesTemplateType) {
    const flat: Record<string, string> = {};
    flatten('', snapshot, flat);
    const body = String(template.template_body ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token: string) => {
      return escapeHtml(flat[token.trim()] ?? '');
    });
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 2.1cm; }
    body { font-family: Arial, sans-serif; color: #12243d; font-size: 12px; margin: 0; }
    header, footer { color: #55657c; font-size: 11px; }
    h1 { font-size: 22px; margin: 0 0 14px; }
    h2 { font-size: 13px; margin: 18px 0 8px; }
    .card { border: 1px solid #d9e2ec; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .label { color: #65768d; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
    .value { font-weight: 700; }
  </style>
</head>
<body>
  ${template.header_html ? `<header>${template.header_html}</header>` : ''}
  <h1>${escapeHtml(template.title || (templateType === 'RESERVATION_CONTRACT' ? 'Contrat de réservation' : 'Contrat de souscription'))}</h1>
  <div class="card">${body}</div>
  ${template.footer_html ? `<footer>${template.footer_html}</footer>` : ''}
</body>
</html>`;
  }

  private buildDefaultTemplate(templateType: SalesTemplateType) {
    if (templateType === 'RESERVATION_CONTRACT') {
      return {
        title: 'Contrat de réservation',
        template_body: `
<div class="grid">
  <div><span class="label">Organisation</span><span class="value">{{organisation.name}}</span></div>
  <div><span class="label">Acquéreur</span><span class="value">{{acquereur.name}}</span></div>
  <div><span class="label">Projet</span><span class="value">{{projet.name}}</span></div>
  <div><span class="label">Bien</span><span class="value">{{bien.reference}} — {{bien.title}}</span></div>
  <div><span class="label">Réservation</span><span class="value">{{reservation.number}}</span></div>
  <div><span class="label">Date</span><span class="value">{{reservation.date}}</span></div>
</div>
<h2>Conditions commerciales</h2>
<p>Prix catalogue : {{prix.catalogue}} {{prix.devise}}.</p>
<p>Prix négocié : {{prix.negocie}} {{prix.devise}}.</p>
<p>Frais de réservation convenus : {{frais.reservation_convenus}} {{prix.devise}}.</p>
<p>Expiration de la réservation : {{reservation.expiration_date}}.</p>`,
      };
    }

    return {
      title: 'Contrat de souscription',
      template_body: `
<div class="grid">
  <div><span class="label">Organisation</span><span class="value">{{organisation.name}}</span></div>
  <div><span class="label">Acquéreur</span><span class="value">{{acquereur.name}}</span></div>
  <div><span class="label">Projet</span><span class="value">{{projet.name}}</span></div>
  <div><span class="label">Bien</span><span class="value">{{bien.reference}} — {{bien.title}}</span></div>
  <div><span class="label">Souscription</span><span class="value">{{souscription.number}}</span></div>
  <div><span class="label">Réservation liée</span><span class="value">{{reservation.number}}</span></div>
</div>
<h2>Conditions financières</h2>
<p>Prix catalogue : {{prix.catalogue}} {{prix.devise}}.</p>
<p>Prix final : {{prix.final}} {{prix.devise}}.</p>
<p>Acompte : {{acompte.montant}} {{prix.devise}}.</p>
<p>Échéancier : {{echeancier.resume}}.</p>`,
    };
  }
}
