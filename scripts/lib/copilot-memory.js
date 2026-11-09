'use strict';

// Copilot workflow only. Canonical memory.js owns storage, scope resolution,
// credential checks, routing, create-only writes and protective .gitignore.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const sessions = require('./copilot-sessions');
const { findPotentialSecrets, hasUnsafeControlCharacters } = require('./memory-vault-format');

const MAX_PROPOSAL_BYTES = 32 * 1024;
function runtimePrerequisite(env = process.env) {
  const root = env.ECC_COPILOT_MEMORY_RUNTIME || path.resolve(__dirname, '../..');
  if (!path.isAbsolute(root)) return { available: false, reason: 'Runtime root must be absolute.' };
  try {
    const canonical = fs.realpathSync(root);
    const pkg = JSON.parse(sessions.readBounded(path.join(canonical, 'package.json'), 128 * 1024));
    if (pkg.name !== 'ecc-universal') throw new Error('Unexpected memory runtime package.');
    const script = path.join(canonical, 'scripts/memory.js');
    sessions.readBounded(script, 128 * 1024);
    const mcpScript = path.join(canonical, 'scripts/memory-mcp.mjs');
    let mcpAvailable = false;
    try { sessions.readBounded(mcpScript, 128 * 1024); mcpAvailable = true; } catch { /* Diagnosed separately; never installed here. */ }
    return { available: true, root: canonical, version: pkg.version, script, mcpScript, mcpAvailable };
  } catch {
    return { available: false, reason: 'ECC Memory Vault runtime unavailable. Install ecc-universal explicitly or configure ECC_COPILOT_MEMORY_RUNTIME to its absolute package root.' };
  }
}

function invokeMemory(workspace, args, env = process.env, body) {
  const schemas = { doctor: 'ecc.memory.doctor.v1', handoff: 'ecc.memory.write.v1', search: 'ecc.memory.search.v1', read: 'ecc.memory.read.v1' };
  if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string') || !Object.hasOwn(schemas, args[0])) {
    throw new Error('Unsupported canonical Memory Vault operation.');
  }
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--scope') scopesFor(args[++index], env);
  }
  const runtime = runtimePrerequisite(env);
  if (!runtime.available) throw new Error(runtime.reason);
  const result = spawnSync(process.execPath, [runtime.script, ...args], {
    cwd: fs.realpathSync(workspace), env: { ...env, ECC_MEMORY_HARNESS: 'copilot' },
    input: body, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 15000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.signal || result.status !== 0) {
    // Raw memory bodies, filesystem paths and credential-shaped text must not
    // escape through errors. Outcome may be unknown if a write timed out.
    const error = new Error('Canonical Memory Vault operation failed or is unavailable; inspect its doctor report. A timed-out write must be reconciled before retry.');
    error.code = args[0] === 'handoff' || result.error || result.signal ? 'ECC_COPILOT_MEMORY_OUTCOME_UNKNOWN' : 'ECC_COPILOT_MEMORY_FAILED';
    // These exact canonical diagnostics classify operation failures without
    // returning their raw stderr or mistaking transport failure for absence.
    if (!result.error && !result.signal && args[0] === 'read') {
      const diagnostic = String(result.stderr || '').trim();
      if (diagnostic === 'Error: Memory lookup is incomplete. Inspect the authorized vault before retrying.') error.code = 'ECC_COPILOT_MEMORY_INCOMPLETE';
      if (diagnostic === `Error: Memory ${args[1]} was not found.`) error.code = 'ECC_COPILOT_MEMORY_NOT_FOUND';
    }
    throw error;
  }
  const invalidResponse = message => {
    const error = new Error(message);
    if (args[0] === 'handoff') error.code = 'ECC_COPILOT_MEMORY_OUTCOME_UNKNOWN';
    return error;
  };
  let output;
  try { output = JSON.parse(result.stdout); } catch { throw invalidResponse('Invalid canonical Memory Vault response; reconcile any write before retry.'); }
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || !Object.hasOwn(schemas, args[0]) || output.schemaVersion !== schemas[args[0]]) {
    throw invalidResponse('Unsupported canonical Memory Vault response; reconcile any write before retry.');
  }
  if ((args[0] === 'doctor' && typeof output.ok !== 'boolean')
    || (args[0] === 'search' && !Array.isArray(output.results))
    || (['read', 'handoff'].includes(args[0]) && (!output.memory || typeof output.memory.id !== 'string'))) {
    throw invalidResponse('Invalid canonical Memory Vault operation result; reconcile any write before retry.');
  }
  return output;
}

