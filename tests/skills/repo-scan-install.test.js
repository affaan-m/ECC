/**
 * Regression tests for #2774: repo-scan installation must be reproducible.
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillFiles = [
  {
    relativePath: path.join('skills', 'repo-scan', 'SKILL.md'),
    heading: '## Installation',
    descriptionTerms: ['bootstrap', 'external', 'install'],
    reinvocationText: 'Reload your agent harness, then invoke `repo-scan` again',
  },
  {
    relativePath: path.join('docs', 'zh-CN', 'skills', 'repo-scan', 'SKILL.md'),
    heading: '## 安装',
    descriptionTerms: ['引导', '外部', '安装'],
    reinvocationText: '重新加载智能体运行环境，然后再次调用 `repo-scan`',
  },
  {
    relativePath: path.join('docs', 'ja-JP', 'skills', 'repo-scan', 'SKILL.md'),
    heading: '## インストール',
    descriptionTerms: ['ブートストラップ', '外部', 'インストール'],
    reinvocationText: 'エージェントハーネスを再読み込みしてから、`repo-scan` を再度呼び出してください',
  }
];
const pinnedCommit = '2742664ebcad1450c208eda0ae45d3c17fad5dd8';
const bashBinary = process.env.ECC_TEST_BASH || (process.platform === 'win32' ? null : 'bash');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function toShellPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function requireShellCommand(command) {
  const result = run(bashBinary, ['-lc', `command -v ${command}`]);
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createLocalSource(root) {
  const sourceRepo = path.join(root, 'source-repo');
  fs.mkdirSync(sourceRepo, { recursive: true });
  assert.strictEqual(run('git', ['init', '--quiet'], { cwd: sourceRepo }).status, 0);
  fs.writeFileSync(path.join(sourceRepo, 'SKILL.md'), 'pinned fixture\n');
  fs.mkdirSync(path.join(sourceRepo, 'scripts'));
  fs.writeFileSync(path.join(sourceRepo, 'scripts', 'scan.sh'), '#!/bin/sh\n');
  assert.strictEqual(run('git', ['add', '.'], { cwd: sourceRepo }).status, 0);
  const commit = run('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: sourceRepo,
    env: {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  assert.strictEqual(commit.status, 0, commit.stderr);
  return sourceRepo;
}

function createCommandShims(root) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  writeExecutable(path.join(binDir, 'git'), `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = clone ]; then
  target="\${!#}"
  exec "$REAL_GIT" clone --quiet "$LOCAL_REPO" "$target"
fi
if [ "\${1:-}" = -C ] && [ "\${3:-}" = checkout ]; then
  exec "$REAL_GIT" -C "$2" checkout --quiet --detach HEAD
fi
if [ "\${1:-}" = -C ] && [ "\${3:-}" = archive ]; then
  exec "$REAL_GIT" -C "$2" archive HEAD
fi
exec "$REAL_GIT" "$@"
`);
  writeExecutable(path.join(binDir, 'mv'), `#!/usr/bin/env bash
set -euo pipefail
original_args=("$@")
no_target=0
positional=()
for arg in "$@"; do
  case "$arg" in
    -T) no_target=1 ;;
    --) ;;
    *) positional+=("$arg") ;;
  esac
done
source_path="\${positional[0]:-}"
destination="\${positional[1]:-}"
case "$source_path" in
  */mv-probe-source)
    case "\${REPO_SCAN_TEST_MV_FAILURE:-}" in
      *-portable) if [ "$no_target" -eq 1 ]; then exit 64; fi ;;
    esac
    exec "$REAL_MV" "\${original_args[@]}"
    ;;
esac
case "$source_path" in
  */stage-*)
    case "\${REPO_SCAN_TEST_MV_FAILURE:-}" in
      replace|rollback) exit 73 ;;
      rollback-target-conflict|rollback-target-conflict-portable) exit 73 ;;
      target-conflict|target-conflict-portable)
        if [ ! -e "$SHIM_DIR/conflict-created" ]; then
          mkdir -p -- "$destination"
          printf 'concurrent installation\n' > "$destination/concurrent-marker.txt"
          : > "$SHIM_DIR/conflict-created"
        fi
        ;;
    esac
    ;;
  */backup-*)
    case "\${REPO_SCAN_TEST_MV_FAILURE:-}" in
      rollback) exit 74 ;;
      rollback-target-conflict|rollback-target-conflict-portable)
        if [ ! -e "$SHIM_DIR/conflict-created" ]; then
          mkdir -p -- "$destination"
          printf 'concurrent installation\n' > "$destination/concurrent-marker.txt"
          : > "$SHIM_DIR/conflict-created"
        fi
        ;;
    esac
    ;;
