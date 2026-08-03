import ExcelJS from 'exceljs';

export type XlsxRowValue = Record<string, unknown> | unknown[];

export type XlsxColumnDefinition =
  | string
  | {
      header?: string;
      key?: string;
      width?: number;
    };

export type XlsxSection = {
  name?: string;
  title?: string;
  rows?: XlsxRowValue[];
  data?: XlsxRowValue[];
  values?: XlsxRowValue[];
  columns?: XlsxColumnDefinition[];
  headers?: string[];
};

export type XlsxSheet = {
  name: string;
  title?: string;
  rows?: XlsxRowValue[];
  data?: XlsxRowValue[];
  values?: XlsxRowValue[];
  sections?: XlsxSection[];
  columns?: XlsxColumnDefinition[];
  headers?: string[];
};

type NormalizedColumn = {
  header: string;
  key: string;
  width?: number;
};

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function exportXlsxWorkbook(filename: string, sheets: XlsxSheet[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NG Property ERP';
  workbook.created = new Date();
  workbook.modified = new Date();

  const usedNames = new Set<string>();
  const safeSheets = sheets.length ? sheets : [{ name: 'Feuille 1', rows: [] }];

  for (const [index, sheet] of safeSheets.entries()) {
    const title = sheet.title || sheet.name || `Feuille ${index + 1}`;
    const worksheetName = uniqueSheetName(sheet.name || `Feuille ${index + 1}`, usedNames);
    const worksheet = workbook.addWorksheet(worksheetName);
    const resolved = resolveSheetPayload(sheet);

    addWorksheetContent(worksheet, title, resolved);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  downloadBlob(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, blob);
}

function addWorksheetContent(worksheet: ExcelJS.Worksheet, title: string, resolved: ResolvedSheetPayload) {
  const resolvedRows = resolved.rows;
  const resolvedColumns = resolveSheetColumns(resolved, resolvedRows);
  const headers = resolveHeaders(resolved, resolvedRows, resolvedColumns);
  const dataRows = resolvedRows.length ? resolvedRows : [fallbackRow(headers)];
  const columnCount = Math.max(headers.length, resolvedColumns.length, ...dataRows.map((row) => rowLength(row)), 1);
  const paddedHeaders = padHeaders(headers, columnCount);
  const columnKeys = Array.from({ length: columnCount }, (_, index) => resolvedColumns[index]?.key ?? `column_${index + 1}`);

  worksheet.columns = columnKeys.map((key, index) => ({
    key,
    width: resolvedColumns[index]?.width ?? 12,
  }));

  worksheet.addRow(recordFromValues([sanitizeExcelValue(title)], columnKeys));
  worksheet.addRow(recordFromValues(paddedHeaders, columnKeys));

  const maxLengths = paddedHeaders.map((header) => displayLength(header));

  dataRows.forEach((row) => {
    const record = recordFromRow(row, columnKeys, resolvedColumns, paddedHeaders);
    worksheet.addRow(record);
    columnKeys.forEach((key, index) => {
      maxLengths[index] = Math.max(maxLengths[index] ?? 0, displayLength(record[key]));
    });
  });

  worksheet.views = [{ state: 'frozen', ySplit: 2 }];
  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: columnCount },
  };

  if (columnCount > 1) worksheet.mergeCells(1, 1, 1, columnCount);

  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.getRow(2).font = { bold: true };

  for (let index = 0; index < columnCount; index += 1) {
    worksheet.getColumn(index + 1).width = Math.min(42, Math.max(12, (maxLengths[index] ?? 0) + 2));
  }
}

type ResolvedSheetPayload = {
  rows: XlsxRowValue[];
  columns: NormalizedColumn[];
  headers: string[];
  source: 'rows' | 'data' | 'values' | 'sections' | 'empty';
  sectionsCount: number;
};

