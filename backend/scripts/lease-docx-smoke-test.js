const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { buildLeaseContractDocxBuffer, ensureLeaseArticle2RateSentence } = require('../dist/leases/lease-contracts.js');

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
  };
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

  console.log(`SOURCE OK: ${sourcePath}`);
  console.log(`TEMPLATE OK: ${templatePath}`);
  console.log(`GENERATED OK: ${outputPath}`);
  console.log(`GENERATED SIZE: ${buffer.byteLength} bytes`);
  console.log(`ARTICLE 02 OK: 1`);
  console.log(`REVISION CLAUSE OK: 1`);
  console.log(`RATE SENTENCE OK: 1`);
  console.log(`NORMALIZATION IDEMPOTENT OK: 1`);
  console.log('Occurrences mojibake -> 0');
}

run();