esac
exec "$REAL_MV" "\${original_args[@]}"
`);
  return binDir;
}

function transactionDirs(installParent) {
  if (!fs.existsSync(installParent)) return [];
  return fs.readdirSync(installParent).filter(
    name => name.startsWith('.repo-scan-install.') && name !== '.repo-scan-install.lock'
  );
}

function prepareInstallScenario(installParent, installDir, scenario) {
  if (scenario === 'fresh') return;
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, 'old-marker.txt'), 'previous installation\n');
  if (scenario === 'lock-held') {
    fs.mkdirSync(path.join(installParent, '.repo-scan-install.lock'));
  }
}

function failureMode(scenario) {
  if (scenario === 'replacement-failure') return 'replace';
  if (scenario === 'rollback-failure') return 'rollback';
  if (scenario.includes('target-conflict')) return scenario;
  return '';
}

function assertPreservedBackup(result, installParent) {
  const workspaces = transactionDirs(installParent);
  assert.strictEqual(workspaces.length, 1, result.stderr);
  const workspace = path.join(installParent, workspaces[0]);
  const backupName = fs.readdirSync(workspace).find(name => name.startsWith('backup-'));
  assert.ok(backupName, result.stderr);
  const preservedBackup = path.join(workspace, backupName);
  assert.strictEqual(
    fs.readFileSync(path.join(preservedBackup, 'old-marker.txt'), 'utf8'),
    'previous installation\n'
  );
}

function assertInstallationResult({ result, scenario, installDir, installParent }) {
  const lockDir = path.join(installParent, '.repo-scan-install.lock');
  if (scenario === 'fresh' || scenario === 'existing') {
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(installDir, 'SKILL.md'), 'utf8').trim(), 'pinned fixture');
    assert.ok(!fs.existsSync(path.join(installDir, '.git')));
    assert.ok(!fs.existsSync(path.join(installDir, 'old-marker.txt')));
    assert.deepStrictEqual(transactionDirs(installParent), []);
    assert.ok(!fs.existsSync(lockDir));
    return;
  }

  assert.notStrictEqual(result.status, 0, 'forced installation failure must propagate');
  if (scenario === 'replacement-failure' || scenario === 'lock-held') {
    assert.strictEqual(
      fs.readFileSync(path.join(installDir, 'old-marker.txt'), 'utf8'),
      'previous installation\n'
    );
    assert.deepStrictEqual(transactionDirs(installParent), []);
    assert.strictEqual(fs.existsSync(lockDir), scenario === 'lock-held');
    if (scenario === 'lock-held') assert.match(result.stderr, /holds the lock/);
    return;
  }

  assertPreservedBackup(result, installParent);
  assert.ok(!fs.existsSync(lockDir));
  if (scenario.includes('target-conflict')) {
    assert.ok(fs.existsSync(path.join(installDir, 'concurrent-marker.txt')));
    assert.ok(
      !fs.readdirSync(installDir).some(name => /^(stage|backup)-/.test(name)),
      'native mv must not leave staged or backup directories nested in the target'
    );
    assert.match(result.stderr, /target was recreated|rollback failed/);
  } else {
    assert.match(result.stderr, /previous installation preserved at/);
  }
}

function executeInstallation(block, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-repo-scan-install-'));
  try {
    const sourceRepo = createLocalSource(root);
    const binDir = createCommandShims(root);
    const configDir = path.join(root, 'config');
    const installParent = path.join(configDir, 'skills');
    const installDir = path.join(installParent, 'repo-scan');
    prepareInstallScenario(installParent, installDir, scenario);
    const result = run(bashBinary, ['-c', `export PATH="$SHIM_DIR:$PATH"\n${block}`], {
      input: 'install\n',
      cwd: repoRoot,
      env: {
        CLAUDE_CONFIG_DIR: toShellPath(configDir),
        LOCAL_REPO: toShellPath(sourceRepo),
        REAL_GIT: requireShellCommand('git'),
        REAL_MV: requireShellCommand('mv'),
        REPO_SCAN_TEST_MV_FAILURE: failureMode(scenario),
        SHIM_DIR: toShellPath(binDir),
      },
      timeout: 30000,
    });
    assertInstallationResult({ result, scenario, installDir, installParent });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function installationBlock({ relativePath, heading }) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const headingStart = source.indexOf(`${heading}\n`);
  assert.notStrictEqual(headingStart, -1, `${relativePath} must contain ${heading}`);
  const afterHeading = source.slice(headingStart + heading.length + 1);
  const nextHeading = afterHeading.search(/^## /m);
  const installationSection = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  const match = installationSection.match(/```bash\n([\s\S]*?)```/);
  assert.ok(match, `${relativePath} must contain a bash installation block`);
  return match[1];
}

function assertPointerContract({ relativePath, descriptionTerms, reinvocationText }) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, `${relativePath} must contain YAML frontmatter`);
  const description = frontmatter[1].match(/^description:\s*(.+)$/m);
  assert.ok(description, `${relativePath} must contain a frontmatter description`);
  for (const term of descriptionTerms) {
    assert.ok(
      description[1].toLocaleLowerCase().includes(term.toLocaleLowerCase()),
      `${relativePath} description must identify this as an external installer pointer (${term})`
    );
  }
  assert.ok(
    source.includes(reinvocationText),
    `${relativePath} must tell users to reload and invoke repo-scan again after installation`
  );
}

console.log('\nrepo-scan installation docs (#2774):');

const blocks = skillFiles.map(installationBlock);
let passed = 0;
for (const skillFile of skillFiles) {
  assertPointerContract(skillFile);
  passed++;
}
for (const [index, block] of blocks.entries()) {
  const { relativePath } = skillFiles[index];
  assert.ok(block.includes(`REPO_SCAN_COMMIT=${pinnedCommit}`), `${relativePath} must pin the full commit SHA`);
  assert.ok(block.includes('set -euo pipefail'), `${relativePath} must fail closed`);
  assert.ok(block.includes('mktemp -d "$REPO_SCAN_INSTALL_PARENT/'), `${relativePath} must stage on the target filesystem`);
  assert.ok(block.includes('REPO_SCAN_KEEP_TMP=0'), `${relativePath} must track cleanup safety`);
  assert.ok(block.includes('REPO_SCAN_LOCK_HELD=0'), `${relativePath} must track lock ownership`);
  assert.ok(block.includes('REPO_SCAN_MV_HAS_NO_TARGET=0'), `${relativePath} must probe no-target moves`);
  assert.ok(block.includes('trap cleanup_repo_scan_install EXIT'), `${relativePath} must use conditional cleanup`);
  assert.ok(block.includes('mv -T -- "$REPO_SCAN_MOVE_SOURCE"'), `${relativePath} must reject an existing GNU mv destination`);
  assert.ok(block.includes('move_repo_scan_dir()'), `${relativePath} must guard portable directory moves`);
  assert.ok(block.includes('git clone --filter=blob:none --no-checkout'), `${relativePath} must clone before checkout`);
  assert.ok(block.includes('checkout --detach "$REPO_SCAN_COMMIT"'), `${relativePath} must detach at the pin`);
  assert.ok(block.includes('archive "$REPO_SCAN_COMMIT"'), `${relativePath} must archive the exact pinned commit`);
  assert.ok(block.includes('tar -xf - -C "$REPO_SCAN_STAGE"'), `${relativePath} must extract into a fresh staging directory`);
  assert.ok(block.includes('# Review "$REPO_SCAN_TMP/source"'), `${relativePath} must instruct source review`);
  assert.ok(block.includes('read -r REPO_SCAN_CONFIRM'), `${relativePath} must require explicit confirmation`);
  assert.ok(block.includes('mkdir -- "$REPO_SCAN_LOCK"'), `${relativePath} must serialize replacement`);
  assert.ok(block.includes('[ "$REPO_SCAN_CONFIRM" != install ]'), `${relativePath} must default-deny installation`);
  assert.ok(block.includes('move_repo_scan_dir "$REPO_SCAN_STAGE" "$REPO_SCAN_INSTALL_DIR"'), `${relativePath} must use guarded replacement`);
  assert.ok(block.indexOf('read -r REPO_SCAN_CONFIRM') < block.indexOf('move_repo_scan_dir "$REPO_SCAN_STAGE"'), `${relativePath} must confirm before replacing the target`);
  assert.ok(block.indexOf('mkdir -- "$REPO_SCAN_LOCK"') < block.indexOf('move_repo_scan_dir "$REPO_SCAN_STAGE"'), `${relativePath} must lock before replacing the target`);
  assert.ok(!block.includes('rm -rf "$REPO_SCAN_INSTALL_DIR"'), `${relativePath} must preserve the old target until replacement succeeds`);
  assert.ok(block.includes('${CLAUDE_CONFIG_DIR:-$HOME/.claude}'), `${relativePath} must honor CLAUDE_CONFIG_DIR`);
  assert.ok(!block.includes('cp -r .'), `${relativePath} must not copy .git metadata`);
  assert.ok(!block.includes('git fetch --depth 1 origin 2742664\n'), `${relativePath} must not fetch the short SHA`);
  assert.ok(block.includes('REPO_SCAN_KEEP_TMP=1'), `${relativePath} must preserve a failed rollback backup`);
  passed++;
}

for (const block of blocks.slice(1)) {
  assert.strictEqual(block, blocks[0], 'translated installation commands must stay synchronized');
  passed++;
}

if (bashBinary) {
  for (const block of blocks) {
    const syntax = run(bashBinary, ['-n'], { input: block });
    assert.strictEqual(syntax.status, 0, syntax.stderr);
    passed++;
    for (const scenario of [
      'fresh',
      'existing',
      'replacement-failure',
      'rollback-failure',
      'target-conflict',
      'target-conflict-portable',
      'rollback-target-conflict',
      'rollback-target-conflict-portable',
      'lock-held',
    ]) {
      executeInstallation(block, scenario);
      passed++;
    }
  }
} else {
  console.log('  Integration coverage skipped on Windows without ECC_TEST_BASH');
}

console.log(`  Passed: ${passed}`);
console.log('  Failed: 0');
