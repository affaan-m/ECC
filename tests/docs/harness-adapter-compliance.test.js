'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ADAPTER_RECORDS,
  MATRIX_BLOCK_END,
  MATRIX_BLOCK_START,
  extractMatrixBlock,
  renderMarkdownTable,
  validateAdapterRecords,
  validateDocumentation,
  validateSourceDocs,
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
    'Pi',
    'Cursor',
    'Gemini',
    'Zed',
    'dmux',
    'DeepSeek Harness',
    'Antigravity',
    'Qwen Code',
    'GitHub Copilot',
    'Hermes',
    'Orca',
    'Superset',
    'Ghast',
    'Terminal-only'
  ]) {
    assert.ok(source.includes(harness), `Expected matrix to include ${harness}`);
  }
});

test('shipped first-party install targets are represented as Adapter-backed records', () => {
  const expectedTargets = [
    ['antigravity', '`./install.sh --profile minimal --target antigravity`', 'docs/ANTIGRAVITY-GUIDE.md'],
    ['qwen', '`./install.sh --target qwen --profile minimal`', 'docs/QWEN-GUIDE.md'],
    ['copilot', '`./install.sh --profile minimal --target copilot`', 'scripts/lib/install-targets/copilot-project.js'],
    ['hermes', '`./install.sh --profile minimal --target hermes`', 'docs/HERMES-HOOKS.md'],
  ];

  for (const [id, onramp, sourceDoc] of expectedTargets) {
    const record = ADAPTER_RECORDS.find(entry => entry.id === id);
    assert.ok(record, `Expected adapter record for ${id}`);
    assert.strictEqual(record.state, 'Adapter-backed', `${id} should be Adapter-backed`);
    assert.ok(record.install_or_onramp.includes(onramp), `${id} should include installer onramp ${onramp}`);
    assert.ok(record.source_docs.includes(sourceDoc), `${id} should reference ${sourceDoc}`);
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

test('every committed adapter source_doc exists inside the repository root', () => {
  assert.deepStrictEqual(validateSourceDocs(ADAPTER_RECORDS, { repoRoot }), []);
});

test('validateSourceDocs and validateDocumentation reject missing, traversal, and escaping source_docs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-adapter-compliance-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-adapter-outside-'));

  try {
    const validDoc = path.join(tempRoot, 'docs', 'GUIDE.md');
    fs.mkdirSync(path.dirname(validDoc), { recursive: true });
    fs.writeFileSync(validDoc, '# Guide\n');

    const baseRecord = {
      id: 'sample',
      harness: 'Sample',
      state: 'Adapter-backed',
      supported_assets: ['skills'],
      unsupported_surfaces: ['hooks'],
      install_or_onramp: ['`./install.sh --target sample`'],
      verification_commands: ['`npm test`'],
      risk_notes: ['None'],
      last_verified_at: '2026-10-30',
      owner: 'ECC maintainers',
      source_docs: ['docs/GUIDE.md'],
    };

    assert.deepStrictEqual(validateSourceDocs([baseRecord], { repoRoot: tempRoot }), []);

    const missingErrors = validateSourceDocs(
      [{ ...baseRecord, source_docs: ['docs/MISSING.md'] }],
      { repoRoot: tempRoot }
    );
    assert.strictEqual(missingErrors.length, 1);
    assert.match(missingErrors[0], /sample: missing source_doc docs\/MISSING\.md/);

    for (const unsafePath of ['../outside.md', 'docs/../../outside.md', '/etc/passwd', 'C:/outside.md']) {
      const traversalErrors = validateSourceDocs(
        [{ ...baseRecord, source_docs: [unsafePath] }],
        { repoRoot: tempRoot }
      );
      assert.strictEqual(traversalErrors.length, 1, `Expected error for ${unsafePath}`);
      assert.match(traversalErrors[0], /must be a repo-relative path without '\.\.'/);
    }

    const matrixDoc = path.join(tempRoot, 'docs', 'architecture', 'harness-adapter-compliance.md');
    fs.mkdirSync(path.dirname(matrixDoc), { recursive: true });
    const badRecords = [{ ...baseRecord, source_docs: ['docs/MISSING.md'] }];
    fs.writeFileSync(
      matrixDoc,
      `${MATRIX_BLOCK_START}\n${renderMarkdownTable(badRecords)}\n${MATRIX_BLOCK_END}\n`
    );

    const docErrors = validateDocumentation({
      repoRoot: tempRoot,
      docPath: matrixDoc,
      records: badRecords,
      checkSourceDocs: true,
    });
    assert.strictEqual(docErrors.length, 1);
    assert.match(docErrors[0], /sample: missing source_doc docs\/MISSING\.md/);

    const outsideFile = path.join(outsideRoot, 'secret.md');
    fs.writeFileSync(outsideFile, 'outside\n');
    const symlinkDoc = path.join(tempRoot, 'docs', 'escaped-link.md');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(outsideFile, symlinkDoc, 'file');
      symlinkCreated = true;
    } catch (_error) {
      // Unprivileged Windows environments may disallow file symlinks.
    }

    if (symlinkCreated) {
      const symlinkErrors = validateSourceDocs(
        [{ ...baseRecord, source_docs: ['docs/escaped-link.md'] }],
        { repoRoot: tempRoot }
      );
      assert.strictEqual(symlinkErrors.length, 1);
      assert.match(symlinkErrors[0], /resolves outside repository root/);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
