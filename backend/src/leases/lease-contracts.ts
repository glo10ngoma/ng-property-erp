import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import PizZip from 'pizzip';

type VariableValue = string | number | null | undefined;
type ContractBlock = { type: 'text'; lines: string[] } | { type: 'table'; rows: Array<[string, string]> };
type PdfLine = { text: string; kind: 'normal' | 'title' | 'article' | 'table' | 'signature' | 'blank' };
type LeaseContractHeaderRow = { label: string; value: string };
type LeaseContractDocumentContext = {
  title: string;
  headerRows: LeaseContractHeaderRow[];
  footer: {
    companyName: string;
    contractNumber: string;
    generatedAt: string;
  };
  blocks: ContractBlock[];
  snapshot: Record<string, unknown>;
};

const DEFAULT_TITLE = 'CONTRAT DE BAIL À USAGE RÉSIDENTIEL';
const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_X = 50;
const PDF_MARGIN_TOP = 60;
const PDF_MARGIN_BOTTOM = 54;
const PDF_LINE_HEIGHT = 14;
const PDF_MAX_CHARS = 96;
const SIGNATURE_TABLE_WIDTH = 4500;
const SIGNATURE_TABLE_TITLE_HEIGHT = 380;
const SIGNATURE_TABLE_BODY_ROW_HEIGHT = 560;
const SIGNATURE_TABLE_BODY_ROWS = 5;
const SIGNATURE_TABLE_GAP = 12;
const DOCX_TEMPLATE_VERSION = 'DOCX_UTF8_V2';
const DOCX_TEMPLATE_NAME = 'LEASE_RESIDENTIAL.docx';
const DOCX_TEMPLATE_CANDIDATES = [
  path.resolve(process.cwd(), 'dist', 'templates', 'leases', DOCX_TEMPLATE_NAME),
  path.resolve(process.cwd(), 'templates', 'leases', DOCX_TEMPLATE_NAME),
  path.resolve(__dirname, '..', '..', 'templates', 'leases', DOCX_TEMPLATE_NAME),
];
const DOCX_TEMPLATE_FORBIDDEN_SEQUENCES = ['ÃƒÆ’', 'Ãƒâ€š', 'Ã¢â‚¬â„¢', 'Ã¢â‚¬Å“', 'Ã¢â‚¬\u009d', 'Ã¯Â¿Â½'];

const winAnsiMap: Record<string, number> = {
  '\u20ac': 128,
  '\u201a': 130,
  '\u0192': 131,
  '\u201e': 132,
  '\u2026': 133,
  '\u2020': 134,
  '\u2021': 135,
  '\u02c6': 136,
  '\u2030': 137,
  '\u0160': 138,
  '\u2039': 139,
  '\u0152': 140,
  '\u017d': 142,
  '\u2018': 145,
  '\u2019': 146,
  '\u201c': 147,
  '\u201d': 148,
  '\u2022': 149,
  '\u2013': 150,
  '\u2014': 151,
  '\u02dc': 152,
  '\u2122': 153,
  '\u0161': 154,
  '\u203a': 155,
  '\u0153': 156,
  '\u017e': 158,
  '\u0178': 159,
};

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flattenVariables(input: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(input).reduce<Record<string, string>>((accumulator, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(accumulator, flattenVariables(value as Record<string, unknown>, nextKey));
    } else {
      accumulator[nextKey] = formatVariableValue(value as VariableValue);
    }
    return accumulator;
  }, {});
}

function formatVariableValue(value: VariableValue) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFC').trim();
}

function cleanText(value: unknown, fallback = '') {
  const normalized = formatVariableValue(value as VariableValue);
  return normalized || fallback;
}

function resolveDocxTemplatePath() {
  const matchedPath = DOCX_TEMPLATE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!matchedPath) {
    throw new BadRequestException(`Modele DOCX introuvable: ${DOCX_TEMPLATE_CANDIDATES[0]}`);
  }
  return matchedPath;
}