function searchForCopilot(workspace, query, env = process.env) {
  const result = invokeMemory(workspace, ['search', query, '--scope', 'project', '--scope', 'team', '--target-harness', 'copilot', '--json'], env);
  const diagnostics = result.diagnostics;
  const incomplete = !diagnostics || diagnostics.truncated || diagnostics.invalidFileCount > 0 || diagnostics.skippedSymlinkCount > 0;
  return { ...result, status: incomplete ? 'incomplete' : result.results.length ? 'found' : 'empty' };
}

function readForCopilot(workspace, id, env = process.env) {
  const result = invokeMemory(workspace, ['read', id, '--scope', 'project', '--scope', 'team', '--json'], env);
  if (!Array.isArray(result.memory.targetHarnesses) || !result.memory.targetHarnesses.some(target => ['all', 'copilot'].includes(target))) {
    const error = new Error('Memory is addressed to a different harness.'); error.code = 'ECC_COPILOT_MEMORY_RECIPIENT_MISMATCH'; throw error;
  }
  return result;
}

const MCP_TOOLS = Object.freeze(['memory_save', 'memory_search', 'memory_read', 'memory_doctor']);
function previewMemoryMcp(workspace, options, env = process.env) {
  fs.realpathSync(workspace);
  const runtime = runtimePrerequisite(env);
  if (!runtime.available || !runtime.mcpAvailable) throw new Error('Canonical Memory MCP runtime unavailable; install/configure it explicitly.');
  const tools = options.tools || [];
  if (!Array.isArray(tools) || tools.some(tool => !MCP_TOOLS.includes(tool)) || new Set(tools).size !== tools.length) throw new Error('Invalid Memory MCP tool selection.');
  const wrapper = path.resolve(__dirname, '../copilot-memory-mcp.js');
  sessions.readBounded(wrapper, 64 * 1024);
  const alias = options.alias || 'ecc-memory';
  return require('./copilot-mcp').preview({ configPath: options.configPath,
    catalog: { mcpServers: { 'ecc-memory': { command: process.execPath,
      args: [wrapper, '--runtime', runtime.root], env: {} } } }, selected: [{ name: 'ecc-memory', alias, tools }] });
}

function applyMemoryMcp(workspace, options, env = process.env) {
  return require('./copilot-mcp').apply(previewMemoryMcp(workspace, options, env));
}

function rollbackMemoryMcp(options) {
  return require('./copilot-mcp').rollback({ configPath: options.configPath, aliases: [options.alias || 'ecc-memory'] });
}

function scopesFor(scope, env) {
  if (!['project', 'team', 'user'].includes(scope)) throw new Error('Invalid memory scope.');
  if (scope === 'user' && env.ECC_MEMORY_ALLOW_USER_SCOPE !== '1') throw new Error('Explicit user scope enablement is required.');
  return ['--scope', scope];
}

function memoryDoctor(workspace, env = process.env) {
  const runtime = runtimePrerequisite(env);
  if (!runtime.available) return { schema: 'ecc.copilot.memory.doctor.v1', status: 'unavailable', runtime };
  const report = invokeMemory(workspace, ['doctor', '--scope', 'project', '--scope', 'team', '--json'], env);
  return { schema: 'ecc.copilot.memory.doctor.v1', status: report.ok ? 'ready' : 'issues', runtime, report,
    mcp: { command: process.execPath, args: [path.resolve(__dirname, '../copilot-memory-mcp.js'), '--runtime', runtime.root],
      env: {}, available: runtime.mcpAvailable },
    limitation: 'CLI subprocess tested separately from native Copilot/MCP loading; doctor never installs or modifies the vault.' };
}

