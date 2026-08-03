import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = path.resolve('src/core/utils/exportXlsx.ts');
let source = fs.readFileSync(sourcePath, 'utf8');
source = source.replace(/import ExcelJS from 'exceljs';/, "const ExcelJS = require('exceljs');");
source = source.replace(/^export type XlsxSheet = \{[\s\S]*?\n\};\n\n/, '');
source = source.replace(/export async function exportXlsxWorkbook/g, 'async function exportXlsxWorkbook');
source += '\nmodule.exports = { exportXlsxWorkbook };\n';

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-xlsx-validate-'));
const context = {
  module: { exports: {} },
  exports: {},
  require,
  console,
  Uint8Array,
  ArrayBuffer,
  Buffer,
  ExcelJS,
  Blob: class Blob {
    constructor(parts) {
      this.buffer = Buffer.concat(parts.map((part) => Buffer.from(part)));
    }
  },
  document: {
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      return { style: {}, click() {} };
    },
  },
  URL: {
    createObjectURL(blob) {
      context.__lastBlob = blob;
      return 'blob:validate';
    },
    revokeObjectURL() {},
  },
  window: { setTimeout(fn) { fn(); } },
  setTimeout,
  __XLSX_EXPORT_DEBUG__: true,
};

vm.createContext(context);
vm.runInContext(compiled, context);
const { exportXlsxWorkbook } = context.module.exports;

const workbooks = [
  [
    'immeubles.xlsx',
    [
      { name: 'Immeubles', rows: [{ nom: 'Immeuble A', adresse: 'Kinshasa Centre', statut: 'Actif', valeur: 123.45 }] },
    ],
  ],
  [
    'Locataires.xlsx',
    [
      { name: 'Locataires', rows: [{ nom: 'Elise', telephone: '+243000000', email: 'test@example.com', actif: true }] },
    ],
  ],
  [
    'Baux.xlsx',
    [
      { name: 'Baux', rows: [{ reference: 'BAIL-2026-001', locataire: 'Marie Mukendi', debut: new Date('2026-07-17T00:00:00Z'), montant: 650 }] },
    ],
  ],
  [
    'Situation.xlsx',
    [
      { name: 'Informations', rows: [{ compte: 'Locataire', solde: 1000, actif: false, date: new Date('2026-08-03T10:00:00Z') }] },
      { name: 'Baux', rows: [{ bail: 'BAIL-2026-001', statut: 'Actif', debut: '2026-07-17', fin: '2026-09-30' }] },
      { name: 'Factures', rows: [{ facture: 'FAC-001', periode: '07/2026', total: 650, reste: 250 }] },
      { name: 'Paiements', rows: [{ date: '2026-08-03', reference: 'RCPT-001', montant: 400, mode: 'CASH' }] },
      { name: 'Garanties', rows: [{ reference: 'GAR-001', montant: 650, paye: 650, statut: 'PAID' }] },
      { name: 'Relances', rows: [{ facture: 'FAC-001', derniere_relance: '2026-08-02', nombre_relances: 2 }] },
      { name: 'Documents', rows: [{ nom: 'Contrat.pdf', statut: 'Disponible', detail: 'Contrat signe' }] },
      { name: 'Timeline', rows: [{ date: '2026-08-03', evenement: 'Paiement', montant: 400 }] },
      { name: 'Rentabilite', rows: [{ total_loyers: 650, total_encaisse: 400, total_impayes: 250 }] },
    ],
  ],
  [
    'Bail.xlsx',
    [
      { name: 'Informations', rows: [{ reference: 'BAIL-2026-XYZ', clause: 'Texte accentue, apostrophe, & et < >', date: new Date('2026-08-03T10:00:00Z') }] },
    ],
  ],
];

async function generate(filename, sheets) {
  await exportXlsxWorkbook(filename, sheets);
  const file = path.join(tempDir, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  fs.writeFileSync(file, context.__lastBlob.buffer);
  return file;
}

const files = [];
for (const [filename, sheets] of workbooks) {
  files.push(await generate(filename, sheets));
}

for (const file of files) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  if (!workbook.worksheets.length) throw new Error(`No worksheets found in ${path.basename(file)}`);
  for (const sheet of workbook.worksheets) {
    const actualRowCount = sheet.actualRowCount ?? sheet.rowCount;
    const actualColumnCount = sheet.actualColumnCount ?? sheet.columnCount;
    if (sheet.rowCount <= 0 || actualRowCount <= 0 || actualColumnCount <= 0) {
      throw new Error(`Empty sheet detected in ${path.basename(file)} / ${sheet.name}`);
    }
    let firstNonEmptyCell = null;
    for (let rowNumber = 1; rowNumber <= actualRowCount && !firstNonEmptyCell; rowNumber += 1) {
      for (let columnNumber = 1; columnNumber <= actualColumnCount; columnNumber += 1) {
        const cell = sheet.getCell(rowNumber, columnNumber);
        if (cell.value === null || cell.value === undefined || cell.value === '') continue;
        firstNonEmptyCell = `${cell.address}:${String(cell.value)}`;
        break;
      }
    }
    if (!firstNonEmptyCell) throw new Error(`No non-empty cell found in ${path.basename(file)} / ${sheet.name}`);
  }
}

console.log(`Validated ${files.length} XLSX files in ${tempDir}`);