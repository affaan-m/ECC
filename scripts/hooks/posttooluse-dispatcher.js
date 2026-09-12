#!/usr/bin/env node
/**
 * Consolidates PostToolUse hooks into one synchronous and one asynchronous
 * entrypoint while preserving each hook's ID, matcher, profile, and output.
 */

'use strict';

const path = require('path');
const { StringDecoder } = require('string_decoder');
const { isHookEnabled } = require('../lib/hook-flags');
const { runPostBash } = require('./bash-hook-dispatcher');
const { run: runQualityGate } = require('./quality-gate');
const { run: runDesignQualityCheck } = require('./design-quality-check');
const { run: runPostEditAccumulator } = require('./post-edit-accumulator');
const { run: runConsoleWarn } = require('./post-edit-console-warn');
const { run: runGovernanceCapture } = require('./governance-capture');
const { run: runSessionActivityTracker } = require('./session-activity-tracker');
const { run: runObserve } = require('./observe-runner');
const { run: runMetricsBridge } = require('./ecc-metrics-bridge');
const { run: runContextMonitor } = require('./ecc-context-monitor');
const { run: runSkillRunTracker } = require('./skill-run-tracker');
const { run: runHookify } = require('./hookify-runtime');
const {
  REGISTERED_HOOK_MAX_STDIN_BYTES,
  createHookContextScanner,
} = require('./hook-input-limits');

const MAX_STDIN = REGISTERED_HOOK_MAX_STDIN_BYTES;

const SYNC_HOOKS = [
  {
    id: 'post:hookify-runtime',
    matcher: '*',
    profiles: 'minimal,standard,strict',
    script: 'scripts/hooks/hookify-runtime.js',
    run(raw, options) {
      const result = runHookify(raw, options);
      return result.stdout === raw ? { ...result, stdout: '' } : result;
    }
  },
  { id: 'post:edit:design-quality-check', matcher: 'Edit|Write|MultiEdit', profiles: 'standard,strict', script: 'scripts/hooks/design-quality-check.js', run: runDesignQualityCheck },
  { id: 'post:edit:accumulator', matcher: 'Edit|Write|MultiEdit', profiles: 'standard,strict', script: 'scripts/hooks/post-edit-accumulator.js', run: runPostEditAccumulator },
  { id: 'post:edit:console-warn', matcher: 'Edit', profiles: 'standard,strict', script: 'scripts/hooks/post-edit-console-warn.js', run: runConsoleWarn },
  { id: 'post:governance-capture', matcher: 'Bash|PowerShell|Write|Edit|MultiEdit', profiles: 'standard,strict', script: 'scripts/hooks/governance-capture.js', run: runGovernanceCapture },
  { id: 'post:session-activity-tracker', matcher: '*', profiles: 'standard,strict', script: 'scripts/hooks/session-activity-tracker.js', run: runSessionActivityTracker },
  { id: 'post:ecc-metrics-bridge', matcher: '*', profiles: 'minimal,standard,strict', script: 'scripts/hooks/ecc-metrics-bridge.js', run: runMetricsBridge },
  { id: 'post:ecc-context-monitor', matcher: '*', profiles: 'standard,strict', script: 'scripts/hooks/ecc-context-monitor.js', run: runContextMonitor }
];

const ASYNC_HOOKS = [
  {
    id: 'post:bash:dispatcher',
    matcher: 'Bash',
    // main ran this phase unconditionally; sub-hooks gate themselves internally
    profiles: 'minimal,standard,strict',
    script: 'scripts/hooks/post-bash-dispatcher.js',
    run(raw) {
      const result = runPostBash(raw);
      return { stdout: result.output, stderr: result.stderr, exitCode: result.exitCode };
    }
  },
  { id: 'post:quality-gate', matcher: 'Edit|Write|MultiEdit', profiles: 'standard,strict', script: 'scripts/hooks/quality-gate.js', run: runQualityGate },
  { id: 'post:observe:continuous-learning', matcher: '*', profiles: 'standard,strict', script: 'scripts/hooks/observe-runner.js', run: runObserve },
  { id: 'post:skill:track', matcher: 'Skill', profiles: 'standard,strict', script: 'scripts/hooks/skill-run-tracker.js', run: runSkillRunTracker }
];

function getPluginRoot(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT || env.ECC_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
}

function matchesTool(matcher, toolName) {
  const normalizedToolName = String(toolName || '').toLowerCase();
  return (
    matcher === '*' ||
    String(matcher || '')
      .split('|')
      .map(value => value.trim())
      .filter(Boolean)
      .some(value => value.toLowerCase() === normalizedToolName)
  );
}

