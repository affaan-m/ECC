#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'ecc.copilot.memory.v1';
const MAX_RUNTIME_FILE = 128 * 1024;
const SCOPES = ['project', 'team'];
const READ_ARGS = ['--scope', 'project', '--scope', 'team', '--target-harness', 'copilot', '--json'];
const CANONICAL_SCHEMAS = {
  doctor: 'ecc.memory.doctor.v1',
  search: 'ecc.memory.search.v1',
  read: 'ecc.memory.read.v1',
};
const MESSAGES = {
  INVALID_ARGUMENTS: 'Use doctor, search QUERY, or read MEMORY_ID.',
  UNAVAILABLE: 'Select a compatible trusted ecc-universal package with ECC_COPILOT_MEMORY_RUNTIME.',
  INCOMPLETE: 'The project or team vault lookup is incomplete. Review vault diagnostics before retrying.',
  NOT_FOUND: 'The requested memory was not found in the allowed scopes and recipients.',
  FAILED: 'The canonical Memory Vault operation failed.',
  INVALID_RESPONSE: 'The selected Memory Vault runtime returned an unsupported response.',
};
const ONLY_ID = /^mem_[a-z0-9][a-z0-9_-]{2,127}$/;
const MEMORY_FIELDS = [
  'schema', 'id', 'title', 'kind', 'scope', 'trust', 'status', 'sourceHarness',
  'targetHarnesses', 'tags', 'links', 'createdAt', 'updatedAt',
];

class BridgeError extends Error {
  constructor(kind) {
    super(MESSAGES[kind]);
    this.kind = kind;
  }
}

function parseArgs(args) {
  const [action, value] = args;
  if (action === 'doctor' && args.length === 1) return { action };
  if (action === 'read' && args.length === 2 && ONLY_ID.test(value)) return { action, value };
  if (action === 'search' && args.length === 2 && value.trim().length <= 500) return { action, value };
  throw new BridgeError('INVALID_ARGUMENTS');
}

function assertRuntimeFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_RUNTIME_FILE) {
    throw new BridgeError('UNAVAILABLE');
  }
}

function runtimePrerequisite(env) {
  const root = env.ECC_COPILOT_MEMORY_RUNTIME;
  if (!root || !path.isAbsolute(root)) throw new BridgeError('UNAVAILABLE');
  try {
    const canonical = fs.realpathSync(root);
    const pkgFile = path.join(canonical, 'package.json');
    const scripts = path.join(canonical, 'scripts');
    if (!fs.lstatSync(scripts).isDirectory()) throw new BridgeError('UNAVAILABLE');
    assertRuntimeFile(pkgFile);
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (pkg?.name !== 'ecc-universal' || pkg.bin?.ecc !== 'scripts/ecc.js') throw new BridgeError('UNAVAILABLE');

    const script = path.join(scripts, 'memory.js');
    assertRuntimeFile(script);
    return script;
  } catch {
    throw new BridgeError('UNAVAILABLE');
  }
}

function childEnvironment(env) {
  // The canonical CLI selects the current workspace. Prevent ambient project
  // and user vault overrides or Node preload/search settings from rewriting it.
  const excluded = ['NODE_OPTIONS', 'NODE_PATH', 'ECC_MEMORY_PROJECT_ROOT', 'ECC_MEMORY_USER_ROOT',
    'ECC_MEMORY_ALLOW_USER_SCOPE', 'ECC_COPILOT_MEMORY_RUNTIME'];
  const selected = Object.fromEntries(Object.entries(env).filter(([key]) => !excluded.includes(key.toUpperCase())));
  return { ...selected, ECC_MEMORY_HARNESS: 'copilot', ECC_DRY_RUN: '1' };
}

function operationFailure(action, value, result) {
  if (!result.error && !result.signal) {
    const diagnostic = String(result.stderr || '').trim();
    if (diagnostic === 'Error: Memory lookup is incomplete. Inspect the authorized vault before retrying.') {
      return new BridgeError('INCOMPLETE');
    }
    if (action === 'read' && diagnostic === `Error: Memory ${value} was not found.`) {
      return new BridgeError('NOT_FOUND');
    }
  }
  return new BridgeError('FAILED');
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('INVALID_RESPONSE');
  return value;
}

