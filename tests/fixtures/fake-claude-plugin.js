#!/usr/bin/env node
'use strict';

/**
 * Stateful Claude plugin CLI fake.
 *
 * Environment:
 * - ECC_TEST_CLAUDE_STATE: JSON state file (required)
 * - ECC_TEST_CLAUDE_CALLS: JSONL argv log (optional)
 *
 * State supports:
 * {
 *   plugins: [{ id, scope, enabled }],
 *   marketplaces: [{ name, source, repo, scope }],
 *   pluginListResponses: [array | string],
 *   marketplaceListResponses: [array | string],
 *   failures: [{ argv: [...], status, stderr, times }]
 * }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const statePath = process.env.ECC_TEST_CLAUDE_STATE;
const callsPath = process.env.ECC_TEST_CLAUDE_CALLS;

if (!statePath) {
  process.stderr.write('ECC_TEST_CLAUDE_STATE is required\n');
  process.exit(2);
}

if (callsPath) {
  fs.appendFileSync(callsPath, `${JSON.stringify(args)}\n`);
}

function readState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function sameArgv(left, right) {
  return (
    Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

function shiftResponse(state, key, fallback) {
  const queue = Array.isArray(state[key]) ? [...state[key]] : [];
  if (queue.length === 0) return fallback;
  const response = queue.shift();
  writeState({ ...state, [key]: queue });
  return response;
}

function printJsonResponse(response) {
  process.stdout.write(typeof response === 'string' ? response : JSON.stringify(response));
}

function createProviderReadArtifacts() {
  if (process.env.ECC_TEST_CLAUDE_CREATE_READ_ARTIFACTS !== '1') return;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
  const claudeStatePath = process.env.CLAUDE_CONFIG_DIR
    ? path.join(configDir, '.claude.json')
    : path.join(homeDir, '.claude.json');
  const backupDir = path.join(configDir, 'backups');
  const projectSettingsPath = path.join(process.cwd(), '.claude', 'settings.local.json');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(path.dirname(projectSettingsPath), { recursive: true });
  if (process.env.ECC_TEST_CLAUDE_OVERWRITE_READ_ARTIFACTS === '1') {
    for (const entry of fs.readdirSync(backupDir)) {
      const entryPath = path.join(backupDir, entry);
      if (fs.statSync(entryPath).isFile()) fs.writeFileSync(entryPath, 'provider-overwrite\n');
    }
  }
  fs.writeFileSync(claudeStatePath, '{"providerRead":true}\n');
  fs.writeFileSync(projectSettingsPath, '{"providerRead":true}\n');
  fs.writeFileSync(
    path.join(backupDir, `.claude.json.backup.${process.pid}`),
    '{"providerRead":true}\n'
  );
  if (
    process.env.ECC_TEST_CLAUDE_WRITE_XDG_DATA === '1'
    && process.env.XDG_DATA_HOME
  ) {
    fs.mkdirSync(process.env.XDG_DATA_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.XDG_DATA_HOME, 'claude-provider-read.json'),
      '{"providerRead":true}\n'
    );
  }
}

let state = readState();
const failureIndex = (state.failures || []).findIndex(rule => (
  sameArgv(rule.argv, args) && (rule.times === undefined || rule.times > 0)
));

if (failureIndex >= 0) {
  const failure = state.failures[failureIndex];
  const nextFailures = state.failures.map((rule, index) => (
    index === failureIndex && Number.isInteger(rule.times)
      ? { ...rule, times: Math.max(0, rule.times - 1) }
      : rule
  ));
  writeState({ ...state, failures: nextFailures });
  process.stderr.write(failure.stderr || 'injected Claude CLI failure\n');
  process.exit(Number.isInteger(failure.status) ? failure.status : 1);
}

const joined = args.join(' ');

if (joined === 'plugin list --json') {
  createProviderReadArtifacts();
  printJsonResponse(shiftResponse(state, 'pluginListResponses', state.plugins || []));
  process.exit(0);
}

if (joined === 'plugin marketplace list --json') {
  createProviderReadArtifacts();
  printJsonResponse(
    shiftResponse(state, 'marketplaceListResponses', state.marketplaces || [])
  );
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const source = args[3];
  const scopeIndex = args.indexOf('--scope');
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : 'user';
  const marketplaces = [
    ...(state.marketplaces || []).filter(entry => entry.name !== 'ecc'),
    {
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      url: source,
      scope,
    },
  ];
  writeState({ ...state, marketplaces });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'update') {
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'install' && args[2] === 'ecc@ecc') {
  const scopeIndex = args.indexOf('--scope');
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : 'user';
  const plugins = [
    ...(state.plugins || []).filter(plugin => (
      plugin.id !== 'ecc@ecc' || plugin.scope !== scope
    )),
    { id: 'ecc@ecc', scope, enabled: true, version: '2.0.0' },
  ];
  writeState({ ...state, plugins });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'update' && args[2] === 'ecc@ecc') {
  const scopeIndex = args.indexOf('--scope');
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : 'user';
  const plugins = (state.plugins || []).map(plugin => (
    plugin.id === 'ecc@ecc' && plugin.scope === scope
      ? { ...plugin, enabled: true, version: '2.0.0' }
      : plugin
  ));
  writeState({ ...state, plugins });
  process.exit(0);
}

if (args[0] === 'plugin' && args[1] === 'uninstall') {
  const pluginId = args[2];
  const scopeIndex = args.indexOf('--scope');
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : 'user';
  const plugins = (state.plugins || []).filter(plugin => !(
    plugin.id === pluginId && plugin.scope === scope
  ));
  writeState({ ...state, plugins });
  process.exit(0);
}

process.stderr.write(`Unsupported fake Claude invocation: ${JSON.stringify(args)}\n`);
process.exit(2);