function resolveSheetPayload(sheet: XlsxSheet): ResolvedSheetPayload {
  if (Array.isArray(sheet.rows)) {
    return {
      rows: cloneRows(sheet.rows),
      columns: resolveSheetColumnsFromExplicit(sheet.columns, sheet.headers, sheet.rows),
      headers: resolveHeadersFromExplicit(sheet.headers, sheet.rows, sheet.columns),
      source: 'rows',
      sectionsCount: Array.isArray(sheet.sections) ? sheet.sections.length : 0,
    };
  }

  if (Array.isArray(sheet.data)) {
    return {
      rows: cloneRows(sheet.data),
      columns: resolveSheetColumnsFromExplicit(sheet.columns, sheet.headers, sheet.data),
      headers: resolveHeadersFromExplicit(sheet.headers, sheet.data, sheet.columns),
      source: 'data',
      sectionsCount: Array.isArray(sheet.sections) ? sheet.sections.length : 0,
    };
  }

  if (Array.isArray(sheet.values)) {
    return {
      rows: cloneRows(sheet.values),
      columns: resolveSheetColumnsFromExplicit(sheet.columns, sheet.headers, sheet.values),
      headers: resolveHeadersFromExplicit(sheet.headers, sheet.values, sheet.columns),
      source: 'values',
      sectionsCount: Array.isArray(sheet.sections) ? sheet.sections.length : 0,
    };
  }

  if (Array.isArray(sheet.sections)) {
    const rows = sheet.sections.flatMap((section) => {
      const sectionRows = section.rows ?? section.data ?? section.values ?? [];
      const label = sanitizeText(String(section.title ?? section.name ?? '').trim());
      const cloned = cloneRows(sectionRows);
      if (!label) return cloned;
      return cloned.map((row) => (isPlainObject(row) ? { Section: label, ...row } : row));
    });
    return {
      rows,
      columns: resolveSheetColumnsFromExplicit(sheet.columns, sheet.headers, rows),
      headers: resolveHeadersFromExplicit(sheet.headers, rows, sheet.columns),
      source: 'sections',
      sectionsCount: sheet.sections.length,
    };
  }

  return {
    rows: [],
    columns: resolveSheetColumnsFromExplicit(sheet.columns, sheet.headers, []),
    headers: resolveHeadersFromExplicit(sheet.headers, [], sheet.columns),
    source: 'empty',
    sectionsCount: 0,
  };
}

function resolveSheetColumnsFromExplicit(columns: XlsxSheet['columns'], headers: XlsxSheet['headers'], rows: XlsxRowValue[]) {
  const source = Array.isArray(columns) && columns.length
    ? columns
    : Array.isArray(headers) && headers.length
      ? headers
      : [];

  if (source.length) return source.map((column, index) => normalizeColumn(column, index));

  const objectHeaders = Array.from(new Set(rows.filter(isPlainObject).flatMap((row) => Object.keys(row as Record<string, unknown>))));
  if (objectHeaders.length) return objectHeaders.map((header) => ({ header, key: header }));

  const arrayLength = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (arrayLength > 0) {
    return Array.from({ length: arrayLength }, (_, index) => ({ header: `Colonne ${index + 1}`, key: `column_${index + 1}` }));
  }

  return [{ header: 'Information', key: 'Information' }];
}

function resolveHeadersFromExplicit(headers: XlsxSheet['headers'], rows: XlsxRowValue[], columns: XlsxSheet['columns']) {
  if (Array.isArray(headers) && headers.length) return headers.filter(Boolean) as string[];
  if (Array.isArray(columns) && columns.length) return columns.map((column, index) => normalizeColumn(column, index).header);

  const objectHeaders = Array.from(new Set(rows.filter(isPlainObject).flatMap((row) => Object.keys(row as Record<string, unknown>))));
  if (objectHeaders.length) return objectHeaders;

  const arrayLength = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (arrayLength > 0) return Array.from({ length: arrayLength }, (_, index) => `Colonne ${index + 1}`);

  return ['Information'];
}


function resolveSheetColumns(sheet: ResolvedSheetPayload, rows: XlsxRowValue[]): NormalizedColumn[] {
  return sheet.columns.length ? sheet.columns : resolveSheetColumnsFromExplicit(undefined, undefined, rows);
}

