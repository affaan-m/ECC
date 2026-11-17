/**
 * Keep tests independent of tools installed on a Windows developer machine.
 *
 * Linux CI never sees these leaks, so they surface only as local failures.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// On Windows, spawning a bare `claude` resolves only .com/.exe on PATH, never
// .cmd. A natively installed claude.exe therefore wins over a test's fake
// claude.cmd even when the fake's directory comes first on PATH.
const SHADOWING_CLAUDE_BINARIES = ['claude.com', 'claude.exe'];

/**
 * Drop PATH entries holding a real Claude binary that would shadow a fake
 * `claude.cmd` launcher. A no-op off Windows, where PATH order is honoured.
 */
function withoutShadowingClaude(pathValue, platform = process.platform) {
  if (platform !== 'win32') return pathValue || '';
  return String(pathValue || '')
    .split(path.win32.delimiter)
    .filter(dir => dir && !SHADOWING_CLAUDE_BINARIES.some(name => fs.existsSync(path.join(dir, name))))
    .join(path.win32.delimiter);
}

/**
 * Name an archive relative to the directory tar runs in, with forward slashes.
 * GNU tar, which Git for Windows puts first on PATH, reads an archive argument
 * containing a colon (C:\...) as a host:path remote spec; bsdtar does not.
 */
function toRelativeTarPath(cwd, archivePath) {
  return path.relative(cwd, archivePath).split(path.sep).join('/');
}

// On Windows, `python3` is usually the Microsoft Store alias stub, which exits
// 9009 instead of running Python; python.org installs provide `python` and the
// `py` launcher instead.
const PYTHON_CANDIDATES = Object.freeze({
  win32: [['python'], ['py', '-3'], ['python3']],
  default: [['python3'], ['python']]
});
const PYTHON3_CHECK = 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)';

function runsPython3(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 15000 }).status === 0;
}

/**
 * The first candidate that actually runs Python 3, as `{ command, prefix }`
 * (spawn `command` with `[...prefix, script]`), or null when none does.
 */
function resolvePython({ platform = process.platform, probe = runsPython3 } = {}) {
  const candidates = platform === 'win32' ? PYTHON_CANDIDATES.win32 : PYTHON_CANDIDATES.default;
  for (const [command, ...prefix] of candidates) {
    if (probe(command, [...prefix, '-c', PYTHON3_CHECK])) return { command, prefix };
  }
  return null;
}

module.exports = { withoutShadowingClaude, toRelativeTarPath, resolvePython };
