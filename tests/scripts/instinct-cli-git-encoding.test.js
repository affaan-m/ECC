/**
 * Tests that instinct-cli.py decodes git output as UTF-8.
 *
 * git prints paths and remote URLs as UTF-8 on every platform, but Python's
 * text-mode subprocess decodes with the locale encoding, which on Windows is
 * the ANSI code page (e.g. cp1252). A non-ASCII repo path or remote URL then
 * comes back garbled (a wrong project name and id) or raises
 * UnicodeDecodeError. The cases below force a cp1252 locale encoding so the
 * failure reproduces on any OS, not only on Windows.
 *
 * Run with: node tests/scripts/instinct-cli-git-encoding.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'instinct-cli.py'
);

function detectPython3() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return bin;
  }
  return null;
}

const PYTHON3 = detectPython3();
const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (!PYTHON3 || gitCheck.status !== 0) {
  console.log('\n=== Testing instinct-cli.py git output encoding ===\n');
  console.log(`  - skipped: ${PYTHON3 ? 'git' : 'Python 3'} not found in PATH`);
  console.log('\nPassed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-encoding-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
}

// Load instinct-cli.py as a module with the locale encoding forced to cp1252,
// as on a Windows machine without UTF-8 mode, and print detect_project()
// next to the values it should have produced. The JSON output is ASCII-only,
// so reading it back does not depend on the console encoding.
function detectWithCp1252Locale(projectDir, homeDir, expectedRemote = '') {
  const code = [
    'import importlib.util, json, locale, sys',
    "locale.getpreferredencoding = lambda do_setlocale=True: 'cp1252'",
    "if hasattr(locale, 'getencoding'): locale.getencoding = lambda: 'cp1252'",
    `spec = importlib.util.spec_from_file_location('icli', ${JSON.stringify(cliPath)})`,
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'p = m.detect_project()',
    `remote = ${JSON.stringify(expectedRemote)}`,
    "expected_id = m._project_hash(m._normalize_remote_url(remote)) if remote else ''",
    "print(json.dumps({'name': p['name'], 'id': p['id'], 'expected_id': expected_id}))",
  ].join('\n');

  const r = spawnSync(PYTHON3, ['-c', code], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      PYTHONUTF8: '0',
      HOME: homeDir,
      USERPROFILE: homeDir,
      CLV2_HOMUNCULUS_DIR: path.join(homeDir, 'homunculus'),
      CLAUDE_PROJECT_DIR: projectDir,
    },
  });
  if (r.status !== 0) {
    throw new Error(`detect_project failed (exit ${r.status}): ${r.stderr || r.error}`);
  }
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

console.log('\n=== Testing instinct-cli.py git output encoding ===\n');

test('a non-ASCII repo path keeps its name under a cp1252 locale', () => {
  const tmp = createTempDir();
  try {
    const name = 'café-repo';
    const projectDir = path.join(tmp, name);
    initRepo(projectDir);

    const result = detectWithCp1252Locale(projectDir, path.join(tmp, 'home'));
    assert.strictEqual(result.name, name);
  } finally {
    cleanupDir(tmp);
  }
});

test('a repo path with a byte cp1252 cannot decode does not crash', () => {
  const tmp = createTempDir();
  try {
    // U+00C1 is C3 81 in UTF-8; 0x81 is unassigned in cp1252.
    const name = 'Árbol-repo';
    const projectDir = path.join(tmp, name);
    initRepo(projectDir);

    const result = detectWithCp1252Locale(projectDir, path.join(tmp, 'home'));
    assert.strictEqual(result.name, name);
  } finally {
    cleanupDir(tmp);
  }
});

test('a non-ASCII remote URL gives the same project id as its UTF-8 text', () => {
  const tmp = createTempDir();
  try {
    const projectDir = path.join(tmp, 'remote-repo');
    const remote = 'https://example.com/équipe/repo.git';
    initRepo(projectDir);
    git(projectDir, ['remote', 'add', 'origin', remote]);

    const result = detectWithCp1252Locale(projectDir, path.join(tmp, 'home'), remote);
    assert.strictEqual(result.id, result.expected_id);
  } finally {
    cleanupDir(tmp);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