function fileSha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readDocxDocumentXml(buffer: Buffer) {
  const zip = new PizZip(buffer);
  return zip.file('word/document.xml')?.asText() ?? '';
}

function assertDocxTemplateIntegrity(documentXml: string) {
  const corruptedToken = DOCX_TEMPLATE_FORBIDDEN_SEQUENCES.find((token) => documentXml.includes(token));
  if (corruptedToken) {
    throw new BadRequestException('Le modele DOCX deploye est corrompu.');
  }
}

export function getLeaseContractTemplateMetadata() {
  const templatePath = resolveDocxTemplatePath();
  const buffer = fs.readFileSync(templatePath);
  const documentXml = readDocxDocumentXml(buffer);
  assertDocxTemplateIntegrity(documentXml);
  return {
    version: DOCX_TEMPLATE_VERSION,
    path: templatePath,
    size: buffer.byteLength,
    sha256: fileSha256(buffer),
    documentXml,
  };
}

export function getDocxBufferSha256(buffer: Buffer) {
  return fileSha256(buffer);
}

function parseContractBlocks(content: string): ContractBlock[] {
  return normalizeWhitespace(content)
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const tableRows = lines
        .map((line) => line.split('|').map((cell) => cell.trim()))
        .filter((row) => row.length >= 2);
      if (lines.length >= 2 && tableRows.length === lines.length) {
        return { type: 'table', rows: tableRows.map((row) => [row[0], row[1] ?? ''] as [string, string]) };
      }
      return { type: 'text', lines };
    });
}

export function renderLeaseContractTemplate(template: string, variables: Record<string, unknown>) {
  const flattened = flattenVariables(variables);
  return normalizeWhitespace(
    template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => flattened[rawKey.trim()] ?? ''),
  );
}

export function unresolvedPlaceholders(content: string) {
  return content.match(/\{\{[^}]+\}\}/g) ?? [];
}

export function buildLeaseContractHtml(content: string, variables: Record<string, unknown> = {}) {
  return buildLeaseContractHtmlFromContext(buildLeaseContractDocumentContext(content, variables));
}

export function buildLeaseContractPdfBase64(content: string, fileTitle = DEFAULT_TITLE, variables: Record<string, unknown> = {}) {
  const context = buildLeaseContractDocumentContext(content, variables);
  const pages = paginateContent(context, fileTitle);
  const pdf = buildPdfDocument(pages);
  return Buffer.from(pdf, 'binary').toString('base64');
}

export function buildLeaseContractDocxBuffer(variables: Record<string, unknown>, renderedContent: string) {
  const context = buildLeaseContractDocumentContext(renderedContent, variables);
  const { path: templatePath, documentXml } = getLeaseContractTemplateMetadata();
  assertDocxTemplateIntegrity(documentXml);
  const zip = new PizZip(fs.readFileSync(templatePath));
  const baseDocumentXml = zip.file('word/document.xml')?.asText() ?? '';
  const sectPr = extractSectionProperties(baseDocumentXml) ?? defaultSectionProperties();
  const bodyXml = [
    buildContractHeaderTableXml(context),
    buildParagraphXml(context.title, { align: 'center', bold: true, underline: true, size: 32, spacingAfter: 220, keepWithNext: true }),
    ...renderContractBlocksToDocxXml(context.blocks, context.snapshot),
    sectPr,
  ].join('');
  zip.file('word/document.xml', buildDocumentXml(bodyXml));
  return zip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }) as Buffer;
}

function buildLeaseContractDocumentContext(content: string, variables: Record<string, unknown>): LeaseContractDocumentContext {
  const blocks = parseContractBlocks(content);
  const title = extractContractTitle(blocks) ?? DEFAULT_TITLE;
  return {
    title,
    headerRows: buildHeaderRows(variables),
    footer: buildFooterContext(variables),
    blocks: normalizeContractBlocks(blocks),
    snapshot: variables,
  };
}

