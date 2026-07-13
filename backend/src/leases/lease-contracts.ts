import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

type VariableValue = string | number | null | undefined;
type ContractBlock = { type: 'text'; lines: string[] } | { type: 'table'; rows: Array<[string, string]> };
type PdfLine = { text: string; kind: 'normal' | 'title' | 'article' | 'table' | 'blank' };

const DEFAULT_TITLE = 'CONTRAT DE BAIL A USAGE RESIDENTIEL';
const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_X = 50;
const PDF_MARGIN_TOP = 60;
const PDF_MARGIN_BOTTOM = 54;
const PDF_LINE_HEIGHT = 14;
const PDF_MAX_CHARS = 96;
const DOCX_TEMPLATE_VERSION = 'DOCX_UTF8_V2';
const DOCX_TEMPLATE_NAME = 'LEASE_RESIDENTIAL.docx';
const DOCX_TEMPLATE_CANDIDATES = [
  path.resolve(process.cwd(), 'dist', 'templates', 'leases', DOCX_TEMPLATE_NAME),
  path.resolve(process.cwd(), 'templates', 'leases', DOCX_TEMPLATE_NAME),
  path.resolve(__dirname, '..', '..', 'templates', 'leases', DOCX_TEMPLATE_NAME),
];
const DOCX_TEMPLATE_FORBIDDEN_SEQUENCES = ['Ãƒ', 'Ã‚', 'â€™', 'â€œ', 'â€\u009d', 'ï¿½'];

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

export function buildLeaseContractHtml(content: string) {
  const blocks = parseContractBlocks(content);
  const bodyBlocks = blocks.length && isTitleBlock(blocks[0]) ? blocks.slice(1) : blocks;
  const sections = bodyBlocks.map((block, index) => {
    if (block.type === 'table') {
      return `<section class="contract-table-wrap"><table class="contract-table"><tbody>${block.rows.map(([left, right]) => `<tr><th>${escapeHtml(left)}</th><td>${escapeHtml(right)}</td></tr>`).join('')}</tbody></table></section>`;
    }
    const lines = block.lines;
    if (!lines.length) return '';
    const first = escapeHtml(lines[0]);
    if (first.toUpperCase().startsWith('ARTICLE ')) {
      return `<section class="contract-article"><h3>${first}</h3>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
    }
    if (lines.length === 1 && /^LE PRENEUR\b/i.test(first)) {
      return `<section class="contract-signatures"><p>${first}</p></section>`;
    }
    const className = index === 0 ? 'contract-intro' : 'contract-paragraph';
    return `<section class="${className}">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
  });
  return [
    '<article class="lease-contract-preview contract-document">',
    `<header class="contract-header"><h1 class="contract-title">${DEFAULT_TITLE}</h1></header>`,
    ...sections,
    '</article>',
  ].join('');
}

export function buildLeaseContractPdfBase64(content: string, fileTitle = DEFAULT_TITLE) {
  const pages = paginateContent(content, fileTitle);
  const pdf = buildPdfDocument(pages);
  return Buffer.from(pdf, 'binary').toString('base64');
}

export function buildLeaseContractDocxBuffer(variables: Record<string, unknown>) {
  const { path: templatePath, documentXml } = getLeaseContractTemplateMetadata();
  assertDocxTemplateIntegrity(documentXml);
  const zip = new PizZip(fs.readFileSync(templatePath));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });

  try {
    doc.render(variables);
  } catch (error: any) {
    const details = error?.properties?.errors?.map((entry: any) => entry?.properties?.explanation).filter(Boolean).join(' | ');
    throw new BadRequestException(details || error?.message || 'Impossible de generer le contrat Word');
  }

  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }) as Buffer;
}

function paginateContent(content: string, title: string) {
  const wrapped = wrapContractContent(content);
  const linesPerPage = Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - PDF_MARGIN_BOTTOM) / PDF_LINE_HEIGHT);
  const pages: PdfLine[][] = [];
  for (let index = 0; index < wrapped.length; index += linesPerPage - 2) {
    const chunk = wrapped.slice(index, index + (linesPerPage - 2));
    pages.push([{ text: title, kind: 'title' }, { text: '', kind: 'blank' }, ...chunk]);
  }
  return pages;
}

function wrapContractContent(content: string) {
  const lines: PdfLine[] = [];
  const blocks = parseContractBlocks(content);
  const bodyBlocks = blocks.length && isTitleBlock(blocks[0]) ? blocks.slice(1) : blocks;
  for (const block of bodyBlocks) {
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
  while (lines.length && lines[lines.length - 1].kind === 'blank') lines.pop();
  return lines;
}

function isTitleBlock(block: ContractBlock) {
  return block.type === 'text' && block.lines.length === 1 && block.lines[0].trim().toUpperCase() === DEFAULT_TITLE;
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
  lines.forEach((line, index) => {
    const kind = line.kind;
    const fontSize = kind === 'title' ? 14 : kind === 'article' ? 12 : kind === 'table' ? 10 : 11;
    const fontName = kind === 'title' || kind === 'article' ? '/F2' : kind === 'table' ? '/F3' : '/F1';
    if (index > 0) commands.push('T*');
    commands.push(`${fontName} ${fontSize} Tf`);
    commands.push(`(${escapePdfString(toWinAnsi(line.text))}) Tj`);
  });
  commands.push('ET');
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
