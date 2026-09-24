#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureAgentDataHomeEnv } = require('../lib/agent-data-home');

function readStdinRaw() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_error) {
    return '';
  }
}

function writeStderr(stderr) {
  if (typeof stderr === 'string' && stderr.length > 0) {
    process.stderr.write(stderr);
  }
}

function passthrough(raw, result) {
  const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    process.stdout.write(stdout);
    return;
  }

  if (!Number.isInteger(result?.status) || result.status === 0) {
    process.stdout.write(raw);
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

function findShellBinary() {
  const candidates = [];
  if (process.env.BASH && process.env.BASH.trim()) {
    candidates.push(process.env.BASH.trim());
  }

  if (process.platform === 'win32') {
    candidates.push('bash.exe', 'bash');
  } else {
    candidates.push('bash', 'sh');
  }

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', ':'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!probe.error) {
      return candidate;
    }
  }

  return null;
}

function spawnNode(rootDir, relPath, raw, args) {
  ensureAgentDataHomeEnv();
  const hookEnv = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: rootDir,
    ECC_PLUGIN_ROOT: rootDir,
  };
  return spawnSync(process.execPath, [resolveTarget(rootDir, relPath), ...args], {
    input: raw,
    encoding: 'utf8',
    env: hookEnv,
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
}

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
  return spawnSync(shell, [resolveTarget(rootDir, relPath), ...args], {
    input: raw,
    encoding: 'utf8',
    env: hookEnv,
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
}

function main() {
  const [, , mode, relPath, ...args] = process.argv;
  const raw = readStdinRaw();
  const rootDir = normalizePluginRootForPlatform(
    process.env.CLAUDE_PLUGIN_ROOT || process.env.ECC_PLUGIN_ROOT
  );

  if (!mode || !relPath || !rootDir) {
    process.stdout.write(raw);
    process.exit(0);
  }

  let result;
  try {
    if (mode === 'node') {
      result = spawnNode(rootDir, relPath, raw, args);
    } else if (mode === 'shell') {
      result = spawnShell(rootDir, relPath, raw, args);
    } else {
      writeStderr(`[Hook] unknown bootstrap mode: ${mode}\n`);
      process.stdout.write(raw);
      process.exit(0);
    }
  } catch (error) {
    writeStderr(`[Hook] bootstrap resolution failed: ${error.message}\n`);
    process.stdout.write(raw);
    process.exit(0);
  }

  passthrough(raw, result);
  writeStderr(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `terminated by signal ${result.signal}`
        : 'missing exit status';
    writeStderr(`[Hook] bootstrap execution failed: ${reason}\n`);
    process.exit(0);
  }

  process.exit(Number.isInteger(result.status) ? result.status : 0);
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
  main,
  normalizePluginRootForPlatform,
};
