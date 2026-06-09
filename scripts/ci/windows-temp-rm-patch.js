'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const childProcess = require('child_process');

const originalRmSync = fs.rmSync.bind(fs);
const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
const originalExecFileSync = childProcess.execFileSync.bind(childProcess);
const root = path.join(__dirname, '..', '..');
const bashShim = path.join(root, 'scripts', 'shims', 'bash-shim.js');
const tmpRoot = path.resolve(process.env.TEMP || process.env.TMP || process.env.TMPDIR || os.tmpdir());

process.env.ECC_TEMP_RM_PATCH_LOADED = '1';

function sleepMs(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function isRetryable(error) {
  return error && (error.code === 'EPERM' || error.code === 'EBUSY');
}

function isUnderTempRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`);
}

function removeWithPowerShell(targetPath) {
  const literal = String(targetPath).replace(/'/g, "''");
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Remove-Item -LiteralPath '${literal}' -Recurse -Force -ErrorAction SilentlyContinue`
  ], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
}

function toBufferOrString(stdout, encoding) {
  if (encoding && encoding !== 'buffer') {
    return stdout;
  }

  return Buffer.from(stdout || '', 'utf8');
}

function buildBashResult(result, encoding) {
  return {
    status: result.status,
    signal: result.signal,
    stdout: toBufferOrString(result.stdout, encoding),
    stderr: toBufferOrString(result.stderr, encoding),
  };
}

function runBashShim(args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  env.BASH_SHIM_ARGS_JSON = JSON.stringify(args || []);
  const result = originalSpawnSync(process.execPath, [bashShim], {
    cwd: options.cwd,
    input: options.input,
    env,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer,
    shell: false,
  });

  if (result.error) {
    return buildBashResult(result, options.encoding);
  }

  return buildBashResult(result, options.encoding);
}

childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
  if (command === 'bash') {
    return runBashShim(args, options);
  }

  return originalSpawnSync(command, args, options);
};

childProcess.execFileSync = function patchedExecFileSync(command, args, options = {}) {
  if (command === 'bash') {
    const result = runBashShim(args, options);
    if (result.status !== 0) {
      const error = new Error(`Command failed: bash ${(args || []).join(' ')}`);
      error.status = result.status;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }

    return toBufferOrString(result.stdout, options.encoding);
  }

  return originalExecFileSync(command, args, options);
};

fs.rmSync = function patchedRmSync(targetPath, options) {
  try {
    return originalRmSync(targetPath, options);
  } catch (error) {
    if (!isUnderTempRoot(targetPath) || !isRetryable(error)) {
      throw error;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      sleepMs(150);
      try {
        return originalRmSync(targetPath, options);
      } catch (retryError) {
        if (!isRetryable(retryError)) {
          throw retryError;
        }
      }
    }

    removeWithPowerShell(targetPath);
    try {
      return originalRmSync(targetPath, options);
    } catch (finalError) {
      if (isRetryable(finalError)) {
        return;
      }
      throw finalError;
    }
  }
};
