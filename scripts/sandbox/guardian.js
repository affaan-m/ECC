'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  clearResource,
  readResources,
  readRun,
  updateState,
} = require('./session-store');
const { processGroupMembers } = require('./stream-exec');
const { withLumeStorage } = require('./vm-storage');
const { limaMissingInstance } = require('./backends/lima');

const TERMINAL_STATES = new Set(['completed', 'error', 'lease-expired', 'recovered']);
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 250;

function defaultRun(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024, ...options,
  });
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || '').trim());
  } catch {
    return null;
  }
}

function cleanupPodman(resource, session, run) {
  const identity = resource.id || resource.name;
  const rootless = run('podman', ['info', '--format', 'json']);
  if (rootless.status !== 0 || parseJson(rootless.stdout)?.host?.security?.rootless !== true) {
    return { cleaned: false, kind: 'podman', error: 'Podman cleanup endpoint is not confirmed rootless' };
  }
  const inspected = run('podman', ['inspect', identity]);
  if (inspected.status !== 0) {
    const missing = /no such container|not found|does not exist/i.test(
      `${inspected.stderr || ''}\n${inspected.stdout || ''}`
    );
    return { cleaned: missing, absent: missing, kind: 'podman' };
  }
  const parsed = parseJson(inspected.stdout);
  const details = Array.isArray(parsed) ? parsed[0] : parsed;
  const labels = details?.Config?.Labels || details?.config?.labels || {};
  if (
    (resource.id && details?.Id !== resource.id)
    ||
    labels['io.ecc.sandbox.run'] !== session.run_id
    || labels['io.ecc.sandbox.owner'] !== session.owner_token
  ) {
    return { cleaned: false, kind: 'podman', error: 'container ownership labels do not match' };
  }
  const removed = run('podman', ['rm', '--force', '--time', '0', identity]);
  return {
    cleaned: removed.status === 0,
    kind: 'podman',
    error: removed.status === 0 ? null : String(removed.stderr || removed.stdout || '').trim(),
  };
}

