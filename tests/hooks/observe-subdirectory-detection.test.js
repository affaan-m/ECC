/**
 * Tests for observe.sh subdirectory project detection.
 *
 * Runs the real hook and verifies that project metadata is attached to the git
 * root when cwd is a subdirectory inside a repository.
 */

if (process.platform === 'win32') {
  console.log('Skipping bash-dependent observe tests on Windows');
  process.exit(0);
}

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'hooks',
  'observe.sh'
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    failed += 1;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-subdir-test-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error(`[cleanupDir] failed to remove ${dir}: ${error.message}`);
  }
}

function normalizeComparablePath(filePath) {
  if (!filePath) {
    return filePath;
  }

  const normalized = fs.realpathSync(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function gitInit(dir) {
  const initResult = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(initResult.status, 0, initResult.stderr);

  const remoteResult = spawnSync(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/example/ecc-test.git'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.strictEqual(remoteResult.status, 0, remoteResult.stderr);

  const commitResult = spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  });
  assert.strictEqual(commitResult.status, 0, commitResult.stderr);
}

function runObserve({ homeDir, cwd, args = ['post'], extraEnv = {} }) {
  const payload = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: 'README.md' },
    tool_response: 'ok',
    session_id: 'session-subdir-test',
    cwd,
  });

  return spawnSync('bash', [observeShPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: payload,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CLAUDE_PROJECT_DIR: '',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      ECC_HOOK_PROFILE: 'standard',
      ECC_SKIP_OBSERVE: '0',
      ...extraEnv,
    },
  });
}

function readSingleProjectMetadata(homeDir) {
  const projectsDir = path.join(homeDir, '.local', 'share', 'ecc-homunculus', 'projects');
  const projectIds = fs.readdirSync(projectsDir);
  assert.strictEqual(projectIds.length, 1, 'Expected exactly one project directory');
  const projectDir = path.join(projectsDir, projectIds[0]);
  const projectMetadataPath = path.join(projectDir, 'project.json');
  assert.ok(fs.existsSync(projectMetadataPath), 'project.json should exist');

  return {
    projectDir,
    metadata: JSON.parse(fs.readFileSync(projectMetadataPath, 'utf8')),
  };
}

console.log('\n=== Observe.sh Subdirectory Project Detection Tests ===\n');

test('observe.sh resolves cwd to git root before setting CLAUDE_PROJECT_DIR', () => {
  const content = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    content.includes('git -C "$STDIN_CWD" rev-parse --show-toplevel'),
    'observe.sh should resolve STDIN_CWD to git repo root'
  );
  assert.ok(
    content.includes('export CLV2_NO_PROJECT=1'),
    'observe.sh should mark non-git cwd payloads as global instead of registering raw cwd'
  );
});

test('git rev-parse resolves a subdirectory to the repo root', () => {
  const testDir = createTempDir();

  try {
    const repoDir = path.join(testDir, 'repo');
    const subDir = path.join(repoDir, 'docs', 'api');
    fs.mkdirSync(subDir, { recursive: true });
    gitInit(repoDir);

    const result = spawnSync('git', ['-C', subDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(
      normalizeComparablePath(result.stdout.trim()),
      normalizeComparablePath(repoDir),
      'git root should equal the repository root'
    );
  } finally {
    cleanupDir(testDir);
  }
});

test('git rev-parse fails cleanly outside a repo when discovery is bounded', () => {
  const testDir = createTempDir();

  try {
    const result = spawnSync(
      'bash',
      ['-lc', 'git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null || echo ""'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TARGET_DIR: testDir,
          GIT_CEILING_DIRECTORIES: testDir,
        },
      }
    );

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), '', 'expected empty output outside a git repo');
  } finally {
    cleanupDir(testDir);
  }
});

test('observe.sh writes project metadata for the git root when cwd is a subdirectory', () => {
  const testRoot = createTempDir();

  try {
    const homeDir = path.join(testRoot, 'home');
    const repoDir = path.join(testRoot, 'repo');
    const subDir = path.join(repoDir, 'src', 'components');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });
    gitInit(repoDir);

    const result = runObserve({ homeDir, cwd: subDir });
    assert.strictEqual(result.status, 0, result.stderr);

    const { metadata, projectDir } = readSingleProjectMetadata(homeDir);
    assert.strictEqual(
      normalizeComparablePath(metadata.root),
      normalizeComparablePath(repoDir),
      'project metadata root should be the repository root'
    );

    const observationsPath = path.join(projectDir, 'observations.jsonl');
    assert.ok(fs.existsSync(observationsPath), 'observe.sh should append an observation');
  } finally {
    cleanupDir(testRoot);
  }
});


test('observe.sh falls back to CLAUDE_HOOK_EVENT_NAME when no phase argument is passed', () => {
  const testRoot = createTempDir();

  try {
    const homeDir = path.join(testRoot, 'home');
    const repoDir = path.join(testRoot, 'repo');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    gitInit(repoDir);

    const result = runObserve({
      homeDir,
      cwd: repoDir,
      args: [],
      extraEnv: { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' },
    });
    assert.strictEqual(result.status, 0, result.stderr);

    const { projectDir } = readSingleProjectMetadata(homeDir);
    const observationsPath = path.join(projectDir, 'observations.jsonl');
    const observation = JSON.parse(fs.readFileSync(observationsPath, 'utf8').trim());
    assert.strictEqual(
      observation.event,
      'tool_start',
      'manual PreToolUse installs without argv should record tool_start'
    );
    assert.ok(Object.prototype.hasOwnProperty.call(observation, 'input'));
    assert.ok(!Object.prototype.hasOwnProperty.call(observation, 'output'));
  } finally {
    cleanupDir(testRoot);
  }
});

test('observe.sh records non-git cwd payloads globally without project registry side effects', () => {
  const testRoot = createTempDir();

  try {
    const homeDir = path.join(testRoot, 'home');
    const nonGitDir = path.join(testRoot, 'plain', 'subdir');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(nonGitDir, { recursive: true });

    const result = runObserve({ homeDir, cwd: nonGitDir });
    assert.strictEqual(result.status, 0, result.stderr);

    const homunculusDir = path.join(homeDir, '.local', 'share', 'ecc-homunculus');
    const projectsDir = path.join(homunculusDir, 'projects');
    const registryPath = path.join(homunculusDir, 'projects.json');
    const observationsPath = path.join(homunculusDir, 'observations.jsonl');

    assert.ok(!fs.existsSync(registryPath), 'non-git cwd should not create projects.json');
    assert.ok(
      !fs.existsSync(projectsDir) || fs.readdirSync(projectsDir).length === 0,
      'non-git cwd should not create project directories'
    );
    assert.ok(fs.existsSync(observationsPath), 'non-git cwd should still record a global observation');
  } finally {
    cleanupDir(testRoot);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
