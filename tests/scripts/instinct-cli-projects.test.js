const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-projects-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeInstinct(filePath, id, confidence = 0.9) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '---',
      `id: ${id}`,
      'trigger: "when repeated"',
      `confidence: ${confidence}`,
      'domain: workflow',
      '---',
      '',
      `Action for ${id}.`,
      '',
    ].join('\n')
  );
}

function seedProject(root, id, options = {}) {
  const projectDir = path.join(root, 'projects', id);
  const personalDir = path.join(projectDir, 'instincts', 'personal');
  const inheritedDir = path.join(projectDir, 'instincts', 'inherited');
  fs.mkdirSync(personalDir, { recursive: true });
  fs.mkdirSync(inheritedDir, { recursive: true });

  for (const instinct of options.personal || []) {
    writeInstinct(path.join(personalDir, `${instinct}.yaml`), instinct);
  }
  for (const instinct of options.inherited || []) {
    writeInstinct(path.join(inheritedDir, `${instinct}.yaml`), instinct);
  }
  if (options.observations) {
    fs.writeFileSync(
      path.join(projectDir, 'observations.jsonl'),
      options.observations.map(row => JSON.stringify(row)).join('\n') + '\n'
    );
  }

  return projectDir;
}

function projectHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runCli(root, args, options = {}) {
  return spawnSync('python3', [cliPath, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLV2_HOMUNCULUS_DIR: root,
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      CLAUDE_PROJECT_DIR: '',
      ...(options.env || {}),
    },
  });
}

console.log('\n=== Testing instinct-cli.py projects maintenance ===\n');

test('projects delete --dry-run preserves registry and project files', () => {
  const root = createTempDir();
  try {
    const registryPath = path.join(root, 'projects.json');
    seedProject(root, 'alpha123', {
      personal: ['keep-me'],
      observations: [{ event: 'tool_complete' }],
    });
    writeJson(registryPath, {
      alpha123: { name: 'alpha', root: '/repo/alpha', remote: '', last_seen: '2026-01-01T00:00:00Z' },
    });

    const result = runCli(root, ['projects', 'delete', 'alpha123', '--dry-run']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /would delete/i);
    assert.ok(fs.existsSync(path.join(root, 'projects', 'alpha123')));
    assert.ok(readJson(registryPath).alpha123);
  } finally {
    cleanupDir(root);
  }
});

test('projects delete --force removes registry entry and project directory', () => {
  const root = createTempDir();
  try {
    const registryPath = path.join(root, 'projects.json');
    seedProject(root, 'alpha123', { personal: ['delete-me'] });
    writeJson(registryPath, {
      alpha123: { name: 'alpha', root: '/repo/alpha', remote: '', last_seen: '2026-01-01T00:00:00Z' },
    });

    const result = runCli(root, ['projects', 'delete', 'alpha123', '--force']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'projects', 'alpha123')));
    assert.ok(!readJson(registryPath).alpha123);
  } finally {
    cleanupDir(root);
  }
});

test('projects gc --force removes only zero-value project entries', () => {
  const root = createTempDir();
  try {
    const registryPath = path.join(root, 'projects.json');
    seedProject(root, 'empty000');
    seedProject(root, 'active999', { personal: ['active'] });
    writeJson(registryPath, {
      empty000: { name: 'empty', root: '/tmp/empty', remote: '', last_seen: '2026-01-01T00:00:00Z' },
      active999: { name: 'active', root: '/repo/active', remote: '', last_seen: '2026-01-02T00:00:00Z' },
    });

    const result = runCli(root, ['projects', 'gc', '--force']);
    assert.strictEqual(result.status, 0, result.stderr);
    const registry = readJson(registryPath);
    assert.ok(!registry.empty000);
    assert.ok(registry.active999);
    assert.ok(!fs.existsSync(path.join(root, 'projects', 'empty000')));
    assert.ok(fs.existsSync(path.join(root, 'projects', 'active999')));
  } finally {
    cleanupDir(root);
  }
});

test('projects merge deduplicates instincts, appends observations, and removes source', () => {
  const root = createTempDir();
  try {
    const registryPath = path.join(root, 'projects.json');
    seedProject(root, 'from111', {
      personal: ['shared', 'from-only'],
      observations: [{ event: 'from-event' }],
    });
    seedProject(root, 'into222', {
      personal: ['shared', 'into-only'],
      observations: [{ event: 'into-event' }],
    });
    writeJson(registryPath, {
      from111: { name: 'from', root: '/repo/from', remote: '', last_seen: '2026-01-01T00:00:00Z' },
      into222: { name: 'into', root: '/repo/into', remote: '', last_seen: '2026-01-02T00:00:00Z' },
    });

    const result = runCli(root, ['projects', 'merge', 'from111', 'into222', '--force']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'projects', 'from111')));
    assert.ok(!readJson(registryPath).from111);
    assert.ok(readJson(registryPath).into222);

    const intoPersonal = path.join(root, 'projects', 'into222', 'instincts', 'personal');
    assert.ok(fs.existsSync(path.join(intoPersonal, 'shared.yaml')));
    assert.ok(fs.existsSync(path.join(intoPersonal, 'from-only.yaml')));
    assert.ok(fs.existsSync(path.join(intoPersonal, 'into-only.yaml')));

    const observations = fs.readFileSync(
      path.join(root, 'projects', 'into222', 'observations.jsonl'),
      'utf8'
    );
    assert.match(observations, /from-event/);
    assert.match(observations, /into-event/);
  } finally {
    cleanupDir(root);
  }
});

test('status migrates legacy no-remote linked worktree project dirs to main worktree id', () => {
  const root = createTempDir();
  const repoParent = createTempDir();
  try {
    const mainWorktree = path.join(repoParent, 'main');
    const linkedWorktree = path.join(repoParent, 'linked');
    fs.mkdirSync(mainWorktree, { recursive: true });
    runGit(mainWorktree, ['init']);
    runGit(mainWorktree, ['config', 'user.email', 'ecc@example.test']);
    runGit(mainWorktree, ['config', 'user.name', 'ECC Test']);
    fs.writeFileSync(path.join(mainWorktree, 'README.md'), 'test\n');
    runGit(mainWorktree, ['add', 'README.md']);
    runGit(mainWorktree, ['commit', '-m', 'init']);
    runGit(mainWorktree, ['worktree', 'add', linkedWorktree]);

    const mainRoot = runGit(mainWorktree, ['rev-parse', '--show-toplevel']);
    const linkedRoot = runGit(linkedWorktree, ['rev-parse', '--show-toplevel']);
    const oldLinkedId = projectHash(linkedRoot);
    const mainId = projectHash(mainRoot);
    seedProject(root, oldLinkedId, { personal: ['legacy-worktree'] });

    const result = runCli(root, ['status'], { cwd: linkedRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, 'projects', oldLinkedId)));
    assert.ok(fs.existsSync(path.join(root, 'projects', mainId)));
    assert.ok(
      fs.existsSync(path.join(root, 'projects', mainId, 'instincts', 'personal', 'legacy-worktree.yaml'))
    );
    assert.match(result.stdout, new RegExp(`\\(${mainId}\\)`));
  } finally {
    cleanupDir(root);
    cleanupDir(repoParent);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
