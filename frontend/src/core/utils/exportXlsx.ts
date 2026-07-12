export type XlsxSheet = {
  name: string;
  rows: Array<Record<string, unknown>>;
};

export function exportXlsxWorkbook(filename: string, sheets: XlsxSheet[]) {
  const safeSheets = sheets.map((sheet, index) => ({
    name: sanitizeSheetName(sheet.name || `Feuille ${index + 1}`),
    title: sheet.name || `Feuille ${index + 1}`,
    rows: sheet.rows.length ? sheet.rows : [{ Information: 'Aucune donnée' }],
  }));
  const files: Array<{ path: string; content: string | Uint8Array }> = [
    { path: '[Content_Types].xml', content: contentTypes(safeSheets.length) },
    { path: '_rels/.rels', content: rootRels() },
    { path: 'xl/workbook.xml', content: workbook(safeSheets) },
    { path: 'xl/_rels/workbook.xml.rels', content: workbookRels(safeSheets.length) },
    { path: 'xl/styles.xml', content: styles() },
    ...safeSheets.map((sheet, index) => ({ path: `xl/worksheets/sheet${index + 1}.xml`, content: worksheet(sheet) })),
  ];
  const blob = new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, blob);
}

function worksheet(sheet: { title: string; rows: Array<Record<string, unknown>> }) {
  const rows = sheet.rows;
  const headers = Object.keys(rows[0] ?? { Information: 'Aucune donnée' });
  const normalizedRows = rows.map((row) => headers.map((header) => sanitizeExcelValue(row[header])));
  const allRows = [[sheet.title, ...Array(Math.max(headers.length - 1, 0)).fill('')], headers, ...normalizedRows];
  const filterRef = `A2:${cellRef(headers.length, allRows.length)}`;
  const cols = headers.map((header, index) => {
    const width = Math.min(42, Math.max(12, ...allRows.map((row) => String(row[index] ?? '').length + 2)));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const rowsXml = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const style = rowIndex === 0 ? ' s="2"' : rowIndex === 1 ? ' s="1"' : '';
      const normalized = sanitizeExcelValue(value);
      if (typeof normalized === 'number') {
        return `<c r="${cellRef(colIndex + 1, rowIndex + 1)}"${style}><v>${normalized}</v></c>`;
      }
      return `<c r="${cellRef(colIndex + 1, rowIndex + 1)}" t="inlineStr"${style}><is><t>${xml(normalized)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const mergeCells = headers.length > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${cellRef(headers.length, 1)}"/></mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${mergeCells}
  <autoFilter ref="${filterRef}"/>
</worksheet>`;
}

function contentTypes(count: number) {
  const sheets = Array.from({ length: count }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets}
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbook(sheets: Array<{ name: string }>) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`;
}

function workbookRels(count: number) {
  const sheets = Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets}
  <Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function zip(files: Array<{ path: string; content: string | Uint8Array }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { time, date } = dosTimeDate(new Date());
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    localParts.push(local);
    centralParts.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return concat([...localParts, central, end]);
}

function dosTimeDate(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16(value: number) {
  const data = new Uint8Array(2);
  new DataView(data.buffer).setUint16(0, value, true);
  return data;
}

function u32(value: number) {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, value, true);
  return data;
}

function cellRef(column: number, row: number) {
  let col = '';
  let value = column;
  while (value > 0) {
    const mod = (value - 1) % 26;
    col = String.fromCharCode(65 + mod) + col;
    value = Math.floor((value - mod) / 26);
  }
  return `${col}${row}`;
}

function xml(value: unknown) {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
}

function sanitizeExcelValue(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => sanitizeExcelValue(entry)));
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  if (!text || text === 'NaN' || text === 'Infinity' || text === '-Infinity') return '';
  const compact = text.replace(/\s/g, '');
  const maybeNumber = Number(compact.replace(',', '.'));
  return Number.isFinite(maybeNumber) && /^-?\d+([.,]\d+)?$/.test(compact) ? maybeNumber : text;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
