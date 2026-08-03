import ExcelJS from 'exceljs';

export type XlsxSheet = {
  name: string;
  rows: Array<Record<string, unknown>>;
};

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function exportXlsxWorkbook(filename: string, sheets: XlsxSheet[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NG Property ERP';
  workbook.created = new Date();
  workbook.modified = new Date();

  const usedNames = new Set<string>();
  const safeSheets = sheets.length ? sheets : [{ name: 'Feuille 1', rows: [] }];

  safeSheets.forEach((sheet, index) => {
    const title = sheet.name || `Feuille ${index + 1}`;
    const worksheet = workbook.addWorksheet(uniqueSheetName(title, usedNames));
    addWorksheetContent(worksheet, title, sheet.rows);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  downloadBlob(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, blob);
}

function addWorksheetContent(worksheet: ExcelJS.Worksheet, title: string, sourceRows: Array<Record<string, unknown>>) {
  const rows = sourceRows.length ? sourceRows : [{ Information: 'Aucune donnee' }];
  const headers = collectHeaders(rows);
  const columnCount = Math.max(1, headers.length);

  worksheet.columns = headers.map((header) => ({ key: header, width: 12 }));
  writeRow(worksheet, 1, [sanitizeExcelValue(title), ...Array(columnCount - 1).fill('')]);
  writeRow(worksheet, 2, headers);

  rows.forEach((row, rowIndex) => {
    writeRow(worksheet, rowIndex + 3, headers.map((header) => sanitizeExcelValue(row[header])));
  });

  worksheet.views = [{ state: 'frozen', ySplit: 2 }];
  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: columnCount },
  };

  if (columnCount > 1) worksheet.mergeCells(1, 1, 1, columnCount);

  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.getRow(2).font = { bold: true };

  headers.forEach((_header, index) => {
    worksheet.getColumn(index + 1).width = Math.min(
      42,
      Math.max(12, ...worksheet.getColumn(index + 1).values.map((value) => displayLength(value) + 2)),
    );
  });
}

function writeRow(worksheet: ExcelJS.Worksheet, rowNumber: number, values: Array<string | number | boolean | Date>) {
  values.forEach((value, index) => {
    worksheet.getCell(rowNumber, index + 1).value = value;
  });
}

function collectHeaders(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row ?? {}))));
  return headers.length ? headers : ['Information'];
}

function uniqueSheetName(name: string, usedNames: Set<string>) {
  const baseName = sanitizeSheetName(name);
  let finalName = baseName;
  let counter = 2;

  while (usedNames.has(finalName)) {
    const suffix = ` (${counter})`;
    finalName = `${baseName.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    counter += 1;
  }

  usedNames.add(finalName);
  return finalName;
}

function sanitizeSheetName(name: string) {
  const sanitized = sanitizeText(name)
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return sanitized || 'Feuille';
}

function sanitizeExcelValue(value: unknown): string | number | boolean | Date {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value;
  if (Array.isArray(value)) return sanitizeText(JSON.stringify(value.map((entry) => sanitizeExcelValue(entry))));
  if (typeof value === 'object') return sanitizeText(JSON.stringify(value));

  const text = sanitizeText(String(value).trim());
  if (!text || text === 'NaN' || text === 'Infinity' || text === '-Infinity') return '';

  const compact = text.replace(/\s/g, '');
  const maybeNumber = Number(compact.replace(',', '.'));
  return Number.isFinite(maybeNumber) && /^-?\d+([.,]\d+)?$/.test(compact) ? maybeNumber : text;
}

function sanitizeText(value: string) {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function displayLength(value: unknown) {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return value.toISOString().length;
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').length;
  return String(value).length;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}