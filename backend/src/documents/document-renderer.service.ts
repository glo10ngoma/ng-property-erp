import type { LeaseDocumentRenderContext, LeaseDocumentUsage } from './document.types';

export class DocumentRendererService {
  buildLeaseRenderContext(snapshot: Record<string, any>): LeaseDocumentRenderContext {
    const usage = this.normalizeUsage(snapshot?.bail?.type_contrat ?? snapshot?.bail?.usage_label ?? snapshot?.LEASE_USAGE);
    const baseRent = numberValue(snapshot?.bail?.loyer_base ?? snapshot?.MONTHLY_RENT);
    const maintenanceFee = numberValue(snapshot?.bail?.frais_entretien ?? snapshot?.MAINTENANCE_AMOUNT);
    const syndicFee = numberValue(snapshot?.bail?.frais_syndic ?? snapshot?.SYNDIC_AMOUNT);
    const otherCharges = numberValue(snapshot?.bail?.autres_charges ?? snapshot?.OTHER_CHARGES_AMOUNT);
    const guaranteeMonths = Math.max(0, Math.floor(numberValue(snapshot?.bail?.garantie_nombre_mois ?? snapshot?.GUARANTEE_MONTHS)));
    const totalMonthly = baseRent + maintenanceFee + syndicFee + otherCharges;
    const guaranteeAmount = baseRent * guaranteeMonths;
    return {
      contract: {
        number: text(snapshot.LEASE_REFERENCE),
        title: this.titleForUsage(usage),
        generatedAt: new Date().toISOString(),
        signaturePlace: text(snapshot?.bail?.lieu_signature ?? snapshot.SIGNATURE_PLACE, 'Kinshasa'),
        signatureDate: text(snapshot?.bail?.date_signature ?? snapshot.SIGNATURE_DATE),
      },
      landlord: {
        companyName: text(snapshot?.bailleur?.raison_sociale ?? snapshot.LANDLORD_NAME),
        acronym: text(snapshot?.bailleur?.sigle ?? snapshot.LANDLORD_ACRONYM),
        legalForm: text(snapshot?.bailleur?.forme_juridique ?? snapshot.LANDLORD_LEGAL_FORM),
        rccm: text(snapshot?.bailleur?.rccm ?? snapshot.LANDLORD_RCCM),
        nationalId: text(snapshot?.bailleur?.identification_nationale ?? snapshot.LANDLORD_NATIONAL_ID),
        taxId: text(snapshot?.bailleur?.numero_fiscal ?? snapshot.LANDLORD_TAX_ID),
        address: text(snapshot?.bailleur?.adresse_complete ?? snapshot.LANDLORD_ADDRESS),
        city: text(snapshot?.bailleur?.ville ?? snapshot.LANDLORD_CITY),
        country: text(snapshot?.bailleur?.pays ?? snapshot.LANDLORD_COUNTRY),
        representativeName: text(snapshot?.bailleur?.representant_nom ?? snapshot.LANDLORD_REPRESENTATIVE),
        representativeTitle: text(snapshot?.bailleur?.representant_fonction ?? snapshot.LANDLORD_REPRESENTATIVE_TITLE),
        representativeCivility: text(snapshot?.bailleur?.representant_civilite ?? snapshot.LANDLORD_REPRESENTATIVE_CIVILITY),
      },
      tenant: {
        type: text(snapshot?.locataire?.type, 'PERSONNE_PHYSIQUE'),
        displayName: text(snapshot?.locataire?.raison_sociale ?? snapshot?.locataire?.nom_complet ?? snapshot.TENANT_NAME),
        legalForm: text(snapshot?.locataire?.forme_juridique ?? snapshot.TENANT_LEGAL_FORM),
        rccm: text(snapshot?.locataire?.rccm ?? snapshot.TENANT_RCCM),
        nationalId: text(snapshot?.locataire?.identification_nationale ?? snapshot.TENANT_ID),
        address: text(snapshot?.locataire?.adresse_complete ?? snapshot.TENANT_ADDRESS),
        representativeName: text(snapshot?.locataire?.representant_nom ?? snapshot.TENANT_REPRESENTATIVE_NAME),
        representativeTitle: text(snapshot?.locataire?.representant_fonction ?? snapshot.TENANT_REPRESENTATIVE_TITLE),
        representativeCivility: text(snapshot?.locataire?.representant_civilite ?? snapshot.TENANT_REPRESENTATIVE_CIVILITY),
        identityType: text(snapshot?.locataire?.type_piece_identite ?? snapshot.TENANT_IDENTITY_TYPE),
        identityNumber: text(snapshot?.locataire?.numero_piece_identite ?? snapshot.TENANT_ID),
      },
      property: {
        type: text(snapshot?.bien?.usage ?? snapshot?.bail?.usage_label, this.labelForUsage(usage)),
        unitLabel: text(snapshot?.bien?.numero_unite ?? snapshot.UNIT_NUMBER),
        buildingName: text(snapshot?.bien?.immeuble ?? snapshot.BUILDING_NAME),
        address: text(snapshot?.bien?.adresse_complete ?? snapshot.BUILDING_ADDRESS),
        city: text(snapshot?.bien?.ville ?? snapshot.BUILDING_CITY),
        bedrooms: text(snapshot?.bien?.nombre_chambres ?? snapshot.BEDROOM_COUNT, '0'),
        parkingSpaces: text(snapshot?.bien?.nombre_parkings ?? snapshot.PARKING_COUNT, '0'),
        furnishedLabel: text(snapshot?.bien?.meuble_label ?? snapshot.UNIT_FURNISHING),
      },
      lease: {
        usage,
        usageLabel: this.labelForUsage(usage),
        activityDescription: text(snapshot?.bail?.activite_destination),
        startDate: text(snapshot?.bail?.date_debut ?? snapshot.START_DATE),
        endDate: text(snapshot?.bail?.date_fin ?? snapshot.END_DATE),
        durationMonths: numberValue(snapshot.LEASE_DURATION_MONTHS),
        durationText: text(snapshot?.bail?.duree_texte ?? snapshot.LEASE_DURATION_TEXT),
        noticeMonths: text(snapshot?.bail?.preavis_mois ?? snapshot.NOTICE_MONTHS, '0'),
        baseRent,
        maintenanceFee,
        syndicFee,
        otherCharges,
        totalMonthly,
        guaranteeMonths,
        guaranteeAmount,
        currency: text(snapshot?.bail?.devise ?? snapshot.CURRENCY, 'USD'),
      },
      rawSnapshot: snapshot,
    };
  }

  private normalizeUsage(value: unknown): LeaseDocumentUsage {
    const raw = String(value ?? '').toUpperCase();
    if (raw.includes('COMMERCIAL')) return 'COMMERCIAL';
    if (raw.includes('PROFESSIONAL') || raw.includes('PROFESSIONNEL')) return 'PROFESSIONAL';
    if (raw.includes('MIXED') || raw.includes('MIXTE')) return 'MIXED';
    return 'RESIDENTIAL';
  }

  private titleForUsage(usage: LeaseDocumentUsage) {
    return `CONTRAT DE BAIL À USAGE ${this.labelForUsage(usage).toUpperCase()}`;
  }

  private labelForUsage(usage: LeaseDocumentUsage) {
    if (usage === 'COMMERCIAL') return 'Commercial';
    if (usage === 'PROFESSIONAL') return 'Professionnel';
    if (usage === 'MIXED') return 'Mixte';
    return 'Résidentiel';
  }
}

function text(value: unknown, fallback = '') {
  const output = String(value ?? '').normalize('NFC').trim();
  return output || fallback;
}

function numberValue(value: unknown) {
  const normalized = String(value ?? '0').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}
