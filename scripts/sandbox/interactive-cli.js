'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  createInteractiveLaunch,
  parseLaunchArgs,
} = require('./interactive-launch');
const {
  appendEvent,
  defaultStateRoot,
  readEventsSince,
  readResources,
  readRun,
  transitionState,
  updateState,
} = require('./session-store');
const { runExploration } = require('./exploration');
const { cleanupOwnedResource, gcRuns, guardSession } = require('./guardian');
const { watchLaunch } = require('./launch-watchdog');
const { filteredSupervisorEnvironment } = require('./visible-terminal');

const PUBLIC_COMMANDS = new Set(['launch', 'runs', 'status', 'listen', 'stop', 'gc']);
const INTERNAL_COMMANDS = new Set(['_explore', '_guard', '_watch-launch']);
const TERMINAL_STATES = new Set(['completed', 'error', 'lease-expired', 'recovered']);
const POLL_MS = 100;

function handles(command) {
  return PUBLIC_COMMANDS.has(command) || INTERNAL_COMMANDS.has(command);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return value;
}

function parseRunReference(args, command) {
  if (!args[0]) throw new Error(`${command} requires a run ID`);
  let root = defaultStateRoot();
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '--state-root') {
      root = path.resolve(valueAfter(args, index, '--state-root'));
      index += 1;
    } else if (command === 'listen' && args[index] === '--follow') {
      continue;
    } else if (command === 'listen' && args[index] === '--format') {
      if (valueAfter(args, index, '--format') !== 'jsonl') {
        throw new Error('listen supports only --format jsonl');
      }
      index += 1;
    } else {
      throw new Error(`Unknown ${command} argument: ${args[index]}`);
    }
  }
  return { runId: args[0], root };
}

function parseCollectionArgs(args, command) {
  let root = defaultStateRoot();
  let active = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--state-root') {
      root = path.resolve(valueAfter(args, index, '--state-root'));
      index += 1;
    } else if (command === 'runs' && args[index] === '--active') {
      active = true;
    } else {
      throw new Error(`Unknown ${command} argument: ${args[index]}`);
    }
  }
  return { root, active };
}

function listRuns(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(name => /^run_[a-f0-9]{32}$/.test(name))
    .flatMap(runId => {
      try {
        const current = readRun(runId, root);
        return [{ run_id: runId, ...current.state, route: current.session.route }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function streamEvents(runId, root, follow) {
  let journalOffset = 0;
  while (true) {
    const batch = readEventsSince(runId, root, journalOffset);
    journalOffset = batch.offset;
    for (const event of batch.events) process.stdout.write(`${JSON.stringify(event)}\n`);
    const state = readRun(runId, root).state;
    if (!follow || TERMINAL_STATES.has(state.status)) return 0;
    sleep(POLL_MS);
  }
}

function exploreFromSession(runId, root, context, dependencies = {}) {
  const current = readRun(runId, root);
  if (!current.session.exploration || current.session.route.backend !== 'podman') {
    throw new Error('internal exploration requires a Tier 1 Podman exploration session');
  }
  const checkedIn = transitionState(runId, root, 'launching', {
    status: 'exploring', supervisor_pid: process.pid, launch_watchdog_pid: null,
  });
  if (!checkedIn.updated) {
    throw new Error(`exploration is no longer awaiting terminal check-in (${checkedIn.state.status})`);
  }
  appendEvent(runId, root, { type: 'exploration.started', phase: 'exploration' });
  const spawnImpl = dependencies.spawn || spawn;
  const guardian = spawnImpl(process.execPath, [
    context.cliPath, '_guard', runId, '--state-root', root,
  ], {
    cwd: current.session.workspace_path,
    detached: true,
    shell: false,
    stdio: 'ignore',
    env: filteredSupervisorEnvironment(),
  });
  guardian.once?.('error', () => {});
  guardian.unref?.();
  updateState(runId, root, { guardian_pid: guardian.pid || null });
  try {
    const outcome = runExploration(runId, root, dependencies);
    const clean = readResources(runId, root).length === 0;
    appendEvent(runId, root, {
      type: 'exploration.completed',
      phase: 'exploration',
      exit: outcome.exitCode,
      cleanup_pass: clean,
    });
    updateState(runId, root, {
      status: clean ? 'completed' : 'error',
      result: outcome.exitCode === 0 && clean ? 'pass' : 'error',
      exit_code: outcome.exitCode,
      error: clean ? null : 'exploration cleanup left owned resources for the guardian',
    });
    return outcome.exitCode;
  } catch (error) {
    appendEvent(runId, root, {
      type: 'exploration.failed', phase: 'exploration', text: error.message,
    });
    updateState(runId, root, { status: 'error', error: error.message, exit_code: 2 });
    throw error;
  }
}

function stopSession(runId, root, dependencies = {}) {
  const cleanup = cleanupOwnedResource(runId, root, dependencies);
  appendEvent(runId, root, {
    type: 'exploration.stopped', phase: 'cleanup', cleanup_pass: cleanup.cleaned,
  });
  updateState(runId, root, {
    status: cleanup.cleaned ? 'completed' : 'error',
    result: cleanup.cleaned ? 'stopped' : 'error',
    exit_code: cleanup.cleaned ? 130 : 2,
    error: cleanup.cleaned ? null : cleanup.error,
  });
  return { result: cleanup.cleaned ? 'stopped' : 'error', run_id: runId, cleanup };
}

function runCommand(command, args, context) {
  if (command === 'launch') {
    context.writeJson(createInteractiveLaunch(parseLaunchArgs(args), context));
    return 0;
  }
  if (command === 'runs' || command === 'gc') {
    const options = parseCollectionArgs(args, command);
    if (command === 'gc') {
      context.writeJson(gcRuns(options.root));
      return 0;
    }
    const runs = listRuns(options.root)
      .filter(run => !options.active || !TERMINAL_STATES.has(run.status));
    context.writeJson({ runs });
    return 0;
  }
  const reference = parseRunReference(args, command);
  if (command === '_explore') return exploreFromSession(reference.runId, reference.root, context);
  if (command === '_guard') {
    guardSession(reference.runId, reference.root);
    return 0;
  }
  if (command === '_watch-launch') {
    const outcome = watchLaunch(reference.runId, reference.root);
    return outcome.result === 'launch-timeout' ? 2 : 0;
  }
  if (command === 'status') {
    context.writeJson(readRun(reference.runId, reference.root).state);
    return 0;
  }
  if (command === 'listen') return streamEvents(
    reference.runId, reference.root, args.includes('--follow')
  );
  context.writeJson(stopSession(reference.runId, reference.root));
  return 0;
}

module.exports = {
  PUBLIC_COMMANDS,
  handles,
  exploreFromSession,
  listRuns,
  parseCollectionArgs,
  parseRunReference,
  runCommand,
  stopSession,
  streamEvents,
};
