import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('..', import.meta.url)));
const markers = [
  String.fromCodePoint(0xc3),
  String.fromCodePoint(0xc2),
  String.fromCodePoint(0xe2) + String.fromCodePoint(0x20ac),
  String.fromCodePoint(0xef, 0xbf, 0xbd),
  String.fromCodePoint(0xfffd),
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walk(root);
const failures = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const found = markers.filter((marker) => content.includes(marker));
  if (found.length) {
    failures.push({ file, found });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`${failure.file}: ${failure.found.join(', ')}`);
  }
  process.exit(1);
}

console.log(`UTF-8 RH check OK (${files.length} files scanned)`);
