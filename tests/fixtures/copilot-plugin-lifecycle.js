#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fixtureEnvironment } = require('../../scripts/copilot-native-discovery');
const { buildPlugin, verifyPlugin, previewMigration } = require('../../scripts/lib/copilot-plugin');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

const ROOT = path.resolve(__dirname, '../..');
const pluginName = 'ecc-copilot';
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false,
    timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (result.error || result.signal || result.status !== 0) throw new Error(`Fixture command ${args.slice(0, 3).join(' ')} failed.`);
  return result.stdout;
}

function updateFixtureVersion(artifact, previous) {
  const parts = previous.match(/^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!parts) throw new Error('Fixture requires a semantic package version.');
  const version = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
  const file = path.join(artifact, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  json(file, { ...manifest, version });
  const inventory = path.join(artifact, 'ecc-artifact.json');
  const report = JSON.parse(fs.readFileSync(inventory, 'utf8'));
  const bytes = fs.readFileSync(file);
  json(inventory, { ...report, entries: report.entries.map(row => row.path === 'plugin.json'
    ? { path: row.path, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } : row) });
  assert.equal(verifyPlugin(artifact).version, version);
  return version;
}

function testOrder(fixture, executable, artifact, names, order, version) {
  const location = fs.mkdirSync(path.join(fixture, order), { recursive: true });
  const project = fs.mkdirSync(path.join(location, 'project with spaces'), { recursive: true });
  const env = fixtureEnvironment(location);
  const nodeLauncher = /\.(?:c?js|mjs)$/i.test(executable);
  const cli = (...args) => run(nodeLauncher ? process.execPath : executable,
    [...(nodeLauncher ? [executable] : []), '--no-auto-update', ...args], project, env);
  run('git', ['init', '--quiet', '--template='], project, env);
  const cliVersion = cli('--version').match(/\b\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\b/i)?.[0];
  assert.ok(cliVersion);
  const plugin = () => JSON.parse(cli('plugin', 'list', '--json')).find(row => row.name === pluginName && row.source === 'installed');
  const skillRows = () => JSON.parse(cli('skill', 'list', '--json')).filter(row => names.has(row.name) && row.enabled === true);
  const only = source => {
    const found = skillRows();
    assert.equal(found.length, names.size);
    assert.equal(new Set(found.map(row => row.name)).size, names.size);
    assert.ok(found.every(row => row.source === source));
    return found.length;
  };
  const installProject = () => applyInstallPlan(withHookConsent(createManifestInstallPlan({ target: 'copilot',
    moduleIds: ['commands-core'], projectRoot: project, homeDir: location, env }), 'declined'));
  const installPlugin = () => cli('plugin', 'install', artifact);

  assert.equal(previewMigration({ artifact, projectRoot: project }).status, 'clear');
  if (order === 'project-first') {
    assert.equal(installProject().applied, true);
    only('project');
    installPlugin();
  } else {
    installPlugin();
    only('plugin');
    cli('plugin', 'disable', pluginName);
    assert.equal(plugin().enabled, false);
    assert.equal(skillRows().length, 0);
    cli('plugin', 'enable', pluginName);
    only('plugin');
    assert.equal(installProject().applied, true);
  }
  assert.equal(plugin().version, version);
  const discovered = only('project');
  const preview = previewMigration({ artifact, projectRoot: project });
  assert.equal(preview.status, 'conflict');
  assert.ok(preview.markers.includes('.github/ecc-install-state.json'));
  const receipt = path.join(project, '.github/ecc-install-state.json');
  const receiptBytes = fs.readFileSync(receipt);
  const privateFile = path.join(env.COPILOT_HOME, 'ecc', 'fixture-private.txt');
  fs.mkdirSync(path.dirname(privateFile), { recursive: true });
  fs.writeFileSync(privateFile, 'preserve fixture state');
  cli('plugin', 'disable', pluginName);
  assert.equal(plugin().enabled, false);
  only('project');
  cli('plugin', 'enable', pluginName);
  assert.equal(plugin().enabled, true);

  let updatedVersion;
  if (order === 'plugin-first') {
    updatedVersion = updateFixtureVersion(artifact, version);
    cli('plugin', 'update', pluginName);
    assert.equal(plugin().version, updatedVersion);
    only('project');
  }
  cli('plugin', 'uninstall', pluginName);
  assert.equal(plugin(), undefined);
  only('project');
  installPlugin();
  assert.equal(plugin().version, updatedVersion || version);
  cli('plugin', 'uninstall', pluginName);
  assert.equal(plugin(), undefined);
  assert.deepEqual(fs.readFileSync(receipt), receiptBytes);
  if (order === 'plugin-first') {
    const userFile = path.join(project, '.github/user-notes.md');
    fs.writeFileSync(userFile, 'Preserve user-owned content.');
    const uninstallOptions = { targets: ['copilot'], projectRoot: project, homeDir: location, env };
    installPlugin();
    const [previewResult] = uninstallInstalledStates({ ...uninstallOptions, dryRun: true }).results;
    assert.equal(previewResult.status, 'planned');
    assert.deepEqual(fs.readFileSync(receipt), receiptBytes);
    assert.ok(!previewResult.plannedRemovals.includes(userFile));
    assert.equal(uninstallInstalledStates(uninstallOptions).results[0].status, 'uninstalled');
    assert.equal(previewMigration({ artifact, projectRoot: project }).status, 'clear');
    only('plugin');
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'Preserve user-owned content.');
    cli('plugin', 'uninstall', pluginName);
    assert.equal(installProject().applied, true);
    only('project');
  }
  assert.equal(fs.readFileSync(privateFile, 'utf8'), 'preserve fixture state');
  return { order, cliVersion, discovered, duplicates: 0, projectReceiptPreserved: true,
    privateFixturePreserved: true, managedMigrationAndRollback: order === 'plugin-first',
    update: updatedVersion ? { from: version, to: updatedVersion } : null };
}

function smoke(executable) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) throw new Error('Provide an absolute Copilot executable.');
  const resolved = fs.realpathSync(executable);
  if (!fs.statSync(resolved).isFile() || /\.(?:cmd|bat|ps1)$/i.test(resolved)) throw new Error('Provide a Copilot executable or Node launcher.');
  const fixture = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc plugin lifecycle '));
  try {
    const env = fixtureEnvironment(fixture);
    const revision = run('git', ['rev-parse', 'HEAD'], ROOT, env).trim();
    assert.match(revision, /^[a-f0-9]{40,64}$/);
    const sourceDirty = run('git', ['status', '--porcelain', '--untracked-files=no'], ROOT, env).trim() !== '';
    const artifact = path.join(fixture, 'plugin artifact with spaces');
    buildPlugin({ output: artifact, moduleIds: ['commands-core', 'hooks-runtime'] });
    const verified = verifyPlugin(artifact);
    const names = new Set(verified.paths.map(file => file.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1]).filter(Boolean));
    assert.ok(names.size > 0);
    return { schema: 'ecc.copilot.offline-plugin-lifecycle.v1', revision, sourceDirty, platform: process.platform, arch: process.arch,
      hooks: verified.hooks, modelSession: 'not-run', results: ['project-first', 'plugin-first']
        .map(order => testOrder(fixture, resolved, artifact, names, order, verified.version)) };
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(smoke(process.argv[2]), null, 2) + '\n'); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
