#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureAgentDataHomeEnv } = require('../lib/agent-data-home');

const SHELL_PROBE_TIMEOUT_MS = 2000;

function readStdinRaw() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_error) {
    return '';
  }
}

function writeStderr(stderr) {
  if ((typeof stderr === 'string' || Buffer.isBuffer(stderr)) && stderr.length > 0) {
    process.stderr.write(stderr);
  }
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.alloc(0);
}

function withComparisonInput(result, comparisonInput) {
  return { ...result, comparisonInput };
}

function isRawPassthrough(raw, stdout) {
  const rawBytes = toBuffer(raw);
  const stdoutBytes = toBuffer(stdout);
  if (rawBytes.length === 0 || stdoutBytes.length === 0) return false;
  return (
    stdoutBytes.length <= rawBytes.length &&
    rawBytes.subarray(0, stdoutBytes.length).equals(stdoutBytes)
  );
}

function passthrough(result) {
  const stdout =
    typeof result?.stdout === 'string' || Buffer.isBuffer(result?.stdout)
      ? result.stdout
      : Buffer.alloc(0);
  if (stdout.length > 0) {
    // Most ECC hook scripts follow a `run(rawInput) -> rawInput` passthrough
    // pattern: they do their work, then return the original input so the hook
    // chain's tool result is preserved. The harness then writes the verbatim
    // raw input (tool_input + tool_response, often 1-275 KB) into the session
    // transcript as a hook_success attachment -- ~89% of every ECC session's
    // transcript is this bloat. Detect the passthrough and emit empty stdout
    // instead; the harness falls back to the tool_use's original result, the
    // same path #2240 established for bash-hook-dispatcher.
    //
    // IMPORTANT: a strict `stdout === raw` check misses child processes whose
    // synchronous `process.stdout.write()` is truncated before exit. Pipe
    // capacity varies by platform and Node version (observed at 8, 16, and
    // 64 KiB), so classify any non-empty byte-exact prefix of the raw hook
    // event as passthrough instead of assuming one buffer size.
    const raw = result?.comparisonInput;
    const looksLikePassthrough = isRawPassthrough(raw, stdout);
    if (looksLikePassthrough) {
      writeStderr(
        '[Hook] bootstrap: hook returned raw input as stdout; emitting empty to avoid transcript bloat\n'
      );
      return;
    }
    process.stdout.write(stdout);
    return;
  }

  if (!Number.isInteger(result?.status) || result.status === 0) {
    writeStderr('[Hook] bootstrap: hook produced no output; emitting empty stdout\n');
  }
}

function normalizePluginRootForPlatform(rootDir, platform = process.platform) {
  if (platform !== 'win32' || typeof rootDir !== 'string') {
    return rootDir;
  }

  const match = rootDir.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) {
    return rootDir;
  }

  const [, driveLetter, rest = ''] = match;
  return `${driveLetter.toUpperCase()}:/${rest}`;
}

function resolveTarget(rootDir, relPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(rootDir, relPath);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(`Path traversal rejected: ${relPath}`);
  }
  return resolvedTarget;
}

let _cachedShell = undefined;
let _cachedBash = undefined;

function isPowerShellBin(bin) {
  const base = path.basename(bin).toLowerCase();
  return base === 'pwsh.exe' || base === 'pwsh' || base === 'powershell.exe' || base === 'powershell';
}

function findShellBinary() {
  if (_cachedShell !== undefined) return _cachedShell;

  const candidates = [];

  // Explicit override always wins — check before any platform probing.
  // Warning: setting BASH to a bash binary on Windows bypasses the PowerShell
  // preference and may reintroduce bash.exe zombie accumulation.
  if (process.env.BASH && process.env.BASH.trim()) {
    candidates.push(process.env.BASH.trim());
  }

  if (process.platform === 'win32') {
    // Prefer PowerShell on Windows — it is native and does not leave zombie
    // bash.exe / conhost.exe processes the way MSYS2/Git Bash does.
    // Note: PowerShell is only suitable for .ps1 scripts; callers that need
    // to run .sh scripts (e.g. observe-runner.js) must not use this function.
    candidates.push('pwsh.exe', 'powershell.exe', 'bash.exe', 'bash');
  } else {
    candidates.push('bash', 'sh');
  }

  const psProbeArgs = ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'];
  const shProbeArgs = ['-c', ':'];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, isPowerShellBin(candidate) ? psProbeArgs : shProbeArgs, {
      stdio: 'ignore',
      windowsHide: true,
      timeout: SHELL_PROBE_TIMEOUT_MS,
    });
    // A candidate is only usable if it both spawns AND exits cleanly. The
    // Windows System32 bash.exe WSL launcher spawns without error but exits
    // non-zero when no distro is installed, so !probe.error alone is not enough.
    if (!probe.error && probe.status === 0) {
      _cachedShell = candidate;
      return _cachedShell;
    }
  }

  _cachedShell = null;
  return null;
}

