import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { LeaseDocumentRenderContext, LeaseDocumentUsage } from './document.types';

const TEMPLATE_CODE_BY_USAGE: Record<LeaseDocumentUsage, string> = {
  RESIDENTIAL: 'LEASE_RESIDENTIAL',
  COMMERCIAL: 'LEASE_COMMERCIAL',
  PROFESSIONAL: 'LEASE_PROFESSIONAL',
  MIXED: 'LEASE_MIXED',
};

const TEMPLATE_FILE_BY_USAGE: Record<LeaseDocumentUsage, string> = {
  RESIDENTIAL: 'residential.html',
  COMMERCIAL: 'commercial.html',
  PROFESSIONAL: 'professional.html',
  MIXED: 'mixed.html',
};

export class DocumentTemplateService {
  private readonly rootCandidates = [
    path.resolve(process.cwd(), 'dist', 'templates', 'leases'),
    path.resolve(process.cwd(), 'templates', 'leases'),
    path.resolve(__dirname, '..', '..', 'templates', 'leases'),
  ];

  renderLeaseTemplate(context: LeaseDocumentRenderContext) {
    const root = this.resolveTemplateRoot();
    const usage = context.lease.usage;
    const base = this.readTemplate(root, 'common/base.html');
    const css = this.readTemplate(root, 'common/common.css');
    const signature = this.readTemplate(root, 'common/signature.html');
    const propertyDetails = this.render(
      this.readTemplate(root, 'common/property-details.html'),
      this.variables(context),
    );
    const body = this.render(this.readTemplate(root, TEMPLATE_FILE_BY_USAGE[usage]), {
      ...this.variables(context),
      propertyDetails,
      signature,
    });
    const html = this.render(base, {
      title: context.contract.title,
      css,
      body,
    });
    const source = [
      'common/base.html',
      'common/common.css',
      'common/signature.html',
      'common/property-details.html',
      TEMPLATE_FILE_BY_USAGE[usage],
    ].map((name) => `${name}:${this.fileHash(path.join(root, name))}`).join('|');
    return {
      html,
      templateCode: TEMPLATE_CODE_BY_USAGE[usage],
      templateSource: TEMPLATE_FILE_BY_USAGE[usage],
      templateHash: createHash('sha256').update(source).digest('hex'),
      rendererVersion: 'PDF_V9',
    };
  }

  private resolveTemplateRoot() {
    const root = this.rootCandidates.find((candidate) => fs.existsSync(candidate));
    if (!root) {
      throw new BadRequestException(`Templates de contrat V9 introuvables: ${this.rootCandidates[0]}`);
    }
    return root;
  }

  private readTemplate(root: string, relativePath: string) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new BadRequestException(`Template de contrat V9 introuvable: ${relativePath}`);
    }
    return fs.readFileSync(fullPath, 'utf8');
  }

  private fileHash(filePath: string) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  private render(template: string, values: Record<string, string>) {
    return template
      .replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, key: string) => values[key.trim()] ?? '')
      .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => escapeHtml(values[key.trim()] ?? ''));
  }

  private variables(context: LeaseDocumentRenderContext) {
    const rentLines = [
      context.lease.baseRent > 0 ? `<li>Loyer de base : ${money(context.lease.baseRent, context.lease.currency)}</li>` : '',
      context.lease.maintenanceFee > 0 ? `<li>Entretien et maintenance : ${money(context.lease.maintenanceFee, context.lease.currency)}</li>` : '',
      context.lease.syndicFee > 0 ? `<li>Frais de syndic : ${money(context.lease.syndicFee, context.lease.currency)}</li>` : '',
      context.lease.otherCharges > 0 ? `<li>Autres charges : ${money(context.lease.otherCharges, context.lease.currency)}</li>` : '',
    ].filter(Boolean).join('');
    return {
      title: context.contract.title,
      generatedAt: context.contract.generatedAt,
      signaturePlace: context.contract.signaturePlace,
      signatureDate: context.contract.signatureDate,
      landlordParagraph: landlordParagraph(context),
      tenantParagraph: tenantParagraph(context),
      propertyDetails: '',
      unitLabel: context.property.unitLabel,
      furnishedLabel: context.property.furnishedLabel,
      buildingName: context.property.buildingName,
      propertyAddress: context.property.address,
      propertyCity: context.property.city,
      bedrooms: context.property.bedrooms,
      parkingSpaces: context.property.parkingSpaces,
      startDate: context.lease.startDate,
      endDate: context.lease.endDate,
      durationText: context.lease.durationText,
      noticeMonths: context.lease.noticeMonths,
      usageLabelLower: context.lease.usageLabel.toLowerCase(),
      activityDescription: context.lease.activityDescription,
      destinationPhrase: destinationPhrase(context),
      totalMonthly: money(context.lease.totalMonthly, context.lease.currency),
      baseRent: money(context.lease.baseRent, context.lease.currency),
      guaranteeMonths: String(context.lease.guaranteeMonths),
      guaranteeAmount: money(context.lease.guaranteeAmount, context.lease.currency),
      rentBreakdown: rentLines ? `<ul>${rentLines}</ul>` : '',
      signature: '',
    };
  }
}

