#!/usr/bin/env node
/**
 * Antigravity 2.0 Hook Bridge for ECC
 *
 * Translates Antigravity 2.0 lifecycle hook payloads (camelCase protojson on stdin)
 * to Claude Code / Hermes hook payloads (snake_case on stdin), executes the target
 * ECC hook script, and translates the outcome back to Antigravity's expected JSON
 * contract on stdout ({ "decision": "allow" | "deny" | "ask", "reason": "..." }).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const KNOWN_HOOKS = Object.freeze({
  'config-protection': path.join(REPO_ROOT, 'scripts', 'hooks', 'config-protection.js'),
  'check-console-log': path.join(REPO_ROOT, 'scripts', 'hooks', 'check-console-log.js'),
  'quality-gate': path.join(REPO_ROOT, 'scripts', 'hooks', 'quality-gate.js'),
  'pre-bash-commit-quality': path.join(REPO_ROOT, 'scripts', 'hooks', 'pre-bash-commit-quality.js'),
  'block-no-verify': path.join(REPO_ROOT, 'scripts', 'hooks', 'block-no-verify.js'),
});

let _hookFlags = null;
function getHookFlags() {
  if (_hookFlags === null) {
    try {
      _hookFlags = require('../lib/hook-flags');
    } catch (_) {
      try {
        _hookFlags = require(path.join(REPO_ROOT, 'scripts', 'lib', 'hook-flags.js'));
      } catch (_err) {
        _hookFlags = {
          areHooksEnabled: () => true,
          isHookEnabled: () => true,
          isDryRun: () => false,
        };
      }
    }
  }
  return _hookFlags;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let hookTarget = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--hook' && i + 1 < args.length) {
      hookTarget = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--hook=')) {
      hookTarget = arg.slice('--hook='.length);
    } else if (arg === '--script' && i + 1 < args.length) {
      hookTarget = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--script=')) {
      hookTarget = arg.slice('--script='.length);
    }
  }

  return { hookTarget };
}

function resolveHookScript(hookTarget) {
  if (!hookTarget) return null;
  if (Object.prototype.hasOwnProperty.call(KNOWN_HOOKS, hookTarget)) {
    const known = KNOWN_HOOKS[hookTarget];
    if (fs.existsSync(known)) return known;
  }

  // Sibling hooks folder relative to this bridge script
  const siblingDir = path.resolve(__dirname, '..', 'hooks');
  const sibling = path.resolve(siblingDir, `${hookTarget}.js`);
  if (sibling.startsWith(siblingDir + path.sep) && fs.existsSync(sibling)) {
    return sibling;
  }

  // Canonical hooks directory under REPO_ROOT (reject path traversal escapes)
  const canonicalHooksDir = path.resolve(REPO_ROOT, 'scripts', 'hooks');
  const targetScript = path.resolve(canonicalHooksDir, `${hookTarget}.js`);
  if (targetScript.startsWith(canonicalHooksDir + path.sep) && fs.existsSync(targetScript)) {
    return targetScript;
  }

  return null;
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
  const result = { decision };
  if (reason) {
    result.reason = reason;
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}

function main() {
  const { hookTarget } = parseArgs(process.argv);
  const hookFlags = getHookFlags();

  // 1. Central ECC policy check: are hooks globally enabled?
  if (!hookFlags.areHooksEnabled()) {
    emitAntigravityDecision('allow');
    process.exit(0);
  }

  // 2. Is this specific hook enabled in active profile / not in ECC_DISABLED_HOOKS?
  if (hookTarget && !hookFlags.isHookEnabled(hookTarget)) {
    emitAntigravityDecision('allow');
    process.exit(0);
  }

  // 3. Dry-run mode check
  if (hookFlags.isDryRun()) {
    emitAntigravityDecision('allow');
    process.exit(0);
  }

  const hookScript = resolveHookScript(hookTarget);

  let rawStdin = '';
  try {
    rawStdin = fs.readFileSync(0, 'utf8');
  } catch (_e) {
    rawStdin = '';
  }

  let antigravityPayload = {};
  if (rawStdin && rawStdin.trim()) {
    try {
      antigravityPayload = JSON.parse(rawStdin);
    } catch (_err) {
      // Unparseable payload fails open per ECC hook contract
      emitAntigravityDecision('allow');
      process.exit(0);
    }
  }

  if (!hookScript) {
    // If no specific hook script was configured or found, allow
    emitAntigravityDecision('allow');
    process.exit(0);
  }

  const claudePayload = normalizeAntigravityToClaude(antigravityPayload);
  const childStdin = JSON.stringify(claudePayload);

  const isPython = hookScript.endsWith('.py');
  const runner = isPython ? (process.platform === 'win32' ? 'python' : 'python3') : process.execPath;

  const result = spawnSync(runner, [hookScript], {
    input: childStdin,
    encoding: 'utf8',
    timeout: 30000,
    cwd: claudePayload.cwd || process.cwd(),
  });

  if (result.error) {
    // Execution failed, fail open with warning
    process.stderr.write(`[antigravity-hook-bridge] Error invoking hook ${hookScript}: ${result.error.message}\n`);
    emitAntigravityDecision('allow');
    process.exit(0);
  }

  // Parse stdout from hook
  const childStdout = (result.stdout || '').trim();
  const childStderr = (result.stderr || '').trim();

  let childDecision = null;
  let childReason = null;

  if (childStdout) {
    try {
      const parsedStdout = JSON.parse(childStdout);
      if (parsedStdout && typeof parsedStdout === 'object') {
        if (parsedStdout.decision === 'block' || parsedStdout.decision === 'deny') {
          childDecision = 'deny';
          childReason = parsedStdout.reason || childStderr || 'Operation blocked by ECC guardrail';
        }
      }
    } catch (_ignore) {
      // Not JSON stdout, check exit code
    }
  }

  // If exit code is 2 (blocking) or non-zero and not explicitly allowed
  if (result.status === 2 || childDecision === 'deny') {
    emitAntigravityDecision('deny', childReason || childStderr || 'Operation blocked by ECC config-protection guardrail');
  } else if (result.status !== 0 && result.status !== null) {
    // Other error
    emitAntigravityDecision('deny', childReason || childStderr || `Hook failed with exit code ${result.status}`);
  } else {
    emitAntigravityDecision('allow');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  KNOWN_HOOKS,
  normalizeAntigravityToClaude,
  resolveHookScript,
  main,
  getHookFlags,
};
