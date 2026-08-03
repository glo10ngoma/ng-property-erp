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
};

vm.createContext(context);
vm.runInContext(compiled, context);
const { exportXlsxWorkbook } = context.module.exports;

const workbooks = [
  ['immeubles.xlsx', [{ name: 'Immeubles', rows: [{ nom: 'Immeuble A', adresse: 'Kinshasa Centre', statut: 'Actif', valeur: 123.45 }] }]],
  ['Locataires.xlsx', [{ name: 'Locataires', rows: [{ nom: 'Elise', telephone: '+243000000', email: 'test@example.com', actif: true }] }]],
  ['Baux.xlsx', [{ name: 'Baux', rows: [{ reference: 'BAIL-2026-001', locataire: 'Marie Mukendi', debut: new Date('2026-07-17T00:00:00Z'), montant: 650 }] }]],
  ['Situation.xlsx', [
    { name: 'Informations', rows: [{ compte: 'Locataire', solde: 1000, actif: false, date: new Date('2026-08-03T10:00:00Z') }] },
    { name: 'Timeline', rows: [{ date: new Date('2026-08-03T10:00:00Z'), evenement: 'Paiement', montant: 250 }] },
    { name: 'Vide', rows: [] },
  ]],
  ['Bail.xlsx', [{ name: 'Informations', rows: [{ reference: 'BAIL-2026-XYZ', clause: 'Texte accentue, apostrophe, & et < >', date: new Date('2026-08-03T10:00:00Z') }] }]],
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
    if (sheet.rowCount <= 0 || sheet.columnCount <= 0) throw new Error(`Empty sheet detected in ${path.basename(file)} / ${sheet.name}`);
  }
}

console.log(`Validated ${files.length} XLSX files in ${tempDir}`);