function cleanupLume(resource, session, run, signal) {
  let commands;
  try {
    const pinned = Object.prototype.hasOwnProperty.call(resource, 'storage_path');
    commands = [
      ['get', resource.name, '--format', 'json'],
      ['stop', resource.name],
      ['delete', resource.name, '--force'],
    ].map(argv => pinned ? withLumeStorage(argv, resource.storage_path) : argv);
  } catch {
    return { cleaned: false, kind: 'lume', error: 'VM receipt storage path is invalid; recovery requires its original storage' };
  }
  const inspected = run('lume', commands[0]);
  const launcher = resource.launcher
    ? cleanupProcess({ kind: 'process', ...resource.launcher }, session, run, signal)
    : { cleaned: true };
  const successful = result => result && !result.error && !result.signal && result.status === 0;
  const absent = result => result && !result.error && !result.signal
    && Number.isInteger(result.status) && result.status !== 0
    && /not found|does not exist|no virtual machine/i.test(`${result.stderr || ''}\n${result.stdout || ''}`);
  if (!successful(inspected)) {
    const missing = Boolean(absent(inspected));
    return {
      cleaned: missing && launcher.cleaned,
      absent: missing,
      kind: 'lume',
      error: launcher.error || (missing ? null : 'VM inspection failed'),
    };
  }
  const parsed = parseJson(inspected.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const identityMatches = entries => entries.length === 1 && entries[0]
    && [entries[0].name, entries[0].Name, entries[0].id].filter(value => value !== undefined).length > 0
    && [entries[0].name, entries[0].Name, entries[0].id].filter(value => value !== undefined).every(value => value === resource.name);
  const exact = identityMatches(values);
  if (!exact) return { cleaned: false, kind: 'lume', error: 'VM identity does not match receipt' };
  if (
    resource.guest_marker?.guestAddress
    && !values.some(value => value?.ipAddress === resource.guest_marker.guestAddress)
  ) {
    return { cleaned: false, kind: 'lume', error: 'VM guest marker does not match receipt' };
  }
  if (!launcher.cleaned) return { cleaned: false, kind: 'lume', error: launcher.error || 'Owned launcher cleanup remains unverified' };
  run('lume', commands[1]);
  const stopped = run('lume', commands[0]);
  if (absent(stopped)) return { cleaned: true, absent: true, kind: 'lume' };
  const stoppedValue = parseJson(stopped.stdout);
  const stoppedValues = Array.isArray(stoppedValue) ? stoppedValue : [stoppedValue];
  if (!successful(stopped) || !identityMatches(stoppedValues)
      || !['stopped', 'halted'].includes(String(stoppedValues[0]?.status || stoppedValues[0]?.state || '').toLowerCase())) {
    return { cleaned: false, kind: 'lume', error: 'Exact VM stopped state could not be verified; receipt retained' };
  }
  const removed = run('lume', commands[2]);
  const verifiedAbsent = successful(removed) && absent(run('lume', commands[0]));
  return {
    cleaned: Boolean(verifiedAbsent),
    kind: 'lume',
    error: verifiedAbsent ? null : 'VM deletion or absence could not be verified; receipt retained',
  };
}

const VM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function vmMissing(result) {
  return /does not exist|no instance|not found|no such virtual machine/i.test(
    `${result.stderr || ''}\n${result.stdout || ''}`
  );
}

function cleanupLima(resource, run) {
  if (!VM_NAME_PATTERN.test(String(resource.name || ''))) {
    return { cleaned: false, kind: 'lima', error: 'Lima receipt VM name is invalid' };
  }
  const inspected = run('limactl', [
    '--tty=false', 'list', resource.name, '--format', 'json',
  ]);
  if (limaMissingInstance(inspected)) return { cleaned: true, absent: true, kind: 'lima' };
  if (inspected.status !== 0) {
    return {
      cleaned: false, absent: false, kind: 'lima',
      error: 'Lima VM inspection failed',
    };
  }
  const parsed = parseJson(inspected.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const exact = values.some(value => (
    value && [value.name, value.Name].includes(resource.name)
  ));
  if (!exact) return { cleaned: false, kind: 'lima', error: 'VM identity does not match receipt' };
  run('limactl', ['--tty=false', 'stop', '--force', resource.name]);
  const removed = run('limactl', ['--tty=false', 'delete', '--force', resource.name]);
  return {
    cleaned: removed.status === 0 || vmMissing(removed),
    kind: 'lima',
    error: removed.status === 0 || vmMissing(removed)
      ? null
      : String(removed.stderr || removed.stdout || '').trim(),
  };
}

function cleanupTart(resource, run) {
  if (!VM_NAME_PATTERN.test(String(resource.name || ''))) {
    return { cleaned: false, kind: 'tart', error: 'Tart receipt VM name is invalid' };
  }
  const inspected = run('tart', ['get', resource.name, '--format', 'json']);
  if (inspected.status !== 0) {
    const missing = vmMissing(inspected);
    return {
      cleaned: missing, absent: missing, kind: 'tart',
      error: missing ? null : 'Tart VM inspection failed',
    };
  }
  const parsed = parseJson(inspected.stdout);
  if (!parsed || Array.isArray(parsed)) {
    return { cleaned: false, kind: 'tart', error: 'Tart VM identity is unreadable' };
  }
  const reportedName = parsed.name || parsed.Name;
  if (reportedName !== resource.name) {
    return { cleaned: false, kind: 'tart', error: 'VM identity does not match receipt' };
  }
  run('tart', ['stop', '--timeout', '30', resource.name]);
  const removed = run('tart', ['delete', resource.name]);
  return {
    cleaned: removed.status === 0 || vmMissing(removed),
    kind: 'tart',
    error: removed.status === 0 || vmMissing(removed)
      ? null
      : String(removed.stderr || removed.stdout || '').trim(),
  };
}

function processMatches(resource, run) {
  const inspected = run('/bin/ps', ['-p', String(resource.pid), '-o', 'lstart=', '-o', 'command=']);
  if (inspected.status !== 0) return { alive: false, matches: true };
  const line = String(inspected.stdout || '').trim();
  return {
    alive: true,
    matches: line.startsWith(`${resource.started} `) && line.endsWith(resource.command),
  };
}

function cleanupProcess(
  resource,
  _session,
  run,
  signal = process.kill.bind(process),
  sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
) {
  const initialLeader = processMatches(resource, run);
  const pgid = resource.pgid || resource.pid;
  const initialMembers = processGroupMembers(pgid, run);
  if (!Array.isArray(initialMembers)) {
    return { cleaned: false, kind: 'process', error: 'could not inspect owned process group' };
  }
  if (initialMembers.length === 0) return { cleaned: true, absent: true, kind: 'process' };
  if (initialLeader.alive && !initialLeader.matches) {
    return { cleaned: false, kind: 'process', error: 'process birth identity does not match' };
  }
  try {
    signal(-pgid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return { cleaned: true, absent: true, kind: 'process' };
    return { cleaned: false, kind: 'process', error: error.message };
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const members = processGroupMembers(pgid, run);
    if (Array.isArray(members) && members.length === 0) return { cleaned: true, kind: 'process' };
    sleep(50);
  }
  try {
    signal(-pgid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') return { cleaned: false, kind: 'process', error: error.message };
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const members = processGroupMembers(pgid, run);
    if (Array.isArray(members) && members.length === 0) return { cleaned: true, kind: 'process', forced: true };
    sleep(50);
  }
  return { cleaned: false, kind: 'process', error: 'owned process group remains alive after SIGKILL' };
}

function cleanupOwnedResource(runId, root, dependencies = {}) {
  const current = readRun(runId, root);
  const resources = readResources(runId, root);
  if (resources.length === 0) return { cleaned: true, absent: true, kinds: [] };
  if (resources.some(resource => resource.owner_token !== current.session.owner_token)) {
    return { cleaned: false, kinds: resources.map(resource => resource.kind), error: 'resource receipt ownership does not match' };
  }
  const run = dependencies.run || defaultRun;
  const results = [];
  for (const resource of [...resources].reverse()) {
    let result;
    if (resource.kind === 'podman') result = cleanupPodman(resource, current.session, run);
    else if (resource.kind === 'lume') {
      result = cleanupLume(resource, current.session, run, dependencies.signal);
    } else if (resource.kind === 'lima') {
      result = cleanupLima(resource, run);
    } else if (resource.kind === 'tart') {
      result = cleanupTart(resource, run);
    } else if (resource.kind === 'process' || resource.kind === 'lume-helper') {
      result = cleanupProcess(resource, current.session, run, dependencies.signal, dependencies.sleep);
    } else result = { cleaned: false, kind: resource.kind, error: 'unsupported resource receipt' };
    results.push(result);
    if (result.cleaned) clearResource(runId, root, current.session.owner_token, {
      kind: resource.kind, name: resource.name, pid: resource.pid,
    });
  }
  return {
    cleaned: results.every(result => result.cleaned),
    kinds: results.map(result => result.kind),
    results,
    error: results.find(result => !result.cleaned)?.error || null,
  };
}

function guardSession(runId, root, dependencies = {}) {
  const sleep = dependencies.sleep || (milliseconds => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  });
  const alive = dependencies.pidIsAlive || pidIsAlive;
  while (true) {
    const current = readRun(runId, root);
    if (alive(current.state.supervisor_pid)) {
      sleep(POLL_MS);
      continue;
    }
    sleep(500);
    const checked = readRun(runId, root);
    if (alive(checked.state.supervisor_pid)) continue;
    let cleanup = cleanupOwnedResource(runId, root, dependencies);
    for (let attempt = 0; !cleanup.cleaned && attempt < 3; attempt += 1) {
      updateState(runId, root, { cleanup_recovered: false, cleanup_error: cleanup.error });
      sleep(250 * (2 ** attempt));
      cleanup = cleanupOwnedResource(runId, root, dependencies);
    }
    updateState(runId, root, {
      status: cleanup.cleaned
        ? (TERMINAL_STATES.has(checked.state.status) ? checked.state.status : 'recovered')
        : 'error',
      cleanup_recovered: cleanup.cleaned,
      error: cleanup.cleaned ? null : cleanup.error,
      cleanup_error: cleanup.cleaned ? null : cleanup.error,
    });
    return { guarded: true, ...cleanup };
  }
}

function gcRuns(root, options = {}) {
  const now = options.now || Date.now();
  const retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
  if (!fs.existsSync(root)) return { result: 'ok', removed: [], recovered: [] };
  const removed = [];
  const recovered = [];
  for (const runId of fs.readdirSync(root).filter(name => /^run_[a-f0-9]{32}$/.test(name)).sort()) {
    let current;
    try {
      current = readRun(runId, root);
    } catch {
      continue;
    }
    if (!pidIsAlive(current.state.supervisor_pid) && readResources(runId, root).length > 0) {
      const cleanup = cleanupOwnedResource(runId, root, options);
      if (cleanup.cleaned) {
        updateState(runId, root, { status: 'recovered', cleanup_recovered: true });
        recovered.push(runId);
        current = readRun(runId, root);
      } else {
        updateState(runId, root, { cleanup_recovered: false, cleanup_error: cleanup.error });
        current = readRun(runId, root);
      }
    }
    if (
      TERMINAL_STATES.has(current.state.status)
      && readResources(runId, root).length === 0
      && now - current.session.created_ms >= retentionMs
    ) {
      fs.rmSync(current.run_directory, { recursive: true, force: true });
      removed.push(runId);
    }
  }
  return { result: 'ok', removed, recovered };
}

module.exports = {
  DEFAULT_RETENTION_MS,
  cleanupOwnedResource,
  gcRuns,
  guardSession,
  pidIsAlive,
};