function findBashBinary() {
  if (_cachedBash !== undefined) return _cachedBash;

  const candidates = [];
  if (process.env.BASH && process.env.BASH.trim() && !isPowerShellBin(process.env.BASH.trim())) {
    candidates.push(process.env.BASH.trim());
  }
  candidates.push('bash.exe', 'bash');

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', ':'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: SHELL_PROBE_TIMEOUT_MS,
    });
    // Require a clean exit, not just a successful spawn: the Windows System32
    // bash.exe WSL stub spawns fine but exits non-zero with no distro installed.
    if (!probe.error && probe.status === 0) {
      _cachedBash = candidate;
      return _cachedBash;
    }
  }

  _cachedBash = null;
  return null;
}

function spawnNode(rootDir, relPath, raw, args) {
  ensureAgentDataHomeEnv();
  const hookEnv = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: rootDir,
    ECC_PLUGIN_ROOT: rootDir,
  };
  const result = spawnSync(process.execPath, [resolveTarget(rootDir, relPath), ...args], {
    input: raw,
    env: hookEnv,
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
  return withComparisonInput(result, Buffer.from(raw, 'utf8'));
}

// spawnShell is not used by any hook in the shipped hooks.json configuration
// (all hooks use 'node' mode). It is provided for third-party plugins that
// register shell-backed hooks. Plugins should supply .ps1 scripts on Windows
// and .sh scripts on Unix; mixing them will produce a skip with a stderr warning.
function spawnShell(rootDir, relPath, raw, args) {
  const shell = findShellBinary();
  if (!shell) {
    return {
      status: 0,
      stdout: '',
      stderr: '[Hook] shell runtime unavailable; skipping shell-backed hook\n',
    };
  }

  ensureAgentDataHomeEnv();
  const hookEnv = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: rootDir,
    ECC_PLUGIN_ROOT: rootDir,
  };
  const scriptPath = resolveTarget(rootDir, relPath);
  const isPs = isPowerShellBin(shell);

  // PowerShell cannot interpret bash scripts — fall back to a bash candidate
  // rather than silently failing the hook.
  if (isPs && scriptPath.endsWith('.sh')) {
    const bash = findBashBinary();
    if (!bash) {
      return {
        status: 0,
        stdout: '',
        stderr: '[Hook] .sh script requested but no bash binary found on Windows; skipping\n',
      };
    }
    const bashResult = spawnSync(bash, [scriptPath, ...args], {
      input: raw,
      env: hookEnv,
      cwd: process.cwd(),
      timeout: 30000,
      windowsHide: true,
    });
    return withComparisonInput(bashResult, Buffer.from(raw, 'utf8'));
  }

  const shellArgs = isPs
    // -ExecutionPolicy Bypass: default Windows policy (Restricted) blocks -File
    // execution of .ps1 scripts; Bypass scopes only to this child process.
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
    : [scriptPath, ...args];

  const result = spawnSync(shell, shellArgs, {
    input: raw,
    env: hookEnv,
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
  return withComparisonInput(result, Buffer.from(raw, 'utf8'));
}

function main() {
  const [, , mode, relPath, ...args] = process.argv;
  const raw = readStdinRaw();
  const rootDir = normalizePluginRootForPlatform(
    process.env.CLAUDE_PLUGIN_ROOT || process.env.ECC_PLUGIN_ROOT
  );

  if (!mode || !relPath || !rootDir) {
    writeStderr(
      '[Hook] bootstrap: missing required args (mode/relPath/rootDir); emitting empty stdout\n'
    );
    process.exitCode = 0;
    return;
  }

  let result;
  try {
    if (mode === 'node') {
      result = spawnNode(rootDir, relPath, raw, args);
    } else if (mode === 'shell') {
      result = spawnShell(rootDir, relPath, raw, args);
    } else {
      writeStderr(`[Hook] unknown bootstrap mode: ${mode}; emitting empty stdout\n`);
      process.exitCode = 0;
      return;
    }
  } catch (error) {
    writeStderr(`[Hook] bootstrap resolution failed: ${error.message}; emitting empty stdout\n`);
    process.exitCode = 0;
    return;
  }

  passthrough(result);
  writeStderr(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `terminated by signal ${result.signal}`
        : 'missing exit status';
    writeStderr(`[Hook] bootstrap execution failed: ${reason}\n`);
    process.exitCode = 0;
    return;
  }

  process.exitCode = Number.isInteger(result.status) ? result.status : 0;
}

// Run when invoked as a hook entry. Production hooks load this via
// `node -e "...; process.argv.splice(1,0,s); require(s)"`; on Node 21+ that
// leaves require.main undefined (not this module), which previously skipped
// main() and made every plugin hook a silent no-op. Guard on both the
// direct-entry case and that eval-bootstrap case. When imported for its
// exports (tests), require.main is a real, different module, so main() stays
// dormant.
if (require.main === module || require.main === undefined) {
  main();
}

module.exports = {
  isRawPassthrough,
  main,
  normalizePluginRootForPlatform,
  withComparisonInput,
};
