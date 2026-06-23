#!/usr/bin/env node
/**
 * Desktop Notification Hook (Stop)
 *
 * Sends a native desktop notification with the task summary when Claude
 * finishes responding.  Supports:
 *   - macOS: iTerm2 native escape sequence (preferred) or osascript (fallback)
 *   - WSL: PowerShell 7 or Windows PowerShell + BurntToast module
 *
 * On macOS under iTerm2, the notification is owned by iTerm2; clicking it
 * focuses the iTerm2 tab where Claude Code runs. Outside iTerm2, falls back
 * to osascript (notification owned by Script Editor; clicks launch it).
 *
 * On WSL, if BurntToast is not installed, logs a tip for installation.
 *
 * Hook ID : stop:desktop-notify
 * Profiles: standard, strict
 */

'use strict';

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const { isMacOS, log } = require('../lib/utils');

const TITLE = 'Claude Code';
const MAX_BODY_LENGTH = 100;
const MAX_TTY_LOOKUP_DEPTH = 30;
const PS_TIMEOUT_MS = 2000;

/**
 * Memoized WSL detection at module load (avoids repeated /proc/version reads).
 */
let isWSL = false;
if (process.platform === 'linux') {
  try {
    isWSL = fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    isWSL = false;
  }
}

/**
 * Find available PowerShell executable on WSL.
 * Returns first accessible path, or null if none found.
 */
