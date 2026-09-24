'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

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

console.log('\n=== Testing stale PR salvage ledger ===\n');

test('stale PR salvage ledger defines every disposition state', () => {
  const source = read('docs/stale-pr-salvage-ledger.md');

  for (const state of [
    'Salvaged',
    'Already present',
    'Superseded',
    'Skipped',
    'Translator/manual review',
  ]) {
    assert.ok(source.includes(state), `Missing salvage state ${state}`);
  }
});

test('stale PR salvage ledger preserves representative source attribution', () => {
  const source = read('docs/stale-pr-salvage-ledger.md');

  for (const pr of [
    '#1309',
    '#1232',
    '#1304',
    '#1322',
    '#1326',
    '#1310',
    '#1325',
    '#1413',
    '#1414',
    '#1478',
    '#1493',
    '#1528/#1529/#1547',
    '#1603',
    '#1658',
    '#1659',
    '#1674',
    '#1687',
    '#1705/#1780',
    '#1757',
  ]) {
    assert.ok(source.includes(pr), `Missing source PR attribution for ${pr}`);
  }
});

test('stale PR salvage ledger records skipped junk and superseded work', () => {
  const source = read('docs/stale-pr-salvage-ledger.md');

  for (const pr of ['#1306', '#1337', '#1341', '#1416/#1465', '#1475']) {
    assert.ok(source.includes(pr), `Missing skipped or superseded PR ${pr}`);
  }

  assert.ok(source.includes('Accidental fork-sync PRs'));
  assert.ok(source.includes('too low-signal'));
});

test('stale PR salvage ledger keeps localization tails manual-review only', () => {
  const source = read('docs/stale-pr-salvage-ledger.md');

  assert.ok(source.includes('The remaining plausibly useful backlog is translation/localization work'));
  assert.ok(source.includes('#1687 zh-CN localization tail'));
  assert.ok(source.includes('#1609 Persian README translation'));
  assert.ok(source.includes('#1563 zh-TW README sync'));
  assert.ok(source.includes('translator/manual review'));
  assert.ok(source.includes('Linear ITO-55'));
  assert.ok(source.includes('Do not import stale top-level docs'));
  assert.ok(source.includes('not a release-blocking salvage task'));
});

test('legacy inventory and roadmap link to the durable salvage ledger', () => {
  const inventory = read('docs/legacy-artifact-inventory.md');
  const roadmap = read('docs/ECC-2.0-GA-ROADMAP.md');

  assert.ok(inventory.includes('docs/stale-pr-salvage-ledger.md'));
  assert.ok(roadmap.includes('docs/stale-pr-salvage-ledger.md'));
  assert.ok(roadmap.includes('#1687, #1609, #1563, #1564'));
  assert.ok(roadmap.includes('Linear ITO-55'));
  assert.ok(roadmap.includes('#1609'));
  assert.ok(roadmap.includes('no automatic import remains release-blocking'));
});

test('stale PR salvage ledger records the May 12 gap pass', () => {
  const source = read('docs/stale-pr-salvage-ledger.md');

  for (const pr of [
    '#1310',
    '#1325',
    '#1360',
    '#1414',
    '#1415',
    '#1478',
    '#1438',
    '#1504',
    '#1508',
    '#1563/#1564/#1565',
    '#1567',
    '#1570',
    '#1584',
    '#1589',
    '#1594',
    '#1597',
    '#1602',
    '#1603',
    '#1604',
    '#1609',
    '#1613',
    '#1631',
    '#1648',
    '#1658',
    '#1693',
  ]) {
    assert.ok(source.includes(pr), `Missing May 12 gap-pass PR ${pr}`);
  }

  assert.ok(source.includes('Django/Celery maintainer branch'));
  assert.ok(source.includes('already preserved in #1770'));
  assert.ok(source.includes('already preserved in #1769'));
  assert.ok(source.includes('already preserved in #1766'));
  assert.ok(source.includes('GateGuard subagent file-gate bypass'));
  assert.ok(source.includes('HTTP MCP reachability handling'));
  assert.ok(source.includes('current managed installer/profile flow'));
  assert.ok(source.includes('false-positive proof gate'));
  assert.ok(source.includes('session_id` from stdin JSON'));
  assert.ok(source.includes('Already present as `skills/redis-patterns/`'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