function normalizeContractBlocks(blocks: ContractBlock[]) {
  const withoutTitle = blocks.length && isTitleBlock(blocks[0]) ? blocks.slice(1) : blocks;
  return withoutTitle.filter((block) => {
    if (block.type === 'text') return !looksLikeSignatureBlock(block.lines);
    return !looksLikeSignatureTable(block.rows);
  });
}

function buildHeaderRows(variables: Record<string, unknown>): LeaseContractHeaderRow[] {
  const company = (variables.bailleur ?? variables.company ?? {}) as Record<string, unknown>;
  const rows: LeaseContractHeaderRow[] = [
    { label: 'Société', value: cleanText(company.raison_sociale ?? variables.LANDLORD_NAME ?? '', 'NG Property ERP') },
    { label: 'Sigle', value: cleanText(company.sigle ?? variables.LANDLORD_ACRONYM ?? '', '—') },
    { label: 'RCCM', value: cleanText(company.rccm ?? variables.LANDLORD_RCCM ?? '', '—') },
    { label: 'ID Nat', value: cleanText(company.identification_nationale ?? variables.LANDLORD_NATIONAL_ID ?? '', '—') },
    { label: 'NIF', value: cleanText(company.numero_fiscal ?? variables.LANDLORD_TAX_ID ?? '', '—') },
    { label: 'Adresse', value: cleanText(company.adresse_complete ?? variables.LANDLORD_ADDRESS ?? '', '—') },
    { label: 'Téléphone', value: cleanText(company.telephone ?? variables.company_phone ?? '', '—') },
    { label: 'Email', value: cleanText(company.email ?? variables.company_email ?? '', '—') },
  ];
  return rows.filter((row) => row.value !== '—' || row.label === 'Société');
}

function buildFooterContext(variables: Record<string, unknown>) {
  const company = (variables.bailleur ?? variables.company ?? {}) as Record<string, unknown>;
  return {
    companyName: cleanText(company.raison_sociale ?? variables.LANDLORD_NAME ?? '', 'NG Property ERP'),
    contractNumber: cleanText(variables.LEASE_REFERENCE ?? variables.lease_reference ?? '', ''),
    generatedAt: cleanText(new Date().toISOString().slice(0, 10), ''),
  };
}

function paginateContent(context: LeaseContractDocumentContext, title?: string) {
  const wrapped = wrapContractContent(context);
  const linesPerPage = Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - PDF_MARGIN_BOTTOM) / PDF_LINE_HEIGHT);
  const pages: PdfLine[][] = [];
  for (let index = 0; index < wrapped.length; index += linesPerPage - 2) {
    const chunk = wrapped.slice(index, index + (linesPerPage - 2));
    pages.push([{ text: title ?? context.title, kind: 'title' }, { text: '', kind: 'blank' }, ...chunk]);
  }
  return pages;
}

function wrapContractContent(context: LeaseContractDocumentContext) {
  const lines: PdfLine[] = [];
  const headerLine = [context.footer.companyName, context.footer.contractNumber ? `Contrat ${context.footer.contractNumber}` : null, context.footer.generatedAt ? `Généré le ${context.footer.generatedAt}` : null].filter(Boolean).join(' | ');
  if (headerLine) {
    lines.push({ text: headerLine, kind: 'normal' });
  }
  context.headerRows.forEach((row) => {
    lines.push({ text: `${row.label} | ${row.value}`, kind: 'table' });
  });
  if (context.headerRows.length) {
    lines.push({ text: '', kind: 'blank' });
  }
  for (const block of context.blocks) {
    if (lines.length && lines[lines.length - 1].kind !== 'blank') {
      lines.push({ text: '', kind: 'blank' });
    }
    if (block.type === 'table') {
      const leftWidth = Math.max(...block.rows.map(([left]) => left.length), 0) + 4;
      block.rows.forEach(([left, right]) => {
        lines.push({
          text: `${left.padEnd(leftWidth)}${right}`,
          kind: 'table',
        });
      });
      lines.push({ text: '', kind: 'blank' });
      continue;
    }
    block.lines.forEach((line) => {
      const wrapped = wrapLine(line.trim(), PDF_MAX_CHARS);
      wrapped.forEach((entry) => {
        lines.push({
          text: entry,
          kind: classifyBodyLine(entry),
        });
      });
    });
  }
  if (lines.length && lines[lines.length - 1].kind !== 'blank') {
    lines.push({ text: '', kind: 'blank' });
  }
  lines.push({ text: 'SIGNATURE_BLOCK', kind: 'signature' });
  while (lines.length && lines[lines.length - 1].kind === 'blank') lines.pop();
  return lines;
}

