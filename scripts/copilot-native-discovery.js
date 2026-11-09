#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('./lib/install-executor');
const { withHookConsent } = require('./lib/install/hook-consent');

const ROOT = path.resolve(__dirname, '..');
const MAX_OUTPUT = 2 * 1024 * 1024;

function fixtureEnvironment(fixture, env = process.env) {
  const system = Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(path|pathext|systemroot|windir|comspec|lang|lc_all)$/i.test(key)));
  return {
    ...system,
    HOME: fixture, USERPROFILE: fixture, APPDATA: fixture, LOCALAPPDATA: fixture,
    XDG_CONFIG_HOME: fixture, XDG_CACHE_HOME: fixture, XDG_DATA_HOME: fixture, XDG_STATE_HOME: fixture,
    COPILOT_HOME: path.join(fixture, 'copilot'), COPILOT_AUTO_UPDATE: 'false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(fixture, 'empty-gitconfig'),
    TMP: fixture, TEMP: fixture, TMPDIR: fixture, CI: 'true',
  };
}

function run(executable, args, cwd, env) {
  const result = spawnSync(executable, args, {
    cwd, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: MAX_OUTPUT,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('Fixture subprocess failed.');
  return result.stdout;
}

function normalizeAbsolute(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function plannedSkills(operations, project) {
  const root = path.join(project, '.github', 'skills');
  const expected = new Map();
  for (const { destinationPath } of operations) {
    const relative = path.relative(root, destinationPath);
    const [name, file, ...rest] = relative.split(path.sep);
    if (name && name !== '..' && file === 'SKILL.md' && !rest.length && !path.isAbsolute(relative)) {
      expected.set(name, path.join(root, name));
    }
  }
  return expected;
}

function compareDiscovery(expected, reported) {
  if (!Array.isArray(reported)) throw new Error('Unexpected skill list shape.');
  const enabled = new Map();
  for (const skill of reported) {
    if (skill?.source !== 'project' || skill.enabled !== true || typeof skill.name !== 'string'
      || typeof skill.path !== 'string' || !path.isAbsolute(skill.path)) continue;
    const directories = enabled.get(skill.name) || new Set();
    directories.add(normalizeAbsolute(skill.path));
    enabled.set(skill.name, directories);
  }
  const missing = [...expected].filter(([name, directory]) => !enabled.get(name)?.has(normalizeAbsolute(directory)))
    .map(([name]) => name).sort();
  return { expected: expected.size, matched: expected.size - missing.length, missing };
}

function discover(executable) {
  if (!path.isAbsolute(executable) || !fs.statSync(executable).isFile() || /\.(?:cmd|bat|ps1)$/i.test(executable)) {
    throw new Error('Provide an absolute Copilot executable or Node launcher.');
  }
  const loader = /\.(?:c?js|mjs)$/i.test(fs.realpathSync(executable));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot discovery '));
  try {
    const env = fixtureEnvironment(fixture);
    const projectPath = path.join(fixture, 'project');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = fs.realpathSync(projectPath);
    run('git', ['init', '--quiet', '--template='], project, env);
    const revision = run('git', ['rev-parse', 'HEAD'], ROOT, env).trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Cannot identify the source revision.');
    const sourceDirty = run('git', ['status', '--porcelain', '--untracked-files=no'], ROOT, env).trim() !== '';
    const invoke = args => run(loader ? process.execPath : executable, loader ? [executable, ...args] : args, project, env);
    const versionOutput = invoke(['--version']);
    const version = versionOutput.match(/\b\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\b/i)?.[0];
    if (!version) throw new Error('Cannot identify the Copilot version.');

    const plan = withHookConsent(createManifestInstallPlan({
      target: 'copilot', profileId: 'full', projectRoot: project, homeDir: fixture, env,
    }), 'declined');
    const expected = plannedSkills(plan.operations, project);
    const installed = applyInstallPlan(plan);
    if (!installed.applied || !expected.size) throw new Error('No projected skills installed.');
    const missingFiles = [...expected].filter(([, dir]) => !fs.existsSync(path.join(dir, 'SKILL.md')))
      .map(([name]) => name).sort();
    const discovery = compareDiscovery(expected, JSON.parse(invoke(['--no-auto-update', 'skill', 'list', '--json'])));
    return {
      schema: 'ecc.copilot.offline-discovery.v1', caseId: 'NATIVE-001', mode: 'project',
      recordedAt: new Date().toISOString(), revision, sourceDirty,
      environment: { platform: process.platform, release: os.release(), arch: process.arch, node: process.version, copilot: version },
      discovery, missingFiles, status: discovery.missing.length || missingFiles.length ? 'failed' : 'passed', nativeAcceptance: 'pending',
    };
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

function main(args = process.argv.slice(2)) {
  if (![2, 4].includes(args.length) || args[0] !== '--copilot'
    || (args.length === 4 && (args[2] !== '--output' || !path.isAbsolute(args[3]) || fs.existsSync(args[3])))) {
    throw new Error('Usage: copilot-native-discovery.js --copilot ABSOLUTE_EXECUTABLE [--output ABSOLUTE_NEW_FILE]');
  }
  const result = discover(args[1]);
  const encoded = JSON.stringify(result, null, 2) + '\n';
  if (args[3]) fs.writeFileSync(args[3], encoded, { flag: 'wx', mode: 0o600 });
  process.stdout.write(encoded);
  return result.status === 'passed' ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch { process.stderr.write('Copilot offline discovery failed. Check the executable, fixture prerequisites and output path.\n'); process.exitCode = 1; }
}
module.exports = { compareDiscovery, fixtureEnvironment, plannedSkills };