function landlordParagraph(context: LeaseDocumentRenderContext) {
  const landlord = context.landlord;
  return [
    `${landlord.companyName}${landlord.acronym ? ` (${landlord.acronym})` : ''}`,
    landlord.legalForm,
    landlord.rccm ? `immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro ${landlord.rccm}` : '',
    landlord.nationalId ? `enregistrée à l'Identification Nationale sous le numéro ${landlord.nationalId}` : '',
    landlord.address ? `dont le siège social est établi à ${landlord.address}` : '',
    landlord.representativeName
      ? `représentée par ${[landlord.representativeCivility, landlord.representativeName].filter(Boolean).join(' ')}${landlord.representativeTitle ? `, agissant en qualité de ${landlord.representativeTitle}` : ''}`
      : '',
    'ci-après dénommée « le Bailleur »',
  ].filter(Boolean).join(', ') + ' ;';
}

function tenantParagraph(context: LeaseDocumentRenderContext) {
  const tenant = context.tenant;
  if (tenant.type === 'PERSONNE_MORALE') {
    return [
      `${tenant.displayName}${tenant.legalForm ? `, ${tenant.legalForm}` : ''}`,
      tenant.rccm ? `immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro ${tenant.rccm}` : '',
      tenant.nationalId ? `enregistrée à l'Identification Nationale sous le numéro ${tenant.nationalId}` : '',
      tenant.address ? `dont le siège social est établi à ${tenant.address}` : '',
      tenant.representativeName
        ? `représentée par ${[tenant.representativeCivility, tenant.representativeName].filter(Boolean).join(' ')}${tenant.representativeTitle ? `, agissant en qualité de ${tenant.representativeTitle}` : ''}`
        : '',
      'ci-après dénommée « le Preneur »',
    ].filter(Boolean).join(', ') + ' ;';
  }
  return [
    [tenant.representativeCivility, tenant.displayName].filter(Boolean).join(' '),
    tenant.identityType ? `titulaire de la pièce d'identité ${tenant.identityType}` : '',
    tenant.identityNumber ? `numéro ${tenant.identityNumber}` : '',
    tenant.address ? `domicilié(e) à ${tenant.address}` : '',
    'ci-après dénommé(e) « le Preneur »',
  ].filter(Boolean).join(', ') + ' ;';
}

function destinationPhrase(context: LeaseDocumentRenderContext) {
  if (context.lease.usage === 'RESIDENTIAL') {
    return `Les lieux loués sont destinés à un usage ${context.lease.usageLabel.toLowerCase()}.`;
  }
  const activity = context.lease.activityDescription || "l'activité déclarée par le Preneur";
  return `Les lieux loués sont exclusivement destinés à ${activity}. Toute modification substantielle de cette destination requiert l'accord écrit préalable du Bailleur.`;
}

function money(value: number, currency: string) {
  return `${Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