function isEnabled(hook, env) {
  return isHookEnabled(hook.id, {
    env,
    profiles: hook.profiles,
  });
}

function extractToolName(raw) {
  try {
    return String(JSON.parse(raw)?.tool_name || '');
  } catch {
    return '';
  }
}

function buildDryRunPreview(hook, raw) {
  let target = '';
  try {
    const input = JSON.parse(raw)?.tool_input || {};
    target = String(input.file_path || input.path || input.command || '');
  } catch {
    target = '';
  }
  const suffix = target ? ` target=${target}` : '';
  return `[DryRun] Hook "${hook.id}" would execute: ${hook.script} (enabled=true, profiles=${hook.profiles})${suffix}\n`;
}

function normalizeResult(raw, output) {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    const stdout = String(output);
    return { stdout: stdout !== raw ? stdout : '', stderr: '', exitCode: 0 };
  }
  if (!output || typeof output !== 'object') {
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  let stdout = '';
  if (Object.prototype.hasOwnProperty.call(output, 'stdout')) {
    stdout = String(output.stdout ?? '');
  } else if (Object.prototype.hasOwnProperty.call(output, 'output')) {
    stdout = String(output.output ?? '');
  } else if (Object.prototype.hasOwnProperty.call(output, 'additionalContext')) {
    stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: String(output.additionalContext ?? '')
      }
    });
  }

  return {
    stdout: stdout !== raw ? stdout : '',
    stderr: typeof output.stderr === 'string' ? output.stderr : '',
    exitCode: Number.isInteger(output.exitCode) ? output.exitCode : 0
  };
}

function appendLine(current, next) {
  if (!next) return current;
  return current + (String(next).endsWith('\n') ? String(next) : `${next}\n`);
}

function parseStructuredOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const output = parsed?.hookSpecificOutput;
    if (parsed?.decision === 'block' && typeof parsed.reason === 'string') {
      return {
        isBlocked: true,
        blockReason: parsed.reason,
        additionalContext: output?.hookEventName === 'PostToolUse'
          && typeof output.additionalContext === 'string'
          ? output.additionalContext
          : '',
      };
    }
    if (output?.hookEventName !== 'PostToolUse') return null;
    if (typeof output.additionalContext !== 'string') return null;
    return { isBlocked: false, blockReason: null, additionalContext: output.additionalContext };
  } catch {
    return null;
  }
}

function mergeBlockingOutputs(outputs, structured) {
  const blockOutputs = structured.filter(output => output?.isBlocked);
  const contexts = structured
    .filter(output => output !== null)
    .map(output => output.additionalContext)
    .filter(Boolean);
  const blocked = {
    decision: 'block',
    reason: blockOutputs.map(output => output.blockReason).join('\n\n'),
  };
  if (contexts.length > 0) {
    blocked.hookSpecificOutput = {
      hookEventName: 'PostToolUse',
      additionalContext: contexts.join('\n'),
    };
  }
  const rawOutputIds = outputs
    .filter((_output, index) => structured[index] === null)
    .map(output => output.id);
  return {
    stdout: JSON.stringify(blocked),
    warning: rawOutputIds.length > 0
      ? '[Hook] raw stdout from ' + rawOutputIds.join(', ') + ' dropped in favor of a blocking decision'
      : '',
  };
}

function mergeHookStdout(outputs) {
  if (outputs.length === 0) return { stdout: '', warning: '' };
  if (outputs.length === 1) return { stdout: outputs[0].stdout, warning: '' };

  const structured = outputs.map(output => parseStructuredOutput(output.stdout));
  const blockOutputs = structured.filter(output => output?.isBlocked);
  if (blockOutputs.length > 0) {
    return mergeBlockingOutputs(outputs, structured);
  }
  if (structured.every(output => output !== null)) {
    const contexts = structured.map(output => output.additionalContext).filter(Boolean);
    const mergedOutput = {};
    if (contexts.length > 0) {
      mergedOutput.hookSpecificOutput = {
        hookEventName: 'PostToolUse',
        additionalContext: contexts.join('\n'),
      };
    }
    return {
      stdout: JSON.stringify(mergedOutput),
      warning: ''
    };
  }

  const kept = outputs[outputs.length - 1];
  const dropped = outputs
    .slice(0, -1)
    .map(output => output.id)
    .join(', ');
  return {
    stdout: kept.stdout,
    warning: `[Hook] stdout from ${dropped} dropped in favor of ${kept.id}; raw stdout cannot be merged`
  };
}

