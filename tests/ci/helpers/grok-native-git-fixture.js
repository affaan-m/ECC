'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { copyGitArchive } = require('../../../scripts/lib/grok-source-identity');

const PLUGIN_NAME = 'ecc';
const ROOT = path.resolve(__dirname, '../../..');

function runGit(sourceRoot, env, args) {
  const result = spawnSync('git', args, {
    cwd: sourceRoot,
    env,
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeVersion(sourceRoot, version, content) {
  const manifestPath = path.join(sourceRoot, '.grok-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.mkdirSync(path.join(sourceRoot, 'skills', 'native-git-fixture'), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version }, null, 2));
  fs.writeFileSync(path.join(sourceRoot, 'skills', 'native-git-fixture', 'SKILL.md'),
    `---\nname: native-git-fixture\ndescription: Disposable native lifecycle fixture\n---\n${content}\n`);
}

async function installedSnapshot(env, expectedCommit, expectedVersion, expectedContent, pinned, runGrok) {
  const grokHome = env.GROK_HOME || path.join(env.HOME, '.grok');
  const registry = JSON.parse(fs.readFileSync(path.join(grokHome, 'installed-plugins', 'registry.json'), 'utf8'));
  const records = Object.values(registry.repos).filter(record => record.plugins[PLUGIN_NAME]);
  assert.equal(records.length, 1, 'Native fixture must have one registry entry');
  const record = records[0];
  assert.equal(record.kind.type, 'Git');
  assert.equal(record.kind.commit, expectedCommit);
  assert.equal(record.kind.git_ref, pinned ? expectedCommit : undefined);
  assert.equal(record.plugins[PLUGIN_NAME].version, expectedVersion);
  assert.equal(fs.lstatSync(record.path).isSymbolicLink(), false, 'Git install must be a snapshot, not a live symlink');
  const manifest = JSON.parse(fs.readFileSync(path.join(record.path, '.grok-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, expectedVersion);
  assert.equal(manifest.hooks, '');
  assert.equal(manifest.mcpServers, '');
  assert.equal(fs.statSync(path.join(record.path, 'scripts', 'grok-install.js')).isFile(), true);
  assert.equal(fs.statSync(path.join(record.path, 'skills', 'coding-standards', 'SKILL.md')).isFile(), true);
  const skill = fs.readFileSync(path.join(record.path, 'skills', 'native-git-fixture', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(expectedContent), 'Installed skill must match the selected commit');
  const inspectionResult = await runGrok(['inspect', '--json']);
  assert.equal(inspectionResult.status, 0, inspectionResult.stderr || inspectionResult.stdout);
  const inspection = JSON.parse(inspectionResult.stdout);
  const discoveredPlugin = inspection.plugins.find(plugin => plugin.name === PLUGIN_NAME);
  assert.ok(discoveredPlugin && discoveredPlugin.enabled, 'Native inspection must discover the ECC Git snapshot');
  assert.ok(inspection.skills.some(item => item.source?.plugin_name === PLUGIN_NAME
    && item.name === 'native-git-fixture'), 'Native inspection must discover the version marker skill');
  return {
    commit: record.kind.commit,
    gitRef: record.kind.git_ref || null,
    version: manifest.version,
    skillContentVerified: true,
    snapshotVerified: true,
    eccCheckoutVerified: true,
    nativeInspectVerified: true,
    hooks: manifest.hooks,
    mcpServers: manifest.mcpServers
  };
}

async function uninstallFixture(runGrok, env) {
  const grokHome = env.GROK_HOME || path.join(env.HOME, '.grok');
  const registryPath = path.join(grokHome, 'installed-plugins', 'registry.json');
  const before = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const record = Object.values(before.repos).find(item => item.plugins[PLUGIN_NAME]);
  assert.ok(record, 'Native fixture must exist before uninstall');
  const result = await runGrok(['plugin', 'uninstall', PLUGIN_NAME]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.ok(Object.values(after.repos).every(item => !item.plugins[PLUGIN_NAME]));
  assert.equal(fs.existsSync(record.path), false, 'Uninstall must remove the native Git snapshot');
  const inspectionResult = await runGrok(['inspect', '--json']);
  assert.equal(inspectionResult.status, 0, inspectionResult.stderr || inspectionResult.stdout);
  const inspection = JSON.parse(inspectionResult.stdout);
  assert.ok(!inspection.plugins.some(plugin => plugin.name === PLUGIN_NAME));
  assert.ok(!inspection.skills.some(item => item.source?.plugin_name === PLUGIN_NAME));
  return { registryEntryRemoved: true, snapshotRemoved: true };
}

// Real ECC files exercise native Git transport; only the disposable fixture's
// version and marker skill differ from the archived source commit.
async function runNativeGitFixture({ tempRoot, runGrok, env, repoRoot = ROOT, sourceCommit }) {
  const sourceRoot = path.join(tempRoot, 'native-git-source');
  assert.match(sourceCommit || '', /^[a-f0-9]{40}$/, 'A full immutable ECC source commit is required');
  copyGitArchive(repoRoot, sourceCommit, sourceRoot, (file, args, options) =>
    execFileSync(file, args, { ...options, env, timeout: 30000 }));
  const originalManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, '.grok-plugin', 'plugin.json'), 'utf8'));
  assert.equal(originalManifest.name, PLUGIN_NAME);
  assert.equal(originalManifest.hooks, '');
  assert.equal(originalManifest.mcpServers, '');
  const firstVersion = originalManifest.version;
  const [major, minor, patch] = firstVersion.split('.').map(Number);
  assert.ok([major, minor, patch].every(Number.isInteger), 'Fixture source needs a stable semver version');
  const secondVersion = `${major}.${minor}.${patch + 1}-native.2`;
  runGit(sourceRoot, env, ['init', '-b', 'main']);
  writeVersion(sourceRoot, firstVersion, 'Fixture version one.');
  runGit(sourceRoot, env, ['add', '.']);
  runGit(sourceRoot, env, ['-c', 'user.name=Native Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture v1']);
  const firstCommit = runGit(sourceRoot, env, ['rev-parse', 'HEAD']);
  const sourceUrl = pathToFileURL(sourceRoot).href;
  const install = async ref => {
    const result = await runGrok(['plugin', 'install', `${sourceUrl}${ref ? `@${ref}` : ''}`, '--trust']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  await install(firstCommit);
  const pinnedInstall = await installedSnapshot(env, firstCommit, firstVersion, 'Fixture version one.', true, runGrok);
  writeVersion(sourceRoot, secondVersion, 'Fixture version two.');
  runGit(sourceRoot, env, ['add', '.']);
  runGit(sourceRoot, env, ['-c', 'user.name=Native Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture v2']);
  const secondCommit = runGit(sourceRoot, env, ['rev-parse', 'HEAD']);
  assert.notEqual(firstCommit, secondCommit);
  const update = await runGrok(['plugin', 'update', PLUGIN_NAME]);
  assert.equal(update.status, 0, update.stderr || update.stdout);
  assert.match(`${update.stdout}\n${update.stderr}`, /pinned to .*skipping/);
  const immutablePin = await installedSnapshot(env, firstCommit, firstVersion, 'Fixture version one.', true, runGrok);

  await uninstallFixture(runGrok, env);
  await install(secondCommit);
  const explicitUpgrade = await installedSnapshot(env, secondCommit, secondVersion, 'Fixture version two.', true, runGrok);
  await uninstallFixture(runGrok, env);
  await install(firstCommit);
  const rollback = await installedSnapshot(env, firstCommit, firstVersion, 'Fixture version one.', true, runGrok);
  await uninstallFixture(runGrok, env);

  // Move only the disposable fixture's branch to exercise native unpinned update
  // using the same two commits as the immutable install and rollback checks.
  runGit(sourceRoot, env, ['reset', '--hard', firstCommit]);
  await install();
  const unpinnedInstall = await installedSnapshot(env, firstCommit, firstVersion, 'Fixture version one.', false, runGrok);
  runGit(sourceRoot, env, ['reset', '--hard', secondCommit]);
  const unpinnedUpdateResult = await runGrok(['plugin', 'update', PLUGIN_NAME]);
  assert.equal(unpinnedUpdateResult.status, 0, unpinnedUpdateResult.stderr || unpinnedUpdateResult.stdout);
  const unpinnedUpdate = await installedSnapshot(env, secondCommit, secondVersion, 'Fixture version two.', false, runGrok);
  const uninstall = await uninstallFixture(runGrok, env);
  return {
    fixture: 'full ECC checkout with synthetic lifecycle versions',
    baseSourceCommit: sourceCommit,
    firstCommit,
    secondCommit,
    pinnedInstall,
    immutablePin,
    explicitUpgrade,
    rollback,
    unpinnedInstall,
    unpinnedUpdate,
    uninstall
  };
}

module.exports = { runNativeGitFixture };
