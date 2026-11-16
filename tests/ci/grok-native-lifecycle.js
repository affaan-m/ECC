#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { runNativeGitFixture } = require('./helpers/grok-native-git-fixture');

const ROOT = path.resolve(__dirname, '../..');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? path.resolve(process.argv[reportIndex + 1] || '') : null;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-native-lifecycle-'));
const homeDir = path.join(tempRoot, 'home');
const projectRoot = path.join(tempRoot, 'project');
const grokHome = path.join(homeDir, '.grok');
const env = {
  PATH: process.env.PATH || '',
  HOME: homeDir,
  USERPROFILE: homeDir,
  GROK_HOME: grokHome,
  XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  XDG_DATA_HOME: path.join(homeDir, '.local', 'share'),
  NO_COLOR: '1',
  ECC_REQUIRE_GROK_NATIVE: '1',
};
let nativeSteps = [];
let grokExecutable;

function executableIdentity() {
  const executable = env.PATH.split(path.delimiter).map(directory => path.join(directory, 'grok'))
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  assert.ok(executable, 'A real grok executable must be available on PATH');
  grokExecutable = fs.realpathSync(executable);
  return {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(grokExecutable)).digest('hex'),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command === 'grok' ? grokExecutable : command, args, {
    cwd: options.cwd || projectRoot,
    env,
    encoding: 'utf8',
    timeout: options.timeout || 300_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function grok(args, options = {}) {
  const result = run('grok', args, options);
  const redact = value => String(value || '').split(tempRoot).join('<temporary-native-root>')
    .split(ROOT).join('<checkout>');
  nativeSteps = [...nativeSteps, {
    command: redact(`grok ${args.join(' ')}`).split(ROOT).join('<checkout>'),
    exitCode: result.status,
    stdout: redact((result.stdout || '').trim()).slice(0, 1200),
    stderr: redact((result.stderr || '').trim()).slice(0, 800),
  }];
  return result;
}

function inspect() {
  const data = JSON.parse(grok(['inspect', '--json']).stdout);
  const stdout = JSON.stringify({
    plugins: data.plugins.map(plugin => ({ name: plugin.name, enabled: plugin.enabled, provides: plugin.provides })),
    eccSkills: data.skills.filter(skill => skill.source?.plugin_name === 'ecc').length,
    hooks: data.hooks.length,
    mcpServers: data.mcpServers.length,
  });
  nativeSteps = [...nativeSteps.slice(0, -1), { ...nativeSteps[nativeSteps.length - 1], stdout }];
  return data;
}

function pluginList() {
  return JSON.parse(grok(['plugin', 'list', '--json']).stdout);
}

function runNodeSuite(relativePath) {
  const result = run(process.execPath, [path.join(ROOT, relativePath)], { cwd: ROOT });
  const summary = result.stdout.match(/Results: Passed: (\d+), Failed: (\d+)/)
    || result.stdout.match(/Passed: (\d+), Failed: (\d+)/);
  if (!summary || Number(summary[2]) !== 0) {
    throw new Error(`${relativePath} emitted no passing summary or has failures:\n${result.stdout}\n${result.stderr}`);
  }
  const inspections = result.stdout.match(/Native Grok inspections: (\d+)/);
  if (relativePath.includes('canonical')) {
    assert.ok(inspections && Number(inspections[1]) >= 8, 'Native inspections must execute without skipping');
  }
  return {
    file: relativePath,
    passed: Number(summary[1]),
    failed: Number(summary[2]),
    ...(inspections ? { nativeInspections: Number(inspections[1]) } : {}),
  };
}

async function main() {
  fs.mkdirSync(projectRoot, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirtyAtStart = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim());
  const executable = executableIdentity();
  const version = grok(['--version']).stdout.trim();
  grok(['plugin', 'validate', ROOT], { cwd: ROOT });
  assert.deepStrictEqual(pluginList(), []);
  const baseline = inspect();
  assert.strictEqual(baseline.skills.length, 0);
  assert.strictEqual(baseline.hooks.length, 0);
  assert.strictEqual(baseline.mcpServers.length, 0);

  const denied = grok(['plugin', 'install', ROOT], { expectedStatus: 1 });
  assert.match(denied.stderr, /requires confirmation/);
  assert.deepStrictEqual(pluginList(), []);

  grok(['plugin', 'install', ROOT, '--trust']);
  const installed = pluginList();
  assert.strictEqual(installed.length, 1);
  assert.strictEqual(installed[0].name, 'ecc');
  const installedInspection = inspect();
  const installedPlugin = installedInspection.plugins.find(plugin => plugin.name === 'ecc');
  assert.ok(installedPlugin && installedPlugin.enabled);
  assert.strictEqual(installedPlugin.provides.hooks, false);
  assert.strictEqual(installedPlugin.provides.mcpServers, 0);
  assert.ok(installedInspection.skills.some(skill => skill.source?.plugin_name === 'ecc'));
  const nativeUpdate = grok(['plugin', 'update', 'ecc']);
  assert.match(nativeUpdate.stdout, /already live|local symlink/i);

  grok(['plugin', 'disable', 'ecc']);
  const disabledInspection = inspect();
  assert.strictEqual(disabledInspection.skills.some(skill => skill.source?.plugin_name === 'ecc'), false);
  grok(['plugin', 'enable', 'ecc']);
  assert.ok(inspect().skills.some(skill => skill.source?.plugin_name === 'ecc'));

  const unavailableRoot = `${installed[0].path}.unavailable`;
  fs.renameSync(installed[0].path, unavailableRoot);
  assert.strictEqual(inspect().skills.some(skill => skill.source?.plugin_name === 'ecc'), false);
  fs.renameSync(unavailableRoot, installed[0].path);
  assert.ok(inspect().skills.some(skill => skill.source?.plugin_name === 'ecc'));

  grok(['plugin', 'uninstall', 'ecc', '--confirm']);
  assert.deepStrictEqual(pluginList(), []);
  assert.strictEqual(inspect().plugins.some(plugin => plugin.name === 'ecc'), false);

  const nativeGitFixture = await runNativeGitFixture({
    tempRoot, runGrok: grok, env, repoRoot: ROOT, sourceCommit: head,
  });

  const suites = [
    runNodeSuite('tests/lib/grok-harness-adapter.test.js'),
    runNodeSuite('tests/lib/grok-canonical-install.test.js'),
  ];
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(grokExecutable)).digest('hex'),
    executable.sha256, 'Grok binary must not change during verification');
  assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), head,
    'Checkout HEAD must not change during verification');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: head,
    sourceDirty: dirtyAtStart || Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()),
    runtime: { grok: version, executable, node: process.version, platform: process.platform, arch: process.arch },
    isolation: { strategy: 'fresh temporary HOME/GROK_HOME', credentialsInherited: false },
    nativeCli: {
      status: 'passed',
      steps: nativeSteps,
      assertions: [
        'untrusted local install was rejected and installed no plugin',
        'trusted install was visible through grok plugin list and grok inspect',
        'Grok discovered ECC skills while hooks and MCP servers remained disabled',
        'disable removed ECC from loaded skills and enable restored them',
        'missing installed root loaded no ECC skills; restoring root restored discovery',
        'uninstall removed ECC from native discovery',
      ],
    },
    eccLifecycleSuites: suites,
    nativeGitFixture,
    coverageNotes: {
      upgradeRollbackAndImmutablePin: 'Covered by the canonical Grok install suite using distinct source commits and an explicit rollback SHA.',
      missingRoot: 'Covered by the Grok adapter boundary suite; unresolved roots return null.',
      nativeUpdate: 'Real native Git lifecycle uses a full ECC source archive with a synthetic second version: pinned update stays on SHA1; explicit SHA2 install and rollback to SHA1 preserve exact registry commits; unpinned update advances to SHA2.',
      disabledFlag: `${version} still reports plugin.enabled=true after disable; loaded ECC skills correctly drop to zero.`,
      providerExecution: 'No model turn, tool execution, or external MCP server was invoked.',
    },
  };
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
