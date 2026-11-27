/**
 * Tests for worktree project-ID mismatch fix
 *
 * Validates that detect-project.sh uses -e (not -d) for .git existence
 * checks, so that git worktrees (where .git is a file) are detected
 * correctly.
 *
 * Run with: node tests/hooks/detect-project-worktree.test.js
 */


// Skip on Windows — these tests invoke bash scripts directly
if (process.platform === 'win32') {
  console.log('Skipping bash-dependent worktree tests on Windows\n');
  process.exit(0);
}
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-worktree-test-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

function toBashPath(filePath) {
  if (process.platform !== 'win32') {
    return filePath;
  }

  return String(filePath)
    .replace(/^([A-Za-z]):/, (_, driveLetter) => `/${driveLetter.toLowerCase()}`)
    .replace(/\\/g, '/');
}

function runBash(command, options = {}) {
  return execFileSync('bash', ['-lc', command], options).toString().trim();
}

const repoRoot = path.resolve(__dirname, '..', '..');
const detectProjectPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'detect-project.sh'
);

console.log('\n=== Worktree Project-ID Mismatch Tests ===\n');

// ──────────────────────────────────────────────────────
// Group 1: Content checks on detect-project.sh
// ──────────────────────────────────────────────────────

console.log('--- Content checks on detect-project.sh ---');

test('uses -e (not -d) for .git existence check', () => {
  const content = fs.readFileSync(detectProjectPath, 'utf8');
  assert.ok(
    content.includes('[ -e "${project_root}/.git" ]'),
    'detect-project.sh should use -e for .git check'
  );
  assert.ok(
    !content.includes('[ -d "${project_root}/.git" ]'),
    'detect-project.sh should NOT use -d for .git check'
  );
});

test('has command -v git fallback check', () => {
  const content = fs.readFileSync(detectProjectPath, 'utf8');
  assert.ok(
    content.includes('command -v git'),
    'detect-project.sh should check for git availability with command -v'
  );
});

test('uses git -C for safe directory operations', () => {
  const content = fs.readFileSync(detectProjectPath, 'utf8');
  assert.ok(
    content.includes('git -C'),
    'detect-project.sh should use git -C for directory-scoped operations'
  );
});

// ──────────────────────────────────────────────────────
// Group 2: Behavior test — -e vs -d
// ──────────────────────────────────────────────────────

console.log('\n--- Behavior test: -e vs -d ---');

const behaviorDir = createTempDir();

test('[ -d ] returns true for .git directory', () => {
  const dir = path.join(behaviorDir, 'test-d-dir');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'));
  const result = runBash(`[ -d "${toBashPath(path.join(dir, '.git'))}" ] && echo yes || echo no`);
  assert.strictEqual(result, 'yes');
});

test('[ -d ] returns false for .git file', () => {
  const dir = path.join(behaviorDir, 'test-d-file');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /some/path\n');
  const result = runBash(`[ -d "${toBashPath(path.join(dir, '.git'))}" ] && echo yes || echo no`);
  assert.strictEqual(result, 'no');
});

test('[ -e ] returns true for .git directory', () => {
  const dir = path.join(behaviorDir, 'test-e-dir');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'));
  const result = runBash(`[ -e "${toBashPath(path.join(dir, '.git'))}" ] && echo yes || echo no`);
  assert.strictEqual(result, 'yes');
});

test('[ -e ] returns true for .git file', () => {
  const dir = path.join(behaviorDir, 'test-e-file');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /some/path\n');
  const result = runBash(`[ -e "${toBashPath(path.join(dir, '.git'))}" ] && echo yes || echo no`);
  assert.strictEqual(result, 'yes');
});

test('[ -e ] returns false when .git does not exist', () => {
  const dir = path.join(behaviorDir, 'test-e-none');
  fs.mkdirSync(dir, { recursive: true });
  const result = runBash(`[ -e "${toBashPath(path.join(dir, '.git'))}" ] && echo yes || echo no`);
  assert.strictEqual(result, 'no');
});

cleanupDir(behaviorDir);

