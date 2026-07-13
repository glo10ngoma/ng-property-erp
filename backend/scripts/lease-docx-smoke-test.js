const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { buildLeaseContractDocxBuffer } = require('../dist/leases/lease-contracts.js');

const sourcePath = path.resolve(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL_SOURCE.docx');
const templatePath = path.resolve(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL.docx');
const outputPath = path.resolve(process.cwd(), 'tmp-lease-contract-smoke.docx');

const requiredTerms = [
  'société',
  'immatriculée',
  'Crédit',
  'enregistrée à',
  'équivaut à',
  'République Démocratique',
  'n°',
];

const forbiddenTerms = ['Ãƒ', 'Ã‚', 'â€™', 'â€œ', 'â€\u009d', 'ï¿½'];

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

function run() {
  const sourceXml = readDocxXml(sourcePath);
  const templateXml = readDocxXml(templatePath);

  assertTerms('SOURCE', sourceXml, ['La garantie locative équivaut à', 'Crédit Mobilier', 'République Démocratique'], true);
  assertTerms('SOURCE', sourceXml, forbiddenTerms, false);

  assertTerms('TEMPLATE', templateXml, ['{{LANDLORD_NAME}}', '{{TENANT_PRESENTATION}}', '{{GUARANTEE_SECTION}}'], true);
  assertTerms('TEMPLATE', templateXml, ['Crédit Mobilier', 'République Démocratique', 'l’identification'], true);
  assertTerms('TEMPLATE', templateXml, forbiddenTerms, false);

  const buffer = buildLeaseContractDocxBuffer({
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
  });

  fs.writeFileSync(outputPath, buffer);
  const generatedXml = readDocxXml(outputPath);

  assertTerms('GENERATED', generatedXml, requiredTerms, true);
  assertTerms('GENERATED', generatedXml, forbiddenTerms, false);

  console.log(`SOURCE OK: ${sourcePath}`);
  console.log(`TEMPLATE OK: ${templatePath}`);
  console.log(`GENERATED OK: ${outputPath}`);
  console.log(`Occurrences mojibake -> Ãƒ: 0, Ã‚: 0, â€™: 0, â€œ: 0, â€”: 0, ï¿½: 0`);
}

run();
