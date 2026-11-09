#!/usr/bin/env node
'use strict';

const fs = require('fs');
const memory = require('./lib/copilot-memory');
const sessions = require('./lib/copilot-sessions');
const { flagArgs } = require('./lib/copilot-runtime-tools');

function main(args = process.argv.slice(2), env = process.env) {
  const [action, ...rest] = args;
  const workspace = fs.realpathSync(process.cwd());
  if (action === 'doctor' && !rest.length) return memory.memoryDoctor(workspace, env);
  if (['mcp-preview', 'mcp-apply', 'mcp-rollback'].includes(action)) {
    const options = flagArgs(rest, ['--config', '--alias', '--tools'], []);
    const setup = { configPath: options['--config'], alias: options['--alias'],
      tools: options['--tools'] ? options['--tools'].split(',') : [] };
    if (action === 'mcp-rollback') {
      if (options['--tools']) throw new Error('Tool selection does not apply to rollback.');
      return memory.rollbackMemoryMcp(setup);
    }
    return action === 'mcp-apply' ? memory.applyMemoryMcp(workspace, setup, env) : memory.previewMemoryMcp(workspace, setup, env);
  }
  if (action === 'propose') {
    const options = flagArgs(rest, ['--session', '--title', '--target', '--scope'], []);
    const proposal = memory.proposeHandoff(workspace, {
      sessionId: options['--session'], title: options['--title'], target: options['--target'], scope: options['--scope']
    }, env);
    return { proposal, reviewSha256: memory.proposalDigest(proposal), saved: false };
  }
  if (action === 'save') {
    const options = flagArgs(rest, ['--proposal', '--reviewed-sha256'], []);
    if (!options['--proposal']) throw new Error('save requires --proposal.');
    const document = JSON.parse(sessions.readBounded(options['--proposal'], memory.MAX_PROPOSAL_BYTES));
    const proposal = document.proposal || document;
    return memory.saveHandoff(workspace, proposal, { reviewedSha256: options['--reviewed-sha256'] }, env);
  }
  if (action === 'search' && rest.length === 1) {
    return memory.searchForCopilot(workspace, rest[0], env);
  }
  if (action === 'read' && rest.length === 1) {
    return memory.readForCopilot(workspace, rest[0], env);
  }
  throw new Error('Usage: copilot-memory.js doctor | mcp-preview|mcp-apply|mcp-rollback --config ABS_PATH [--alias NAME] [--tools LIST] | propose --session ID --title TITLE --target HARNESS [--scope project|team|user] | save --proposal FILE --reviewed-sha256 DIGEST | search QUERY | read ID');
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); }
  catch {
    // Never echo checkpoint bodies, memory contents or proposals on failure.
    process.stderr.write('Copilot Memory Vault operation failed. Check runtime prerequisites, proposal review, workspace and canonical doctor diagnostics.\n');
    process.exitCode = 1;
  }
}
module.exports = { main };
