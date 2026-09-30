const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const {
  buildLeaseContractDocxBuffer,
  buildLeaseContractPdfBase64,
  ensureLeaseArticle2RateSentence,
  formatDateInTimeZone,
  renderLeaseContractTemplate,
} = require('../dist/leases/lease-contracts.js');
const { DocumentRendererService } = require('../dist/documents/document-renderer.service.js');
const { DocumentTemplateService } = require('../dist/documents/document-template.service.js');

const sourcePath = path.resolve(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL_SOURCE.docx');
const templatePath = path.resolve(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL.docx');
const outputPath = path.resolve(process.cwd(), 'tmp-lease-contract-smoke.docx');
const revisionClause = 'd) Les montants prévus peuvent être révisés par accord écrit, notamment en fonction des fluctuations économiques et des réalités du marché immobilier.';
const rateSentence = 'Les montants en dollars équivalent au taux du jour en franc congolais.';
const finalRevisionClause = `${revisionClause} ${rateSentence}`;
const renderedContent = [
  'CONTRAT DE BAIL À USAGE RÉSIDENTIEL',
  '',
  'ENTRE LES SOUSSIGNÉS :',
  'Société immobilière de gestion, immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro RCCM-123, enregistrée à l’Identification Nationale sous le numéro IDN-456.',
  '',
  'ARTICLE 01 - DESCRIPTION DES LIEUX',
  'Le Bailleur donne à bail au Preneur l’appartement 1-03 situé dans l’immeuble HOPE TOWER.',
  'La société est établie en République Démocratique du Congo et agit sous la référence n° TEST-001.',
  '',
  'ARTICLE 02 - DURÉE DU BAIL ET LOYER',
  'a) Le présent contrat est conclu pour une durée de 12 mois.',
  'b) Le loyer mensuel du local est constitué de 2 150 USD le mois dont : 1 300 USD loyer, 700 USD Entretien et Maintenance, 150 USD syndic.',
  'c) La garantie locative équivaut à 3 mois (= 2 150 x 3).',
  finalRevisionClause,
  '',
  'ARTICLE 03 - GARANTIE LOCATIVE ET PREMIER PAIEMENT',
  'Le Preneur verse la garantie locative conformément au présent contrat.',
  '',
  'Fait à Kinshasa, le 12/07/2026.',
].join('\n');

const requiredTerms = [
  'société',
  'immatriculée',
  'Crédit',
  'enregistrée à',
  'équivaut à',
  'République Démocratique',
  'n°',
  'ARTICLE 02',
  revisionClause,
  rateSentence,
  finalRevisionClause,
];

const forbiddenTerms = ['\u00c3\u0192', '\u00c3\u201a', '\u00e2\u20ac\u2122', '\u00e2\u20ac\u0153', '\u00e2\u20ac\u009d', '\u00ef\u00bf\u00bd'];

function readDocxXml(filePath) {
  const zip = new PizZip(fs.readFileSync(filePath));
  return zip.file('word/document.xml').asText();
}

function assertTerms(stage, xml, terms, expected) {
  const failing = terms.filter((term) => xml.includes(term) !== expected);
  if (failing.length) {
    throw new Error(`${stage}: contrôle échoué pour ${failing.join(', ')}`);
  }
}

function assertOccurrence(stage, xml, term, expectedCount) {
  const count = xml.split(term).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${stage}: ${term} attendu ${expectedCount} fois, trouvé ${count}`);
  }
}

function run() {
  const sourceXml = readDocxXml(sourcePath);
  const templateXml = readDocxXml(templatePath);

  assertTerms('SOURCE', sourceXml, ['La garantie locative équivaut à', 'Crédit Mobilier', 'République Démocratique'], true);
  assertTerms('SOURCE', sourceXml, forbiddenTerms, false);

  assertTerms('TEMPLATE', templateXml, ['{{LANDLORD_NAME}}', '{{TENANT_PRESENTATION}}', '{{GUARANTEE_SECTION}}'], true);
  assertTerms('TEMPLATE', templateXml, ['Crédit Mobilier', 'République Démocratique', 'l’identification'], true);
  assertTerms('TEMPLATE', templateXml, forbiddenTerms, false);

  const normalizedTemplate = ensureLeaseArticle2RateSentence(renderedContent);
  const normalizedTwice = ensureLeaseArticle2RateSentence(normalizedTemplate);
  if (normalizedTemplate !== normalizedTwice) {
    throw new Error('NORMALIZATION: second rendu non idempotent');
  }
  assertOccurrence('NORMALIZATION', normalizedTemplate, revisionClause, 1);
  assertOccurrence('NORMALIZATION', normalizedTemplate, rateSentence, 1);
  assertTerms('NORMALIZATION', normalizedTemplate, ['d). Les montants prévus', 'equivaut', 'revisés'], false);
  assertOccurrence('NORMALIZATION garantie équivaut préservée', normalizedTemplate, 'La garantie locative équivaut à', 1);

  const targetedCases = [
    {
      name: 'ancienne phrase singulier',
      content: renderedContent.replace(rateSentence, 'Le montant en dollars équivaut au taux du jour.'),
    },
    {
      name: 'ancienne phrase singulier franc congolais',
      content: renderedContent.replace(rateSentence, 'Le montant en dollars équivaut au taux du jour en franc congolais.'),
    },
    {
      name: 'nouvelle phrase pluriel',
      content: renderedContent,
    },
    {
      name: 'clause revision seule',
      content: renderedContent.replace(` ${rateSentence}`, ''),
    },
  ];

  targetedCases.forEach(({ name, content }) => {
    const firstPass = ensureLeaseArticle2RateSentence(content);
    const secondPass = ensureLeaseArticle2RateSentence(firstPass);
    if (firstPass !== secondPass) {
      throw new Error(`NORMALIZATION ${name}: second passage non idempotent`);
    }
    assertOccurrence(`NORMALIZATION ${name}`, firstPass, finalRevisionClause, 1);
    assertOccurrence(`NORMALIZATION ${name}`, firstPass, rateSentence, 1);
    assertTerms(`NORMALIZATION ${name}`, firstPass, ['Le montant en dollars équivaut au taux du jour.', 'Le montant en dollars équivaut au taux du jour en franc congolais.', 'equivaut', 'revisés'], false);
    assertOccurrence(`NORMALIZATION ${name} garantie équivaut préservée`, firstPass, 'La garantie locative équivaut à', 1);
  });

  const outsideArticle2 = [
    'ARTICLE 01 - DESCRIPTION DES LIEUX',
    'Le montant en dollars équivaut au taux du jour.',
    '',
    'ARTICLE 02 - DURÉE DU BAIL ET LOYER',
    revisionClause,
    '',
    'ARTICLE 03 - GARANTIE LOCATIVE',
  ].join('\n');
  const outsideNormalized = ensureLeaseArticle2RateSentence(outsideArticle2);
  assertOccurrence('NORMALIZATION hors ARTICLE 02 ancienne phrase conservée', outsideNormalized, 'Le montant en dollars équivaut au taux du jour.', 1);
  assertOccurrence('NORMALIZATION hors ARTICLE 02 nouvelle phrase article 02', outsideNormalized, rateSentence, 1);

  const timezoneCases = [
    ['2026-09-10T22:30:00.000Z', '10/09/2026', '2026-09-10'],
    ['2026-09-10T23:30:00.000Z', '11/09/2026', '2026-09-11'],
    ['2026-09-11T00:30:00.000Z', '11/09/2026', '2026-09-11'],
  ];
  timezoneCases.forEach(([instant, displayDate, technicalDate]) => {
    const date = new Date(instant);
    if (formatDateInTimeZone(date, 'Africa/Kinshasa') !== displayDate) {
      throw new Error(`TIMEZONE ${instant}: date Kinshasa attendue ${displayDate}`);
    }
    if (formatDateInTimeZone(date, 'Africa/Kinshasa', 'technical') !== technicalDate) {
      throw new Error(`TIMEZONE ${instant}: date technique attendue ${technicalDate}`);
    }
  });

  const variables = {
    LANDLORD_NAME: 'Société immobilière de gestion',
    LANDLORD_RCCM: 'RCCM-123',
    LANDLORD_NATIONAL_ID: 'IDN-456',
    LANDLORD_ADDRESS: '12 avenue de la Gombe, Kinshasa',
    LANDLORD_REPRESENTATIVE_TITLE: 'Gérant',
    LANDLORD_REPRESENTATIVE: 'Tonton Tata',
    TENANT_PRESENTATION: 'Monsieur Tonton Tata, titulaire de la pièce d’identité n° A12345, domicilié à Kinshasa.',
    TENANT_PHYSICAL_NOTE: 'Titulaire de la pièce d’identité n° A12345.',
    UNIT_NUMBER: '1-03',
    UNIT_FURNISHING: 'Non Meublé',
    BEDROOM_COUNT: '2',
    PARKING_COUNT: '1',
    BUILDING_NAME: 'HOPE TOWER',
    BUILDING_ADDRESS: 'Avenue du Port',
    BUILDING_COMMUNE: 'Gombe',
    BUILDING_NEIGHBORHOOD: 'Centre-ville',
    BUILDING_CITY: 'Kinshasa',
    START_DATE: '12/07/2026',
    LEASE_DURATION_TEXT: '12 mois',
    NOTICE_MONTHS: '3',
    MONTHLY_SECTION: 'Le loyer mensuel du local est constitué de 2 150 USD le mois dont :\n1 300 USD loyer\n700 USD Entretien et Maintenance\n150 USD syndic',
    GUARANTEE_SECTION: 'La garantie locative équivaut à 3 mois (= 2 150 x 3)',
    BEDROOM_COUNT_TEXT: 'deux',
    SIGNATURE_PLACE: 'Kinshasa',
    SIGNATURE_DATE: '12/07/2026',
    GENERATED_AT: '2026-07-12T10:00:00.000Z',
  };

  const buildingWideVariables = {
    ...variables,
    PROPERTY_SCOPE: 'BUILDING',
    PROPERTY_NATURE: 'Immeuble entier',
    PROPERTY_COMPOSITION: 'Ensemble des 7 unités physiques, parties communes et dépendances',
    PROPERTY_LEASE_DESCRIPTION: 'Le Bailleur donne à bail au Preneur, qui accepte, l’intégralité de l’immeuble dénommé « HOPE TOWER », situé à Avenue du Port, Gombe, Kinshasa.',
    PROPERTY_VISIT_ACKNOWLEDGEMENT: 'Le Preneur reconnaît avoir visité l’immeuble loué, ses unités, parties communes et dépendances, et les connaître parfaitement.',
    BUILDING_UNIT_COUNT: '7',
    UNIT_NUMBER: 'IMMEUBLE ENTIER',
  };
  const legacyBuildingTemplate = [
    'PRÉCISIONS SUR LE BIEN LOUÉ',
    'Type | {{UNIT_FURNISHING}}',
    'Appartement / unité | {{UNIT_NUMBER}}',
    'Immeuble | {{BUILDING_NAME}}',
    'Nombre de chambres | {{BEDROOM_COUNT}}',
    'Nombre de parkings | {{PARKING_COUNT}}',
    '',
    'ARTICLE 01 - DESCRIPTION DES LIEUX',
    "Le Bailleur donne à bail au Preneur, qui accepte, l'appartement {{UNIT_NUMBER}}, situé dans l'immeuble {{BUILDING_NAME}}, à l'adresse suivante : {{BUILDING_ADDRESS}}.",
    "Le Preneur reconnaît avoir visité les lieux loués et les connaître parfaitement.",
    'Pour un appartement de {{BEDROOM_COUNT}} chambre(s), l’occupation autorisée doit rester conforme aux capacités du logement.',
  ].join('\n');
  const buildingWideLegacyRendered = renderLeaseContractTemplate(legacyBuildingTemplate, buildingWideVariables);
  assertTerms('BUILDING DOCX', buildingWideLegacyRendered, ['Nature du bien | Immeuble entier', 'Nombre d’unités | 7', 'l’intégralité de l’immeuble', 'parties communes et dépendances'], true);
  assertTerms('BUILDING DOCX', buildingWideLegacyRendered, ['IMMEUBLE ENTIER', 'Appartement / unité', 'Nombre de chambres', 'Nombre de parkings', 'Pour un appartement'], false);
  const unitLegacyRendered = renderLeaseContractTemplate(legacyBuildingTemplate, variables);
  assertTerms('UNIT DOCX REGRESSION', unitLegacyRendered, ['Appartement / unité | 1-03', 'Nombre de chambres | 2', "l'appartement 1-03"], true);

  const renderer = new DocumentRendererService();
  const templateService = new DocumentTemplateService();
  const basePdfSnapshot = {
    ...variables,
    bailleur: { raison_sociale: 'Société immobilière de gestion' },
    locataire: { type: 'PERSONNE_PHYSIQUE', nom_complet: 'Locataire Test' },
    bail: {
      type_contrat: 'RESIDENTIAL', usage_label: 'Résidentiel', date_debut: '12/07/2026', date_fin: '11/07/2027',
      duree_texte: '12 mois', loyer_base: '1300', frais_entretien: '700', frais_syndic: '150', autres_charges: '0',
      garantie_nombre_mois: '3', devise: 'USD',
    },
  };
  const buildingWideHtml = templateService.renderLeaseTemplate(renderer.buildLeaseRenderContext({
    ...basePdfSnapshot,
    bien: {
      scope: 'BUILDING', nature_label: 'Immeuble entier', immeuble: 'HOPE TOWER', adresse_complete: 'Avenue du Port, Gombe, Kinshasa',
      nombre_unites: '7', composition_label: 'Ensemble des 7 unités physiques, parties communes et dépendances', usage: 'Résidentiel',
    },
  })).html;
  assertTerms('BUILDING PDF', buildingWideHtml, ['Nature du bien', 'Immeuble entier', 'Nombre d’unités', 'l’intégralité de l’immeuble', 'ses unités, parties communes et dépendances'], true);
  assertTerms('BUILDING PDF', buildingWideHtml, ['Appartement / unité', 'Nombre de chambres', 'Non meublé', 'IMMEUBLE ENTIER', 'Pour un appartement de 0'], false);
  ['RESIDENTIAL', 'COMMERCIAL', 'PROFESSIONAL', 'MIXED'].forEach((usage) => {
    const html = templateService.renderLeaseTemplate(renderer.buildLeaseRenderContext({
      ...basePdfSnapshot,
      bail: { ...basePdfSnapshot.bail, type_contrat: usage, usage_label: usage, activite_destination: 'Gestion immobilière' },
      bien: {
        scope: 'BUILDING', nature_label: 'Immeuble entier', immeuble: 'HOPE TOWER', adresse_complete: 'Avenue du Port, Gombe, Kinshasa',
        nombre_unites: '7', composition_label: 'Ensemble des 7 unités physiques, parties communes et dépendances', usage,
      },
    })).html;
    assertTerms(`BUILDING PDF ${usage}`, html, ['Nature du bien', 'Immeuble entier', 'l’intégralité de l’immeuble'], true);
    assertTerms(`BUILDING PDF ${usage}`, html, ['IMMEUBLE ENTIER', 'Appartement / unité', "l'unité IMMEUBLE ENTIER"], false);
  });
  const unitHtml = templateService.renderLeaseTemplate(renderer.buildLeaseRenderContext({
    ...basePdfSnapshot,
    bien: {
      scope: 'UNIT', numero_unite: '1-03', immeuble: 'HOPE TOWER', adresse_complete: 'Avenue du Port, Gombe, Kinshasa',
      nombre_chambres: '2', nombre_parkings: '1', meuble_label: 'Non meublé', usage: 'Résidentiel',
    },
  })).html;
  assertTerms('UNIT PDF REGRESSION', unitHtml, ['Appartement / unité', '1-03', 'Nombre de chambres', 'Pour un appartement de 2 chambre(s)'], true);
  const buffer = buildLeaseContractDocxBuffer(variables, renderedContent);

  fs.writeFileSync(outputPath, buffer);
  const generatedXml = readDocxXml(outputPath);

  assertTerms('GENERATED', generatedXml, requiredTerms, true);
  assertTerms('GENERATED', generatedXml, forbiddenTerms, false);
  assertTerms('GENERATED', generatedXml, ['revisés', 'equivaut', 'd). Les montants prévus', 'Le montant en dollars équivaut au taux du jour.'], false);
  assertOccurrence('GENERATED garantie équivaut préservée', generatedXml, 'La garantie locative équivaut à', 1);
  assertOccurrence('GENERATED', generatedXml, revisionClause, 1);
  assertOccurrence('GENERATED', generatedXml, rateSentence, 1);
  assertOccurrence('GENERATED', generatedXml, finalRevisionClause, 1);
  if (buffer.byteLength < 10 * 1024) {
    throw new Error(`GENERATED: document trop petit (${buffer.byteLength} octets)`);
  }

  const timezoneInstant = '2026-09-10T23:30:00.000Z';
  const timezoneDate = formatDateInTimeZone(new Date(timezoneInstant), 'Africa/Kinshasa');
  const timezoneRenderedContent = renderedContent.replace('Fait à Kinshasa, le 12/07/2026.', `Fait à Kinshasa, le ${timezoneDate}.`);
  const timezoneVariables = {
    ...variables,
    SIGNATURE_DATE: timezoneDate,
    GENERATED_AT: timezoneInstant,
  };
  const timezoneBuffer = buildLeaseContractDocxBuffer(timezoneVariables, timezoneRenderedContent);
  const timezoneXml = new PizZip(timezoneBuffer).file('word/document.xml').asText();
  assertOccurrence('TIMEZONE DOCX signature', timezoneXml, 'Fait à Kinshasa, le 11/09/2026.', 1);
  assertOccurrence('TIMEZONE DOCX footer', timezoneXml, 'Généré le 11/09/2026', 1);
  const timezonePdfBuffer = Buffer.from(buildLeaseContractPdfBase64(timezoneRenderedContent, 'CONTRAT DE BAIL TEST TIMEZONE', timezoneVariables), 'base64');
  if (!timezonePdfBuffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error('TIMEZONE PDF: signature PDF absente');
  }
  if (timezonePdfBuffer.byteLength < 1000) {
    throw new Error(`TIMEZONE PDF: document trop petit (${timezonePdfBuffer.byteLength} octets)`);
  }

  console.log(`SOURCE OK: ${sourcePath}`);
  console.log(`TEMPLATE OK: ${templatePath}`);
  console.log(`GENERATED OK: ${outputPath}`);
  console.log(`GENERATED SIZE: ${buffer.byteLength} bytes`);
  console.log(`ARTICLE 02 OK: 1`);
  console.log(`REVISION CLAUSE OK: 1`);
  console.log(`RATE SENTENCE OK: 1`);
  console.log(`NORMALIZATION IDEMPOTENT OK: 1`);
  console.log(`TIMEZONE KINSHASA OK: ${timezoneDate}`);
  console.log(`TIMEZONE DOCX OK: Fait à Kinshasa, le ${timezoneDate}.`);
  console.log(`TIMEZONE PDF OK: ${timezonePdfBuffer.byteLength} bytes`);
  console.log('WHOLE BUILDING PDF/DOCX OK: 1');
  console.log('UNIT CONTRACT REGRESSION OK: 1');
  console.log('Occurrences mojibake -> 0');
}

run();