function safeText(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit
    || hasUnsafeControlCharacters(value, true) || findPotentialSecrets(value).length
    || /\b(?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/i.test(value)) {
    throw new Error(`Invalid ${label}: empty, oversized, unsafe or suspected secret.`);
  }
  return value;
}

function validateProposal(workspace, value, env) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 'ecc.copilot.handoff-proposal.v1') throw new Error('Invalid handoff proposal schema.');
  const fields = ['schema', 'workspace', 'sessionId', 'checkpointUpdatedAt', 'sourceHarness', 'target', 'scope', 'title', 'body'];
  if (Object.keys(value).some(key => !fields.includes(key))) throw new Error('Unknown handoff proposal fields.');
  if (value.workspace !== fs.realpathSync(workspace) || value.sourceHarness !== 'copilot') throw new Error('Foreign handoff workspace or harness.');
  sessions.sessionId(value.sessionId);
  if (typeof value.checkpointUpdatedAt !== 'string' || !Number.isFinite(Date.parse(value.checkpointUpdatedAt))) throw new Error('Invalid checkpoint timestamp.');
  scopesFor(value.scope, env);
  if (typeof value.target !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.target) || value.target === 'all') throw new Error('Choose one explicit target harness.');
  safeText(value.title, 'handoff title', 500);
  safeText(value.body, 'handoff body', sessions.MAX_SUMMARY_BYTES);
  return value;
}

function proposeHandoff(workspace, options, env = process.env) {
  const canonical = fs.realpathSync(workspace);
  const checkpoint = sessions.recall(canonical, sessions.sessionId(options.sessionId), env);
  if (!checkpoint || checkpoint.summarySource !== 'manual' || !checkpoint.summary.trim()) throw new Error('An explicit manual checkpoint is required for handoff.');
  return validateProposal(canonical, {
    schema: 'ecc.copilot.handoff-proposal.v1', workspace: canonical,
    sessionId: checkpoint.sessionId, checkpointUpdatedAt: checkpoint.updatedAt,
    sourceHarness: 'copilot', target: options.target, scope: options.scope || 'project',
    title: options.title, body: checkpoint.summary
  }, env);
}

function proposalDigest(proposal) {
  // Stable schema order makes review independent of JSON property ordering.
  const fields = ['schema', 'workspace', 'sessionId', 'checkpointUpdatedAt', 'sourceHarness', 'target', 'scope', 'title', 'body'];
  const normalized = fields.map(key => [key, proposal[key]]);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function saveHandoff(workspace, proposal, options, env = process.env) {
  validateProposal(workspace, proposal, env);
  if (options.reviewedSha256 !== proposalDigest(proposal)) throw new Error('Explicit review of the current proposal digest is required before save.');
  const checkpoint = sessions.recall(fs.realpathSync(workspace), proposal.sessionId, env);
  if (!checkpoint || checkpoint.summarySource !== 'manual' || checkpoint.summary !== proposal.body
    || Date.parse(checkpoint.updatedAt) < Date.parse(proposal.checkpointUpdatedAt)) {
    throw new Error('The manual checkpoint no longer matches this handoff proposal; create and review a new proposal.');
  }
  if (env.ECC_DRY_RUN === '1') throw new Error('Handoff save is disabled in dry-run mode.');
  return invokeMemory(workspace, ['handoff', '--from', 'copilot', '--target', proposal.target,
    ...scopesFor(proposal.scope, env), '--title', proposal.title, '--stdin', '--json'], env, proposal.body);
}

module.exports = { runtimePrerequisite, invokeMemory, memoryDoctor, proposeHandoff, saveHandoff, proposalDigest,
  searchForCopilot, readForCopilot, previewMemoryMcp, applyMemoryMcp, rollbackMemoryMcp, MAX_PROPOSAL_BYTES };
