'use strict';

/**
 * Keeps a hook process from outliving the harness that started it.
 *
 * When Claude Code kills a hook that overran its timeout, it kills the
 * process it spawned. On Windows that is the bash.exe wrapper, and the
 * node.exe runner underneath survives. The runner then waits on stdin or on a
 * stdout flush that never completes, and lingers for hours or days.
 *
 * The watchdog exits the process when either:
 * - the parent that spawned it is gone (Windows: the PID no longer exists;
 *   POSIX: the process was re-parented), checked every few seconds, or
 * - a hard deadline passes. The default sits above the longest hook timeout
 *   in hooks.json (300s). An earlier ECC_HOOK_DEADLINE_MS from an upstream
 *   bootstrap takes precedence.
 *
 * Timers are unref'd, so the watchdog never keeps a finished hook alive.
 */

const DEFAULT_HARD_DEADLINE_MS = 330000;
const PARENT_POLL_MS = 2000;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

function resolveDeadline(nowMs, env = process.env) {
  const hardDeadline = nowMs + DEFAULT_HARD_DEADLINE_MS;
  const inherited = Number(env.ECC_HOOK_DEADLINE_MS);
  if (Number.isSafeInteger(inherited) && inherited > nowMs) {
    return Math.min(hardDeadline, inherited);
  }
  return hardDeadline;
}

function installHookWatchdog(options = {}) {
  const {
    label = 'hook',
    env = process.env,
    now = Date.now,
    getPpid = () => process.ppid,
    isAlive = isProcessAlive,
    exit = code => process.exit(code),
    writeStderr = message => process.stderr.write(message),
    pollMs = PARENT_POLL_MS,
    setTimer = setTimeout,
    setRepeating = setInterval,
    clearTimer = clearTimeout,
    clearRepeating = clearInterval,
  } = options;

  const startPpid = getPpid();
  let disarmed = false;
  let deadlineTimer = null;
  let parentTimer = null;

  const disarm = () => {
    disarmed = true;
    if (deadlineTimer) clearTimer(deadlineTimer);
    if (parentTimer) clearRepeating(parentTimer);
  };

  const fire = reason => {
    if (disarmed) return;
    disarm();
    try {
      writeStderr(`[Hook] watchdog: ${reason}; exiting ${label}\n`);
    } catch {
      // stderr may be the broken pipe that got us here
    }
    exit(0);
  };

  const parentGone = () => getPpid() !== startPpid || !isAlive(startPpid);

  const delay = Math.max(0, resolveDeadline(now(), env) - now());
  deadlineTimer = setTimer(() => fire(`deadline of ${delay}ms passed`), delay);
  if (deadlineTimer && typeof deadlineTimer.unref === 'function') deadlineTimer.unref();

  if (Number.isInteger(startPpid) && startPpid > 1) {
    parentTimer = setRepeating(() => {
      if (parentGone()) fire(`parent process ${startPpid} is gone`);
    }, pollMs);
    if (parentTimer && typeof parentTimer.unref === 'function') parentTimer.unref();
  }

  return disarm;
}

module.exports = {
  DEFAULT_HARD_DEADLINE_MS,
  PARENT_POLL_MS,
  installHookWatchdog,
  isProcessAlive,
  resolveDeadline,
};
