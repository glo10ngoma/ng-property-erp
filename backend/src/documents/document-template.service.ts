import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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

  getTemplatePaths() {
    return [...this.rootCandidates];
  }

  getRuntimeInfo() {
    return {
      cwd: process.cwd(),
      dirname: __dirname,
      rootCandidates: this.rootCandidates.map((candidate) => ({
        path: candidate,
        exists: fs.existsSync(candidate),
      })),
    };
  }

  renderLeaseTemplate(context: LeaseDocumentRenderContext) {
    const root = this.resolveTemplateRoot();
    const usage = context.lease.usage;
    const base = this.readTemplate(root, 'common/base.html');
    const css = this.readTemplate(root, 'common/common.css');
    const signature = this.readTemplate(root, 'common/signature.html');
    const values = this.variables(context);
    const propertyDetails = this.render(this.readTemplate(root, 'common/property-details.html'), values);
    const body = this.render(this.readTemplate(root, TEMPLATE_FILE_BY_USAGE[usage]), {
      ...values,
      propertyDetails,
      signature,
    });
    const html = this.render(base, {
      title: context.contract.title,
      css,
      body,
    });
    this.assertRenderedHtml(html);
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
      templateRoot: root,
    };
  }

  private resolveTemplateRoot() {
    const root = this.rootCandidates.find((candidate) => fs.existsSync(candidate));
    if (!root) {
      throw new NotFoundException({
        code: 'PDF_TEMPLATE_NOT_FOUND',
        message: `Lease PDF templates not found. Checked: ${this.rootCandidates.join(', ')}`,
      });
    }
    return root;
  }

  private readTemplate(root: string, relativePath: string) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException({
        code: 'PDF_TEMPLATE_NOT_FOUND',
        message: `Lease PDF template file not found: ${relativePath}`,
      });
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

  private assertRenderedHtml(html: string) {
    const trimmed = html.trim();
    if (!trimmed) {
      throw new UnprocessableEntityException({
        code: 'PDF_TEMPLATE_INVALID',
        message: 'Rendered lease PDF HTML is empty',
      });
    }
    if (!/^<!doctype html>/i.test(trimmed)) {
      throw new UnprocessableEntityException({
        code: 'PDF_TEMPLATE_INVALID',
        message: 'Rendered lease PDF HTML is missing <!DOCTYPE html>',
      });
    }
    const unresolved = [];
    if (trimmed.includes('{{')) unresolved.push('{{');
    if (trimmed.includes('}}')) unresolved.push('}}');
    if (trimmed.includes('undefined')) unresolved.push('undefined');
    if (trimmed.includes('[object Object]')) unresolved.push('[object Object]');
    if (unresolved.length) {
      throw new UnprocessableEntityException({
        code: 'PDF_TEMPLATE_INVALID',
        message: `Rendered lease PDF HTML contains unresolved content: ${unresolved.join(', ')}`,
      });
    }
  }

  private variables(context: LeaseDocumentRenderContext) {
    const rentLines = [
      context.lease.baseRent > 0 ? `<li>Loyer de base : ${money(context.lease.baseRent, context.lease.currency)}</li>` : '',
      context.lease.maintenanceFee > 0 ? `<li>Frais d'entretien : ${money(context.lease.maintenanceFee, context.lease.currency)}</li>` : '',
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
      maintenanceFee: money(context.lease.maintenanceFee, context.lease.currency),
      guaranteeBaseAmount: money(context.lease.guaranteeBaseAmount, context.lease.currency),
      guaranteeMonths: String(context.lease.guaranteeMonths),
      guaranteeAmount: money(context.lease.guaranteeAmount, context.lease.currency),
      guaranteeFormula: `(${money(context.lease.baseRent, context.lease.currency)} + ${money(context.lease.maintenanceFee, context.lease.currency)}) x ${context.lease.guaranteeMonths} = ${money(context.lease.guaranteeAmount, context.lease.currency)}`,
      rentBreakdown: rentLines ? `<ul>${rentLines}</ul>` : '',
      signature: '',
    };
  }
}

function landlordParagraph(context: LeaseDocumentRenderContext) {
  const landlord = context.landlord;
  const representativeFormattedName = formatPersonNameWithCivility(landlord.representativeCivility, landlord.representativeName);
  return [
    `${landlord.companyName}${landlord.acronym ? ` (${landlord.acronym})` : ''}`,
    landlord.legalForm,
    landlord.rccm ? `immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro ${landlord.rccm}` : '',
    landlord.nationalId ? `enregistrée à l'Identification Nationale sous le numéro ${landlord.nationalId}` : '',
    landlord.address ? `dont le siège social est établi à ${landlord.address}` : '',
    representativeFormattedName
      ? `représentée par ${representativeFormattedName}${landlord.representativeTitle ? `, agissant en qualité de ${landlord.representativeTitle}` : ''}`
      : '',
    'ci-après dénommée « le Bailleur »',
  ].filter(Boolean).join(', ') + ' ;';
}

function tenantParagraph(context: LeaseDocumentRenderContext) {
  const tenant = context.tenant;
  const representativeFormattedName = formatPersonNameWithCivility(tenant.representativeCivility, tenant.representativeName);
  if (tenant.type === 'PERSONNE_MORALE') {
    return [
      `${tenant.displayName}${tenant.legalForm ? `, ${tenant.legalForm}` : ''}`,
      tenant.rccm ? `immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro ${tenant.rccm}` : '',
      tenant.nationalId ? `enregistrée à l'Identification Nationale sous le numéro ${tenant.nationalId}` : '',
      tenant.address ? `dont le siège social est établi à ${tenant.address}` : '',
      representativeFormattedName
        ? `représentée par ${representativeFormattedName}${tenant.representativeTitle ? `, agissant en qualité de ${tenant.representativeTitle}` : ''}`
        : '',
      'ci-après dénommée « le Preneur »',
    ].filter(Boolean).join(', ') + ' ;';
  }

  const formattedTenantName = formatPersonNameWithCivility(tenant.civility, tenant.displayName);
  return [
    formattedTenantName,
    tenant.identityType ? `titulaire de la pièce d'identité ${tenant.identityType}` : '',
    tenant.identityNumber ? `numéro ${tenant.identityNumber}` : '',
    tenant.address ? `${isFemaleCivility(tenant.civility) ? 'domiciliée' : 'domicilié'} à ${tenant.address}` : '',
    isFemaleCivility(tenant.civility) ? 'ci-après dénommée « le Preneur »' : 'ci-après dénommé « le Preneur »',
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

function resolveCivilityLabel(value: string) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'MR') return 'Monsieur';
  if (normalized === 'MRS') return 'Madame';
  return '';
}

function isFemaleCivility(value: string) {
  return String(value ?? '').trim().toUpperCase() === 'MRS';
}

function formatPersonNameWithCivility(civility: string, name: string) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return '';
  const label = resolveCivilityLabel(civility);
  return label ? `${label} ${cleanName}` : cleanName;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
