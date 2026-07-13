const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const source = path.join(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL_SOURCE.docx');
const target = path.join(__dirname, '..', 'templates', 'leases', 'LEASE_RESIDENTIAL.docx');

const xmlNs = 'http://www.w3.org/XML/1998/namespace';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphText(node) {
  const texts = [];
  const walk = (current) => {
    if (!current) return;
    if (current.nodeType === 3) {
      texts.push(current.nodeValue ?? '');
      return;
    }
    for (let child = current.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(node);
  return texts.join('').trim();
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstChildByLocalName(node, localName) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.localName === localName) return child;
  }
  return null;
}

function resetParagraphText(paragraph, text, document) {
  const firstRun = firstChildByLocalName(paragraph, 'r');
  const firstRunProps = firstRun ? firstChildByLocalName(firstRun, 'rPr') : null;
  const paragraphProps = firstChildByLocalName(paragraph, 'pPr');

  while (paragraph.firstChild) {
    paragraph.removeChild(paragraph.firstChild);
  }
  if (paragraphProps) {
    paragraph.appendChild(paragraphProps);
  }

  const run = document.createElementNS(wordNs, 'w:r');
  if (firstRunProps) {
    run.appendChild(firstRunProps.cloneNode(true));
  }
  const textNode = document.createElementNS(wordNs, 'w:t');
  if (/^\s|\s$| {2,}/.test(text)) {
    textNode.setAttributeNS(xmlNs, 'xml:space', 'preserve');
  }
  textNode.appendChild(document.createTextNode(text));
  run.appendChild(textNode);
  paragraph.appendChild(run);
}

function replaceParagraphExact(paragraphs, exact, replacement, document) {
  const expected = normalizeText(exact);
  const paragraph = paragraphs.find((node) => normalizeText(paragraphText(node)) === expected);
  if (!paragraph) {
    throw new Error(`Paragraphe introuvable: ${exact}`);
  }
  resetParagraphText(paragraph, replacement, document);
}

function replaceParagraphContains(paragraphs, fragment, replacement, document) {
  const expected = normalizeText(fragment);
  const paragraph = paragraphs.find((node) => normalizeText(paragraphText(node)).includes(expected));
  if (!paragraph) {
    throw new Error(`Paragraphe introuvable (fragment): ${fragment}`);
  }
  resetParagraphText(paragraph, replacement, document);
}

function removeParagraphExact(paragraphs, exact) {
  const expected = normalizeText(exact);
  const paragraph = paragraphs.find((node) => normalizeText(paragraphText(node)) === expected);
  if (!paragraph || !paragraph.parentNode) {
    throw new Error(`Paragraphe introuvable: ${exact}`);
  }
  paragraph.parentNode.removeChild(paragraph);
}

function replaceCellExact(cells, exact, replacement, document) {
  const expected = normalizeText(exact);
  const cell = cells.find((node) => normalizeText(paragraphText(node)) === expected);
  if (!cell) {
    throw new Error(`Cellule introuvable: ${exact}`);
  }
  let paragraph = null;
  for (let child = cell.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.localName === 'p') {
      paragraph = child;
      break;
    }
  }
  if (!paragraph) {
    throw new Error(`Cellule sans paragraphe: ${exact}`);
  }
  resetParagraphText(paragraph, replacement, document);
}

fs.copyFileSync(source, target);

const zip = new PizZip(fs.readFileSync(target));
const xmlText = zip.file('word/document.xml').asText();
const document = new DOMParser().parseFromString(xmlText, 'application/xml');

const paragraphs = Array.from(document.getElementsByTagName('w:p'));
const cells = Array.from(document.getElementsByTagName('w:tc'));