function runHooks(raw, hooks, options = {}) {
  const env = options.env || process.env;
  const toolName = options.toolName ?? extractToolName(raw);
  const pluginRoot = getPluginRoot(env);
  const outputs = [];
  let stderr = '';
  let exitCode = 0;

  for (const hook of hooks) {
    if (!matchesTool(hook.matcher, toolName) || !isEnabled(hook, env)) continue;
    if (env.ECC_DRY_RUN === '1') {
      stderr += buildDryRunPreview(hook, raw);
      continue;
    }

    try {
      const result = normalizeResult(
        raw,
        hook.run(raw, {
          hookId: hook.id,
          pluginRoot,
          scriptPath: path.join(pluginRoot, hook.script || ''),
          cwd: options.cwd || process.cwd(),
          env,
          hookEventName: 'PostToolUse',
          toolName,
          truncated: options.truncated === true,
          maxStdin: MAX_STDIN
        })
      );
      if (result.stdout) outputs.push({ id: hook.id, stdout: result.stdout });
      stderr = appendLine(stderr, result.stderr);
      if (result.exitCode !== 0) {
        if (exitCode === 0) exitCode = result.exitCode;
        stderr = appendLine(stderr, `[Hook] ${hook.id} exited with code ${result.exitCode}; continuing`);
      }
    } catch (error) {
      stderr = appendLine(stderr, `[Hook] ${hook.id} failed: ${error.message}`);
    }
  }

  const merged = mergeHookStdout(outputs);
  if (merged.warning) stderr = appendLine(stderr, merged.warning);
  const mergedDecision = parseStructuredOutput(merged.stdout);
  // Structured blocking decisions must reach Claude on a successful command
  // hook exit. An unrelated sibling hook failure must not downgrade the block
  // into a generic non-blocking hook error.
  const finalExitCode = mergedDecision?.isBlocked ? 0 : exitCode;
  return { stdout: merged.stdout, stderr, exitCode: finalExitCode };
}

function readStdinRaw() {
  return new Promise(resolve => {
    const decoder = new StringDecoder('utf8');
    const contextDecoder = new StringDecoder('utf8');
    let raw = '';
    let bytesRead = 0;
    let truncated = false;
    let settled = false;
    const contextScanner = createHookContextScanner();
    process.stdin.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      contextScanner.push(contextDecoder.write(buffer));
      const remaining = Math.max(0, MAX_STDIN - bytesRead);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        raw += decoder.write(accepted);
        bytesRead += accepted.length;
      }
      if (buffer.length > accepted.length) truncated = true;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      contextScanner.push(contextDecoder.end());
      if (!truncated) raw += decoder.end();
      resolve({ raw, truncated, hookContext: contextScanner.context });
    };
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

function resolveMainStdout(raw, result, options = {}) {
  if (result.stdout) return result.stdout;
  if (options.truncated || result.exitCode !== 0 || !options.passthrough) return '';
  return raw;
}

async function main() {
  const mode = process.argv[2] === 'async' ? 'async' : 'sync';
  const { raw, truncated, hookContext } = await readStdinRaw();
  const dispatcherId = `post:dispatcher:${mode}`;
  const dispatcherEnabled = isEnabled(
    {
      id: dispatcherId,
      profiles: 'minimal,standard,strict'
    },
    process.env
  );
  const hooks = dispatcherEnabled ? (mode === 'async' ? ASYNC_HOOKS : SYNC_HOOKS) : [];
  const result = runHooks(raw, hooks, {
    truncated,
    ...(truncated ? { toolName: hookContext.toolName } : {}),
  });
  if (truncated) {
    process.stderr.write(`[Hook] stdin exceeded ${MAX_STDIN} bytes for PostToolUse ${mode}; suppressing pass-through\n`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  const stdout = resolveMainStdout(raw, result, {
    passthrough: process.env.ECC_POSTTOOLUSE_PASSTHROUGH === '1',
    truncated
  });
  if (stdout) process.stdout.write(stdout);
  process.exitCode = result.exitCode;
}

function cli() {
  main().catch(error => {
    process.stderr.write(`[Hook] PostToolUse dispatcher failed: ${error.message}\n`);
    process.exitCode = 0;
  });
}

if (require.main === module) cli();

module.exports = {
  ASYNC_HOOKS,
  SYNC_HOOKS,
  cli,
  matchesTool,
  main,
  mergeBlockingOutputs,
  mergeHookStdout,
  normalizeResult,
  resolveMainStdout,
  runHooks
};
