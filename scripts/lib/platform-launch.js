#!/usr/bin/env node
'use strict';

/**
 * Shared cross-platform browser launcher.
 *
 * Extracted from scripts/plan-canvas.js (which had a working but error-silent
 * tri-platform branch) and scripts/control-pane.js (which had a darwin-only
 * branch that silently no-op'd on Windows/Linux). This helper:
 *
 *   1. Dispatches `open` / `cmd /c start` / `xdg-open` based on process.platform
 *   2. Wires the child's 'error' event so ENOENT / EACCES propagate to the caller
 *      instead of being swallowed by detached spawns
 *   3. Returns a structured { opened, reason } result so CLI consumers can
 *      surface the truth (browser did/did not open) instead of a lying true/false
 *
 * The signature is intentionally small (single function, no class) so callers
 * can import without picking up the rest of scripts/lib.
 *
 * Tests live at tests/lib/platform-launch.test.js.
 */

const { spawn } = require('child_process');

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
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

/**
 * Open a URL in the user's default browser, dispatching per-platform.
 *
 * Always returns a structured result so callers can:
 *   - show a clear error to the agent (no silent failures)
 *   - keep JSON CLI output truthful when browsers cannot launch
 *
 * @param {string} url
 * @param {NodeJS.Platform} [platform] - injectable for tests; defaults to process.platform
 * @returns {{ opened: boolean, reason: string }}
 */
function openBrowser(url, platform = process.platform) {
  if (typeof url !== 'string' || url.length === 0) {
    return { opened: false, reason: 'invalid-url' };
  }

  const [cmd, args] = openerCommandFor(platform, url);
  let child;
  try {
    child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
  } catch (err) {
    return {
      opened: false,
      reason: `spawn-threw:${err && err.code ? err.code : 'unknown'}`,
    };
  }

  // Listen for ENOENT/EACCES/etc that would otherwise be silently swallowed
  // when the user has no `open` / `xdg-open` / `start` available.
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