// ──────────────────────────────────────────────────────
// Group 3: E2E test — detect-project.sh with worktree .git file
// ──────────────────────────────────────────────────────

console.log('\n--- E2E: detect-project.sh with worktree .git file ---');

test('detect-project.sh sets PROJECT_NAME and non-global PROJECT_ID for worktree', () => {
  const testDir = createTempDir();

  try {
    // Create a "main" repo with git init so we have real git structures
    const mainRepo = path.join(testDir, 'main-repo');
    fs.mkdirSync(mainRepo, { recursive: true });
    execSync('git init', { cwd: mainRepo, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', {
      cwd: mainRepo,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com'
      }
    });

    const worktreeDir = path.join(testDir, 'my-worktree');
    execSync(`git worktree add "${worktreeDir}" -b feature/project-id`, {
      cwd: mainRepo,
      stdio: 'pipe'
    });
    assert.ok(
      fs.statSync(path.join(worktreeDir, '.git')).isFile(),
      'linked worktree should expose .git as a file'
    );

    // Source detect-project.sh from the worktree directory and capture results
    const script = `
      export CLAUDE_PROJECT_DIR="${toBashPath(worktreeDir)}"
      export HOME="${toBashPath(testDir)}"
      source "${toBashPath(detectProjectPath)}"
      echo "PROJECT_NAME=\${PROJECT_NAME}"
      echo "PROJECT_ID=\${PROJECT_ID}"
    `;

    const result = execFileSync('bash', ['-lc', script], {
      cwd: worktreeDir,
      timeout: 10000,
      env: {
        ...process.env,
        HOME: toBashPath(testDir),
        USERPROFILE: testDir,
        CLAUDE_PROJECT_DIR: toBashPath(worktreeDir)
      }
    }).toString();

    const lines = result.trim().split('\n');
    const vars = {};
    for (const line of lines) {
      const match = line.match(/^(PROJECT_NAME|PROJECT_ID)=(.*)$/);
      if (match) {
        vars[match[1]] = match[2];
      }
    }

    assert.ok(
      vars.PROJECT_NAME && vars.PROJECT_NAME.length > 0,
      `PROJECT_NAME should be set, got: "${vars.PROJECT_NAME || ''}"`
    );
    assert.ok(
      vars.PROJECT_ID && vars.PROJECT_ID !== 'global',
      `PROJECT_ID should not be "global", got: "${vars.PROJECT_ID || ''}"`
    );
  } finally {
    cleanupDir(testDir);
  }
});

test('detect-project.sh uses the main worktree hash when no remote exists', () => {
  const testDir = createTempDir();

  try {
    const mainRepo = path.join(testDir, 'main-repo');
    const worktreeDir = path.join(testDir, 'feature-worktree');
    const homeDir = path.join(testDir, 'home');
    fs.mkdirSync(mainRepo, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    execSync('git init', { cwd: mainRepo, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', {
      cwd: mainRepo,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com'
      }
    });
    execSync(`git worktree add "${worktreeDir}" -b feature/no-remote`, {
      cwd: mainRepo,
      stdio: 'pipe'
    });

    function detectId(targetDir) {
      const script = `
        export HOME="${toBashPath(homeDir)}"
        export USERPROFILE="${toBashPath(homeDir)}"
        export CLAUDE_PROJECT_DIR="${toBashPath(targetDir)}"
        source "${toBashPath(detectProjectPath)}" >/dev/null
        printf "%s" "$PROJECT_ID"
      `;
      return execFileSync('bash', ['-lc', script], {
        cwd: targetDir,
        timeout: 10000,
        env: {
          ...process.env,
          HOME: toBashPath(homeDir),
          USERPROFILE: toBashPath(homeDir),
          CLAUDE_PROJECT_DIR: toBashPath(targetDir)
        }
      }).toString();
    }

    const mainId = detectId(mainRepo);
    const worktreeId = detectId(worktreeDir);
    assert.ok(mainId && mainId !== 'global', 'main repo should get a project id');
    assert.strictEqual(worktreeId, mainId, 'linked worktree should share the main worktree project id');
  } finally {
    cleanupDir(testDir);
  }
});

// ──────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
