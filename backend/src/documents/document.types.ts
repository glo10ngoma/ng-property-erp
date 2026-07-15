export type LeaseDocumentUsage = 'RESIDENTIAL' | 'COMMERCIAL' | 'PROFESSIONAL' | 'MIXED';

export type LeaseDocumentRenderContext = {
  contract: {
    number: string;
    title: string;
    generatedAt: string;
    signaturePlace: string;
    signatureDate: string;
  };
  landlord: {
    companyName: string;
    acronym: string;
    legalForm: string;
    rccm: string;
    nationalId: string;
    taxId: string;
    address: string;
    city: string;
    country: string;
    representativeName: string;
    representativeTitle: string;
    representativeCivility: string;
  };
  tenant: {
    type: string;
    displayName: string;
    legalForm: string;
    rccm: string;
    nationalId: string;
    address: string;
    representativeName: string;
    representativeTitle: string;
    representativeCivility: string;
    identityType: string;
    identityNumber: string;
  };
  property: {
    type: string;
    unitLabel: string;
    buildingName: string;
    address: string;
    city: string;
    bedrooms: string;
    parkingSpaces: string;
    furnishedLabel: string;
  };
  lease: {
    usage: LeaseDocumentUsage;
    usageLabel: string;
    activityDescription: string;
    startDate: string;
    endDate: string;
    durationMonths: number;
    durationText: string;
    noticeMonths: string;
    baseRent: number;
    maintenanceFee: number;
    syndicFee: number;
    otherCharges: number;
    totalMonthly: number;
    guaranteeMonths: number;
    guaranteeAmount: number;
    currency: string;
  };
  rawSnapshot: Record<string, unknown>;
};

export type RenderedLeaseDocument = {
  html: string;
  templateCode: string;
  templateSource: string;
  rendererVersion: string;
  templateHash: string;
};
