#!/usr/bin/env node
/**
 * Executes a hook script only when enabled by ECC hook profile flags.
 *
 * Usage:
 *   node run-with-flags.js <hookId> <scriptRelativePath> [profilesCsv]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { isHookEnabled, isDryRun } = require('../lib/hook-flags');
const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');

const DEFAULT_MAX_STDIN = 1024 * 1024;

function resolveMaxStdin(value) {
  if (value === undefined) return DEFAULT_MAX_STDIN;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    process.stderr.write(
      '[Hook] ECC_HOOK_INPUT_MAX_BYTES must be a positive safe integer; using the 1 MiB default\n'
    );
    return DEFAULT_MAX_STDIN;
  }
  if (parsed > DEFAULT_MAX_STDIN) {
    process.stderr.write(
      '[Hook] ECC_HOOK_INPUT_MAX_BYTES exceeds the 1 MiB safety maximum; clamping to 1 MiB\n'
    );
    return DEFAULT_MAX_STDIN;
  }
  return parsed;
}

const MAX_STDIN = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES);

function readStdinRaw() {
  return new Promise(resolve => {
    const decoder = new StringDecoder('utf8');
    let raw = '';
    let acceptedBytes = 0;
    let finished = false;
    let truncated = false;
    process.stdin.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_STDIN - acceptedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }

      const accepted = buffer.subarray(0, remaining);
      acceptedBytes += accepted.length;
      raw += decoder.write(accepted);
      if (accepted.length < buffer.length) truncated = true;
    });
    const finish = () => {
      if (finished) return;
      finished = true;
      const finalText = decoder.end();
      if (!truncated) raw += finalText;
      resolve({ raw, truncated });
    };
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

function writeStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return;
  }

  process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
}

/**
 * Exit only after stdout and any previously queued stderr have drained.
 * `process.exit()` immediately after a stream write drops anything beyond
 * the OS pipe buffer, which cut large hook output mid-payload and made the
 * harness treat the hook as failed (#2222).
 */
function exitWithStdout(text, exitCode) {
  process.exitCode = exitCode;
  let pendingWrites = 1;
  const exitWhenFlushed = () => {
    pendingWrites -= 1;
    if (pendingWrites === 0) {
      process.exit(exitCode);
    }
  };

  if (typeof text === 'string' && text.length > 0) {
    pendingWrites += 1;
    process.stdout.write(text, exitWhenFlushed);
  }
  process.stderr.write('', exitWhenFlushed);
}

function resolveHookResult(output) {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    return { stdout: String(output), exitCode: 0 };
  }

  if (output && typeof output === 'object') {
    writeStderr(output.stderr);
    const exitCode = Number.isInteger(output.exitCode) ? output.exitCode : 0;

    if (Object.prototype.hasOwnProperty.call(output, 'additionalContext')) {
      return { stdout: buildPreToolUseAdditionalContext(output.additionalContext), exitCode };
    }
    if (Object.prototype.hasOwnProperty.call(output, 'stdout')) {
      return { stdout: String(output.stdout ?? ''), exitCode };
    }
    return { stdout: '', exitCode };
  }

  return { stdout: '', exitCode: 0 };
}

function resolveLegacySpawnStdout(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  return stdout || '';
}

function getPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

//Safely extract target context from hook stdin JSON for dry-run preview.

function extractTargetContext(raw) {
  const result = { tool: '', filePath: '', command: '' };
  if (!raw || typeof raw !== 'string') return result;

  try {
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object') {
      result.tool = String(payload.tool || '');
      const input = payload.tool_input;
      if (input && typeof input === 'object') {
        result.filePath = String(input.file_path || input.path || '');
        result.command = String(input.command || '');
      }
    }
  } catch {
    // best-effort field extraction; ignore malformed input
  }
  return result;
}

function escapeDiagnostic(value, maxLength = 160) {
  const escapedTokens = Array.from(String(value), character => {
    const codePoint = character.codePointAt(0);
    if (codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f)) {
      return character;
    }
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    return `\\x${codePoint.toString(16).padStart(2, '0')}`;
  });

  let escaped = '';
  for (const token of escapedTokens) {
    if (escaped.length + token.length > maxLength) {
      return `${escaped}...`;
    }
    escaped += token;
  }
  return escaped;
}

// Build the [DryRun] preview line for stderr.

function buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw) {
  const ctx = extractTargetContext(raw);
  const parts = [
    `[DryRun] Hook "${escapeDiagnostic(hookId)}" would execute: ${escapeDiagnostic(relScriptPath)}`,
    `(enabled=true, profiles=${escapeDiagnostic(profilesCsv || 'default')})`
  ];

  if (ctx.tool) {
    parts.push(`tool=${escapeDiagnostic(ctx.tool, 64)}`);
  }
  if (ctx.filePath) {
    parts.push('target=[redacted]');
  }
  if (ctx.command) {
    parts.push('command=[redacted]');
  }

  return parts.join(' ') + '\n';
}