replaceParagraphExact(
  paragraphs,
  'ENTRE : société (nom societe bailleur) en sigle, immatriculée au Registre du commerce et du Crédit Mobilier de Kinshasa sous le numéro XX-X-XXXX, enregistrée à l’indentification Nationale au XX-XXXXX-XXXXXXX, dont le siège social est établi à Kinshasa, au n XXXX de la Gombe, à Kinshasa, représentée par son Gérant statutaire, Monsieur AHMED MORAD. Ci-après dénommée Le Bailleur d’une part ;',
  'ENTRE : société {{LANDLORD_NAME}}, immatriculée au Registre du commerce et du Crédit Mobilier de Kinshasa sous le numéro {{LANDLORD_RCCM}} (RCCM), enregistrée à l’identification Nationale au {{LANDLORD_NATIONAL_ID}}, dont le siège social est établi à {{LANDLORD_ADDRESS}}, représentée par son {{LANDLORD_REPRESENTATIVE_TITLE}}, Monsieur {{LANDLORD_REPRESENTATIVE}}. Ci-après dénommée Le Bailleur d’une part ;',
  document,
);
replaceParagraphExact(
  paragraphs,
  '(NOM DU TENANT), Société Anonyme / inscrite au Registre du Commerce et du Crédit Mobilier de la Ville de Kinshasa sous le numéro RCCM : XX/XXX/RCCM/ XX-X-XXXX, ainsi qu’au Registre du Ministère de l’Economie Nationale sous le numéro Id. Nat. : XX-XXX- X XXXXXX X, dont le Siège social est sis, XXXX (ADDRESS DU TENANT) dans la Commune de la Gombe, à Kinshasa en République Démocratique du Congo ici représentée par Monsieur NOM ET PRENOM son Directeur Général;',
  '{{TENANT_PRESENTATION}}',
  document,
);
replaceParagraphExact(
  paragraphs,
  'Nom et numero piece d identite au cas ou c était une personne',
  '{{TENANT_PHYSICAL_NOTE}}',
  document,
);
replaceParagraphContains(
  paragraphs,
  'Le Bailleur donne à bail au preneur qui accepte la location d’un appartement N 103 Immeuble A situé sur (ADDRESS IMMEUBLE). (COMMUNE), (quartier), dans la Ville de Kinshasa, République Démocratique du Congo.',
  'Le Bailleur donne à bail au preneur qui accepte la location d’un appartement N{{UNIT_NUMBER}} Immeuble {{BUILDING_NAME}} situé sur {{BUILDING_ADDRESS}}. {{BUILDING_COMMUNE}}, {{BUILDING_NEIGHBORHOOD}}, dans la Ville de {{BUILDING_CITY}}, République Démocratique du Congo. Le Preneur connaît avoir visité les biens loués qu’il connaît parfaitement sans qu’il soit nécessaire d’en faire de plus amples descriptions.',
  document,
);
replaceParagraphExact(
  paragraphs,
  'S’agissant de la durée, le présent contrat de bail est conclus pour une durée d’une année et entre en vigueur à la date de sa signature. Il est renouvelable avec l’accord du bailleur par écrit. Chacune des deux parties peut y mettre fin moyennant un préavis de 3 mois ou par convention mutuelle. Dans ce cas, la partie qui prend l’initiative de mettre fin au contrat devra notifier à l’autre son intention écrite, transmise par la lettre recommandée ou par lettre avec accusé de réceptions sous peine d’indemnités pour rupture abusive.',
  'S’agissant de la durée, le présent contrat de bail est conclus pour une durée de {{LEASE_DURATION_TEXT}} et entre en vigueur à la date de sa signature. Il est renouvelable avec l’accord du bailleur par écrit. Chacune des deux parties peut y mettre fin moyennant un préavis de {{NOTICE_MONTHS}} mois ou par convention mutuelle. Dans ce cas, la partie qui prend l’initiative de mettre fin au contrat devra notifier à l’autre son intention écrite, transmise par la lettre recommandée ou par lettre avec accusé de réceptions sous peine d’indemnités pour rupture abusive.',
  document,
);
replaceParagraphExact(paragraphs, 'Le loyer mensuel du local est constitué de 2,150 USD le mois dont :', '{{MONTHLY_SECTION}}', document);
removeParagraphExact(paragraphs, '1,300 USD loyer');
removeParagraphExact(paragraphs, '700 USD Entretien et Maintenance');
removeParagraphExact(paragraphs, '150 USD syndic');
replaceParagraphExact(paragraphs, 'La garantie locative équivaut à 3 mois (= 2150 x 3)', '{{GUARANTEE_SECTION}}', document);
replaceParagraphExact(
  paragraphs,
  'Le locataire n’est pas tenu de retenir l’impôt sur le Revenu Locative (IRL) ou de payer toutes autres taxes liées à ce bail, en tant que le loyer constitue le chiffre d’affaires de la Société Catalyse, en tant que telle comme le stipule son objectif social.',
  'Le locataire n’est pas tenu de retenir l’impôt sur le Revenu Locative (IRL) ou de payer toutes autres taxes liées à ce bail, en tant que le loyer constitue le chiffre d’affaires de la Société {{LANDLORD_NAME}}, en tant que telle comme le stipule son objectif social.',
  document,
);
replaceParagraphExact(
  paragraphs,
  'Pour occuper un (1) appartement de Deux chambres, il n’est autorisé qu’une seule famille. Pour des cas d’occupation individuelle, 2 à 3 personnes célibataires peuvent partager un même appartement.',
  'Pour occuper un (1) appartement de {{BEDROOM_COUNT_TEXT}} chambres, il n’est autorisé qu’une seule famille. Pour des cas d’occupation individuelle, 2 à 3 personnes célibataires peuvent partager un même appartement.',
  document,
);
replaceParagraphExact(
  paragraphs,
  'En cas de non-respect de l’une des clauses, le bailleur peut résilier le contrat de bail moyennant un préavis de 3 mois ;',
  'En cas de non-respect de l’une des clauses, le bailleur peut résilier le contrat de bail moyennant un préavis de {{NOTICE_MONTHS}} mois ;',
  document,
);
replaceParagraphExact(paragraphs, 'Fait à Kinshasa, le / /', 'Fait à {{SIGNATURE_PLACE}}, le {{SIGNATURE_DATE}}', document);

replaceCellExact(cells, 'Appartement Non Meublé', 'Appartement {{UNIT_FURNISHING}}', document);
replaceCellExact(cells, 'A103', '{{UNIT_NUMBER}}', document);
replaceCellExact(cells, '2', '{{BEDROOM_COUNT}}', document);
replaceCellExact(cells, '1', '{{PARKING_COUNT}}', document);
replaceCellExact(cells, '01/07/2026', '{{START_DATE}}', document);

zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
fs.writeFileSync(target, zip.generate({ type: 'nodebuffer' }));

console.log('Template created');
