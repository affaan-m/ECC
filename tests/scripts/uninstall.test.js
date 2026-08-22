/**
 * Tests for scripts/uninstall.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INSTALL_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'uninstall.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;
const CURRENT_MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
).version;
const CLI_TIMEOUT_MS = 30000;
const {
  createInstallState,
  writeInstallState,
} = require('../../scripts/lib/install-state');
const {
  beginLegacySyncState,
  recordLegacySyncPath,
  finalizeLegacySyncState,
} = require('../../scripts/lib/codex-legacy-sync');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeState(filePath, options) {
  const state = createInstallState(options);
  writeInstallState(filePath, state);
  return state;
}

function run(args = [], options = {}) {
  const env = {
    ...process.env,
    HOME: options.homeDir || process.env.HOME,
  };
  if (options.homeDir) {
    env.CODEX_HOME = path.join(options.homeDir, '.codex');
  } else {
    delete env.CODEX_HOME;
  }

  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing uninstall.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('uninstalls files from a real install-apply state and preserves unrelated files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const installStdout = execFileSync('node', [INSTALL_SCRIPT, '--target', 'cursor', 'typescript'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: homeDir,
        },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: CLI_TIMEOUT_MS,
      });
      assert.ok(installStdout.includes('Done. Install-state written'));

      const normalizedProjectRoot = fs.realpathSync(projectRoot);
      const managedPath = path.join(normalizedProjectRoot, '.cursor', 'hooks.json');
      const statePath = path.join(normalizedProjectRoot, '.cursor', 'ecc-install-state.json');
      const unrelatedPath = path.join(normalizedProjectRoot, '.cursor', 'custom-user-note.txt');
      fs.writeFileSync(unrelatedPath, 'leave me alone');

      const uninstallResult = run(['--target', 'cursor'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(uninstallResult.stdout.includes('Uninstall summary'));
      assert.ok(uninstallResult.stdout.includes('quick-feedback.yml'));
      assert.ok(uninstallResult.stdout.includes('public GitHub issue'));
      assert.ok(!fs.existsSync(managedPath));
      assert.ok(!fs.existsSync(statePath));
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reverses non-copy operations and keeps unrelated files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const copiedPath = path.join(normalizedTargetRoot, 'managed-rule.md');
      const mergedPath = path.join(normalizedTargetRoot, 'hooks.json');
      const removedPath = path.join(normalizedTargetRoot, 'legacy-note.txt');
      const unrelatedPath = path.join(normalizedTargetRoot, 'custom-user-note.txt');
      fs.writeFileSync(copiedPath, 'managed\n');
      fs.writeFileSync(mergedPath, JSON.stringify({
        existing: true,
        managed: true,
      }, null, 2));
      fs.writeFileSync(unrelatedPath, 'leave me alone');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: normalizedTargetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: ['platform-configs'],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['platform-configs'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'copy-file',
            moduleId: 'platform-configs',
            sourceRelativePath: 'rules/common/coding-style.md',
            destinationPath: copiedPath,
            strategy: 'preserve-relative-path',
            ownership: 'managed',
            scaffoldOnly: false,
            contentSha256: crypto.createHash('sha256').update('managed\n').digest('hex'),
          },
          {
            kind: 'merge-json',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath: mergedPath,
            strategy: 'merge-json',
            ownership: 'managed',
            scaffoldOnly: false,
            mergePayload: {
              managed: true,
            },
            previousContent: JSON.stringify({
              existing: true,
            }, null, 2),
          },
          {
            kind: 'remove',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/legacy-note.txt',
            destinationPath: removedPath,
            strategy: 'remove',
            ownership: 'managed',
            scaffoldOnly: false,
            previousContent: 'restore me\n',
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const uninstallResult = run(['--target', 'cursor'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(uninstallResult.stdout.includes('Uninstall summary'));
      assert.ok(!fs.existsSync(copiedPath));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(mergedPath, 'utf8')), {
        existing: true,
      });
      assert.strictEqual(fs.readFileSync(removedPath, 'utf8'), 'restore me\n');
      assert.ok(!fs.existsSync(statePath));
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('supports dry-run without mutating managed files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const renderedPath = path.join(normalizedTargetRoot, 'generated.md');
      fs.writeFileSync(renderedPath, '# generated\n');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: normalizedTargetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: ['platform-configs'],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['platform-configs'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'render-template',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/generated.md.template',
            destinationPath: renderedPath,
            strategy: 'render-template',
            ownership: 'managed',
            scaffoldOnly: false,
            renderedContent: '# generated\n',
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const uninstallResult = run(['--target', 'cursor', '--dry-run', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);

      const parsed = JSON.parse(uninstallResult.stdout);
      assert.strictEqual(parsed.dryRun, true);
      assert.ok(parsed.results[0].plannedRemovals.includes(renderedPath));
      assert.ok(fs.existsSync(renderedPath));
      assert.ok(fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reports preserved legacy Antigravity files as an incomplete uninstall', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const targetRoot = path.join(projectRoot, '.agent');
      fs.mkdirSync(path.join(targetRoot, 'rules'), { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const editedPath = path.join(normalizedTargetRoot, 'rules', 'common-coding-style.md');
      fs.writeFileSync(editedPath, 'customer edit\n');

      writeState(statePath, {
        adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
        targetRoot: normalizedTargetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-antigravity-install'],
          skippedModules: [],
        },
        operations: [{
          kind: 'copy-file',
          moduleId: 'rules-core',
          sourceRelativePath: 'rules/common/coding-style.md',
          destinationPath: editedPath,
          strategy: 'flatten-copy',
          ownership: 'managed',
          scaffoldOnly: false,
        }],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const dryRun = run(['--target', 'antigravity', '--dry-run', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(dryRun.code, 1);
      const parsed = JSON.parse(dryRun.stdout);
      assert.strictEqual(parsed.results[0].status, 'partial');
      assert.deepStrictEqual(parsed.results[0].plannedRemovals, []);
      assert.deepStrictEqual(parsed.results[0].retainedPaths, [editedPath]);
      assert.strictEqual(parsed.summary.partialCount, 1);

      const applied = run(['--target', 'antigravity'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(applied.code, 1);
      assert.ok(applied.stdout.includes('Status: PARTIAL'));
      assert.ok(applied.stdout.includes('Legacy Antigravity files were preserved'));
      assert.ok(applied.stdout.includes(editedPath));
      assert.ok(fs.existsSync(editedPath));
      assert.ok(fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('auto-detects legacy sync-ecc-to-codex.sh install and removes artifacts without touching conversations or unrelated config keys', () => {
    const homeDir = createTempDir('uninstall-legacy-codex-home-');
    const projectRoot = createTempDir('uninstall-legacy-codex-project-');

    try {
      const codexHome = path.join(homeDir, '.codex');
      const configPath = path.join(codexHome, 'config.toml');
      const agentsPath = path.join(codexHome, 'AGENTS.md');
      const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
      const conversationPath = path.join(codexHome, 'conversations', 'keep-me.md');
      const userFilePath = path.join(codexHome, 'user-owned.txt');

      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(configPath, 'model = "user"\n');
      fs.writeFileSync(agentsPath, '# User instructions\n');
      fs.mkdirSync(path.dirname(promptPath), { recursive: true });

      const statePath = beginLegacySyncState({
        codexHome,
        backupDir: path.join(codexHome, 'backups', 'ecc-test'),
      });
      recordLegacySyncPath({ statePath, filePath: configPath });
      recordLegacySyncPath({ statePath, filePath: agentsPath });
      recordLegacySyncPath({ statePath, filePath: promptPath });

      fs.writeFileSync(configPath, 'model = "user"\napproval_policy = "on-request"\n');
      fs.writeFileSync(
        agentsPath,
        '# User instructions\n\n<!-- BEGIN ECC -->\n# ECC managed\n<!-- END ECC -->\n'
      );
      fs.writeFileSync(promptPath, '# ECC generated prompt\n');
      finalizeLegacySyncState({ statePath });

      fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
      fs.writeFileSync(conversationPath, 'conversation history');
      fs.writeFileSync(userFilePath, 'unrelated');

      const uninstallResult = run([], { cwd: projectRoot, homeDir });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(!uninstallResult.stdout.includes('No ECC install-state files found'), uninstallResult.stdout);
      assert.ok(uninstallResult.stdout.includes('Legacy Codex sync cleanup summary'), uninstallResult.stdout);
      assert.ok(!fs.existsSync(promptPath));
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'model = "user"\n');
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), '# User instructions\n');
      assert.strictEqual(fs.readFileSync(conversationPath, 'utf8'), 'conversation history');
      assert.strictEqual(fs.readFileSync(userFilePath, 'utf8'), 'unrelated');
      assert.ok(!fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('does not misclassify a clean Codex home as a legacy install', () => {
    const homeDir = createTempDir('uninstall-clean-codex-home-');
    const projectRoot = createTempDir('uninstall-clean-codex-project-');

    try {
      const codexHome = path.join(homeDir, '.codex');
      const configPath = path.join(codexHome, 'config.toml');
      const conversationPath = path.join(codexHome, 'conversations', 'keep-me.md');

      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(configPath, 'model = "user"\n');
      fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
      fs.writeFileSync(conversationPath, 'conversation history');

      const uninstallResult = run([], { cwd: projectRoot, homeDir });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(uninstallResult.stdout.includes('No ECC install-state files found'), uninstallResult.stdout);
      assert.ok(!uninstallResult.stdout.includes('Legacy Codex sync cleanup summary'), uninstallResult.stdout);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'model = "user"\n');
      assert.strictEqual(fs.readFileSync(conversationPath, 'utf8'), 'conversation history');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('explicit --legacy-codex-sync on a clean home reports not-found without removing files', () => {
    const homeDir = createTempDir('uninstall-legacy-clean-home-');
    const projectRoot = createTempDir('uninstall-legacy-clean-project-');

    try {
      const codexHome = path.join(homeDir, '.codex');
      const configPath = path.join(codexHome, 'config.toml');

      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(configPath, 'model = "user"\n');

      const uninstallResult = run(['--legacy-codex-sync', '--json'], { cwd: projectRoot, homeDir });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      const parsed = JSON.parse(uninstallResult.stdout);
      assert.strictEqual(parsed.status, 'not-found');
      assert.deepStrictEqual(parsed.plannedRemovals, []);
      assert.deepStrictEqual(parsed.retainedPaths, []);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'model = "user"\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
