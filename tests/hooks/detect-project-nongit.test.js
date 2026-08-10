/**
 * Tests for non-git CLAUDE_PROJECT_DIR project detection (issue #2469)
 *
 * Validates that detect-project.sh honors an explicitly-provided
 * CLAUDE_PROJECT_DIR that is NOT a git repository, deriving a stable
 * path-based PROJECT_ID instead of collapsing to the shared `global`
 * bucket. A bare non-git cwd (no CLAUDE_PROJECT_DIR) must still fall
 * back to `global` — the fix is gated on the explicit env var so an
 * arbitrary working directory never becomes a "project".
 *
 * Run with: node tests/hooks/detect-project-nongit.test.js
 */

// Skip on Windows — these tests invoke bash scripts directly
if (process.platform === 'win32') {
  console.log('Skipping bash-dependent non-git detection tests on Windows\n');
  process.exit(0);
}

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

// Locate a Python interpreter for the cross-implementation consistency check.
// Absent Python just skips that one case (the bash path is the primary fix).
function findPython() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}
const PYTHON = findPython();

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nongit-test-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const detectProjectPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'detect-project.sh'
);
const instinctCliPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'instinct-cli.py'
);

// Resolve the project id the Python CLI (instinct-cli.py) assigns, so we can
// prove it agrees with the shell observer for the same non-git directory.
function pythonProjectId(projectDir, homeDir) {
  const code =
    'import importlib.util as u, sys;' +
    `s=u.spec_from_file_location("icli", ${JSON.stringify(instinctCliPath)});` +
    'm=u.module_from_spec(s); s.loader.exec_module(m);' +
    'print(m.detect_project()["id"])';
  const r = spawnSync(PYTHON, ['-c', code], {
    cwd: projectDir,
    timeout: 10000,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CLAUDE_PROJECT_DIR: projectDir,
    },
  });
  if (r.status !== 0) {
    throw new Error(`instinct-cli.py detect_project failed: ${r.stderr || r.error}`);
  }
  return r.stdout.trim();
}

