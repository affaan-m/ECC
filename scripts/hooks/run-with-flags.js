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
const { isHookEnabled, isDryRun } = require('../lib/hook-flags');
const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');

const MAX_STDIN = 1024 * 1024;

function readStdinRaw() {
  return new Promise(resolve => {
    let raw = '';
    let truncated = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < MAX_STDIN) {
        const remaining = MAX_STDIN - raw.length;
        raw += chunk.substring(0, remaining);
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated }));
  });
}

function writeStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return;
  }

  process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
}

/**
 * Write stdout fully, then exit. `process.exit()` immediately after
 * `process.stdout.write()` drops anything beyond the ~64KB pipe buffer,
 * which cut large pass-through payloads mid-JSON and made the harness
 * treat the hook as failed (#2222). The write callback fires only after
 * the chunk is flushed to the pipe.
 */
function exitWithStdout(text, exitCode) {
  if (typeof text !== 'string' || text.length === 0) {
    process.exit(exitCode);
  }
  process.stdout.write(text, () => process.exit(exitCode));
}

function resolveHookResult(raw, output) {
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
    return { stdout: exitCode === 0 ? raw : '', exitCode };
  }

  return { stdout: raw, exitCode: 0 };
}

function resolveLegacySpawnStdout(raw, result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    return stdout;
  }

  if (Number.isInteger(result.status) && result.status === 0) {
    return raw;
  }

  return '';
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

// Build the [DryRun] preview line for stderr.

function buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw) {
  const ctx = extractTargetContext(raw);
  const parts = [`[DryRun] Hook "${hookId}" would execute: ${relScriptPath}`, `(enabled=true, profiles=${profilesCsv || 'default'})`];

  if (ctx.tool) {
    parts.push(`tool=${ctx.tool}`);
  }
  if (ctx.filePath) {
    parts.push(`target=${ctx.filePath}`);
  }
  if (ctx.command) {
    parts.push(`command=${ctx.command}`);
  }

  return parts.join(' ') + '\n';
}

async function main() {
  const [, , hookId, relScriptPath, profilesCsv] = process.argv;
  const { raw, truncated } = await readStdinRaw();

  // Oversized payloads: never echo the truncated string — a JSON document
  // cut mid-stream is treated by the harness as a hook failure, blocking the
  // tool call (#2222). Empty stdout + exit 0 means "no opinion", so
  // pass-through paths fail open. The hook itself still runs and receives
  // the truncated flag (run() context / ECC_HOOK_INPUT_TRUNCATED), so
  // security hooks like config-protection can still choose to block.
  const sanitizeEcho = text => (truncated && text === raw ? '' : text);
  if (truncated) {
    process.stderr.write(`[Hook] stdin exceeded ${MAX_STDIN} bytes for ${hookId || 'unknown'}; suppressing pass-through (fail-open unless the hook blocks)\n`);
  }

  if (!hookId || !relScriptPath) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!isHookEnabled(hookId, { profiles: profilesCsv })) {
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (isDryRun()) {
    const preview = buildDryRunPreview(hookId, relScriptPath, profilesCsv, raw);
    process.stderr.write(preview);
    process.stdout.write(raw);
    process.exit(0);
  }

  const pluginRoot = getPluginRoot();
  const resolvedRoot = path.resolve(pluginRoot);
  const scriptPath = path.resolve(pluginRoot, relScriptPath);

  // Prevent path traversal outside the plugin root
  if (!scriptPath.startsWith(resolvedRoot + path.sep)) {
    process.stderr.write(`[Hook] Path traversal rejected for ${hookId}: ${scriptPath}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
    return;
  }

  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[Hook] Script not found for ${hookId}: ${scriptPath}\n`);
    exitWithStdout(sanitizeEcho(raw), 0);
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
      const output = hookModule.run(raw, {
        hookId,
        pluginRoot,
        scriptPath,
        truncated,
        maxStdin: MAX_STDIN
      });
      const result = resolveHookResult(raw, output);
      exitWithStdout(sanitizeEcho(result.stdout), result.exitCode);
    } catch (runErr) {
      process.stderr.write(`[Hook] run() error for ${hookId}: ${runErr.message}\n`);
      exitWithStdout(sanitizeEcho(raw), 0);
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

  const legacyStdout = sanitizeEcho(resolveLegacySpawnStdout(raw, result));
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
