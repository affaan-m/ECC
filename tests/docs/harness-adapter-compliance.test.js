'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  ADAPTER_RECORDS,
  extractMatrixBlock,
  renderMarkdownTable,
  validateAdapterRecords,
} = require('../../scripts/lib/harness-adapter-compliance');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'harness-adapter-compliance.js');

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

console.log('\n=== Testing harness adapter compliance docs ===\n');

test('adapter compliance matrix covers the required harness surfaces', () => {
  const source = read('docs/architecture/harness-adapter-compliance.md');
  for (const harness of [
    'Claude Code',
    'Codex',
    'OpenCode',
    'Cursor',
    'Gemini',
    'Zed',
    'dmux',
    'Orca',
    'Superset',
    'Ghast',
    'Terminal-only'
  ]) {
    assert.ok(source.includes(harness), `Expected matrix to include ${harness}`);
  }
});

test('adapter compliance source data validates required evidence fields', () => {
  assert.deepStrictEqual(validateAdapterRecords(), []);

  const zedRecord = ADAPTER_RECORDS.find(record => record.id === 'zed');
  assert.ok(zedRecord, 'Expected Zed adapter record');
  assert.strictEqual(zedRecord.state, 'Adapter-backed');
  assert.ok(
    zedRecord.install_or_onramp.includes('`./install.sh --profile minimal --target zed`'),
    'Expected Zed installer onramp'
  );

  for (const record of ADAPTER_RECORDS) {
    assert.ok(record.install_or_onramp.length > 0, `${record.id} needs an install or onramp`);
    assert.ok(record.verification_commands.length > 0, `${record.id} needs verification commands`);
    assert.ok(record.risk_notes.length > 0, `${record.id} needs risk notes`);
    assert.ok(record.source_docs.length > 0, `${record.id} needs source docs`);
  }
});

test('adapter compliance matrix is generated from source data', () => {
  const source = read('docs/architecture/harness-adapter-compliance.md');
  assert.strictEqual(extractMatrixBlock(source), renderMarkdownTable());
});

test('adapter compliance matrix extraction tolerates Windows line endings', () => {
  const source = read('docs/architecture/harness-adapter-compliance.md')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\r\n');
  assert.strictEqual(extractMatrixBlock(source), renderMarkdownTable());
});

test('adapter compliance matrix includes the required evidence columns', () => {
  const source = read('docs/architecture/harness-adapter-compliance.md');
  for (const heading of [
    'Supported assets',
    'Unsupported or different surfaces',
    'Install or onramp',
    'Verification command',
    'Risk notes'
  ]) {
    assert.ok(source.includes(heading), `Expected matrix to include ${heading}`);
  }
});

test('scorecard onramp names the local verification commands', () => {
  const source = read('docs/architecture/harness-adapter-compliance.md');
  for (const command of [
    'npm run harness:adapters -- --check',
    'npm run harness:audit -- --format json',
    'npm run observability:ready',
    'node scripts/session-inspect.js --list-adapters',
    'node scripts/loop-status.js --json --write-dir .ecc/loop-status'
  ]) {
    assert.ok(source.includes(command), `Expected onramp to include ${command}`);
  }
});

test('adapter compliance CLI check passes against the committed doc', () => {
  const output = execFileSync('node', [scriptPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.ok(output.includes('Harness Adapter Compliance: PASS'));
  assert.ok(output.includes(`Adapters: ${ADAPTER_RECORDS.length}`));
});

test('adapter compliance CLI emits machine-readable scorecard data', () => {
  const output = execFileSync('node', [scriptPath, '--format=json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output);

  assert.strictEqual(parsed.schema_version, 'ecc.harness-adapter-compliance.v1');
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.adapter_count, ADAPTER_RECORDS.length);
  assert.ok(parsed.adapters.some(record => record.id === 'terminal-only'));
});

test('cross-harness architecture links to the adapter compliance matrix', () => {
  const source = read('docs/architecture/cross-harness.md');
  assert.ok(source.includes('harness-adapter-compliance.md'));
});

test('GA roadmap records the matrix and validator as current evidence', () => {
  const source = read('docs/ECC-2.0-GA-ROADMAP.md');
  assert.ok(source.includes('docs/architecture/harness-adapter-compliance.md'));
  assert.ok(source.includes('npm run harness:adapters -- --check'));
  assert.ok(source.includes('scripts/lib/harness-adapter-compliance.js'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
