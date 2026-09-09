'use strict';

const {
  appendEvent,
  clearResource,
  consumeControl,
  finalizeMetrics,
  listControls,
  readRun,
  sanitizeValue,
  updateState,
  writeControlResponse,
  writeReport,
  writeResource,
} = require('./session-store');
const { writeCast } = require('./recording');

const UI_HANDSHAKE_TIMEOUT_MS = 15_000;
const PAUSE_LEASE_MS = 5 * 60 * 1000;
const POLL_MS = 100;
const UI_REATTACH_GRACE_MS = 15_000;

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sanitizedObject(value) {
  return sanitizeValue(value);
}

function superviseRun(runId, root, dependencies = {}) {
  const sleep = dependencies.sleep || defaultSleep;
  const now = dependencies.now || (() => Date.now());
  const startedMs = dependencies.startedMs || readRun(runId, root).session.created_ms;
  let reviewWaitMs = 0;
  let uiReadyMs = null;
  let firstReadyMs = null;
  let firstStepMs = null;
  let evidenceStartedMs = null;
  let cleanupStartedMs = null;
  const stepMetrics = [];
  const inspections = [];
  const pauseWaits = { ready: 0, evidence: 0 };
  let currentInspection = null;

  const elapsed = () => Math.max(0, now() - startedMs);
  const emit = event => appendEvent(runId, root, event, {
    now: now(), monotonicMs: elapsed(),
  });
  const respond = (control, response) => {
    writeControlResponse(runId, root, control.control_id, response);
    consumeControl(runId, root, control.control_id);
  };
  const controls = () => listControls(runId, root);

  const waitForUi = () => {
    const waitingStarted = now();
    updateState(runId, root, { status: 'awaiting-ui', supervisor_pid: process.pid });
    while (now() - waitingStarted <= UI_HANDSHAKE_TIMEOUT_MS) {
      const control = controls().find(candidate => candidate.action === 'ui-ready');
      if (control) {
        respond(control, { ok: true });
        updateState(runId, root, { status: 'provisioning', ui_connected: true });
        uiReadyMs = now();
        emit({ type: 'ui.ready', phase: 'review' });
        reviewWaitMs += Math.max(0, now() - waitingStarted);
        return;
      }
      sleep(POLL_MS);
    }
    reviewWaitMs += Math.max(0, now() - waitingStarted);
    throw new Error('Visible review UI did not connect within 15 seconds; no sandbox was provisioned');
  };

  const pause = (name, inspect) => {
    const session = readRun(runId, root).session;
    if (session.pause_review === false) return { waited_ms: 0 };
    const pauseStarted = now();
    let detachedDeadline = null;
    currentInspection = typeof inspect === 'function' ? inspect : null;
    updateState(runId, root, { status: `${name}-paused`, pause: name });
    emit({ type: 'pause.entered', phase: name });
    while (now() - pauseStarted <= PAUSE_LEASE_MS) {
      const control = controls()[0];
      if (!control) {
        if (detachedDeadline !== null && now() >= detachedDeadline) {
          reviewWaitMs += Math.max(0, now() - pauseStarted);
          pauseWaits[name] = (pauseWaits[name] || 0) + Math.max(0, now() - pauseStarted);
          updateState(runId, root, { status: 'stop-requested', pause: null });
          return { waited_ms: Math.max(0, now() - pauseStarted), stop: true, detached: true };
        }
        sleep(POLL_MS);
        continue;
      }
      if (control.action === 'ui-detached') {
        respond(control, { ok: true, detached: true, grace_ms: UI_REATTACH_GRACE_MS });
        detachedDeadline = now() + UI_REATTACH_GRACE_MS;
        updateState(runId, root, { ui_connected: false });
        emit({ type: 'ui.detached', phase: name });
        continue;
      }
      if (control.action === 'ui-ready') {
        respond(control, { ok: true, reattached: true });
        detachedDeadline = null;
        updateState(runId, root, { ui_connected: true });
        emit({ type: 'ui.reattached', phase: name });
        continue;
      }
      if (control.action === 'inspect') {
        const inspectionStarted = now();
        const raw = currentInspection ? currentInspection() : { unavailable: true };
        const inspection = sanitizedObject(raw);
        const durationMs = Math.max(0, now() - inspectionStarted);
        inspections.push({ pause: name, duration_ms: durationMs });
        emit({
          type: 'inspection.completed', phase: 'inspection',
          text: JSON.stringify(inspection),
        });
        respond(control, { ok: true, inspection });
        continue;
      }
      if (control.action === 'continue') {
        respond(control, { ok: true, released: name });
        reviewWaitMs += Math.max(0, now() - pauseStarted);
        pauseWaits[name] = (pauseWaits[name] || 0) + Math.max(0, now() - pauseStarted);
        updateState(runId, root, { status: 'running', pause: null });
        emit({ type: 'pause.released', phase: name });
        currentInspection = null;
        return { waited_ms: Math.max(0, now() - pauseStarted) };
      }
      if (control.action === 'stop') {
        respond(control, { ok: true, stopping: true });
        reviewWaitMs += Math.max(0, now() - pauseStarted);
        pauseWaits[name] = (pauseWaits[name] || 0) + Math.max(0, now() - pauseStarted);
        updateState(runId, root, { status: 'stop-requested', pause: null });
        return { waited_ms: Math.max(0, now() - pauseStarted), stop: true };
      }
      respond(control, { ok: false, error: `Control ${control.action} is invalid at ${name}` });
    }
    reviewWaitMs += Math.max(0, now() - pauseStarted);
    pauseWaits[name] = (pauseWaits[name] || 0) + Math.max(0, now() - pauseStarted);
    updateState(runId, root, { status: 'stop-requested', pause: null });
    return { waited_ms: Math.max(0, now() - pauseStarted), stop: true };
  };

  emit({ type: 'run.created', phase: 'session' });
  emit({ type: 'route.selected', phase: 'session' });
  try {
    waitForUi();
    emit({ type: 'sandbox.provisioning', phase: 'provision' });
    const registerResource = details => {
      const session = readRun(runId, root).session;
      if (details.resource?.container) {
        writeResource(runId, root, {
          kind: 'podman', name: details.resource.container,
          id: details.resource.id || null,
          owner_token: session.owner_token,
        });
      } else if (details.resource?.vm) {
        writeResource(runId, root, {
          kind: details.backend, name: details.resource.vm,
          seed: details.resource.seed,
          ...(details.resource.storage_path ? { storage_path: details.resource.storage_path } : {}),
          launcher: details.resource.launcher || null,
          guest_marker: details.resource.guest_marker || null,
          owner_token: session.owner_token,
        });
      } else if (details.resource?.process) {
        const processResource = details.resource.process;
        writeResource(runId, root, {
          kind: 'lume-helper', name: String(processResource.pid),
          ...processResource,
          owner_token: session.owner_token,
        });
      }
    };
    const lifecycle = {
      resourceAdmission(details) {
        emit({
          type: 'resource.admission', phase: 'provision',
          admission: details.admission, text: details.admission.message,
        });
      },
      resourceCreated(details) {
        registerResource(details);
        emit({
          type: 'resource.registered', phase: 'provision',
          resource_kind: details.resource?.container ? 'podman' : details.backend,
          resource_name: details.resource?.container || details.resource?.vm || null,
        });
      },
      helperCreated(details) {
        registerResource(details);
        emit({
          type: 'resource.registered', phase: 'provision',
          resource_kind: 'lume-helper',
          resource_name: String(details.resource?.process?.pid || ''),
        });
      },
      ready(details) {
        firstReadyMs = now();
        registerResource(details);
        emit({ type: 'sandbox.ready', phase: 'ready' });
        return pause('ready', details.inspect);
      },
      stepStarted(details) {
        if (firstStepMs === null) firstStepMs = now();
        stepMetrics.push({
          phase: details.phase, command: details.command, started_ms: elapsed(),
        });
        emit({
          type: 'step.started', phase: details.phase, command: details.command,
        });
      },
      stepCompleted(details) {
        const metric = stepMetrics.at(-1);
        if (metric) metric.duration_ms = Math.max(0, elapsed() - metric.started_ms);
        if (!details.output_streamed) {
          for (const [stream, text] of [
            ['stdout', details.step.stdout_tail], ['stderr', details.step.stderr_tail],
          ]) {
            if (text) emit({ type: 'step.output', phase: details.phase, stream, text });
          }
        }
        emit({
          type: 'step.completed', phase: details.phase,
          command: details.command, exit: details.step.exit,
        });
        return { stop: readRun(runId, root).state.status === 'stop-requested' };
      },
      shouldStop() {
        return readRun(runId, root).state.status === 'stop-requested';
      },
      evidenceStarted() {
        evidenceStartedMs = now();
        emit({ type: 'evidence.started', phase: 'evidence' });
      },
      evidence(details) {
        emit({ type: 'evidence.completed', phase: 'evidence' });
        return pause('evidence', details.inspect);
      },
      cleanupStarted() {
        cleanupStartedMs = now();
        updateState(runId, root, { status: 'cleaning', pause: null });
        emit({ type: 'cleanup.started', phase: 'cleanup' });
      },
      cleanupCompleted(details) {
        const session = readRun(runId, root).session;
        if (details.pass === true) {
          try {
            const kind = ['podman', 'lume', 'lima', 'tart'].includes(details.backend)
              ? details.backend
              : null;
            if (kind) clearResource(runId, root, session.owner_token, { kind });
            if (details.backend === 'lume') {
              clearResource(runId, root, session.owner_token, { kind: 'lume-helper' });
            }
          } catch (error) {
            if (!/unavailable/.test(error.message)) throw error;
          }
        }
        emit({ type: 'cleanup.completed', phase: 'cleanup', pass: details.pass === true });
      },
    };
    const execute = dependencies.execute;
    if (typeof execute !== 'function') throw new Error('Supervisor execute dependency is unavailable');
    const outcome = execute(lifecycle);
    const completedMs = now();
    const wallMs = Math.max(0, completedMs - startedMs);
    const metrics = finalizeMetrics({
      wall_ms: wallMs,
      review_wait_ms: Math.min(reviewWaitMs, wallMs),
      phases: {
        provision_ms: firstReadyMs === null || uiReadyMs === null
          ? 0
          : Math.max(0, firstReadyMs - uiReadyMs),
        ready_ms: firstStepMs === null || firstReadyMs === null
          ? 0
          : Math.max(0, firstStepMs - firstReadyMs - pauseWaits.ready),
        workload_ms: evidenceStartedMs === null || firstStepMs === null
          ? 0
          : Math.max(0, evidenceStartedMs - firstStepMs),
        evidence_ms: cleanupStartedMs === null || evidenceStartedMs === null
          ? 0
          : Math.max(0, cleanupStartedMs - evidenceStartedMs - pauseWaits.evidence),
        cleanup_ms: cleanupStartedMs === null ? 0 : Math.max(0, completedMs - cleanupStartedMs),
      },
      steps: stepMetrics,
      inspections,
    });
    writeReport(runId, root, outcome.report, metrics);
    emit({ type: 'run.completed', phase: 'session', result: outcome.report.result });
    updateState(runId, root, {
      status: 'completed', pause: null, ui_connected: false,
      result: outcome.report.result, exit_code: outcome.exitCode,
    });
    const session = readRun(runId, root).session;
    if (session.record) writeCast(runId, root);
    return { ...outcome, metrics };
  } catch (error) {
    emit({ type: 'run.failed', phase: 'session', text: error.message });
    updateState(runId, root, {
      status: 'error', pause: null, ui_connected: false, error: error.message,
    });
    throw error;
  }
}

module.exports = {
  PAUSE_LEASE_MS,
  POLL_MS,
  UI_REATTACH_GRACE_MS,
  UI_HANDSHAKE_TIMEOUT_MS,
  defaultSleep,
  sanitizedObject,
  superviseRun,
};
