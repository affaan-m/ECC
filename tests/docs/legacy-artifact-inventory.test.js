'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const legacyShimsDir = path.join(repoRoot, 'legacy-command-shims', 'commands');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function findLegacyDocumentDirs(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const nextPath = path.join(dir, entry.name);

    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith('_legacy-documents-')) {
      results.push(path.relative(repoRoot, nextPath));
    }

    results.push(...findLegacyDocumentDirs(nextPath));
  }

  return results.sort();
}

console.log('\n=== Testing legacy artifact inventory ===\n');

test('legacy artifact inventory documents classification states', () => {
  const source = read('docs/legacy-artifact-inventory.md');

  for (const state of [
    'Landed',
    'Milestone-tracked',
    'Salvage branch',
    'Translator/manual review',
    'Archive/no-action',
  ]) {
    assert.ok(source.includes(state), `Missing classification state ${state}`);
  }
});

test('any _legacy-documents directories are explicitly inventoried', () => {
  const source = read('docs/legacy-artifact-inventory.md');
  const dirs = findLegacyDocumentDirs(repoRoot);

  for (const dir of dirs) {
    assert.ok(source.includes(dir), `Missing legacy artifact inventory row for ${dir}`);
  }
});

test('workspace-level legacy repos are inventoried without personal paths', () => {
  const source = read('docs/legacy-artifact-inventory.md');

  for (const dir of [
    '../_legacy-documents-ecc-context-2026-04-30',
    '../_legacy-documents-ecc-everything-claude-code-2026-04-30',
  ]) {
    assert.ok(source.includes(dir), `Missing workspace legacy repo ${dir}`);
  }

  assert.ok(source.includes('Workspace-Level Legacy Repos'));
  assert.ok(!source.includes('/Users/'), 'Inventory should avoid machine-local absolute paths');
});

test('workspace legacy import rules block raw private context', () => {
  const source = read('docs/legacy-artifact-inventory.md');

  for (const required of [
    'Do not read, print, stage, or copy `.env` files',
    'tokens',
    'OAuth secrets',
    'personal paths',
    'private operator context',
    'Do not import raw marketing drafts',
    'public-safe ideas',
  ]) {
    assert.ok(source.includes(required), `Missing import guardrail: ${required}`);
  }
});

test('legacy command shims remain classified as an opt-in archive', () => {
  const source = read('docs/legacy-artifact-inventory.md');
  const readme = read('legacy-command-shims/README.md');

  assert.ok(source.includes('legacy-command-shims/'));
  assert.ok(source.includes('Archive/no-action'));
  assert.ok(readme.includes('no longer loaded by the default plugin command surface'));
  assert.ok(readme.includes('short-term migration compatibility'));
});

test('legacy command shim table tracks the current archive contents', () => {
  const source = read('docs/legacy-artifact-inventory.md');
  const shims = fs.readdirSync(legacyShimsDir)
    .filter(fileName => fileName.endsWith('.md'))
    .sort();

  assert.strictEqual(shims.length, 12);

  for (const shim of shims) {
    assert.ok(source.includes(`\`${shim}\``), `Missing legacy shim ${shim}`);
  }
});

test('stale salvage backlog records the remaining manual-review tail', () => {
  const source = read('docs/legacy-artifact-inventory.md');

  for (const pr of [
    '#1687 zh-CN localization tail',
    '#1609 Persian README translation',
    '#1563 zh-TW README sync',
    '#1564 Turkish README sync',
    '#1565 pt-BR README sync',
  ]) {
    assert.ok(source.includes(pr), `Missing manual-review inventory row for ${pr}`);
  }

  assert.ok(source.includes('Translator/manual review'));
  assert.ok(source.includes('#1746-#1752'));
  assert.ok(source.includes('ITO-55'));
  assert.ok(source.includes('no automatic import remains release-blocking'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
