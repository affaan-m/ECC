#!/usr/bin/env node
/**
 * InsAIts Security Monitor - wrapper for run-with-flags compatibility.
 *
 * This thin wrapper receives stdin from the hooks infrastructure and
 * delegates to the Python-based insaits-security-monitor.py script.
 *
 * The wrapper exists because run-with-flags.js spawns child scripts
 * via `node`, so a JS entry point is needed to bridge to Python.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const WINDOWS_SHELL_UNSAFE_PATH_CHARS = /[&|<>^%!]/;

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    raw += chunk.substring(0, MAX_STDIN - raw.length);
  }
});

process.stdin.on('end', () => {
  if (!isEnabled(process.env.ECC_ENABLE_INSAITS)) {
    process.stdout.write(raw);
    process.exit(0);
  }

  const scriptDir = __dirname;
  const pyScript = path.join(scriptDir, 'insaits-security-monitor.py');

  // Prefer real Windows executables before .cmd shims so shell execution is
  // only used for wrapper scripts such as pyenv/npm-style shims.
  const pythonCandidates = process.platform === 'win32'
    ? ['python3.exe', 'python.exe', 'python3.cmd', 'python.cmd', 'python3', 'python']
    : ['python3', 'python'];
  let result;

  for (const pythonBin of pythonCandidates) {
    const useWindowsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(pythonBin);
    if (useWindowsShell && (
      WINDOWS_SHELL_UNSAFE_PATH_CHARS.test(pythonBin)
      || WINDOWS_SHELL_UNSAFE_PATH_CHARS.test(pyScript)
    )) {
      result = {
        error: new Error(`Unsafe Windows Python shim path: ${pythonBin}`),
      };
      break;
    }

    result = spawnSync(pythonBin, [pyScript], {
      input: raw,
      encoding: 'utf8',
      env: process.env,
      cwd: process.cwd(),
      timeout: 14000,
      shell: useWindowsShell,
      windowsHide: true,
    });

    // ENOENT means binary not found - try next candidate
    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }
    break;
  }

  if (!result || (result.error && result.error.code === 'ENOENT')) {
    process.stderr.write('[InsAIts] python3/python not found. Install Python 3.9+ and: pip install insa-its\n');
    process.stdout.write(raw);
    process.exit(0);
  }

  // Log non-ENOENT spawn errors (timeout, signal kill, etc.) so users
  // know the security monitor did not run - fail-open with a warning.
  if (result.error) {
    process.stderr.write(`[InsAIts] Security monitor failed to run: ${result.error.message}\n`);
    process.stdout.write(raw);
    process.exit(0);
  }

  // result.status is null when the process was killed by a signal or
  // timed out.  Check BEFORE writing stdout to avoid leaking partial
  // or corrupt monitor output.  Pass through original raw input instead.
  if (!Number.isInteger(result.status)) {
    const signal = result.signal || 'unknown';
    process.stderr.write(`[InsAIts] Security monitor killed (signal: ${signal}). Tool execution continues.\n`);
    process.stdout.write(raw);
    process.exit(0);
  }

  // The monitor only uses 0 (pass) and 2 (block). Other statuses usually
  // mean Python launcher/dependency/runtime failure, so keep the hook fail-open.
  if (result.status !== 0 && result.status !== 2) {
    const detail = (result.stderr || result.stdout || '').trim();
    const suffix = detail ? `: ${detail}` : '';
    process.stderr.write(`[InsAIts] Security monitor exited with status ${result.status}${suffix}\n`);
    process.stdout.write(raw);
    process.exit(0);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  } else if (result.status === 0) {
    process.stdout.write(raw);
  }
  if (result.stderr) process.stderr.write(result.stderr);

  process.exit(result.status);
});
