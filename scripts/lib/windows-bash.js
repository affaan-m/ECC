'use strict';

/**
 * Resolve bash on Windows without landing on a WSL launcher.
 *
 * %SystemRoot%\System32\bash.exe and the %LOCALAPPDATA%\Microsoft\WindowsApps
 * alias start a WSL distro. With a distro installed they pass a `bash -c :`
 * probe, then cannot open a hook script named by a Windows (C:\...) or Git
 * Bash (/c/...) path, so the hook fails (exit 127) instead of being skipped.
 * Spawning a bare `bash.exe` takes the first match on PATH, and System32 is
 * normally ahead of Git's bin directory.
 *
 * Tests live at tests/lib/windows-bash.test.js.
 */

const fs = require('fs');
const path = require('path');

const WSL_LAUNCHER_SYSTEM_DIRS = ['System32', 'SysWOW64', 'Sysnative'];

// Windows environment names are case-insensitive; a plain env object is not.
function readEnv(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function normalizeDir(dir) {
  return path.resolve(dir).replace(/[\\/]+$/, '').toLowerCase();
}

function wslLauncherDirs(env) {
  const systemRoot = readEnv(env, 'SystemRoot') || readEnv(env, 'windir') || 'C:\\Windows';
  const dirs = WSL_LAUNCHER_SYSTEM_DIRS.map(name => path.join(systemRoot, name));
  const localAppData = readEnv(env, 'LOCALAPPDATA');
  if (localAppData) dirs.push(path.join(localAppData, 'Microsoft', 'WindowsApps'));
  return new Set(dirs.map(normalizeDir));
}

/**
 * True when filePath is a bash.exe that starts WSL rather than a native bash.
 */
function isWslBashLauncher(filePath, env = process.env) {
  return path.basename(filePath).toLowerCase() === 'bash.exe'
    && wslLauncherDirs(env).has(normalizeDir(path.dirname(filePath)));
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Absolute paths of `names` found on PATH, minus WSL bash launchers.
 *
 * Earlier names win over later ones, then PATH order decides, so `bash` is
 * preferred to `sh` wherever each sits. A name without an extension matches
 * .com/.exe, as a bare spawn would. Off Windows the names are returned as
 * given, leaving lookup to the platform.
 */
function resolveWindowsBashCandidates(names, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return [...names];

  const dirs = String(readEnv(env, 'PATH') || '').split(';').filter(Boolean);
  const found = [];
  const seen = new Set();
  for (const name of names) {
    const fileNames = path.extname(name) ? [name] : [`${name}.com`, `${name}.exe`];
    for (const dir of dirs) {
      for (const fileName of fileNames) {
        const candidate = path.join(dir, fileName);
        const key = candidate.toLowerCase();
        if (seen.has(key) || !isFile(candidate) || isWslBashLauncher(candidate, env)) continue;
        seen.add(key);
        found.push(candidate);
      }
    }
  }
  return found;
}

module.exports = { isWslBashLauncher, resolveWindowsBashCandidates };
