'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_PROCESS_LIMIT = 256;
const DEFAULT_OUTPUT_LIMIT = 16 * 1024 * 1024;
const DEFAULT_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5_000;

function memoryBytes(memory) {
  const match = String(memory).match(/^([1-9][0-9]*)(MB|GB)$/);
  if (!match) throw new Error('Resource monitoring requires canonical manifest memory');
  return Number(match[1]) * (match[2] === 'GB' ? 1024 ** 3 : 1024 ** 2);
}

function directoryBytes(root, state = { entries: 0 }) {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    state.entries += 1;
    if (state.entries > 100_000) throw new Error('Resource storage telemetry exceeded its entry bound');
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += directoryBytes(candidate, state);
    else if (entry.isFile()) total += fs.lstatSync(candidate).size;
  }
  return total;
}

function controlsFor(backend, hasSampler) {
  const backendLimits = ['podman', 'microsandbox', 'lume', 'lima', 'tart'].includes(backend);
  const local = !['ci', 'ci-native'].includes(backend);
  return {
    cpu: backendLimits ? 'hard-limit' : (hasSampler ? 'monitored' : 'unavailable'),
    memory: backendLimits ? 'hard-limit' : (hasSampler ? 'monitored' : 'unavailable'),
    processes: hasSampler ? 'monitored' : 'unavailable',
    storage: 'monitored',
    output: 'hard-limit',
    runtime: 'hard-limit',
    spend: local ? 'local-zero' : (hasSampler ? 'monitored' : 'unavailable'),
  };
}

function resourceLimits(manifest) {
  return {
    cpu_cores: manifest.resources.cpu,
    memory_bytes: memoryBytes(manifest.resources.memory),
    processes: DEFAULT_PROCESS_LIMIT,
    storage_growth_bytes: DEFAULT_STORAGE_LIMIT,
    output_bytes: DEFAULT_OUTPUT_LIMIT,
    runtime_ms: manifest.resources.timeout * 1_000,
    spend: { amount: 0, currency: 'USD' },
  };
}

function stopError(reason) {
  const error = new Error(`Fabric resource policy stopped execution: ${reason}`);
  error.name = 'FabricResourceLimitError';
  error.code = 'FABRIC_RESOURCE_LIMIT_EXCEEDED';
  return error;
}

function valueOrNull(value, integer = false) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (integer && !Number.isSafeInteger(value)) return null;
  return value;
}

function outputBytes(report) {
  if (!report) return null;
  return (report.steps || []).reduce((total, step) => (
    total + Buffer.byteLength(step.stdout_tail || '') + Buffer.byteLength(step.stderr_tail || '')
  ), 0);
}

