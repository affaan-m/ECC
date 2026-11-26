/**
 * Tests that instinct-cli.py import keeps the instincts it does not update.
 *
 * An import writes every instinct from its source into one file. Updating one
 * of them later must remove only that instinct's old copy: the file's other
 * instincts are not part of the update and have no other copy on disk.
 *
 * Run with: node tests/scripts/instinct-cli-import.test.js
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
if (!PYTHON3) {
  console.log('\n=== Testing instinct-cli.py import updates ===\n');
  console.log('  - skipped: Python 3 not found in PATH');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-import-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function instinctBlock(id, confidence) {
  return [
    '---',
    `id: ${id}`,
    `trigger: "when ${id} applies"`,
    `confidence: ${confidence}`,
    'domain: workflow',
    '---',
    '',
    `Action for ${id}.`,
    '',
  ].join('\n');
}

function writeSource(dir, name, instincts) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(
    filePath,
    instincts.map(([id, confidence]) => instinctBlock(id, confidence)).join('\n')
  );
  return filePath;
}

function runCli(root, args, options = {}) {
  return spawnSync(PYTHON3, [cliPath, ...args], {
    cwd: options.cwd || root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLV2_HOMUNCULUS_DIR: root,
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      CLAUDE_PROJECT_DIR: '',
      CLV2_SKIP_PYTHON_EOL_NOTICE: '1',
    },
  });
}

function importFile(root, sourcePath, scope, options) {
  const result = runCli(root, ['import', sourcePath, '--scope', scope, '--force'], options);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result;
}

// Every instinct stored under an instincts directory, across personal/ and
// inherited/, with the text that follows its frontmatter.
function readStoredInstincts(instinctsDir) {
  const found = [];
  for (const sub of ['personal', 'inherited']) {
    const dir = path.join(instinctsDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      let content = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      const blocks = content.matchAll(/^---\n((?:.*\n)*?)---\n((?:(?!---\n).*\n?)*)/gm);
      for (const [, frontmatter, body] of blocks) {
        const id = (frontmatter.match(/^id: (.+)$/m) || [])[1];
        const confidence = (frontmatter.match(/^confidence: (.+)$/m) || [])[1];
        found.push({ id, confidence, body: body.trim() });
      }
    }
  }
  return found;
}

// The stored `id=confidence` pairs, sorted so the assertion does not depend on
// which file an instinct lives in. Each instinct must still carry its own
// action text: a kept id with a lost or swapped body is not a kept instinct.
function storedInstincts(instinctsDir) {
  const stored = readStoredInstincts(instinctsDir);
  for (const instinct of stored) {
    assert.strictEqual(instinct.body, `Action for ${instinct.id}.`, `action text of ${instinct.id}`);
  }
  return stored.map(instinct => `${instinct.id}=${instinct.confidence}`).sort();
}

function listFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

// Built from the code point so the fixture text is unambiguous: this is one
// backslash, written into instinct files ahead of a `u00e9`-style escape.
const BACKSLASH = String.fromCharCode(92);

function rawBlock(idLine, confidence, action) {
  return ['---', idLine, 'trigger: "when it applies"', `confidence: ${confidence}`, '---', '', action, ''].join('\n');
}

// Run cmd_import in-process and count the atomic rewrites it performs.
function importCountingRewrites(root, sourcePath) {
  const code = [
    'import argparse, importlib.util, json',
    `spec = importlib.util.spec_from_file_location('icli', ${JSON.stringify(cliPath)})`,
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'rewrites = []',
    'write = m._write_text_atomic',
    'def counting(file_path, content):',
    '    rewrites.append(file_path.name)',
    '    write(file_path, content)',
    'm._write_text_atomic = counting',
    `args = argparse.Namespace(source=${JSON.stringify(sourcePath)}, scope='global', min_confidence=None, dry_run=False, force=True)`,
    'status = m.cmd_import(args)',
    "print(json.dumps({'status': status, 'rewrites': rewrites}))",
  ].join('\n');
  const result = spawnSync(PYTHON3, ['-c', code], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLV2_HOMUNCULUS_DIR: root,
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      CLAUDE_PROJECT_DIR: '',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
}

console.log('\n=== Testing instinct-cli.py import updates ===\n');

test('updating one instinct keeps the other instincts imported from the same file', () => {
  const root = createTempDir();
  try {
    const sources = path.join(root, 'sources');
    const team = writeSource(sources, 'team.yaml', [
      ['prefer-functional', 0.6],
      ['always-test-first', 0.7],
      ['grep-before-edit', 0.8],
    ]);
    const update = writeSource(sources, 'update.yaml', [['prefer-functional', 0.9]]);
    const instinctsDir = path.join(root, 'instincts');

    importFile(root, team, 'global');
    assert.deepStrictEqual(storedInstincts(instinctsDir), [
      'always-test-first=0.7',
      'grep-before-edit=0.8',
      'prefer-functional=0.6',
    ]);

    const result = importFile(root, update, 'global');
    assert.match(result.stdout, /Updated: 1/);
    assert.deepStrictEqual(storedInstincts(instinctsDir), [
      'always-test-first=0.7',
      'grep-before-edit=0.8',
      'prefer-functional=0.9',
    ]);
  } finally {
    cleanupDir(root);
  }
});

test('re-importing a newer revision keeps the instincts it reports as skipped', () => {
  const root = createTempDir();
  try {
    const sources = path.join(root, 'sources');
    const first = writeSource(sources, 'team-v1.yaml', [
      ['prefer-functional', 0.6],
      ['always-test-first', 0.7],
      ['grep-before-edit', 0.8],
    ]);
    const second = writeSource(sources, 'team-v2.yaml', [
      ['prefer-functional', 0.9],
      ['always-test-first', 0.7],
      ['grep-before-edit', 0.8],
    ]);
    const instinctsDir = path.join(root, 'instincts');

    importFile(root, first, 'global');
    const result = importFile(root, second, 'global');
    assert.match(result.stdout, /SKIP \(2 - already exists/);
    assert.deepStrictEqual(storedInstincts(instinctsDir), [
      'always-test-first=0.7',
      'grep-before-edit=0.8',
      'prefer-functional=0.9',
    ]);
  } finally {
    cleanupDir(root);
  }
});

test('updating several instincts from one file keeps the rest of that file', () => {
  const root = createTempDir();
  try {
    const sources = path.join(root, 'sources');
    const first = writeSource(sources, 'team-v1.yaml', [
      ['prefer-functional', 0.6],
      ['always-test-first', 0.7],
      ['grep-before-edit', 0.8],
    ]);
    const second = writeSource(sources, 'team-v2.yaml', [
      ['prefer-functional', 0.9],
      ['grep-before-edit', 0.95],
    ]);
    const instinctsDir = path.join(root, 'instincts');

    importFile(root, first, 'global');
    importFile(root, second, 'global');
    assert.deepStrictEqual(storedInstincts(instinctsDir), [
      'always-test-first=0.7',
      'grep-before-edit=0.95',
      'prefer-functional=0.9',
    ]);
  } finally {
    cleanupDir(root);
  }
});

test('a project-scoped update keeps the other instincts in the project file', () => {
  const root = createTempDir();
  const repoParent = createTempDir();
  try {
    const repoDir = path.join(repoParent, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    const init = spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
    assert.strictEqual(init.status, 0, init.stderr);

    const sources = path.join(root, 'sources');
    const team = writeSource(sources, 'team.yaml', [
      ['prefer-functional', 0.6],
      ['always-test-first', 0.7],
    ]);
    const update = writeSource(sources, 'update.yaml', [['prefer-functional', 0.9]]);

    importFile(root, team, 'project', { cwd: repoDir });
    importFile(root, update, 'project', { cwd: repoDir });

    const projects = listFiles(path.join(root, 'projects'));
    assert.strictEqual(projects.length, 1, `expected one project, got: ${projects.join(', ')}`);
    assert.deepStrictEqual(
      storedInstincts(path.join(root, 'projects', projects[0], 'instincts')),
      ['always-test-first=0.7', 'prefer-functional=0.9']
    );
  } finally {
    cleanupDir(root);
    cleanupDir(repoParent);
  }
});

test('an update keeps the other instincts in a file that starts with a BOM or uses CRLF', () => {
  for (const [label, encode] of [
    ['BOM', text => `\ufeff${text}`],
    ['CRLF', text => text.replace(/\n/g, '\r\n')],
  ]) {
    const root = createTempDir();
    try {
      const inheritedDir = path.join(root, 'instincts', 'inherited');
      fs.mkdirSync(inheritedDir, { recursive: true });
      fs.writeFileSync(
        path.join(inheritedDir, 'team.yaml'),
        encode([
          instinctBlock('prefer-functional', 0.6),
          instinctBlock('always-test-first', 0.7),
        ].join('\n'))
      );
      const update = writeSource(path.join(root, 'sources'), 'update.yaml', [
        ['prefer-functional', 0.9],
      ]);

      importFile(root, update, 'global');
      assert.deepStrictEqual(
        storedInstincts(path.join(root, 'instincts')),
        ['always-test-first=0.7', 'prefer-functional=0.9'],
        label
      );
    } finally {
      cleanupDir(root);
    }
  }
});

test('updating several instincts from one file rewrites that file once', () => {
  const root = createTempDir();
  try {
    const personalDir = path.join(root, 'instincts', 'personal');
    fs.mkdirSync(personalDir, { recursive: true });
    fs.writeFileSync(
      path.join(personalDir, 'team.yaml'),
      ['prefer-functional', 'always-test-first', 'grep-before-edit'].map(id => instinctBlock(id, 0.6)).join('\n')
    );
    const update = writeSource(path.join(root, 'sources'), 'update.yaml', [
      ['prefer-functional', 0.9],
      ['grep-before-edit', 0.9],
    ]);

    const result = importCountingRewrites(root, update);
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(result.rewrites, ['team.yaml']);
    assert.deepStrictEqual(storedInstincts(path.join(root, 'instincts')), [
      'always-test-first=0.6',
      'grep-before-edit=0.9',
      'prefer-functional=0.9',
    ]);
  } finally {
    cleanupDir(root);
  }
});

test('a failed rewrite of the old file is reported and leaves that file intact', () => {
  // Needs a directory the process cannot write to: not expressible with POSIX
  // modes on Windows, and root ignores them.
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
    console.log('    (skipped: needs an unwritable directory)');
    return;
  }
  const root = createTempDir();
  const personalDir = path.join(root, 'instincts', 'personal');
  try {
    fs.mkdirSync(personalDir, { recursive: true });
    const staleFile = path.join(personalDir, 'team.yaml');
    const original = [instinctBlock('prefer-functional', 0.6), instinctBlock('always-test-first', 0.7)].join('\n');
    fs.writeFileSync(staleFile, original);
    const update = writeSource(path.join(root, 'sources'), 'update.yaml', [['prefer-functional', 0.9]]);

    fs.chmodSync(personalDir, 0o555);
    const result = importFile(root, update, 'global');

    assert.match(result.stderr, /Warning: Failed to remove superseded instinct\(s\) prefer-functional from .*team\.yaml: /);
    assert.strictEqual(fs.readFileSync(staleFile, 'utf8'), original);
    assert.deepStrictEqual(storedInstincts(path.join(root, 'instincts')), [
      'always-test-first=0.7',
      'prefer-functional=0.6',
      'prefer-functional=0.9',
    ]);
  } finally {
    fs.chmodSync(personalDir, 0o755);
    cleanupDir(root);
  }
});

test('an old copy whose id is written with a JSON escape is reported, not silently kept', () => {
  const root = createTempDir();
  try {
    const personalDir = path.join(root, 'instincts', 'personal');
    fs.mkdirSync(personalDir, { recursive: true });
    const staleFile = path.join(personalDir, 'team.yaml');
    // The escape sequence spells "p": the parser reads this id as prefer-functional.
    const original = [
      rawBlock(`id: "${BACKSLASH}u0070refer-functional"`, 0.6, 'Action for prefer-functional.'),
      rawBlock('id: always-test-first', 0.7, 'Action for always-test-first.'),
    ].join('\n');
    fs.writeFileSync(staleFile, original);
    const update = writeSource(path.join(root, 'sources'), 'update.yaml', [['prefer-functional', 0.9]]);

    const result = importFile(root, update, 'global');

    assert.match(result.stdout, /Updated: 1/);
    assert.match(result.stderr, /Warning: Could not safely remove superseded instinct\(s\) prefer-functional from .*team\.yaml/);
    assert.strictEqual(fs.readFileSync(staleFile, 'utf8'), original);
  } finally {
    cleanupDir(root);
  }
});

test('updating an id never removes a different instinct whose raw id text looks the same', () => {
  const root = createTempDir();
  try {
    const personalDir = path.join(root, 'instincts', 'personal');
    fs.mkdirSync(personalDir, { recursive: true });
    const staleFile = path.join(personalDir, 'team.yaml');
    // Two different ids to the parser: the first decodes to "caf" + e-acute,
    // the second is the literal text caf, backslash, u00e9.
    const literalIdLine = `id: "caf${BACKSLASH}${BACKSLASH}u00e9"`;
    const original = [
      rawBlock(`id: "caf${BACKSLASH}u00e9"`, 0.6, 'Action for the decoded id.'),
      rawBlock(literalIdLine, 0.6, 'Action for the literal id.'),
    ].join('\n');
    fs.writeFileSync(staleFile, original);
    const sources = path.join(root, 'sources');
    fs.mkdirSync(sources, { recursive: true });
    const update = path.join(sources, 'update.yaml');
    fs.writeFileSync(update, rawBlock(literalIdLine, 0.9, 'Action for the literal id.'));

    const result = importFile(root, update, 'global');

    assert.match(result.stdout, /Updated: 1/);
    assert.match(result.stderr, /Warning: Could not safely remove superseded instinct\(s\) /);
    assert.strictEqual(fs.readFileSync(staleFile, 'utf8'), original);
    assert.match(fs.readFileSync(staleFile, 'utf8'), /Action for the decoded id\./);
  } finally {
    cleanupDir(root);
  }
});

test('updating the only instinct in a file still removes that file', () => {
  const root = createTempDir();
  try {
    const sources = path.join(root, 'sources');
    const first = writeSource(sources, 'solo-v1.yaml', [['prefer-functional', 0.6]]);
    const second = writeSource(sources, 'solo-v2.yaml', [['prefer-functional', 0.9]]);
    const inheritedDir = path.join(root, 'instincts', 'inherited');

    importFile(root, first, 'global');
    const before = listFiles(inheritedDir);
    assert.strictEqual(before.length, 1);
    assert.match(before[0], /^solo-v1-/);

    importFile(root, second, 'global');
    const after = listFiles(inheritedDir);
    assert.strictEqual(after.length, 1, `expected the stale file to be removed, got: ${after.join(', ')}`);
    assert.match(after[0], /^solo-v2-/);
    assert.deepStrictEqual(storedInstincts(path.join(root, 'instincts')), ['prefer-functional=0.9']);
  } finally {
    cleanupDir(root);
  }
});

test('updating a personal instinct replaces its single-instinct file', () => {
  const root = createTempDir();
  try {
    const personalDir = path.join(root, 'instincts', 'personal');
    fs.mkdirSync(personalDir, { recursive: true });
    fs.writeFileSync(
      path.join(personalDir, 'prefer-functional.yaml'),
      instinctBlock('prefer-functional', 0.6)
    );
    fs.writeFileSync(
      path.join(personalDir, 'always-test-first.yaml'),
      instinctBlock('always-test-first', 0.7)
    );
    const update = writeSource(path.join(root, 'sources'), 'update.yaml', [
      ['prefer-functional', 0.9],
    ]);

    importFile(root, update, 'global');
    assert.deepStrictEqual(listFiles(personalDir), ['always-test-first.yaml']);
    assert.deepStrictEqual(storedInstincts(path.join(root, 'instincts')), [
      'always-test-first=0.7',
      'prefer-functional=0.9',
    ]);
  } finally {
    cleanupDir(root);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
