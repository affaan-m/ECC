#!/usr/bin/env node
'use strict';

/**
 * Shared cross-platform browser launcher.
 *
 * Extracted from scripts/plan-canvas.js (which had a working but error-silent
 * tri-platform branch) and scripts/control-pane.js (which had a darwin-only
 * branch that silently no-op'd on Windows/Linux). This helper:
 *
 *   1. Dispatches `open` / a fixed PowerShell launcher / `xdg-open` by platform
 *   2. Handles the child's 'error' event so a missing launcher does not cause
 *      an unhandled error after a detached spawn
 *   3. Returns a structured { opened, reason } result for the launch request.
 *      Later asynchronous errors cannot change the returned result; success
 *      does not prove a browser opened.
 *
 * The signature is intentionally small (single function, no class) so callers
 * can import without picking up the rest of scripts/lib.
 *
 * Tests live at tests/lib/platform-launch.test.js.
 */

const { spawn } = require('child_process');

const WINDOWS_BROWSER_URL = 'ECC_BROWSER_URL';
// Only this constant is encoded as PowerShell source. The validated URL is
// process-environment data, never command text or an interpolated argument.
const WINDOWS_BROWSER_SCRIPT = `$ErrorActionPreference = 'Stop'
try {
  $value = [System.Environment]::GetEnvironmentVariable('ECC_BROWSER_URL', 'Process')
  [System.Environment]::SetEnvironmentVariable('ECC_BROWSER_URL', $null, 'Process')
  $uri = $null
  if (-not [System.Uri]::TryCreate($value, [System.UriKind]::Absolute, [ref]$uri) -or @('http', 'https') -notcontains $uri.Scheme -or $uri.UserInfo) { exit 1 }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $value
  $info.UseShellExecute = $true
  [void][System.Diagnostics.Process]::Start($info)
} catch { exit 1 }
`;
const WINDOWS_BROWSER_COMMAND = Buffer.from(WINDOWS_BROWSER_SCRIPT, 'utf16le').toString('base64');

function normalizeBrowserUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.includes('\\') || !/^https?:\/\//i.test(value)) return null;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function windowsBrowserEnvironment(url, environment) {
  const entries = Object.entries(environment).filter(([key]) => key.toUpperCase() !== WINDOWS_BROWSER_URL);
  return { ...Object.fromEntries(entries), [WINDOWS_BROWSER_URL]: url };
}

/**
 * Pick the platform-appropriate opener command + args.
 * Returns [cmd, args] suitable for child_process.spawn.
 *
 * @param {NodeJS.Platform} platform
 * @param {string} url
 * @returns {[string, string[]]}
 */
function openerCommandFor(platform, url) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') {
    return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', WINDOWS_BROWSER_COMMAND]];
  }
  return ['xdg-open', [url]];
}

/**
 * Open an absolute HTTP/S URL in the default browser, dispatching per-platform.
 *
 * Returns the synchronous launch-request result. Asynchronous child errors
 * are handled, but are not an acknowledgment that a browser opened.
 *
 * @param {string} url
 * @param {NodeJS.Platform} [platform] - injectable for tests; defaults to process.platform
 * @param {typeof spawn} [spawnProcess] - injectable process launcher for tests
 * @param {NodeJS.ProcessEnv} [environment] - optional Windows child environment for tests
 * @returns {{ opened: boolean, reason: string }}
 */
function openBrowser(url, platform = process.platform, spawnProcess = spawn, environment) {
  const normalizedUrl = normalizeBrowserUrl(url);
  if (!normalizedUrl) {
    return { opened: false, reason: 'invalid-url' };
  }

  const [cmd, args] = openerCommandFor(platform, normalizedUrl);
  let child;
  try {
    child = spawnProcess(cmd, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      ...(platform === 'win32' ? {
        windowsHide: true,
        env: windowsBrowserEnvironment(normalizedUrl, environment === undefined ? process.env : environment),
      } : {}),
    });
  } catch (err) {
    return {
      opened: false,
      reason: `spawn-threw:${err && err.code ? err.code : 'unknown'}`,
    };
  }

  // Listen for ENOENT/EACCES/etc that would otherwise be silently swallowed
  // when the user has no `open` / `xdg-open` / `powershell.exe` available.
  let capturedError = null;
  child.on('error', (err) => {
    capturedError = err && err.code ? err.code : 'spawn-error';
  });

  // Best-effort: detach so we don't keep the parent alive on the launcher.
  try {
    child.unref();
  } catch {
    /* unref may throw on some platforms; safe to ignore */
  }

  if (capturedError) {
    return { opened: false, reason: `child-error:${capturedError}` };
  }
  return { opened: true, reason: 'spawned' };
}

module.exports = {
  openBrowser,
  openerCommandFor,
};
