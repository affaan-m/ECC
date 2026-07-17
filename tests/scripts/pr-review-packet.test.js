/**
 * Tests for scripts/pr-review-packet.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const SCRIPT = path.join(repoRoot, 'scripts', 'pr-review-packet.js');
const packet = require(SCRIPT);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(rootDir, relativePath, content) {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function runGit(rootDir, args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function initFixtureRepo() {
  const rootDir = createTempDir('ecc-pr-review-packet-');

  runGit(rootDir, ['init']);
  runGit(rootDir, ['config', 'user.email', 'test@example.com']);
  runGit(rootDir, ['config', 'user.name', 'ECC Test']);
  runGit(rootDir, ['checkout', '-b', 'main']);

  writeFile(rootDir, 'src/old-name.js', [
    'export function oldName(value) {',
    '  return value + 1;',
    '}',
    ''
  ].join('\n'));
  writeFile(rootDir, 'src/template.js', [
    'export function template(value) {',
    '  return value * 2;',
    '}',
    ''
  ].join('\n'));
  writeFile(rootDir, 'README.md', '# Fixture\n');
  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', 'initial fixture']);

  runGit(rootDir, ['checkout', '-b', 'feature/review-packet']);
  fs.renameSync(path.join(rootDir, 'src', 'old-name.js'), path.join(rootDir, 'src', 'new-name.js'));
  fs.copyFileSync(path.join(rootDir, 'src', 'template.js'), path.join(rootDir, 'src', 'template-copy.js'));
  writeFile(rootDir, 'tests/new-name.test.js', [
    "import { newName } from '../src/new-name.js';",
    '',
    "test('increments', () => {",
    '  expect(newName(1)).toBe(3);',
    '});',
    ''
  ].join('\n'));
  writeFile(rootDir, '.claude/plans/review-packet.plan.md', '# Review Packet Plan\n');
  runGit(rootDir, ['add', '.']);
  runGit(rootDir, ['commit', '-m', 'feature changes']);

  return rootDir;
}

function runCli(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000
  });
}

function writeGhShim(rootDir, body) {
  const shimPath = path.join(rootDir, 'gh-shim.js');
  fs.writeFileSync(shimPath, body, 'utf8');
  return shimPath;
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
  console.log('\n=== Testing pr-review-packet.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parses git name-status rename and copy rows', () => {
    const rows = packet.parseNameStatus([
      'R091\tsrc/old.js\tsrc/new.js',
      'C100\tsrc/base.js\tsrc/copy.js',
      'M\tsrc/edit.js'
    ].join('\n'));

    assert.deepStrictEqual(rows.map(row => row.change), ['renamed', 'copied', 'modified']);
    assert.strictEqual(rows[0].oldPath, 'src/old.js');
    assert.strictEqual(rows[0].path, 'src/new.js');
    assert.strictEqual(rows[1].score, 100);
  })) passed++; else failed++;

  if (test('builds JSON packet with rename/copy maps, groups, and related artifacts', () => {
    const rootDir = initFixtureRepo();

    try {
      const result = runCli([
        '--root', rootDir,
        '--base', 'main',
        '--head', 'HEAD',
        '--json',
        '--find-copies-harder',
        '--no-github'
      ], { cwd: rootDir });

      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);

      assert.strictEqual(parsed.schema_version, packet.SCHEMA_VERSION);
      assert.strictEqual(parsed.git.range, 'main...HEAD');
      assert.ok(parsed.maps.renames.some(row => row.oldPath === 'src/old-name.js' && row.path === 'src/new-name.js'));
      assert.ok(parsed.maps.copies.some(row => row.oldPath === 'src/template.js' && row.path === 'src/template-copy.js'));
      assert.ok(parsed.groups.source.some(row => row.path === 'src/new-name.js'));
      assert.ok(parsed.groups.tests.some(row => row.path === 'tests/new-name.test.js'));
      assert.ok(parsed.relatedArtifacts.some(bucket => (
        bucket.kind === 'plans'
        && bucket.files.some(file => file.path === '.claude/plans/review-packet.plan.md')
      )));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('writes markdown output as a durable review artifact', () => {
    const rootDir = initFixtureRepo();
    const outputPath = path.join(rootDir, '.claude', 'reviews', 'packet.md');

    try {
      const result = runCli([
        '--root', rootDir,
        '--base', 'main',
        '--markdown',
        '--find-copies-harder',
        '--no-github',
        '--write', outputPath
      ], { cwd: rootDir });

      assert.strictEqual(result.status, 0, result.stderr);
      const written = fs.readFileSync(outputPath, 'utf8');

      assert.strictEqual(result.stdout, written);
      assert.ok(written.includes('# ECC PR Review Packet'));
      assert.ok(written.includes('## Rename And Copy Map'));
      assert.ok(written.includes('src/old-name.js'));
      assert.ok(written.includes('src/template-copy.js'));
      assert.ok(written.includes('## Reviewer Handoff'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('keeps local packet usable when gh metadata fetch fails', () => {
    const rootDir = initFixtureRepo();

    try {
      const shimPath = writeGhShim(rootDir, `
console.error('gh unavailable in test');
process.exit(7);
`);
      const result = runCli([
        '--root', rootDir,
        '--base', 'main',
        '--json',
        '--pr', '123'
      ], {
        cwd: rootDir,
        env: { ECC_GH_SHIM: shimPath }
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);

      assert.strictEqual(parsed.github.pr, null);
      assert.ok(parsed.warnings.some(warning => warning.includes('GitHub PR metadata unavailable')));
      assert.ok(parsed.files.length > 0);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('cli help and invalid args exit cleanly', () => {
    const help = runCli(['--help']);
    assert.strictEqual(help.status, 0);
    assert.ok(help.stdout.includes('Usage: node scripts/pr-review-packet.js'));

    const invalid = runCli(['--format', 'xml']);
    assert.strictEqual(invalid.status, 1);
    assert.ok(invalid.stderr.includes('Invalid format'));
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
