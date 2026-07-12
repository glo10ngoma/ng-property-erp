type VariableValue = string | number | null | undefined;

const DEFAULT_TITLE = 'CONTRAT DE BAIL A USAGE RESIDENTIEL';
const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_X = 50;
const PDF_MARGIN_TOP = 64;
const PDF_MARGIN_BOTTOM = 56;
const PDF_LINE_HEIGHT = 15;
const PDF_MAX_CHARS = 92;

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
  return value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
  return String(value).trim();
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
  const blocks = normalizeWhitespace(content).split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const sections = blocks.map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return '';
    const first = escapeHtml(lines[0]);
    if (lines.length === 1 && first === first.toUpperCase()) {
      return `<h2>${first}</h2>`;
    }
    if (first.startsWith('ARTICLE ')) {
      return `<section><h3>${first}</h3>${lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
    }
    if (lines.length === 1) {
      return `<p>${first}</p>`;
    }
    return `<section>${lines.map((line, index) => `<p${index === 0 && first === first.toUpperCase() ? ' class="lead"' : ''}>${escapeHtml(line)}</p>`).join('')}</section>`;
  });
  return [
    '<article class="lease-contract-preview">',
    `<header><h1>${DEFAULT_TITLE}</h1></header>`,
    ...sections,
    '</article>',
  ].join('');
}

export function buildLeaseContractPdfBase64(content: string, fileTitle = DEFAULT_TITLE) {
  const pages = paginateContent(normalizeWhitespace(content), fileTitle);
  const pdf = buildPdfDocument(pages);
  return Buffer.from(pdf, 'binary').toString('base64');
}

function paginateContent(content: string, title: string) {
  const wrapped = wrapContractContent(content);
  const linesPerPage = Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN_TOP - PDF_MARGIN_BOTTOM) / PDF_LINE_HEIGHT);
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += linesPerPage - 2) {
    const chunk = wrapped.slice(index, index + (linesPerPage - 2));
    pages.push([title, '', ...chunk]);
  }
  return pages;
}

function wrapContractContent(content: string) {
  return content
    .split('\n')
    .flatMap((line) => wrapLine(line.trim(), PDF_MAX_CHARS))
    .flatMap((line) => line === '__BLANK__' ? [''] : [line]);
}

function wrapLine(line: string, maxChars: number) {
  if (!line) return ['__BLANK__'];
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

function buildPdfDocument(pages: string[][]) {
  const objects: string[] = [];
  const offsets: number[] = [0];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObjectId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentObjectIds = pages.map((pageLines, index) => {
    const content = buildPdfPageStream(pageLines, index + 1, pages.length);
    return addObject(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`);
  });
  const pagesObjectId = 1 + 1 + contentObjectIds.length + pages.length;

  const pageObjectIds = pages.map((_, index) =>
    addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
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

function buildPdfPageStream(lines: string[], pageNumber: number, totalPages: number) {
  const commands: string[] = ['BT', '/F1 11 Tf', `${PDF_MARGIN_X} ${PDF_PAGE_HEIGHT - PDF_MARGIN_TOP} Td`, `${PDF_LINE_HEIGHT} TL`];
  lines.forEach((line, index) => {
    const fontSize = index === 0 ? 14 : line.startsWith('ARTICLE ') ? 12 : 11;
    if (index > 0) commands.push('T*');
    commands.push(`/F1 ${fontSize} Tf`);
    commands.push(`(${escapePdfString(toWinAnsi(line))}) Tj`);
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