function buildLeaseContractHtmlFromContext(context: LeaseContractDocumentContext) {
  const companySnapshot = (context.snapshot.bailleur ?? context.snapshot.company ?? {}) as Record<string, unknown>;
  const logoUrl = cleanText(context.snapshot.company_logo_file_url ?? companySnapshot.logo_file_url ?? '', '');
  const logoHtml = logoUrl ? `<div class="contract-logo"><img src="${escapeHtml(logoUrl)}" alt="Logo société" /></div>` : '';
  const headerHtml = context.headerRows.length
    ? `<section class="contract-header">${logoHtml}<div class="contract-header-grid">${context.headerRows.map((row) => `<div class="contract-header-item"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`).join('')}</div></section>`
    : '';
  return [
    '<article class="lease-contract-preview contract-document">',
    headerHtml,
    `<header class="contract-title-wrap"><h1 class="contract-title">${escapeHtml(context.title)}</h1></header>`,
    ...renderContractBlocksToHtml(context.blocks, context.snapshot),
    renderSignatureHtml(),
    '</article>',
  ].join('');
}

function renderContractBlocksToHtml(blocks: ContractBlock[], snapshot: Record<string, unknown>) {
  return blocks.map((block, index) => {
    if (block.type === 'table') {
      return `<section class="contract-table-wrap"><table class="contract-table"><tbody>${block.rows.map(([left, right]) => `<tr><th>${escapeHtml(left)}</th><td>${escapeHtml(right)}</td></tr>`).join('')}</tbody></table></section>`;
    }
    const lines = block.lines;
    if (!lines.length) return '';
    const first = escapeHtml(lines[0]);
    if (first.toUpperCase().startsWith('ARTICLE ')) {
      return `<section class="contract-article"><h3>${first}</h3>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
    }
    const className = index === 0 ? 'contract-intro' : 'contract-paragraph';
    return `<section class="${className}">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
  }).filter(Boolean);
}

function looksLikeSignatureBlock(lines: string[]) {
  const joined = lines.join(' ').toUpperCase();
  return joined.includes('LE PRENEUR') && joined.includes('LE BAILLEUR');
}

function looksLikeSignatureTable(rows: Array<[string, string]>) {
  const joined = rows.map((row) => row.join(' ')).join(' ').toUpperCase();
  return joined.includes('LE PRENEUR') && joined.includes('LE BAILLEUR');
}

function renderSignatureHtml() {
  return `<section class="lease-signatures">${renderSignatureTitleTableHtml()}${renderSignatureBodyTableHtml()}</section>`;
}

function renderContractBlocksToDocxXml(blocks: ContractBlock[], snapshot: Record<string, unknown>) {
  return blocks.map((block, index) => {
    if (block.type === 'table') {
      return buildTableXml(block.rows);
    }
    const lines = block.lines;
    if (!lines.length) return '';
    const first = lines[0];
    if (/^ARTICLE\s+\d+/i.test(first)) {
      return [buildParagraphXml(first, { bold: true, underline: true, size: 22, spacingBefore: 160, spacingAfter: 80 }), ...lines.slice(1).map((line) => buildParagraphXml(line, { spacingAfter: 0 }))].join('');
    }
    return lines.map((line, lineIndex) => buildParagraphXml(line, { indentFirstLine: index === 0 && lineIndex === 0 ? 720 : 0, spacingAfter: 0 })).join('');
  }).filter(Boolean).join('') + buildSignatureTablesXml();
}

function buildContractHeaderTableXml(context: LeaseContractDocumentContext) {
  return [
    buildParagraphXml(`${context.footer.companyName}${context.footer.contractNumber ? ` | Contrat ${context.footer.contractNumber}` : ''}${context.footer.generatedAt ? ` | Généré le ${context.footer.generatedAt}` : ''}`, { align: 'center', bold: true, size: 18, spacingAfter: 120 }),
    buildTableXml(context.headerRows.map((row) => [row.label, row.value] as [string, string])),
  ].join('');
}

function buildContractFooterXml(context: LeaseContractDocumentContext) {
  const footerLines = [context.footer.companyName, context.footer.contractNumber ? `Contrat ${context.footer.contractNumber}` : '', context.footer.generatedAt ? `Généré le ${context.footer.generatedAt}` : ''].filter(Boolean);
  return footerLines.length ? buildParagraphXml(footerLines.join('  |  '), { align: 'center', size: 18, spacingBefore: 180, spacingAfter: 60 }) : '';
}

function buildParagraphXml(text: string, options: { align?: 'left' | 'center' | 'right' | 'both'; bold?: boolean; underline?: boolean; size?: number; spacingBefore?: number; spacingAfter?: number; indentFirstLine?: number; keepWithNext?: boolean } = {}) {
  const align = options.align ?? 'both';
  const size = options.size ?? 22;
  const pPr = [
    `<w:jc w:val="${align}"/>`,
    `<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${options.spacingAfter ?? 0}" w:line="276" w:lineRule="auto"/>`,
    options.indentFirstLine ? `<w:ind w:firstLine="${options.indentFirstLine}"/>` : '',
    options.keepWithNext ? '<w:keepNext/>' : '',
  ].filter(Boolean).join('');
  const rPr = [
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`,
    `<w:sz w:val="${size}"/>`,
    options.bold ? '<w:b/>' : '',
    options.underline ? '<w:u w:val="single"/>' : '',
  ].filter(Boolean).join('');
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildTableXml(rows: Array<[string, string]>) {
  const leftWidth = 3150;
  const rightWidth = 6150;
  const tableRows = rows.map(([left, right]) => `
    <w:tr>
      <w:tc>
        <w:tcPr><w:tcW w:w="${leftWidth}" w:type="dxa"/></w:tcPr>
        ${buildTableCellParagraphXml(left, true)}
      </w:tc>
      <w:tc>
        <w:tcPr><w:tcW w:w="${rightWidth}" w:type="dxa"/></w:tcPr>
        ${buildTableCellParagraphXml(right, false)}
      </w:tc>
    </w:tr>`).join('');
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="9aa7b1"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="9aa7b1"/>
        </w:tblBorders>
        <w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid>
      ${tableRows}
    </w:tbl>`;
}

function renderSignatureTitleTableHtml() {
  return `<table class="lease-signature-table lease-signature-title-table"><tbody><tr><th>LE PRENEUR</th><th>LE BAILLEUR</th></tr></tbody></table>`;
}

function renderSignatureBodyTableHtml() {
  const rows = Array.from({ length: SIGNATURE_TABLE_BODY_ROWS }, () => '<tr><td><div class="lease-signature-space"></div></td><td><div class="lease-signature-space"></div></td></tr>').join('');
  return `<table class="lease-signature-table lease-signature-body-table"><tbody>${rows}</tbody></table>`;
}

function buildSignatureTablesXml() {
  return `${buildSignatureTitleTableXml()}${buildSignatureBodyTableXml()}`;
}

function buildSignatureTitleTableXml() {
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="nil"/>
          <w:left w:val="nil"/>
          <w:bottom w:val="nil"/>
          <w:right w:val="nil"/>
          <w:insideH w:val="nil"/>
          <w:insideV w:val="nil"/>
        </w:tblBorders>
        <w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="${SIGNATURE_TABLE_WIDTH}"/><w:gridCol w:w="${SIGNATURE_TABLE_WIDTH}"/></w:tblGrid>
      <w:tr>
        <w:trPr><w:trHeight w:val="${SIGNATURE_TABLE_TITLE_HEIGHT}" w:hRule="atLeast"/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w="${SIGNATURE_TABLE_WIDTH}" w:type="dxa"/></w:tcPr>${buildTableCellParagraphXml('LE PRENEUR', true, { align: 'center', spacingAfter: 80 })}</w:tc>
        <w:tc><w:tcPr><w:tcW w:w="${SIGNATURE_TABLE_WIDTH}" w:type="dxa"/></w:tcPr>${buildTableCellParagraphXml('LE BAILLEUR', true, { align: 'center', spacingAfter: 80 })}</w:tc>
      </w:tr>
    </w:tbl>`;
}

function buildSignatureBodyTableXml() {
  const rows = Array.from({ length: SIGNATURE_TABLE_BODY_ROWS }, () => `
      <w:tr>
        <w:trPr><w:trHeight w:val="${SIGNATURE_TABLE_BODY_ROW_HEIGHT}" w:hRule="atLeast"/></w:trPr>
        <w:tc><w:tcPr><w:tcW w:w="${SIGNATURE_TABLE_WIDTH}" w:type="dxa"/></w:tcPr>${buildTableCellParagraphXml(' ', false, { spacingAfter: 120 })}</w:tc>
        <w:tc><w:tcPr><w:tcW w:w="${SIGNATURE_TABLE_WIDTH}" w:type="dxa"/></w:tcPr>${buildTableCellParagraphXml(' ', false, { spacingAfter: 120 })}</w:tc>
      </w:tr>`).join('');
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="9aa7b1"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="9aa7b1"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="9aa7b1"/>
        </w:tblBorders>
        <w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="${SIGNATURE_TABLE_WIDTH}"/><w:gridCol w:w="${SIGNATURE_TABLE_WIDTH}"/></w:tblGrid>
      ${rows}
    </w:tbl>`;
}

function buildTableCellParagraphXml(text: string, bold = false, options: { align?: 'left' | 'center' | 'right' | 'both'; spacingAfter?: number } = {}) {
  const align = options.align ?? 'left';
  const spacingAfter = options.spacingAfter ?? 0;
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="${spacingAfter}" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/>' : ''}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildDocumentXml(bodyXml: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>${bodyXml}</w:body>
</w:document>`;
}

function extractSectionProperties(documentXml: string) {
  const match = documentXml.match(/<w:sectPr[\s\S]*<\/w:sectPr>/i);
  return match ? match[0] : null;
}

function defaultSectionProperties() {
  return '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>';
}

function isTitleBlock(block: ContractBlock) {
  return block.type === 'text' && block.lines.length === 1 && /^CONTRAT DE BAIL/i.test(block.lines[0].trim());
}

function extractContractTitle(blocks: ContractBlock[]) {
  if (!blocks.length || blocks[0].type !== 'text' || blocks[0].lines.length !== 1) return null;
  const title = blocks[0].lines[0].trim();
  return /^CONTRAT DE BAIL/i.test(title) ? title : null;
}

function wrapLine(line: string, maxChars: number) {
  if (!line) return [''];
  if (line.length <= maxChars) return [line];
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function classifyBodyLine(line: string): PdfLine['kind'] {
  if (!line.trim()) return 'blank';
  if (/^ARTICLE\s+\d+/i.test(line)) return 'article';
  if (line.includes('|')) return 'table';
  return 'normal';
}

function buildPdfDocument(pages: PdfLine[][]) {
  const objects: string[] = [];
  const offsets: number[] = [0];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObjectId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  const boldFontObjectId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>');
  const monoFontObjectId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const contentObjectIds = pages.map((pageLines, index) => {
    const content = buildPdfPageStream(pageLines, index + 1, pages.length);
    return addObject(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`);
  });
  const pagesObjectId = 1 + 3 + contentObjectIds.length + pages.length;

  const pageObjectIds = pages.map((_, index) =>
    addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectId} 0 R /F2 ${boldFontObjectId} 0 R /F3 ${monoFontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
    ),
  );

  addObject(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function buildPdfPageStream(lines: PdfLine[], pageNumber: number, totalPages: number) {
  const commands: string[] = ['BT', '/F1 11 Tf', `${PDF_MARGIN_X} ${PDF_PAGE_HEIGHT - PDF_MARGIN_TOP} Td`, `${PDF_LINE_HEIGHT} TL`];
  let textModeOpen = true;
  lines.forEach((line, index) => {
    const kind = line.kind;
    const fontSize = kind === 'title' ? 14 : kind === 'article' ? 12 : kind === 'table' ? 10 : kind === 'signature' ? 11 : 11;
    const fontName = kind === 'title' || kind === 'article' || kind === 'signature' ? '/F2' : kind === 'table' ? '/F3' : '/F1';
    if (kind === 'signature') {
      if (textModeOpen) {
        commands.push('ET');
        textModeOpen = false;
      }
      const tableX = PDF_MARGIN_X;
      const tableWidth = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2;
      const titleHeight = 26;
      const bodyHeight = SIGNATURE_TABLE_BODY_ROWS * 30;
      const totalHeight = titleHeight + SIGNATURE_TABLE_GAP + bodyHeight;
      const tableY = Math.max(PDF_MARGIN_BOTTOM + 28, PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - (index * PDF_LINE_HEIGHT) - totalHeight + 24);
      const halfWidth = tableWidth / 2;
      const titleY = tableY + bodyHeight + SIGNATURE_TABLE_GAP;
      const bodyRowHeight = bodyHeight / SIGNATURE_TABLE_BODY_ROWS;
      commands.push('q');
      commands.push('1 w');
      commands.push(`${tableX} ${titleY} ${tableWidth} ${titleHeight} re S`);
      commands.push(`${tableX + halfWidth} ${titleY} m ${tableX + halfWidth} ${titleY + titleHeight} l S`);
      commands.push(`BT /F2 11 Tf ${tableX + 24} ${titleY + 8} Td (LE PRENEUR) Tj ET`);
      commands.push(`BT /F2 11 Tf ${tableX + halfWidth + 24} ${titleY + 8} Td (LE BAILLEUR) Tj ET`);
      commands.push(`${tableX} ${tableY} ${tableWidth} ${bodyHeight} re S`);
      commands.push(`${tableX + halfWidth} ${tableY} m ${tableX + halfWidth} ${tableY + bodyHeight} l S`);
      for (let rowIndex = 1; rowIndex < SIGNATURE_TABLE_BODY_ROWS; rowIndex += 1) {
        const y = tableY + rowIndex * bodyRowHeight;
        commands.push(`${tableX} ${y} m ${tableX + tableWidth} ${y} l S`);
      }
      commands.push('Q');
      return;
    }
    if (index > 0) commands.push('T*');
    commands.push(`${fontName} ${fontSize} Tf`);
    commands.push(`(${escapePdfString(toWinAnsi(line.text))}) Tj`);
  });
  if (textModeOpen) {
    commands.push('ET');
  }
  commands.push(`BT /F1 9 Tf ${PDF_MARGIN_X} ${PDF_MARGIN_BOTTOM - 14} Td (${escapePdfString(toWinAnsi(`Page ${pageNumber}/${totalPages}`))}) Tj ET`);
  return commands.join('\n');
}

function toWinAnsi(value: string) {
  const bytes = Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    if (code <= 255) return code;
    return winAnsiMap[char] ?? 63;
  });
  return Buffer.from(bytes).toString('binary');
}

function escapePdfString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
