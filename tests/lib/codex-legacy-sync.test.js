'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  beginLegacySyncState,
  finalizeLegacySyncState,
  recordLegacySyncPath,
  rollbackLegacyCodexSync,
  uninstallLegacyCodexSync,
} = require('../../scripts/lib/codex-legacy-sync');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readStateStatus(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8')).status;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing Codex legacy sync lifecycle ===\n');
  let passed = 0;
  let failed = 0;

  if (test('manifest uninstall restores previous files, removes owned files, markers, and hooks path', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const backupDir = path.join(codexHome, 'backups', 'ecc-test');
    const configPath = path.join(codexHome, 'config.toml');
    const agentsPath = path.join(codexHome, 'AGENTS.md');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    const hooksPath = path.join(codexHome, 'git-hooks');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.mkdirSync(hooksPath, { recursive: true });
    fs.writeFileSync(configPath, 'model = "user"\n');
    fs.writeFileSync(agentsPath, '# User instructions\n');
    fs.writeFileSync(promptPath, '# User prompt with the same name\n');

    const statePath = beginLegacySyncState({
      codexHome,
      backupDir,
      previousHooksPath: '/tmp/user-hooks',
      installedHooksPath: hooksPath,
    });
    for (const filePath of [configPath, agentsPath, promptPath, path.join(hooksPath, 'pre-commit')]) {
      recordLegacySyncPath({ statePath, filePath });
    }

    fs.writeFileSync(configPath, 'model = "user"\napproval_policy = "on-request"\n');
    fs.writeFileSync(
      agentsPath,
      '# User instructions\n\n<!-- BEGIN ECC -->\n# ECC managed\n<!-- END ECC -->\n'
    );
    fs.writeFileSync(promptPath, '# ECC generated prompt\n');
    fs.writeFileSync(path.join(hooksPath, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    finalizeLegacySyncState({ statePath });

    let hooksValue = hooksPath;
    const result = uninstallLegacyCodexSync({
      codexHome,
      getGlobalHooksPath: () => hooksValue,
      setGlobalHooksPath: value => { hooksValue = value; },
    });

    assert.strictEqual(result.status, 'uninstalled');
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), 'model = "user"\n');
    assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), '# User instructions\n');
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), '# User prompt with the same name\n');
    assert.ok(!fs.existsSync(path.join(hooksPath, 'pre-commit')));
    assert.strictEqual(hooksValue, '/tmp/user-hooks');
    assert.ok(!fs.existsSync(statePath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('dry-run is non-mutating and drifted artifacts are retained', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const backupDir = path.join(codexHome, 'backups', 'ecc-test');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    const statePath = beginLegacySyncState({ codexHome, backupDir, previousHooksPath: '' });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC generated prompt\n');
    finalizeLegacySyncState({ statePath });
    fs.writeFileSync(promptPath, '# customer edit\n');

    const dryRun = uninstallLegacyCodexSync({ codexHome, dryRun: true });
    assert.strictEqual(dryRun.status, 'planned');
    assert.ok(fs.existsSync(statePath));
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), '# customer edit\n');

    const applied = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(applied.status, 'partial');
    assert.deepStrictEqual(applied.retainedPaths, [promptPath]);
    assert.ok(fs.existsSync(promptPath));
    assert.ok(fs.existsSync(statePath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('uninstall preserves config and AGENTS edits made after legacy sync', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const configPath = path.join(codexHome, 'config.toml');
    const agentsPath = path.join(codexHome, 'AGENTS.md');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(configPath, 'model = "user"\n');
    fs.writeFileSync(agentsPath, '# User instructions\n');
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
    });
    recordLegacySyncPath({ statePath, filePath: configPath });
    recordLegacySyncPath({ statePath, filePath: agentsPath });
    fs.writeFileSync(configPath, 'model = "user"\napproval_policy = "on-request"\n');
    fs.writeFileSync(agentsPath, '# User instructions\n\n<!-- BEGIN ECC -->\n# ECC\n<!-- END ECC -->\n');
    finalizeLegacySyncState({ statePath });
    fs.appendFileSync(configPath, '# user edit after sync\n');
    fs.appendFileSync(agentsPath, '\n# user edit after sync\n');

    const result = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(result.status, 'partial');
    assert.ok(fs.readFileSync(configPath, 'utf8').includes('# user edit after sync'));
    assert.ok(fs.readFileSync(agentsPath, 'utf8').includes('# user edit after sync'));
    assert.ok(result.retainedPaths.includes(configPath));
    assert.ok(result.retainedPaths.includes(agentsPath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('pre-manifest cleanup removes only the ECC marker block and preserves all other artifacts', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const agentsPath = path.join(codexHome, 'AGENTS.md');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      '# User\n\n<!-- BEGIN ECC -->\n# Old ECC\n<!-- END ECC -->\n\n# More user\n'
    );
    fs.writeFileSync(promptPath, '# unverifiable legacy prompt\n');

    const result = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(result.status, 'partial');
    assert.ok(!fs.readFileSync(agentsPath, 'utf8').includes('BEGIN ECC'));
    assert.ok(fs.readFileSync(agentsPath, 'utf8').includes('# User'));
    assert.ok(fs.readFileSync(agentsPath, 'utf8').includes('# More user'));
    assert.ok(fs.existsSync(promptPath));
    assert.ok(result.retainedPaths.includes(promptPath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('pre-manifest cleanup preserves inline, fenced, and symlinked AGENTS markers', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const agentsPath = path.join(codexHome, 'AGENTS.md');
    const outsidePath = path.join(homeDir, 'outside-agents.md');
    fs.mkdirSync(codexHome, { recursive: true });
    const examples = '# User\nInline <!-- BEGIN ECC --> example <!-- END ECC -->\n```md\n<!-- BEGIN ECC -->\n# Example\n<!-- END ECC -->\n```\n````md\n```md\n<!-- BEGIN ECC -->\n# Nested example\n<!-- END ECC -->\n```\n````\n';
    fs.writeFileSync(agentsPath, examples);
    const examplesResult = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(examplesResult.status, 'not-found');
    assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), examples);

    fs.writeFileSync(outsidePath, '<!-- BEGIN ECC -->\n# Outside\n<!-- END ECC -->\n');
    fs.rmSync(agentsPath);
    fs.symlinkSync(outsidePath, agentsPath);
    const symlinkResult = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(symlinkResult.status, 'partial');
    assert.ok(symlinkResult.retainedPaths.includes(agentsPath));
    assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), '<!-- BEGIN ECC -->\n# Outside\n<!-- END ECC -->\n');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('interrupted sync rollback restores overwritten files and removes newly created files', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const backupDir = path.join(codexHome, 'backups', 'ecc-test');
    const existingPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    const createdPath = path.join(codexHome, 'prompts', 'ecc-review.md');
    fs.mkdirSync(path.dirname(existingPath), { recursive: true });
    fs.writeFileSync(existingPath, '# User prompt\n', { mode: 0o640 });
    const existingDescriptor = fs.openSync(existingPath, 'r+');
    const originalMode = fs.fstatSync(existingDescriptor).mode & 0o777;

    const statePath = beginLegacySyncState({
      codexHome,
      backupDir,
      previousHooksPath: '/tmp/user-hooks',
      installedHooksPath: path.join(codexHome, 'git-hooks'),
    });
    recordLegacySyncPath({ statePath, filePath: existingPath });
    recordLegacySyncPath({ statePath, filePath: createdPath });
    const partialContent = Buffer.from('# Partial ECC write\n');
    fs.ftruncateSync(existingDescriptor, 0);
    fs.writeSync(existingDescriptor, partialContent, 0, partialContent.length, 0);
    fs.writeFileSync(createdPath, '# Partial new file\n');

    let hooksValue = path.join(codexHome, 'git-hooks');
    const result = rollbackLegacyCodexSync({
      statePath,
      getGlobalHooksPath: () => hooksValue,
      setGlobalHooksPath: value => { hooksValue = value; },
    });

    assert.strictEqual(result.status, 'rolled-back');
    const restoredContent = Buffer.alloc(Buffer.byteLength('# User prompt\n'));
    fs.readSync(existingDescriptor, restoredContent, 0, restoredContent.length, 0);
    assert.strictEqual(restoredContent.toString('utf8'), '# User prompt\n');
    assert.strictEqual(fs.fstatSync(existingDescriptor).mode & 0o777, originalMode);
    fs.closeSync(existingDescriptor);
    assert.ok(!fs.existsSync(createdPath));
    assert.strictEqual(hooksValue, '/tmp/user-hooks');
    assert.ok(!fs.existsSync(statePath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('recording refuses symlink targets before the sync can write through them', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const outsidePath = path.join(homeDir, 'outside.md');
    const linkedPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(linkedPath), { recursive: true });
    fs.writeFileSync(outsidePath, '# Outside\n');
    fs.symlinkSync(outsidePath, linkedPath);
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
    });

    assert.throws(
      () => recordLegacySyncPath({ statePath, filePath: linkedPath }),
      /Refusing to manage non-regular legacy sync path/
    );
    assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), '# Outside\n');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('recording refuses a symlinked parent directory before any managed write', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const outsideDir = path.join(homeDir, 'outside');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(codexHome, 'prompts'));
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
    });

    assert.throws(
      () => recordLegacySyncPath({
        statePath,
        filePath: path.join(codexHome, 'prompts', 'ecc-plan.md'),
      }),
      /Refusing to manage legacy sync path through symlinked ancestor/
    );
    assert.deepStrictEqual(fs.readdirSync(outsideDir), []);
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('uninstall preserves a managed path replaced by a symlink', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    const outsidePath = path.join(homeDir, 'outside.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(outsidePath, '# ECC generated prompt\n');
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC generated prompt\n');
    finalizeLegacySyncState({ statePath });
    fs.rmSync(promptPath);
    fs.symlinkSync(outsidePath, promptPath);

    const result = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(result.status, 'partial');
    assert.ok(fs.lstatSync(promptPath).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), '# ECC generated prompt\n');
    assert.ok(result.retainedPaths.includes(promptPath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('repeat sync preserves the original pre-ECC baseline through uninstall', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, '# Original user prompt\n');

    let statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-first'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC v1\n');
    finalizeLegacySyncState({ statePath });

    statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-second'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC v2\n');
    finalizeLegacySyncState({ statePath });

    const result = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(result.status, 'uninstalled');
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), '# Original user prompt\n');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('repeat sync refuses drift instead of overwriting a post-install user edit', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-first'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC v1\n');
    finalizeLegacySyncState({ statePath });
    fs.appendFileSync(promptPath, '# User edit\n');

    assert.throws(
      () => beginLegacySyncState({
        codexHome,
        backupDir: path.join(codexHome, 'backups', 'ecc-second'),
      }),
      /Refusing to replace modified legacy Codex artifact/
    );
    assert.ok(fs.readFileSync(promptPath, 'utf8').includes('# User edit'));
    assert.strictEqual(readStateStatus(statePath), 'installed');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('custom external hooks root is separately trusted and retains original ownership', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const hooksRoot = path.join(homeDir, 'custom-hooks');
    const hookPath = path.join(hooksRoot, 'pre-commit');
    fs.mkdirSync(hooksRoot, { recursive: true });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho user\n', { mode: 0o700 });
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
      previousHooksPath: hooksRoot,
      installedHooksPath: hooksRoot,
    });
    recordLegacySyncPath({ statePath, filePath: hookPath });
    fs.writeFileSync(hookPath, '#!/bin/sh\necho ecc\n', { mode: 0o700 });
    finalizeLegacySyncState({ statePath });

    const result = uninstallLegacyCodexSync({
      codexHome,
      getGlobalHooksPath: () => hooksRoot,
      setGlobalHooksPath() {},
    });
    assert.strictEqual(result.status, 'uninstalled');
    assert.strictEqual(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho user\n');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('repeat sync rollback remains recoverable after changing custom hooks roots', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const hooksRootA = path.join(homeDir, 'custom-hooks-a');
    const hooksRootB = path.join(homeDir, 'custom-hooks-b');
    const hookPathA = path.join(hooksRootA, 'pre-commit');
    const hookPathB = path.join(hooksRootB, 'pre-commit');
    fs.mkdirSync(hooksRootA, { recursive: true });
    fs.mkdirSync(hooksRootB, { recursive: true });
    fs.writeFileSync(hookPathA, '#!/bin/sh\necho user-a\n');

    let statePath = beginLegacySyncState({
      codexHome,
      installedHooksPath: hooksRootA,
      previousHooksPath: '',
    });
    recordLegacySyncPath({ statePath, filePath: hookPathA });
    fs.writeFileSync(hookPathA, '#!/bin/sh\necho ecc-a\n');
    finalizeLegacySyncState({ statePath });
    const priorInstalledState = fs.readFileSync(statePath, 'utf8');

    statePath = beginLegacySyncState({
      codexHome,
      installedHooksPath: hooksRootB,
      previousHooksPath: hooksRootA,
    });
    recordLegacySyncPath({ statePath, filePath: hookPathB });
    fs.writeFileSync(hookPathA, '#!/bin/sh\necho partial-a\n');
    fs.writeFileSync(hookPathB, '#!/bin/sh\necho partial-b\n');

    let hooksValue = hooksRootB;
    const rollback = rollbackLegacyCodexSync({
      statePath,
      getGlobalHooksPath: () => hooksValue,
      setGlobalHooksPath: value => { hooksValue = value; },
    });
    assert.strictEqual(rollback.status, 'rolled-back');
    assert.strictEqual(fs.readFileSync(hookPathA, 'utf8'), '#!/bin/sh\necho ecc-a\n');
    assert.ok(!fs.existsSync(hookPathB));
    assert.strictEqual(hooksValue, hooksRootA);
    assert.strictEqual(fs.readFileSync(statePath, 'utf8'), priorInstalledState);
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('repeat sync uninstall restores all custom hooks roots after a root change', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const hooksRootA = path.join(homeDir, 'custom-hooks-a');
    const hooksRootB = path.join(homeDir, 'custom-hooks-b');
    const hookPathA = path.join(hooksRootA, 'pre-commit');
    const hookPathB = path.join(hooksRootB, 'pre-commit');
    fs.mkdirSync(hooksRootA, { recursive: true });
    fs.mkdirSync(hooksRootB, { recursive: true });
    fs.writeFileSync(hookPathA, '#!/bin/sh\necho user-a\n');

    let statePath = beginLegacySyncState({
      codexHome,
      installedHooksPath: hooksRootA,
      previousHooksPath: '',
    });
    recordLegacySyncPath({ statePath, filePath: hookPathA });
    fs.writeFileSync(hookPathA, '#!/bin/sh\necho ecc-a\n');
    finalizeLegacySyncState({ statePath });

    statePath = beginLegacySyncState({
      codexHome,
      installedHooksPath: hooksRootB,
      previousHooksPath: hooksRootA,
    });
    recordLegacySyncPath({ statePath, filePath: hookPathB });
    fs.writeFileSync(hookPathB, '#!/bin/sh\necho ecc-b\n');
    finalizeLegacySyncState({ statePath });

    let hooksValue = hooksRootB;
    const uninstall = uninstallLegacyCodexSync({
      codexHome,
      getGlobalHooksPath: () => hooksValue,
      setGlobalHooksPath: value => { hooksValue = value; },
    });
    assert.strictEqual(uninstall.status, 'uninstalled');
    assert.strictEqual(fs.readFileSync(hookPathA, 'utf8'), '#!/bin/sh\necho user-a\n');
    assert.ok(!fs.existsSync(hookPathB));
    assert.strictEqual(hooksValue, '');
    assert.ok(!fs.existsSync(statePath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('rollback preserves a managed path replaced by a dangling symlink', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    const outsidePath = path.join(homeDir, 'missing-outside.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, '# Original user prompt\n');
    const statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-test'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.rmSync(promptPath);
    fs.symlinkSync(outsidePath, promptPath);

    const result = rollbackLegacyCodexSync({ statePath });
    assert.strictEqual(result.status, 'partial');
    assert.ok(result.retainedPaths.includes(promptPath));
    assert.ok(fs.lstatSync(promptPath).isSymbolicLink());
    assert.ok(!fs.existsSync(outsidePath));
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('failed repeat sync restores the prior installed ownership manifest', () => {
    const homeDir = tempDir('legacy-codex-home-');
    const codexHome = path.join(homeDir, '.codex');
    const promptPath = path.join(codexHome, 'prompts', 'ecc-plan.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, '# Original user prompt\n');
    let statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-first'),
    });
    recordLegacySyncPath({ statePath, filePath: promptPath });
    fs.writeFileSync(promptPath, '# ECC v1\n');
    finalizeLegacySyncState({ statePath });
    const priorInstalledState = fs.readFileSync(statePath, 'utf8');

    statePath = beginLegacySyncState({
      codexHome,
      backupDir: path.join(codexHome, 'backups', 'ecc-second'),
    });
    fs.writeFileSync(promptPath, '# Partial ECC v2\n');
    const rollback = rollbackLegacyCodexSync({ statePath });
    assert.strictEqual(rollback.status, 'rolled-back');
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), '# ECC v1\n');
    assert.strictEqual(fs.readFileSync(statePath, 'utf8'), priorInstalledState);

    const uninstall = uninstallLegacyCodexSync({ codexHome });
    assert.strictEqual(uninstall.status, 'uninstalled');
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), '# Original user prompt\n');
    fs.rmSync(homeDir, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