function resolveHeaders(sheet: ResolvedSheetPayload, rows: XlsxRowValue[], columns: NormalizedColumn[]) {
  if (sheet.headers.length) return sheet.headers;
  if (columns.length) return columns.map((column) => column.header || column.key);

  const headers = Array.from(new Set(rows.filter(isPlainObject).flatMap((row) => Object.keys(row as Record<string, unknown>))));
  if (headers.length) return headers;

  const maxArrayLength = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (maxArrayLength > 0) return Array.from({ length: maxArrayLength }, (_, index) => `Colonne ${index + 1}`);

  return ['Information'];
}

function recordFromRow(row: XlsxRowValue, columnKeys: string[], columns: NormalizedColumn[], headers: string[]) {
  if (Array.isArray(row)) {
    return recordFromValues(row.map((value) => sanitizeExcelValue(value)), columnKeys);
  }

  if (isPlainObject(row)) {
    const record: Record<string, string | number | boolean | Date> = {};
    columnKeys.forEach((key, index) => {
      const column = columns[index];
      const lookup = column ? readRowValue(row, column.key, column.header) : readRowValue(row, headers[index] ?? key, headers[index] ?? key);
      record[key] = sanitizeExcelValue(lookup);
    });
    return record;
  }

  return recordFromValues([sanitizeExcelValue(row)], columnKeys);
}

function recordFromValues(values: Array<string | number | boolean | Date>, columnKeys: string[]) {
  const record: Record<string, string | number | boolean | Date> = {};
  columnKeys.forEach((key, index) => {
    record[key] = values[index] ?? '';
  });
  return record;
}

function readRowValue(row: Record<string, unknown>, primaryKey: string, fallbackKey: string) {
  if (primaryKey in row) return row[primaryKey];
  if (fallbackKey in row) return row[fallbackKey];
  const normalizedPrimary = normalizeLookupKey(primaryKey);
  const normalizedFallback = normalizeLookupKey(fallbackKey);
  const foundEntry = Object.entries(row).find(([key]) => normalizeLookupKey(key) === normalizedPrimary || normalizeLookupKey(key) === normalizedFallback);
  return foundEntry?.[1];
}

function normalizeLookupKey(value: string) {
  return sanitizeText(String(value ?? '').trim()).toLowerCase();
}

function cloneRows(rows: XlsxRowValue[]) {
  return rows.map((row) => (Array.isArray(row) ? [...row] : { ...(row as Record<string, unknown>) }));
}

function fallbackRow(headers: string[]) {
  if (headers.length > 1) {
    const row: Record<string, unknown> = {};
    row[headers[0] || 'Information'] = 'Aucune donnée';
    return row;
  }
  return { Information: 'Aucune donnée' };
}

function padHeaders(headers: string[], count: number) {
  if (headers.length >= count) return headers.slice(0, count);
  return [...headers, ...Array.from({ length: count - headers.length }, (_, index) => `Colonne ${headers.length + index + 1}`)];
}

function normalizeColumn(column: XlsxColumnDefinition, index: number): NormalizedColumn {
  if (typeof column === 'string') {
    const header = sanitizeText(column.trim()) || `Colonne ${index + 1}`;
    return { header, key: header };
  }

  const header = sanitizeText(String(column.header ?? column.key ?? `Colonne ${index + 1}`).trim()) || `Colonne ${index + 1}`;
  const key = sanitizeText(String(column.key ?? column.header ?? `column_${index + 1}`).trim()) || `column_${index + 1}`;
  return { header, key, width: typeof column.width === 'number' ? column.width : undefined };
}

function rowLength(row: XlsxRowValue) {
  if (Array.isArray(row)) return row.length;
  if (isPlainObject(row)) return Object.keys(row).length;
  return 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
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
  if (typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text ?? '').length;
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
  const sanitized = sanitizeText(String(name).trim())
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return sanitized || 'Feuille';
}