function findPowerShell() {
  if (!isWSL) return null;

  const candidates = [
    'pwsh.exe',        // WSL interop resolves from Windows PATH
    'powershell.exe',  // WSL interop for Windows PowerShell
    '/mnt/c/Program Files/PowerShell/7/pwsh.exe',      // PowerShell 7 (default install)
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', // Windows PowerShell
  ];

  for (const path of candidates) {
    try {
      const result = spawnSync(path, ['-Command', 'exit 0'],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
      if (result.status === 0) {
        return path;
      }
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Send a Windows Toast notification via PowerShell BurntToast.
 * Returns { success: boolean, reason: string|null }.
 * reason is null on success, or contains error detail on failure.
 */
function notifyWindows(pwshPath, title, body) {
  const safeBody = body.replace(/'/g, "''");
  const safeTitle = title.replace(/'/g, "''");
  const command = `Import-Module BurntToast; New-BurntToastNotification -Text '${safeTitle}', '${safeBody}'`;
  const result = spawnSync(pwshPath, ['-Command', command],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  if (result.status === 0) {
    return { success: true, reason: null };
  }
  const errorMsg = result.error ? result.error.message : result.stderr?.toString();
  return { success: false, reason: errorMsg || `exit ${result.status}` };
}

/**
 * Extract a short summary from the last assistant message.
 * Takes the first non-empty line and truncates to MAX_BODY_LENGTH chars.
 */
function extractSummary(message) {
  if (!message || typeof message !== 'string') return 'Done';

  const firstLine = message
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0);

  if (!firstLine) return 'Done';

  return firstLine.length > MAX_BODY_LENGTH
    ? `${firstLine.slice(0, MAX_BODY_LENGTH)}...`
    : firstLine;
}

/**
 * Walk up the process tree to find an ancestor attached to a real TTY.
 * Hook subprocesses are detached from a controlling terminal, but the parent
 * Claude Code process still owns the terminal emulator's tty (e.g. iTerm2 tab).
 * Returns absolute path like "/dev/ttys017", or null if none found.
 */
function findTerminalTTY() {
  let pid = process.pid;
  for (let depth = 0; depth < MAX_TTY_LOOKUP_DEPTH; depth += 1) {
    try {
      const out = execFileSync('ps', ['-o', 'ppid=,tty=', '-p', String(pid)], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: PS_TIMEOUT_MS,
      }).toString().trim();
      const m = out.match(/^\s*(\d+)\s+(\S+)\s*$/);
      if (!m) return null;
      const [, ppidStr, tty] = m;
      if (tty && !tty.startsWith('?')) {
        // `ps -o tty=` may emit either "ttys001" or the short form "s001"
        // depending on macOS version; normalize so the resulting path exists.
        const name = tty.startsWith('tty') ? tty : `tty${tty}`;
        return `/dev/${name}`;
      }
      const ppid = parseInt(ppidStr, 10);
      if (!ppid || ppid <= 1) return null;
      pid = ppid;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Detect whether the process runs under a terminal multiplexer that would
 * swallow OSC 9. tmux and screen don't pass OSC 9 through by default, so the
 * sequence written to their pty never reaches iTerm2 and the user gets no
 * notification. In that case we skip the iTerm2 fast path and let osascript
 * handle the notification instead.
 */
function isUnderMultiplexer() {
  if (process.env.TMUX) return true;
  const term = process.env.TERM || '';
  return /^screen/.test(term) || /^tmux/.test(term);
}

/**
 * Send a macOS notification.
 *
 * On terminals that support the OSC 9 notification sequence (iTerm2 and
 * Ghostty), and when not inside tmux/screen, prefers the native escape
 * sequence (ESC ] 9 ; <message> BEL) written to the parent terminal's tty.
 * This makes the terminal the notification owner, so clicking the
 * notification focuses the exact tab/window where Claude Code is running.
 * The default osascript path makes Script Editor the owner instead, which
 * causes clicks to launch Script Editor.
 *
 * Falls back to osascript when not running under an OSC 9-capable terminal,
 * when tty discovery fails, or when running inside a multiplexer that would
 * swallow OSC 9.
 * AppleScript strings do not support backslash escapes, so we replace double
 * quotes with curly quotes and strip backslashes before embedding.
 */
function notifyMacOS(title, body) {
  const osc9Capable =
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'ghostty';
  if (osc9Capable && !isUnderMultiplexer()) {
    try {
      const tty = findTerminalTTY();
      if (tty) {
        // Strip control chars (incl. ESC/BEL) to prevent escape-sequence injection.
        // eslint-disable-next-line no-control-regex
        const message = `${title}: ${body}`.replace(/[\x00-\x1f\x7f]/g, ' ');
        fs.writeFileSync(tty, `\x1b]9;${message}\x07`);
        return;
      }
    } catch (err) {
      log(`[DesktopNotify] iTerm escape failed, falling back to osascript: ${err.message}`);
    }
  }
  const safeBody = body.replace(/\\/g, '').replace(/"/g, '\u201C');
  const safeTitle = title.replace(/\\/g, '').replace(/"/g, '\u201C');
  const script = `display notification "${safeBody}" with title "${safeTitle}"`;
  const result = spawnSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 5000 });
  if (result.error || result.status !== 0) {
    log(`[DesktopNotify] osascript failed: ${result.error ? result.error.message : `exit ${result.status}`}`);
  }
}

/**
 * Fast-path entry point for run-with-flags.js (avoids extra process spawn).
 */
function run(raw) {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};
    const summary = extractSummary(input.last_assistant_message);

    if (isMacOS) {
      notifyMacOS(TITLE, summary);
    } else if (isWSL) {
      const ps = findPowerShell();
      if (ps) {
        const { success, reason } = notifyWindows(ps, TITLE, summary);
        if (success) {
          // notification sent successfully
        } else if (reason && reason.toLowerCase().includes('burnttoast')) {
          // BurntToast module not found
          log('[DesktopNotify] Tip: Install BurntToast module to enable notifications');
        } else if (reason) {
          // Other PowerShell/notification error - log for debugging
          log(`[DesktopNotify] Notification failed: ${reason}`);
        }
      } else {
        // No PowerShell found
        log('[DesktopNotify] Tip: Install BurntToast module in PowerShell for notifications');
      }
    }
  } catch (err) {
    log(`[DesktopNotify] Error: ${err.message}`);
  }

  return raw;
}

module.exports = { run };

// Legacy stdin path (when invoked directly rather than via run-with-flags)
if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  let data = '';
  let truncated = false;

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
      if (chunk.length > remaining) truncated = true;
    } else {
      truncated = true;
    }
  });
  process.stdin.on('end', () => {
    const output = run(data);
    // Never echo truncated stdin — invalid JSON on stdout is reported as a
    // Stop hook failure (#2090).
    if (truncated) {
      log('[DesktopNotify] stdin exceeded 1MB; suppressing pass-through (fail-open)');
      return;
    }
    if (output) process.stdout.write(output);
  });
}
