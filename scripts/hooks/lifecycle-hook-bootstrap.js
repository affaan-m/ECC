#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { normalizePluginRootForPlatform } = require('../lib/resolve-ecc-root');
const { readStdinRaw, resolveMaxStdin } = require('./hook-input');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 300000;

function writeStderr(text) {
  if (typeof text !== 'string' || text.length === 0) return;
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}

function resolveTimeout(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

function exitAfterFlush(stdout, stderr, exitCode) {
  process.exitCode = exitCode;
  let pendingWrites = 2;
  const finish = () => {
    pendingWrites -= 1;
    if (pendingWrites === 0) process.exit(exitCode);
  };

  // Empty writes still queue callbacks behind any earlier diagnostics on the
  // same stream, so both streams are drained before the explicit exit.
  process.stdout.write(stdout || '', finish);
  process.stderr.write(stderr || '', finish);
}

async function main() {
  const [, , hookId, relScriptPath, profilesCsv, timeoutValue] = process.argv;
  const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES, {
    writeDiagnostic: message => process.stderr.write(message)
  });
  const { raw, truncated } = await readStdinRaw(process.stdin, { maxStdin });

  if (!hookId || !relScriptPath) {
    writeStderr('[Hook] lifecycle bootstrap missing hook ID or script path; skipping hook');
    process.exitCode = 0;
    return;
  }

  const pluginRoot = normalizePluginRootForPlatform(
    process.env.CLAUDE_PLUGIN_ROOT || process.env.ECC_PLUGIN_ROOT
  );
  if (!pluginRoot) {
    writeStderr('[Hook] lifecycle bootstrap could not resolve ECC plugin root; skipping hook');
    process.exitCode = 0;
    return;
  }
  const resolvedRoot = path.resolve(pluginRoot);
  const runner = path.resolve(resolvedRoot, 'scripts', 'hooks', 'run-with-flags.js');
  if (!runner.startsWith(resolvedRoot + path.sep) || !fs.existsSync(runner)) {
    writeStderr('[Hook] lifecycle bootstrap could not resolve ECC plugin root; skipping hook');
    process.exitCode = 0;
    return;
  }

  if (truncated) {
    writeStderr(`[Hook] lifecycle stdin exceeded ${maxStdin} bytes; forwarded a bounded prefix`);
  }

  const result = spawnSync(
    process.execPath,
    [runner, hookId, relScriptPath, profilesCsv || 'minimal,standard,strict'],
    {
      input: raw,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: resolvedRoot,
        ECC_PLUGIN_ROOT: resolvedRoot,
        ECC_HOOK_INPUT_MAX_BYTES: String(maxStdin),
        ECC_HOOK_INPUT_TRUNCATED_UPSTREAM: truncated ? '1' : '0'
      },
      cwd: process.cwd(),
      timeout: resolveTimeout(timeoutValue),
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    }
  );

  const failed = result.error || result.status === null || result.signal;
  const stdout = !failed && typeof result.stdout === 'string' && result.stdout !== raw
    ? result.stdout
    : '';
  let stderr = typeof result.stderr === 'string' ? result.stderr : '';
  let exitCode = Number.isInteger(result.status) ? result.status : 0;

  if (failed) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `signal ${result.signal}`
        : 'missing exit status';
    stderr += `[Hook] lifecycle runner failed for ${hookId}: ${reason}\n`;
    exitCode = 1;
  }

  exitAfterFlush(stdout, stderr, exitCode);
}

function cli() {
  main().catch(error => {
    writeStderr(`[Hook] lifecycle bootstrap failed: ${error.message}`);
    process.exitCode = 0;
  });
}

if (require.main === module) cli();

module.exports = { cli, exitAfterFlush, main, resolveTimeout };
