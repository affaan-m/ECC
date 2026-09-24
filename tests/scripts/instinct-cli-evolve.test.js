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
  console.log('\n=== Testing instinct-cli.py evolve clustering ===\n');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-evolve-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeInstinct(root, id, trigger, confidence = 0.8, domain = 'workflow') {
  const filePath = path.join(root, 'instincts', 'personal', `${id}.yaml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '---',
      `id: ${id}`,
      `trigger: ${trigger}`,
      `confidence: ${confidence}`,
      `domain: ${domain}`,
      'scope: global',
      '---',
      '',
      '## Action',
      '',
      `Action for ${id}.`,
      '',
    ].join('\n')
  );
}

// cwd is the temp dir (not a git repo) so project detection falls back to
// global scope and the fixture instincts are the only ones loaded.
function runEvolve(root, args = []) {
  return spawnSync(PYTHON3, [cliPath, 'evolve', ...args], {
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
}

function clusterCount(stdout) {
  const match = stdout.match(/Potential skill clusters found:\s*(\d+)/);
  assert.ok(match, `cluster count missing from output:\n${stdout}`);
  return Number(match[1]);
}

console.log('\n=== Testing instinct-cli.py evolve clustering ===\n');

// evolve refuses to analyze fewer than 3 instincts, so each fixture adds a
// filler whose trigger shares no keywords with the pair under test.
const FILLER = ['filler-unrelated', 'when rotating expired signing certificates'];

test('instincts with overlapping trigger keywords form one cluster', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'l10n-merge', 'when adding a language to the localization dictionary');
    writeInstinct(root, 'l10n-verify', 'when verifying the localization dictionary for a language');
    writeInstinct(root, ...FILLER);

    const result = runEvolve(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(clusterCount(result.stdout), 1);
  } finally {
    cleanupDir(root);
  }
});

test('unrelated triggers do not cluster together', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'docker-build', 'when building container images for deployment');
    writeInstinct(root, 'sql-index', 'when tuning slow database queries');
    writeInstinct(root, ...FILLER);

    const result = runEvolve(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(clusterCount(result.stdout), 0);
  } finally {
    cleanupDir(root);
  }
});

test('a single shared keyword is not enough to cluster', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'bash-archives', 'when sampling compressed archives with bash pipelines');
    writeInstinct(root, 'bash-signing', 'when inspecting bash exit codes after failures');
    writeInstinct(root, ...FILLER);

    const result = runEvolve(root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(clusterCount(result.stdout), 0);
  } finally {
    cleanupDir(root);
  }
});

test('preview command name matches the file --generate writes', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'reddit-scrape', 'when extracting data from Reddit pages');
    writeInstinct(root, 'filler-one', 'when rotating expired signing certificates', 0.8, 'testing');
    writeInstinct(root, 'filler-two', 'when pruning stale feature branches', 0.8, 'testing');

    const preview = runEvolve(root);
    assert.strictEqual(preview.status, 0, preview.stderr);

    const match = preview.stdout.match(/^\s+\/(\S+)$/m);
    assert.ok(match, `no command candidate in output:\n${preview.stdout}`);
    const previewName = match[1];

    // The old preview stripped every "a " occurrence, mangling "data from"
    // into "datfrom" and advertising a name --generate never wrote.
    assert.ok(
      !previewName.includes('datfrom'),
      `preview mangled the trigger: ${previewName}`
    );

    const generated = runEvolve(root, ['--generate']);
    assert.strictEqual(generated.status, 0, generated.stderr);

    const commandFile = path.join(root, 'evolved', 'commands', `${previewName}.md`);
    assert.ok(
      fs.existsSync(commandFile),
      `expected ${commandFile}, got: ${fs.readdirSync(path.join(root, 'evolved', 'commands')).join(', ')}`
    );
  } finally {
    cleanupDir(root);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
