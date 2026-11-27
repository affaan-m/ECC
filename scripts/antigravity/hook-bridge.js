#!/usr/bin/env node
'use strict';

// Experimental CLI payload adapter. Canonical Antigravity hooks retain policy
// selection and all permission-decision translation.
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdinRaw, resolveMaxStdin } = require('../hooks/hook-input');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL_HOOK_IDS = Object.freeze({
  'config-protection': 'pre:config-protection',
  'gateguard-fact-force': 'pre:edit-write:gateguard-fact-force',
  'block-no-verify': 'pre:bash:dispatcher',
  'pre-bash-commit-quality': 'pre:bash:dispatcher',
});
const KNOWN_HOOKS = Object.freeze(Object.fromEntries(Object.keys(CANONICAL_HOOK_IDS)
  .map(name => [name, path.join(REPO_ROOT, 'scripts', 'hooks', `${name}.js`)])));
function getHookFlags() { return require('../lib/hook-flags'); }
function parseArgs(argv) {
  let hookTarget = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--hook') hookTarget = argv[++index];
    else if (argv[index].startsWith('--hook=')) hookTarget = argv[index].slice(7);
  }
  return { hookTarget };
}
function resolveHookScript(hookTarget) {
  return Object.hasOwn(KNOWN_HOOKS, hookTarget || '') ? KNOWN_HOOKS[hookTarget] : null;
}
function normalizeAntigravityToClaude(payload) {
  const toolCall = payload.toolCall || {};
  const rawToolName = String(toolCall.name || '');
  const args = toolCall.args || {};

  let claudeToolName = rawToolName;
  const claudeToolInput = { ...args };

  if (
    rawToolName === 'edit_file'
    || rawToolName === 'replace_file_content'
    || rawToolName === 'multi_replace_file_content'
  ) {
    claudeToolName = 'Edit';
    const filePath = args.TargetFile || args.targetFile || args.Path || args.path || args.filePath || '';
    claudeToolInput.file_path = filePath;
    claudeToolInput.path = filePath;
    claudeToolInput.file = filePath;
  } else if (rawToolName === 'write_file' || rawToolName === 'write_to_file') {
    claudeToolName = 'Write';
    const filePath = args.TargetFile || args.targetFile || args.Path || args.path || args.filePath || '';
    claudeToolInput.file_path = filePath;
    claudeToolInput.path = filePath;
    claudeToolInput.file = filePath;
    claudeToolInput.content = args.Content || args.content || '';
  } else if (rawToolName === 'run_command') {
    claudeToolName = 'Bash';
    claudeToolInput.command = args.CommandLine || args.command || '';
  } else if (rawToolName === 'read_file' || rawToolName === 'view_file') {
    claudeToolName = 'Read';
    const filePath = args.TargetFile || args.targetFile || args.Path || args.path || args.filePath || '';
    claudeToolInput.file_path = filePath;
    claudeToolInput.path = filePath;
  }

  return {
    hook_event_name: 'pre_tool_call',
    session_id: payload.conversationId || '',
    tool_name: claudeToolName,
    tool_input: claudeToolInput,
    transcript_path: payload.transcriptPath || '',
    cwd: Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0
      ? payload.workspacePaths[0]
      : process.cwd(),
  };
}

function emitAntigravityDecision(decision, reason) {
  process.stdout.write(JSON.stringify({ decision, ...(reason ? { reason } : {}) }) + '\n');
}
async function main(providedRaw) {
  try {
    const { hookTarget } = parseArgs(process.argv);
    const flags = getHookFlags();
    if (!flags.areHooksEnabled() || flags.isDryRun()) {
      emitAntigravityDecision('allow');
      return;
    }
    if (!Object.hasOwn(CANONICAL_HOOK_IDS, hookTarget || '')) {
      emitAntigravityDecision('deny', 'Unsupported ECC safety hook');
      return;
    }
    // Preserve old explicit alias opt-outs; the canonical child owns profiles
    // and canonical hook IDs, including mandatory guards in minimal profiles.
    if (flags.getDisabledHookIds().has(hookTarget)) {
      emitAntigravityDecision('allow');
      return;
    }
    const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES);
    const input = typeof providedRaw === 'string'
      ? { raw: providedRaw, truncated: Buffer.byteLength(providedRaw) > maxStdin }
      : await readStdinRaw(process.stdin, { maxStdin });
    if (input.truncated) throw new Error('Incomplete hook input');
    const payload = JSON.parse(input.raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid hook input');
    const normalized = normalizeAntigravityToClaude(payload);
    if (!['Edit', 'Write', 'Read', 'Bash'].includes(normalized.tool_name)) throw new Error('Unknown native tool');
    const target = normalized.tool_name === 'Bash' ? normalized.tool_input.command : normalized.tool_input.file_path;
    if (typeof target !== 'string' || !target.trim()) throw new Error('Missing native tool arguments');
    const result = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'scripts', 'hooks', 'antigravity-hook-bridge.js'),
      '--mode', 'pre-tool-use', '--hook', CANONICAL_HOOK_IDS[hookTarget],
    ], {
      input: JSON.stringify(normalized),
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
      cwd: process.cwd(),
    });
    if (result.error || result.status !== 0) throw new Error('Canonical hook did not complete');
    const decision = JSON.parse(result.stdout);
    if (!decision || !['allow', 'deny', 'ask'].includes(decision.decision)) throw new Error('Unknown hook outcome');
    emitAntigravityDecision(decision.decision, typeof decision.reason === 'string' ? decision.reason : undefined);
  } catch {
    emitAntigravityDecision('deny', 'ECC safety hook could not complete with verified input');
  }
}
if (require.main === module) main();
module.exports = { protocol: 'ecc.antigravity-cli.v1', KNOWN_HOOKS, CANONICAL_HOOK_IDS, normalizeAntigravityToClaude, resolveHookScript, main, getHookFlags };