function invokeMemory(action, value, workspace, env) {
  const script = runtimePrerequisite(env);
  // The canonical parser treats arguments beginning with a hyphen as options.
  // Search core trims its query, so prefix literal queries with a space.
  const positional = action === 'search' ? [` ${value}`] : action === 'read' ? [value] : [];
  const result = spawnSync(process.execPath, [script, action, ...positional, ...READ_ARGS], {
    cwd: workspace,
    env: childEnvironment(env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) throw operationFailure(action, value, result);
  let output;
  try { output = record(JSON.parse(result.stdout)); }
  catch { throw new BridgeError('INVALID_RESPONSE'); }
  if (output.schemaVersion !== CANONICAL_SCHEMAS[action]) throw new BridgeError('INVALID_RESPONSE');
  return output;
}

function allows(memory) {
  record(memory);
  if (memory.schema !== 'ecc.memory.v1' || typeof memory.id !== 'string' || !ONLY_ID.test(memory.id)
    || !Array.isArray(memory.targetHarnesses) || memory.targetHarnesses.some(target => typeof target !== 'string')) {
    throw new BridgeError('INVALID_RESPONSE');
  }
  return SCOPES.includes(memory.scope)
    && memory.targetHarnesses.some(target => target === 'all' || target === 'copilot');
}

function memoryFields(memory, includeBody = false) {
  const metadata = Object.fromEntries(MEMORY_FIELDS.map(key => [key, memory[key]]));
  if (typeof metadata.title !== 'string' || metadata.trust !== 'unreviewed') {
    throw new BridgeError('INVALID_RESPONSE');
  }
  if (!includeBody) return metadata;
  if (typeof memory.body !== 'string' || Buffer.byteLength(memory.body) > 64 * 1024) {
    throw new BridgeError('INVALID_RESPONSE');
  }
  return { ...metadata, body: memory.body };
}

function diagnostics(output, extraCounts = []) {
  const current = record(output);
  const counts = ['invalidFileCount', 'skippedSymlinkCount', ...extraCounts];
  if (counts.some(key => !Number.isSafeInteger(current[key]) || current[key] < 0)
    || typeof current.truncated !== 'boolean' || typeof current.diagnosticsTruncated !== 'boolean') {
    throw new BridgeError('INVALID_RESPONSE');
  }
  return {
    ...Object.fromEntries(counts.map(key => [key, current[key]])),
    truncated: current.truncated,
    diagnosticsTruncated: current.diagnosticsTruncated,
  };
}

function doctorResult(output) {
  if (output.targetHarness !== 'copilot') throw new BridgeError('UNAVAILABLE');
  if (typeof output.ok !== 'boolean') throw new BridgeError('INVALID_RESPONSE');
  const counts = diagnostics(output, ['memoryCount', 'duplicateIdCount', 'brokenLinkCount']);
  return { status: output.ok ? 'ready' : 'issues', report: { ok: output.ok, ...counts } };
}

function searchResult(output) {
  if (!Array.isArray(output.results) || output.results.length > 20) throw new BridgeError('INVALID_RESPONSE');
  const rows = output.results.filter(row => allows(record(row).memory)).map(row => {
    if (!Number.isFinite(row.score) || typeof row.excerpt !== 'string') throw new BridgeError('INVALID_RESPONSE');
    return { memory: memoryFields(row.memory), score: row.score, excerpt: row.excerpt };
  });
  const counts = diagnostics(output.diagnostics);
  const incomplete = counts.truncated || counts.invalidFileCount || counts.skippedSymlinkCount;
  return { status: incomplete ? 'incomplete' : rows.length ? 'found' : 'empty', results: rows, diagnostics: counts };
}

function readResult(output, id) {
  if (!allows(output.memory)) throw new BridgeError('NOT_FOUND');
  if (output.memory.id !== id || !Array.isArray(output.backlinks) || output.backlinks.length > 100
    || typeof output.backlinksTruncated !== 'boolean') {
    throw new BridgeError('INVALID_RESPONSE');
  }
  return {
    status: 'found',
    memory: memoryFields(output.memory, true),
    backlinks: output.backlinks.filter(allows).map(memory => memoryFields(memory)),
    backlinksTruncated: output.backlinksTruncated,
  };
}

function main() {
  const { action, value } = parseArgs(process.argv.slice(2));
  const workspace = fs.realpathSync(process.cwd());
  const output = invokeMemory(action, value, workspace, process.env);
  const publicResult = action === 'doctor' ? doctorResult(output)
    : action === 'search' ? searchResult(output)
      : readResult(output, value);
  return { schemaVersion: SCHEMA, ...publicResult };
}

try {
  process.stdout.write(JSON.stringify(main()) + '\n');
} catch (error) {
  const kind = error instanceof BridgeError && Object.hasOwn(MESSAGES, error.kind) ? error.kind : 'FAILED';
  const status = kind === 'UNAVAILABLE' ? 'unavailable' : 'error';
  process.stdout.write(JSON.stringify({
    schemaVersion: SCHEMA,
    status,
    code: `ECC_COPILOT_MEMORY_${kind}`,
    message: MESSAGES[kind],
  }) + '\n');
  process.exitCode = 1;
}