async function main() {
  const [, , hookId, relScriptPath, profilesCsv] = process.argv;
  const { raw, truncated } = await readStdinRaw();

  // Oversized payloads: never echo the truncated string — a JSON document
  // cut mid-stream is treated by the harness as a hook failure, blocking the
  // tool call (#2222). Empty stdout + exit 0 means "no opinion", so
  // silent paths fail open. The hook itself still runs and receives
  // the truncated flag (run() context / ECC_HOOK_INPUT_TRUNCATED), so
  // security hooks like config-protection can still choose to block.
  const sanitizeEcho = text => (truncated && text === raw ? '' : text);
  if (truncated) {
    process.stderr.write(`[Hook] stdin exceeded ${MAX_STDIN} bytes for ${hookId || 'unknown'}; suppressing pass-through (fail-open unless the hook blocks)\n`);
  }

  if (!hookId || !relScriptPath) {
    exitWithStdout('', 0);
    return;
  }

  if (!isHookEnabled(hookId, { profiles: profilesCsv })) {
    exitWithStdout('', 0);
    return;
  }

  if (isDryRun()) {
    const preview = buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw);
    process.stderr.write(preview);
    exitWithStdout('', 0);
    return;
  }

  const pluginRoot = getPluginRoot();
  const resolvedRoot = path.resolve(pluginRoot);
  const scriptPath = path.resolve(pluginRoot, relScriptPath);

  // Prevent path traversal outside the plugin root
  if (!scriptPath.startsWith(resolvedRoot + path.sep)) {
    process.stderr.write(`[Hook] Path traversal rejected for ${hookId}: ${scriptPath}\n`);
    exitWithStdout('', 0);
    return;
  }

  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[Hook] Script not found for ${hookId}: ${scriptPath}\n`);
    exitWithStdout('', 0);
    return;
  }

  // Prefer direct require() when the hook exports a run(rawInput) function.
  // This eliminates one Node.js process spawn (~50-100ms savings per hook).
  //
  // SAFETY: Only require() hooks that export run(). Legacy hooks execute
  // side effects at module scope (stdin listeners, process.exit, main() calls)
  // which would interfere with the parent process or cause double execution.
  let hookModule;
  const src = fs.readFileSync(scriptPath, 'utf8');
  const hasRunExport = /\bmodule\.exports\b/.test(src) && /\brun\b/.test(src);

  if (hasRunExport) {
    try {
      hookModule = require(scriptPath);
    } catch (requireErr) {
      process.stderr.write(`[Hook] require() failed for ${hookId}: ${requireErr.message}\n`);
      // Fall through to legacy spawnSync path
    }
  }

  if (hookModule && typeof hookModule.run === 'function') {
    try {
      // Awaited so a hook may export `async run()`. Without this an async hook
      // hands back a pending Promise, which resolveHookResult reads as "no
      // opinion" and silently degrades to pass-through. Synchronous hooks are
      // unaffected: awaiting a plain value just costs a microtask.
      const output = await hookModule.run(raw, {
        hookId,
        pluginRoot,
        scriptPath,
        truncated,
        maxStdin: MAX_STDIN
      });
      const result = resolveHookResult(output);
      exitWithStdout(sanitizeEcho(result.stdout), result.exitCode);
    } catch (runErr) {
      process.stderr.write(`[Hook] run() error for ${hookId}: ${runErr.message}\n`);
      exitWithStdout('', 0);
    }
    return;
  }

  // Legacy path: spawn a child Node process for hooks without run() export
  const result = spawnSync(process.execPath, [scriptPath], {
    input: raw,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ECC_PLUGIN_ROOT: pluginRoot,
      ECC_HOOK_ID: hookId,
      ECC_HOOK_INPUT_TRUNCATED: truncated ? '1' : '0',
      ECC_HOOK_INPUT_MAX_BYTES: String(MAX_STDIN)
    },
    cwd: process.cwd(),
    timeout: 30000
  });

  const legacyStdout = sanitizeEcho(resolveLegacySpawnStdout(result));
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const failureDetail = result.error ? result.error.message : result.signal ? `terminated by signal ${result.signal}` : 'missing exit status';
    writeStderr(`[Hook] legacy hook execution failed for ${hookId}: ${failureDetail}`);
    exitWithStdout(legacyStdout, 1);
    return;
  }

  exitWithStdout(legacyStdout, Number.isInteger(result.status) ? result.status : 0);
}

main().catch(err => {
  process.stderr.write(`[Hook] run-with-flags error: ${err.message}\n`);
  process.exit(0);
});
