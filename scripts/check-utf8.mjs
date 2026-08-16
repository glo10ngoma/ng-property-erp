import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const roots = ['frontend/src', 'backend/src', 'docs'];
const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.md', '.sql']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const patterns = [
  { label: 'BOM', test: (text, buf) => buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf },
  { label: 'ReplacementChar', regex: /\uFFFD/u },
  { label: 'Mojibake_A_tilde', regex: /Ã/u },
  { label: 'Mojibake_A_circ', regex: /Â/u },
  { label: 'Mojibake_quotes', regex: /â€|â€™|â€œ|â€|â€“|â€”/u },
  { label: 'Mojibake_BOM_text', regex: /ï»/u },
];
const failures = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!exts.has(path.extname(entry.name))) continue;
    const buf = fs.readFileSync(full);
    let text = '';
    try {
      text = decoder.decode(buf);
    } catch (error) {
      failures.push({ file: full, line: 1, motif: 'InvalidUTF8', extrait: String(error.message) });
      continue;
    }
    if (patterns[0].test(text, buf)) {
      failures.push({ file: full, line: 1, motif: 'BOM', extrait: '(UTF-8 BOM detected)' });
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of patterns.slice(1)) {
        if (pattern.regex.test(line)) {
          failures.push({ file: full, line: index + 1, motif: pattern.label, extrait: line.trim().slice(0, 220) });
        }
      }
    }
  }
}
for (const rel of roots) walk(path.join(repoRoot, rel));
if (failures.length) {
  console.error(JSON.stringify({ total: failures.length, failures }, null, 2));
  process.exit(1);
}
console.log('UTF8_OK');