// Source detect-project.sh with an isolated HOME and the given
// CLAUDE_PROJECT_DIR, returning the exported PROJECT_* vars.
function detect(projectDir, homeDir, { setProjectDir = true } = {}) {
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  if (setProjectDir) {
    env.CLAUDE_PROJECT_DIR = projectDir;
  } else {
    delete env.CLAUDE_PROJECT_DIR;
  }

  // Suppress only stdout; keep stderr so a sourcing failure (e.g. a syntax
  // error or missing _CLV2_PYTHON_CMD) surfaces instead of silently leaving
  // the PROJECT_* vars empty and producing confusing assertion messages.
  const script = `
    source "${detectProjectPath}" >/dev/null
    printf 'PROJECT_ID=%s\\n' "$PROJECT_ID"
    printf 'PROJECT_NAME=%s\\n' "$PROJECT_NAME"
    printf 'PROJECT_ROOT=%s\\n' "$PROJECT_ROOT"
  `;

  const out = execFileSync('bash', ['-lc', script], {
    // Run from the project dir; it is not a git repo, so the cwd-git
    // branch (priority 2) cannot fire and interfere with the assertions.
    cwd: projectDir,
    timeout: 10000,
    env,
  }).toString();

  const vars = {};
  for (const line of out.trim().split('\n')) {
    const m = line.match(/^(PROJECT_ID|PROJECT_NAME|PROJECT_ROOT)=(.*)$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

console.log('\n=== Non-git CLAUDE_PROJECT_DIR detection (issue #2469) ===\n');

console.log('--- Content check ---');

test('detect-project.sh has an env-nogit fallback for non-git dirs', () => {
  const content = fs.readFileSync(detectProjectPath, 'utf8');
  assert.ok(
    content.includes('env-nogit'),
    'detect-project.sh should set source_hint="env-nogit" for non-git CLAUDE_PROJECT_DIR'
  );
});

console.log('\n--- Behavior: non-git CLAUDE_PROJECT_DIR ---');

test('non-git CLAUDE_PROJECT_DIR yields a non-global, path-derived PROJECT_ID', () => {
  const testDir = createTempDir();
  try {
    const homeDir = path.join(testDir, 'home');
    const projectDir = path.join(testDir, 'my-plain-project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    assert.ok(!fs.existsSync(path.join(projectDir, '.git')), 'guard: project dir must not be a git repo');

    const vars = detect(projectDir, homeDir);
    assert.ok(
      vars.PROJECT_ID && vars.PROJECT_ID !== 'global',
      `PROJECT_ID should not be "global", got: "${vars.PROJECT_ID || ''}"`
    );
    assert.ok(
      /^[0-9a-f]{12}$/.test(vars.PROJECT_ID),
      `PROJECT_ID should be a 12-char hex hash, got: "${vars.PROJECT_ID || ''}"`
    );
    assert.strictEqual(
      vars.PROJECT_NAME,
      'my-plain-project',
      `PROJECT_NAME should be the directory basename, got: "${vars.PROJECT_NAME || ''}"`
    );
    assert.strictEqual(
      vars.PROJECT_ROOT,
      fs.realpathSync(projectDir),
      `PROJECT_ROOT should be the canonicalized project dir, got: "${vars.PROJECT_ROOT || ''}"`
    );
  } finally {
    cleanupDir(testDir);
  }
});

test('PROJECT_ID is stable across repeated invocations of the same dir', () => {
  const testDir = createTempDir();
  try {
    const homeDir = path.join(testDir, 'home');
    const projectDir = path.join(testDir, 'stable-project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const first = detect(projectDir, homeDir).PROJECT_ID;
    const second = detect(projectDir, homeDir).PROJECT_ID;
    assert.ok(first && first !== 'global', 'first run should produce a real id');
    assert.strictEqual(second, first, 'the same non-git dir must hash to the same PROJECT_ID');
  } finally {
    cleanupDir(testDir);
  }
});

test('distinct non-git dirs produce distinct PROJECT_IDs', () => {
  const testDir = createTempDir();
  try {
    const homeDir = path.join(testDir, 'home');
    const dirA = path.join(testDir, 'project-a');
    const dirB = path.join(testDir, 'project-b');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    const idA = detect(dirA, homeDir).PROJECT_ID;
    const idB = detect(dirB, homeDir).PROJECT_ID;
    assert.ok(idA && idA !== 'global' && idB && idB !== 'global', 'both dirs should get real ids');
    assert.notStrictEqual(idA, idB, 'different non-git dirs must not share a project id');
  } finally {
    cleanupDir(testDir);
  }
});

console.log('\n--- Gating: bare non-git cwd stays global ---');

test('non-git cwd with no CLAUDE_PROJECT_DIR still falls back to global', () => {
  const testDir = createTempDir();
  try {
    const homeDir = path.join(testDir, 'home');
    const projectDir = path.join(testDir, 'unregistered');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const vars = detect(projectDir, homeDir, { setProjectDir: false });
    assert.strictEqual(
      vars.PROJECT_ID,
      'global',
      `without CLAUDE_PROJECT_DIR an arbitrary non-git cwd must stay "global", got: "${vars.PROJECT_ID || ''}"`
    );
  } finally {
    cleanupDir(testDir);
  }
});

console.log('\n--- Cross-impl consistency: shell observer vs Python CLI ---');

// Guard the Python-dependent case OUTSIDE test() so an unmet prerequisite is
// counted as skipped, never as a silent pass. This is not a hard failure:
// detect-project.sh itself degrades gracefully without Python (it falls back to
// shasum/sha256sum), so a Python-less host is a supported environment where the
// cross-check simply cannot run.
if (!PYTHON) {
  console.log('  ⊘ instinct-cli.py cross-impl check (skipped — no Python interpreter available)');
  skipped++;
} else {
  test('instinct-cli.py assigns the same non-global id as detect-project.sh', () => {
    const testDir = createTempDir();
    try {
      const homeDir = path.join(testDir, 'home');
      const projectDir = path.join(testDir, 'shared-nongit-project');
      fs.mkdirSync(homeDir, { recursive: true });
      fs.mkdirSync(projectDir, { recursive: true });

      const shellId = detect(projectDir, homeDir).PROJECT_ID;
      const pyId = pythonProjectId(projectDir, homeDir);
      assert.ok(shellId && shellId !== 'global', `shell id should be real, got "${shellId}"`);
      assert.ok(pyId && pyId !== 'global', `python id should be real, got "${pyId}"`);
      assert.strictEqual(
        pyId,
        shellId,
        `observer (${shellId}) and CLI (${pyId}) must agree so observations/instincts stay grouped`
      );
    } finally {
      cleanupDir(testDir);
    }
  });
}

console.log('\n=== Test Results ===');
console.log(`Passed:  ${passed}`);
console.log(`Failed:  ${failed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Total:   ${passed + failed + skipped}\n`);

process.exit(failed > 0 ? 1 : 0);
