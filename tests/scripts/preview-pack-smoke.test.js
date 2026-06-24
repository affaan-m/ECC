'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'preview-pack-smoke.js');
const {
  REQUIRED_ARTIFACTS,
  REQUIRED_PUBLICATION_BLOCKERS,
  REQUIRED_VERIFICATION_COMMANDS,
  buildReport,
  parseArgs,
  renderText,
} = require(SCRIPT);

const RELEASE_DIR = 'docs/releases/2.0.0-rc.1';

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(rootDir, relativePath, content) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function manifestContent() {
  return [
    '# ECC v2.0.0-rc.1 Preview Pack Manifest',
    '',
    '## Pack Contents',
    '',
    '| Artifact | Role | Gate |',
    '| --- | --- | --- |',
    ...REQUIRED_ARTIFACTS.map(artifact => `| \`${artifact}\` | release artifact | checked |`),
    '',
    '## Hermes Skill Boundary',
    '',
    '- no raw workspace exports;',
    '',
    '## Final Verification Commands',
    '',
    '```bash',
    ...REQUIRED_VERIFICATION_COMMANDS,
    '```',
    '',
    '## Publication Blockers',
    '',
    ...REQUIRED_PUBLICATION_BLOCKERS.map(blocker => `- ${blocker}`),
    '',
    'The preview pack is not public without approval-gated release, package, plugin, and announcement steps.',
  ].join('\n');
}

function seedRepo(rootDir, overrides = {}) {
  const files = {
    'package.json': JSON.stringify({
      files: ['scripts/preview-pack-smoke.js'],
      scripts: {
        'preview-pack:smoke': 'node scripts/preview-pack-smoke.js',
      },
    }, null, 2),
    'scripts/preview-pack-smoke.js': 'preview pack smoke script',
    [`${RELEASE_DIR}/preview-pack-manifest.md`]: manifestContent(),
    'docs/HERMES-SETUP.md': [
      '# Hermes Setup',
      'Public Release Candidate Scope',
      'ECC v2.0.0-rc.1 documents the Hermes surface',
      'No raw workspace export is included.',
    ].join('\n'),
    'skills/hermes-imports/SKILL.md': [
      '---',
      'name: hermes-imports',
      '---',
      'Sanitization Checklist',
      'Do not ship raw workspace exports',
      'Output Contract',
    ].join('\n'),
  };

  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!Object.prototype.hasOwnProperty.call(files, artifact)) {
      files[artifact] = `${artifact} public preview-pack content`;
    }
  }

  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) {
      continue;
    }
    writeFile(rootDir, relativePath, content);
  }
}

function run(args = [], options = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function runProcess(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing preview-pack-smoke.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts smoke flags and rejects invalid values', () => {
    const rootDir = createTempDir('preview-pack-smoke-args-');

    try {
      const parsed = parseArgs([
        'node',
        'script',
        '--format=json',
        `--root=${rootDir}`,
      ]);

      assert.strictEqual(parsed.format, 'json');
      assert.strictEqual(parsed.root, path.resolve(rootDir));
      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format/);
      assert.throws(() => parseArgs(['node', 'script', '--root']), /--root requires a value/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument/);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('seeded release pack passes every smoke check', () => {
    const rootDir = createTempDir('preview-pack-smoke-pass-');

    try {
      seedRepo(rootDir);
      const report = buildReport({ root: rootDir });

      assert.strictEqual(report.schema_version, 'ecc.preview-pack-smoke.v1');
      assert.strictEqual(report.ready, true);
      assert.strictEqual(report.summary.failed, 0);
      assert.ok(report.checks.every(check => check.status === 'pass'));

      const text = renderText(report);
      assert.ok(text.includes('Ready: yes'));
      assert.ok(text.includes('Passed: 5'));
      assert.ok(text.includes('Failed: 0'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('script registration fails closed without package wiring', () => {
    const rootDir = createTempDir('preview-pack-smoke-package-');

    try {
      seedRepo(rootDir, {
        'package.json': JSON.stringify({ files: [], scripts: {} }, null, 2),
      });

      const report = buildReport({ root: rootDir });
      const registration = report.checks.find(check => check.id === 'preview-pack-script-registered');

      assert.strictEqual(report.ready, false);
      assert.strictEqual(registration.status, 'fail');
      assert.ok(registration.fix.includes('preview-pack:smoke'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('Hermes boundary fails closed on private local paths', () => {
    const rootDir = createTempDir('preview-pack-smoke-private-path-');

    try {
      seedRepo(rootDir, {
        [`${RELEASE_DIR}/quickstart.md`]: 'Do not ship /Users/affoon/private-state in public docs.',
      });

      const report = buildReport({ root: rootDir });
      const boundary = report.checks.find(check => check.id === 'hermes-boundary-sanitized');

      assert.strictEqual(report.ready, false);
      assert.strictEqual(boundary.status, 'fail');
      assert.ok(boundary.evidence.includes(`${RELEASE_DIR}/quickstart.md:1`));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('CLI emits json and uses status 2 for failed smoke reports', () => {
    const rootDir = createTempDir('preview-pack-smoke-cli-');

    try {
      seedRepo(rootDir);
      const stdout = run(['--format=json', `--root=${rootDir}`], { cwd: rootDir });
      const parsed = JSON.parse(stdout);
      assert.strictEqual(parsed.ready, true);

      writeFile(rootDir, 'package.json', JSON.stringify({ files: [], scripts: {} }, null, 2));
      const failedRun = runProcess(['--format=json', `--root=${rootDir}`], { cwd: rootDir });
      assert.strictEqual(failedRun.status, 2);
      assert.strictEqual(failedRun.stderr, '');
      assert.ok(failedRun.stdout.includes('"ready": false'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('CLI help exits successfully and invalid flags fail before reporting', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.strictEqual(help.stderr, '');
    assert.ok(help.stdout.includes('Usage: node scripts/preview-pack-smoke.js'));

    const invalid = runProcess(['--format=xml']);
    assert.strictEqual(invalid.status, 1);
    assert.strictEqual(invalid.stdout, '');
    assert.match(invalid.stderr, /Error: Invalid format/);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}
