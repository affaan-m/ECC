// Static sanity check: every file the manifest references exists, every ESM
// import and HTML asset inside src/ resolves, and no file exceeds 800 lines.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const problems = [];
const must = p => { if (!existsSync(join(root, p))) problems.push(`missing file: ${p}`); };

Object.values(manifest.icons || {}).forEach(must);
must(manifest.side_panel.default_path);
must(manifest.options_page);
must(manifest.background.service_worker);
manifest.content_scripts.forEach(cs => cs.js.forEach(must));

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(join(root, 'src'));
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > 800) problems.push(`${file} has ${lines} lines (max 800)`);
  if (file.endsWith('.js')) {
    for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      if (!existsSync(resolve(dirname(file), m[1]))) problems.push(`${file}: unresolved import ${m[1]}`);
    }
  }
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (!existsSync(resolve(dirname(file), m[1]))) problems.push(`${file}: unresolved asset ${m[1]}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`manifest and ${files.length} source files look consistent`);
