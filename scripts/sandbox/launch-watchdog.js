'use strict';

const { spawn } = require('child_process');
const {
  readRun,
  transitionStateWithEvent,
} = require('./session-store');
const { filteredSupervisorEnvironment } = require('./visible-terminal');

const LAUNCH_CHECK_IN_TIMEOUT_MS = 15_000;
const POLL_MS = 100;
const LAUNCH_TIMEOUT_ERROR = 'Visible terminal did not check in within 15 seconds';

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function watchLaunch(runId, root, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const wait = dependencies.sleep || sleep;
  const timeoutMs = dependencies.timeoutMs ?? LAUNCH_CHECK_IN_TIMEOUT_MS;
  const started = now();
  while (now() - started < timeoutMs) {
    const status = readRun(runId, root).state.status;
    if (status !== 'launching') return { result: 'checked-in', status };
    wait(Math.min(POLL_MS, timeoutMs));
  }
  const transition = transitionStateWithEvent(
    runId,
    root,
    'launching',
    {
      status: 'error',
      result: 'error',
      exit_code: 2,
      error: LAUNCH_TIMEOUT_ERROR,
      launch_watchdog_pid: null,
    },
    {
      type: 'exploration.launch.failed',
      phase: 'exploration',
      error: LAUNCH_TIMEOUT_ERROR,
      timeout_ms: timeoutMs,
    }
  );
  if (!transition.updated) {
    return { result: 'checked-in', status: transition.state.status };
  }
  return { result: 'launch-timeout', status: 'error' };
}

function startLaunchWatchdog(runId, root, context, dependencies = {}) {
  const current = readRun(runId, root);
  const spawnImpl = dependencies.spawn || spawn;
  const watchdog = spawnImpl(process.execPath, [
    context.cliPath, '_watch-launch', runId, '--state-root', root,
  ], {
    cwd: current.session.workspace_path,
    detached: true,
    shell: false,
    stdio: 'ignore',
    env: filteredSupervisorEnvironment(dependencies.environment || process.env),
  });
  watchdog.once?.('error', () => {});
  watchdog.unref?.();
  return watchdog;
}

module.exports = {
  LAUNCH_CHECK_IN_TIMEOUT_MS,
  LAUNCH_TIMEOUT_ERROR,
  startLaunchWatchdog,
  watchLaunch,
};