function createResourceMonitor(options) {
  const startedMs = options.now ? options.now() : Date.now();
  const now = options.now || Date.now;
  const limits = resourceLimits(options.manifest);
  const intervalMs = Math.max(
    50,
    Math.ceil(limits.runtime_ms / 9_998),
    Math.min(60_000, options.intervalMs || DEFAULT_SAMPLE_INTERVAL_MS)
  );
  const hasSampler = typeof options.sampler === 'function';
  const controls = controlsFor(options.backend, hasSampler);
  const samples = [];
  const warnings = new Set();
  let initialBytes = null;
  try {
    initialBytes = directoryBytes(options.workspacePath);
  } catch {
    warnings.add('controller workspace storage telemetry is unavailable');
  }
  let timer = null;
  let stopped = false;
  let sampling = null;
  let stopReason = null;
  let completedReceipt = null;

  async function performSample(phase, report = null) {
    if (stopped && phase === 'interval') return null;
    const recordedMs = now();
    let observed = {};
    let samplerFailed = false;
    try {
      observed = hasSampler ? (await options.sampler({
        backend: options.backend,
        jobId: options.jobId,
        ownershipReceipt: options.ownershipReceipt || null,
        phase,
      })) || {} : {};
    } catch {
      samplerFailed = true;
      warnings.add('resource sampler failed; unavailable signals were recorded as missing');
    }
    const validObservedTime = Number.isSafeInteger(observed.observed_ms)
      && observed.observed_ms >= 0
      && observed.observed_ms <= 8_640_000_000_000_000;
    const observedMs = validObservedTime ? observed.observed_ms : recordedMs;
    const stale = observedMs > recordedMs + MAX_CLOCK_SKEW_MS
      || recordedMs - observedMs > Math.max(intervalMs * 3, MAX_CLOCK_SKEW_MS);
    const values = {
      cpu_cores: valueOrNull(observed.cpu_cores),
      memory_bytes: valueOrNull(observed.memory_bytes, true),
      processes: valueOrNull(observed.processes, true),
      storage_growth_bytes: null,
      output_bytes: valueOrNull(observed.output_bytes, true) ?? outputBytes(report),
      spend: observed.spend && typeof observed.spend.amount === 'number'
        ? { amount: observed.spend.amount, currency: 'USD' }
        : (['ci', 'ci-native'].includes(options.backend) ? null : { amount: 0, currency: 'USD' }),
    };
    if (initialBytes !== null) {
      try {
        values.storage_growth_bytes = Math.max(
          0,
          directoryBytes(options.workspacePath) - initialBytes
        );
      } catch {
        warnings.add('controller workspace storage telemetry is unavailable');
      }
    }
    const dynamic = [values.cpu_cores, values.memory_bytes, values.processes, values.output_bytes];
    let telemetry = stale ? 'stale' : (dynamic.every(value => value !== null) ? 'complete' : 'partial');
    if (samplerFailed || (!hasSampler && dynamic.every(value => value === null))) telemetry = 'missing';
    const reasons = [];
    const comparisons = [
      ['CPU', values.cpu_cores, limits.cpu_cores],
      ['memory', values.memory_bytes, limits.memory_bytes],
      ['process', values.processes, limits.processes],
      ['storage growth', values.storage_growth_bytes, limits.storage_growth_bytes],
      ['output', values.output_bytes, limits.output_bytes],
      ['runtime', Math.max(0, recordedMs - startedMs), limits.runtime_ms],
      ['spend', values.spend?.amount ?? null, limits.spend.amount],
    ];
    for (const [label, value, limit] of comparisons) {
      if (value !== null && value > limit) reasons.push(`${label} limit exceeded`);
    }
    if (stale) reasons.push('resource telemetry is stale');
    const decision = reasons.length > 0 ? 'stop' : (telemetry === 'complete' ? 'continue' : 'warn');
    if (decision === 'warn') warnings.add(`resource telemetry ${telemetry}; enforced limits remain disclosed per signal`);
    const record = {
      sequence: samples.length,
      phase,
      recorded_at: new Date(recordedMs).toISOString(),
      observed_at: new Date(observedMs).toISOString(),
      telemetry,
      ...values,
      elapsed_ms: Math.max(0, recordedMs - startedMs),
      decision,
      reasons,
    };
    samples.push(record);
    if (decision === 'stop' && !stopped) {
      stopped = true;
      stopReason = reasons.join('; ');
      options.abort(stopError(stopReason));
    }
    return record;
  }

  function sample(phase, report = null) {
    if (phase === 'interval' && sampling) return Promise.resolve(null);
    const previous = sampling;
    const current = Promise.resolve(previous)
      .catch(() => null)
      .then(() => performSample(phase, report));
    sampling = current;
    const release = () => { if (sampling === current) sampling = null; };
    current.then(release, release);
    return current;
  }

  async function start() {
    await sample('initial');
    if (!stopped) {
      timer = setInterval(() => { sample('interval').catch(() => {}); }, intervalMs);
      timer.unref?.();
    }
  }

  async function finish(report = null, cleanupTriggered = false) {
    if (completedReceipt) return completedReceipt;
    clearInterval(timer);
    await sample('final', report);
    const telemetryValues = samples.map(item => item.telemetry);
    const telemetry = telemetryValues.includes('stale')
      ? 'stale'
      : (telemetryValues.every(value => value === 'complete')
        ? 'complete'
        : (telemetryValues.every(value => value === 'missing') ? 'missing' : 'partial'));
    completedReceipt = {
      schema_version: 1,
      status: stopReason ? 'stopped' : (warnings.size > 0 ? 'warn' : 'pass'),
      started_at: new Date(startedMs).toISOString(),
      completed_at: new Date(now()).toISOString(),
      sample_interval_ms: intervalMs,
      limits,
      controls,
      telemetry,
      samples,
      warnings: [...warnings],
      stop_reason: stopReason,
      cleanup_triggered: cleanupTriggered,
    };
    return completedReceipt;
  }

  return { finish, start };
}

module.exports = {
  createResourceMonitor,
  directoryBytes,
  memoryBytes,
  resourceLimits,
};
