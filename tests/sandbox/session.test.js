'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  appendEvent,
  clearResource,
  createRun,
  createControl,
  evaluateRun,
  finalizeMetrics,
  listEvents,
  readControlResponse,
  readResources,
  readRun,
  resolveRunDirectory,
  transitionStateWithEvent,
  updateState,
  validateStateRoot,
  writeResource,
  writeReport,
} = require('../../scripts/sandbox/session-store');
const { exportMp4, writeCast } = require('../../scripts/sandbox/recording');
const { cleanupOwnedResource, gcRuns } = require('../../scripts/sandbox/guardian');
const { runStreaming } = require('../../scripts/sandbox/stream-runner');
const { sanitizedObject, superviseRun } = require('../../scripts/sandbox/supervisor');
const {
  filteredInteractiveEnvironment,
} = require('../../scripts/sandbox/interactive-exec');
const {
  createReview,
  filteredSupervisorEnvironment,
  parseReviewArgs,
} = require('../../scripts/sandbox/review-cli');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function mode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-test-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n=== ECC sandbox session tests ===\n');

test('parses bounded purpose and explicit consent without accepting prompt injection', () => {
  const parsed = parseReviewArgs([
    '/repo/sandbox.yaml', '--purpose', 'the ECC installer', '--consent', 'y',
  ]);
  assert.strictEqual(parsed.purpose, 'the ECC installer');
  assert.strictEqual(parsed.consent, 'y');

  for (const purpose of ['line one\nline two', 'nul\0byte', `delete${String.fromCharCode(0x7f)}host`]) {
    assert.throws(
      () => parseReviewArgs(['/repo/sandbox.yaml', '--purpose', purpose]),
      /purpose.*control/i
    );
  }
  assert.throws(
    () => parseReviewArgs(['/repo/sandbox.yaml', '--purpose', 'x'.repeat(241)]),
    /purpose.*240.*byte/i
  );
  assert.throws(
    () => parseReviewArgs(['/repo/sandbox.yaml', '--purpose', 'é'.repeat(121)]),
    /purpose.*240.*byte/i
  );
  for (const consent of ['yes', 'Y', '0']) {
    assert.throws(
      () => parseReviewArgs(['/repo/sandbox.yaml', '--consent', consent]),
      /consent.*y.*n/i
    );
  }
  assert.throws(
    () => parseReviewArgs(['/repo/sandbox.yaml', '--terminal', 'iterm2']),
    /terminal.*wezterm.*terminal\.app/i
  );
});

test('Tier 1 review requests purpose-specific consent before creating any state', () => withRoot(root => {
  const manifestPath = path.join(root, 'sandbox.yaml');
  fs.writeFileSync(manifestPath, 'name: consent-review\n');
  const route = { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' };
  const context = {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: {
        needs: {
          os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false,
        },
      },
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };
  const unexpected = () => {
    throw new Error('consent boundary invoked a launcher');
  };
  const expectedPrompt = 'Would you like to launch a Tier 1 rootless Podman sandbox with '
    + 'a clean Linux home, a read-only source mount, and networking disabled, '
    + 'for testing the ECC installer? y/n';

  const requested = createReview(parseReviewArgs([
    manifestPath, '--purpose', 'the ECC installer',
  ]), context, { root, spawn: unexpected, launch: unexpected });
  assert.strictEqual(requested.result, 'consent-required');
  assert.strictEqual(requested.creates_run, false);
  assert.match(requested.proposal_id, /^proposal_[a-f0-9]{64}$/);
  assert.strictEqual(requested.consent_prompt, expectedPrompt);
  assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.yaml']);

  const declined = createReview(parseReviewArgs([
    manifestPath, '--purpose', 'the ECC installer', '--consent', 'n',
  ]), context, { root, spawn: unexpected, launch: unexpected });
  assert.strictEqual(declined.result, 'declined');
  assert.strictEqual(declined.creates_run, false);
  assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.yaml']);
}));

test('Tier 1 consent proposal does not create a previously absent state root', () => withRoot(workspace => {
  const manifestPath = path.join(workspace, 'sandbox.yaml');
  const stateRoot = path.join(workspace, 'state', 'runs');
  fs.writeFileSync(manifestPath, 'name: consent-review\n');
  const route = { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' };
  const context = {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: {
        needs: {
          os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false,
        },
      },
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };

  const requested = createReview(parseReviewArgs([
    manifestPath, '--purpose', 'the ECC installer',
  ]), context, {
    root: stateRoot,
    spawn: () => { throw new Error('consent boundary invoked a process'); },
    launch: () => { throw new Error('consent boundary invoked a terminal'); },
  });

  assert.strictEqual(requested.result, 'consent-required');
  assert.strictEqual(requested.creates_run, false);
  assert.strictEqual(fs.existsSync(stateRoot), false);
}));

test('Tier 1 review launches only after y and stores immutable consent audit metadata', () => withRoot(root => {
  const manifestPath = path.join(root, 'sandbox.yaml');
  fs.writeFileSync(manifestPath, 'name: consent-review\n');
  const route = { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' };
  const context = {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: {
        needs: {
          os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false,
        },
      },
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };
  const launches = [];
  const proposal = createReview(parseReviewArgs([
    manifestPath, '--purpose', 'the ECC installer', '--terminal', 'terminal.app',
  ]), context, { root });
  const started = createReview(parseReviewArgs([
    manifestPath,
    '--purpose', 'the ECC installer',
    '--consent', 'y',
    '--proposal', proposal.proposal_id,
    '--terminal', 'terminal.app',
  ]), context, {
    root,
    spawn: (executable, argv, options) => {
      launches.push({ executable, argv, options });
      return { pid: 4242, once() {}, unref() {} };
    },
    launch: plan => {
      launches.push({ plan });
      return { strategy: 'app' };
    },
  });

  assert.strictEqual(started.result, 'launching');
  assert.strictEqual(started.terminal, 'terminal.app');
  assert.strictEqual(launches[2].plan.command, '/usr/bin/osascript');
  const stored = readRun(started.run_id, root).session;
  assert.strictEqual(stored.purpose, 'the ECC installer');
  assert.strictEqual(stored.consent.decision, 'y');
  assert.strictEqual(stored.consent.proposal_id, proposal.proposal_id);
  assert.strictEqual(
    stored.consent.prompt,
    'Would you like to launch a Tier 1 rootless Podman sandbox with '
      + 'a clean Linux home, a read-only source mount, and networking disabled, '
      + 'for testing the ECC installer? y/n'
  );
  assert.match(stored.consent.granted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}));

test('Tier 1 review rejects y when the proposed manifest has changed', () => withRoot(root => {
  const manifestPath = path.join(root, 'sandbox.yaml');
  fs.writeFileSync(manifestPath, 'name: consent-review\n');
  const route = { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' };
  const context = {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: {
        needs: {
          os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false,
        },
      },
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };
  const proposal = createReview(parseReviewArgs([
    manifestPath, '--purpose', 'the ECC installer',
  ]), context, { root });
  fs.appendFileSync(manifestPath, '\n');
  assert.throws(() => createReview(parseReviewArgs([
    manifestPath,
    '--purpose', 'the ECC installer',
    '--consent', 'y',
    '--proposal', proposal.proposal_id,
  ]), context, {
    root,
    spawn: () => { throw new Error('changed proposal launched a process'); },
    launch: () => { throw new Error('changed proposal launched a terminal'); },
  }), /proposal.*no longer matches/i);
  assert.deepStrictEqual(fs.readdirSync(root), ['sandbox.yaml']);
}));

test('creates private unguessable run storage and rejects invalid run IDs', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'a'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    record: true,
  });
  assert.match(created.run_id, /^run_[a-f0-9]{32}$/);
  assert.strictEqual(mode(root), 0o700);
  assert.strictEqual(mode(created.run_directory), 0o700);
  assert.strictEqual(mode(path.join(created.run_directory, 'session.json')), 0o600);
  assert.strictEqual(readRun(created.run_id, root).session.record, true);
  assert.throws(() => resolveRunDirectory('../escape', root), /Invalid sandbox run ID/);
  assert.throws(() => validateStateRoot(`${root}\ninjected`), /control characters/);
  const linked = `${root}-link`;
  fs.symlinkSync(root, linked);
  try {
    assert.throws(() => validateStateRoot(linked), /symbolic link/);
  } finally {
    fs.unlinkSync(linked);
  }
}));

test('writes one ordered redacted event stream without persisting raw secrets', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'b'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  appendEvent(created.run_id, root, {
    type: 'step.output',
    phase: 'assert',
    stream: 'stdout',
    text: 'token=ghp_abcdefghijklmnopqrstuvwxyz1234567890 done',
  }, { now: 1_700_000_000_050, monotonicMs: 50 });
  appendEvent(created.run_id, root, {
    type: 'step.completed', phase: 'assert', exit: 0,
  }, { now: 1_700_000_000_060, monotonicMs: 60 });
  const events = listEvents(created.run_id, root);
  assert.deepStrictEqual(events.map(event => event.seq), [1, 2]);
  assert.match(events[0].text, /\[REDACTED\]/);
  assert.strictEqual(events[0].redaction_count, 1);
  assert.ok(events[0].original_bytes > events[0].retained_bytes);
  assert.match(events[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(fs.readFileSync(path.join(created.run_directory, 'events.jsonl'), 'utf8'), /ghp_/);
  appendEvent(created.run_id, root, {
    type: 'inspection.completed', phase: 'inspection',
    metadata: { GH_TOKEN: 'another-secret-value', nested: { authorization: 'Bearer hidden-value' } },
  });
  writeReport(created.run_id, root, {
    execution_mode: 'real', result: 'error',
    notes: ['OPENAI_API_KEY=sk-this-must-not-persist'],
    diagnostic: { client_secret: 'private-value' },
  }, finalizeMetrics({ wall_ms: 1, review_wait_ms: 0 }));
  const stored = fs.readFileSync(path.join(created.run_directory, 'events.jsonl'), 'utf8')
    + fs.readFileSync(path.join(created.run_directory, 'report.json'), 'utf8');
  assert.doesNotMatch(stored, /another-secret|hidden-value|this-must-not-persist|private-value/);
}));

test('redacts structured inspection secrets without corrupting JSON', () => {
  assert.deepStrictEqual(sanitizedObject({
    token: 'abc', accessToken: 'def', AWS_SECRET_ACCESS_KEY: 'ghi',
    nested: { 'io.ecc.sandbox.owner': 'owner-token', safe: 'visible' },
  }), {
    token: '[REDACTED]', accessToken: '[REDACTED]', AWS_SECRET_ACCESS_KEY: '[REDACTED]',
    nested: { 'io.ecc.sandbox.owner': '[REDACTED]', safe: 'visible' },
  });
});

test('filters ambient secrets from interactive exploration environments', () => {
  assert.strictEqual(typeof filteredInteractiveEnvironment, 'function');
  const environment = filteredInteractiveEnvironment({
    PATH: '/safe/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_MESSAGES: 'en_US.UTF-8',
    TMPDIR: '/private/tmp/ecc',
    GH_TOKEN: 'must-not-leak',
    OPENAI_API_KEY: 'must-not-leak',
    SSH_AUTH_SOCK: '/private/tmp/agent.sock',
    AWS_PROFILE: 'production',
  });
  assert.deepStrictEqual(environment, {
    PATH: '/safe/bin',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_MESSAGES: 'en_US.UTF-8',
    TMPDIR: '/private/tmp/ecc',
  });
});

test('uses atomic state snapshots and bounded ownership-safe controls', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'c'.repeat(64),
    route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' },
  });
  updateState(created.run_id, root, { status: 'ready-paused', pause: 'ready' });
  const current = readRun(created.run_id, root).state;
  assert.strictEqual(current.status, 'ready-paused');
  assert.strictEqual(current.pause, 'ready');
  const control = createControl(created.run_id, root, 'inspect');
  const second = createControl(created.run_id, root, 'continue');
  assert.match(control.control_id, /^ctl_[a-f0-9]{24}$/);
  assert.strictEqual(mode(path.join(created.run_directory, 'controls', `${control.control_id}.json`)), 0o600);
  assert.strictEqual(second.created_seq, control.created_seq + 1);
  assert.throws(() => createControl(created.run_id, root, 'shell'), /Unsupported sandbox control/);
}));

test('publishes a transition diagnostic before exposing its terminal state', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'f'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    exploration: true,
  });
  updateState(created.run_id, root, { status: 'launching' });

  const transition = transitionStateWithEvent(
    created.run_id,
    root,
    'launching',
    { status: 'error', error: 'terminal did not check in' },
    { type: 'exploration.launch.failed', phase: 'exploration' }
  );

  assert.strictEqual(transition.updated, true);
  assert.strictEqual(transition.state.status, 'error');
  assert.strictEqual(transition.event.type, 'exploration.launch.failed');
  assert.strictEqual(listEvents(created.run_id, root)[0].type, 'exploration.launch.failed');
  assert.strictEqual(readRun(created.run_id, root).state.next_seq, 2);
}));

test('bounds exploration output and discloses dropped events in state', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/sandbox.yaml', manifestDigest: '2'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    exploration: true,
  });
  for (let index = 0; index < 5_001; index += 1) {
    appendEvent(created.run_id, root, {
      type: 'exploration.output', phase: 'exploration', stream: 'pty', text: 'x',
    });
  }
  const state = readRun(created.run_id, root).state;
  assert.strictEqual(state.output_events, 5_000);
  assert.strictEqual(state.dropped_output_events, 1);
  assert.strictEqual(state.dropped_output_bytes, 1);
}));

test('stores and clears an exact private resource ownership receipt', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '3'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'podman', name: 'ecc-run', owner_token: created.session.owner_token,
  });
  const receiptPath = path.join(created.run_directory, 'resource.json');
  assert.strictEqual(mode(receiptPath), 0o600);
  assert.strictEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).resources[0].name, 'ecc-run');
  clearResource(created.run_id, root, created.session.owner_token);
  assert.strictEqual(fs.existsSync(receiptPath), false);
}));

test('excludes review waits from active performance and evaluates evidence deterministically', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'd'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
  });
  const metrics = finalizeMetrics({
    wall_ms: 1_250,
    review_wait_ms: 250,
    phases: { provision_ms: 200, workload_ms: 800 },
  });
  assert.strictEqual(metrics.active_total_ms, 1_000);
  assert.throws(() => finalizeMetrics({ wall_ms: 10, review_wait_ms: 11 }), /cannot exceed/);
  writeReport(created.run_id, root, {
    manifest: '/repo/sandbox.yaml', backend: 'podman', tier: 1,
    execution_mode: 'real', result: 'pass', install_diff: { complete: true },
    notes: [],
  }, metrics);
  appendEvent(created.run_id, root, {
    type: 'cleanup.completed', phase: 'cleanup', pass: true,
  });
  updateState(created.run_id, root, { status: 'completed', result: 'pass', exit_code: 0 });
  const evaluation = evaluateRun(created.run_id, root);
  assert.strictEqual(evaluation.verdict, 'pass');
  assert.strictEqual(evaluation.performance.active_total_ms, 1_000);
  assert.deepStrictEqual(evaluation.blockers, []);
}));

test('never passes requested installation evidence when the backend reports none', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/sandbox.yaml', manifestDigest: 'd'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
    requestedReport: 'install-diff',
  });
  writeReport(created.run_id, root, {
    manifest: '/repo/sandbox.yaml', backend: 'srt', tier: 0,
    execution_mode: 'real', result: 'pass',
    install_diff: { method: 'none', complete: false }, notes: [],
  }, finalizeMetrics({ wall_ms: 10, review_wait_ms: 0 }));
  appendEvent(created.run_id, root, { type: 'cleanup.completed', phase: 'cleanup', pass: true });
  updateState(created.run_id, root, { status: 'completed', result: 'pass', exit_code: 0 });
  const evaluation = evaluateRun(created.run_id, root);
  assert.strictEqual(evaluation.verdict, 'inconclusive');
  assert.ok(evaluation.blockers.includes('installation evidence is incomplete'));
  assert.strictEqual(evaluation.evidence_complete, false);
}));

test('records only the sanitized event journal as a replayable cast', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'e'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
    record: true,
  });
  appendEvent(created.run_id, root, {
    type: 'step.output', phase: 'setup', stream: 'stdout',
    text: 'Authorization: Bearer secret-value-123456',
  }, { now: 1_700_000_000_100, monotonicMs: 100 });
  const result = writeCast(created.run_id, root);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const cast = fs.readFileSync(result.path, 'utf8');
  assert.match(cast, /\[REDACTED\]/);
  assert.doesNotMatch(cast, /secret-value/);
  assert.deepStrictEqual(JSON.parse(cast.split('\n')[0]).version, 2);
}));

test('supervises one backend through UI handshake, pauses, inspection, evidence, and cleanup', () => withRoot(root => {
  const created = createRun({
    root,
    now: 1_700_000_000_000,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: 'f'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
    record: true,
  });
  createControl(created.run_id, root, 'ui-ready');
  const inspect = createControl(created.run_id, root, 'inspect');
  createControl(created.run_id, root, 'continue');
  createControl(created.run_id, root, 'continue');
  const outcome = superviseRun(created.run_id, root, {
    sleep: () => {},
    now: (() => { let value = 1_700_000_000_000; return () => (value += 10); })(),
    execute: lifecycle => {
      lifecycle.resourceCreated({ backend: 'podman', resource: { container: 'ecc-owned-run' } });
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(created.run_directory, 'resource.json'), 'utf8')).resources[0].name,
        'ecc-owned-run'
      );
      lifecycle.ready({ backend: 'podman', inspect: () => ({ state: 'running' }) });
      lifecycle.stepStarted({ backend: 'podman', phase: 'setup', command: 'printf setup' });
      lifecycle.stepCompleted({
        backend: 'podman', phase: 'setup', command: 'printf setup',
        step: { cmd: 'printf setup', exit: 0, stdout_tail: 'setup ok', stderr_tail: '' },
      });
      lifecycle.evidenceStarted({ backend: 'podman', report: 'install-diff' });
      lifecycle.evidence({ backend: 'podman', report: 'install-diff', inspect: () => ({ diff: 'sealed' }) });
      lifecycle.cleanupStarted({ backend: 'podman' });
      lifecycle.cleanupCompleted({ backend: 'podman', pass: true });
      return {
        exitCode: 0,
        report: {
          manifest: '/repo/sandbox.yaml', backend: 'podman', tier: 1,
          execution_mode: 'real', result: 'pass',
          install_diff: { method: 'podman-layer', complete: true }, notes: [],
        },
      };
    },
  });
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(readRun(created.run_id, root).state.status, 'completed');
  assert.deepStrictEqual(listEvents(created.run_id, root).map(event => event.type), [
    'run.created', 'route.selected', 'ui.ready', 'sandbox.provisioning', 'resource.registered', 'sandbox.ready',
    'pause.entered', 'inspection.completed', 'pause.released',
    'step.started', 'step.output', 'step.completed', 'evidence.started', 'evidence.completed',
    'pause.entered', 'pause.released', 'cleanup.started', 'cleanup.completed',
    'run.completed',
  ]);
  const response = require('../../scripts/sandbox/session-store').readControlResponse(
    created.run_id, root, inspect.control_id
  );
  assert.deepStrictEqual(response.inspection, { state: 'running' });
  assert.ok(fs.existsSync(path.join(created.run_directory, 'review.cast')));
}));

test('supervisor journals the exact host-admission refusal for the visible user before any resource exists', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/admission.yaml', manifestDigest: 'a'.repeat(64),
    route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' }, pauseReview: false,
  });
  createControl(created.run_id, root, 'ui-ready');
  const admission = {
    schema_version: 1, decision: 'deny', code: 'host_insufficient_memory',
    message: 'VM launch refused: 7.00 GiB available; 9.00 GiB required. Close memory-heavy apps and retry.',
    checked_at: '2026-09-07T12:00:00.000Z', guest_memory_bytes: 4 * 1024 ** 3,
    available_memory_bytes: 7 * 1024 ** 3, required_memory_bytes: 9 * 1024 ** 3,
    memory_pressure: 'normal',
  };
  const outcome = superviseRun(created.run_id, root, {
    sleep: () => {},
    execute: lifecycle => {
      lifecycle.resourceAdmission({ backend: 'lume', admission });
      assert.deepStrictEqual(readResources(created.run_id, root), []);
      lifecycle.cleanupStarted({ backend: 'lume' });
      lifecycle.cleanupCompleted({ backend: 'lume', pass: true });
      return { exitCode: 2, report: {
        manifest: '/repo/admission.yaml', backend: 'lume', tier: 2,
        execution_mode: 'real', result: 'error',
        install_diff: { method: 'none', complete: false }, notes: [admission.message],
      } };
    },
  });
  const events = listEvents(created.run_id, root);
  const event = events.find(item => item.type === 'resource.admission');
  assert.deepStrictEqual(event.admission, admission);
  assert.strictEqual(event.text, admission.message);
  assert.strictEqual(event.phase, 'provision');
  assert.strictEqual(event.backend, 'lume');
  assert.strictEqual(event.tier, 2);
  assert.strictEqual(events.some(item => item.type === 'resource.registered' || item.type === 'sandbox.ready'), false);
  assert.strictEqual(outcome.exitCode, 2);
  assert.strictEqual(readRun(created.run_id, root).state.result, 'error');
}));

test('supervisor propagates an admission-journal write failure before the executor can provision', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/admission.yaml', manifestDigest: 'b'.repeat(64),
    route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' }, pauseReview: false,
  });
  createControl(created.run_id, root, 'ui-ready');
  let provisioned = false;
  assert.throws(() => superviseRun(created.run_id, root, {
    sleep: () => {},
    execute: lifecycle => {
      const journal = path.join(created.run_directory, 'events.jsonl');
      const saved = path.join(created.run_directory, 'saved-events.jsonl');
      fs.renameSync(journal, saved);
      fs.mkdirSync(journal);
      try {
        lifecycle.resourceAdmission({ backend: 'lume', admission: {
          schema_version: 1, decision: 'allow', message: 'Host memory and disk admission passed.',
        } });
        provisioned = true;
        throw new Error('unreachable: failed admission persistence was ignored');
      } finally {
        fs.rmdirSync(journal);
        fs.renameSync(saved, journal);
      }
    },
  }), /EISDIR|illegal operation on a directory/i);
  assert.strictEqual(provisioned, false);
  assert.deepStrictEqual(readResources(created.run_id, root), []);
  assert.strictEqual(readRun(created.run_id, root).state.status, 'error');
  const events = listEvents(created.run_id, root);
  assert.strictEqual(events.some(event => event.type === 'resource.admission' || event.type === 'resource.registered'), false);
  assert.strictEqual(events.at(-1).type, 'run.failed');
  assert.match(events.at(-1).text, /EISDIR|illegal operation on a directory/i);
}));

test('supervisor preserves admitted VM storage in both created and ready recovery receipts', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/storage.yaml', manifestDigest: 'c'.repeat(64),
    route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' }, pauseReview: false,
  });
  createControl(created.run_id, root, 'ui-ready');
  const resource = { vm: 'ecc-sandbox-lume-storage-test', seed: 'ecc-seed', storage_path: '/Volumes/VM Store/admitted' };
  const launcher = { pid: 65432, pgid: 65432, started: 'fixture', command: 'lume run owned' };
  superviseRun(created.run_id, root, {
    sleep: () => {},
    execute: lifecycle => {
      lifecycle.resourceCreated({ backend: 'lume', resource });
      let receipt = readResources(created.run_id, root)[0];
      assert.strictEqual(receipt.storage_path, resource.storage_path);
      assert.strictEqual(receipt.name, resource.vm);
      lifecycle.ready({ backend: 'lume', resource: {
        ...resource, launcher, guest_marker: { guestAddress: '192.0.2.20' },
      } });
      receipt = readResources(created.run_id, root)[0];
      assert.strictEqual(receipt.storage_path, resource.storage_path);
      assert.deepStrictEqual(receipt.launcher, launcher);
      assert.deepStrictEqual(receipt.guest_marker, { guestAddress: '192.0.2.20' });
      lifecycle.cleanupStarted({ backend: 'lume' });
      lifecycle.cleanupCompleted({ backend: 'lume', pass: false });
      return { exitCode: 2, report: {
        manifest: '/repo/storage.yaml', backend: 'lume', tier: 2,
        execution_mode: 'real', result: 'error',
        install_diff: { method: 'none', complete: false }, notes: ['Cleanup retained the recovery receipt.'],
      } };
    },
  });
  assert.strictEqual(readResources(created.run_id, root)[0].storage_path, resource.storage_path);
  assert.strictEqual(listEvents(created.run_id, root).find(event => event.type === 'cleanup.completed').pass, false);
}));

test('plans and launches one deterministic visible review without leaking credentials', () => withRoot(root => {
  const manifestPath = path.join(root, 'sandbox.yaml');
  const mockPath = path.join(root, 'mock.json');
  fs.writeFileSync(manifestPath, 'name: test\n');
  fs.writeFileSync(mockPath, '{"results":[]}\n');
  const route = { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' };
  const context = {
    cliPath: '/trusted/ecc-sandbox',
    resolveRun: () => ({
      manifestPath,
      manifest: {
        needs: {
          os: ['linux'], capabilities: ['clean-home'], trust: 'first-party', native: false,
        },
      },
      capabilities: {},
      decision: { result: 'routable', routes: [route] },
    }),
  };
  const dry = createReview({
    ...parseReviewArgs([manifestPath, '--dry-run', '--expect-backend', 'podman']),
  }, context, { root });
  assert.strictEqual(dry.creates_run, false);
  assert.strictEqual(fs.readdirSync(root).length, 2);
  assert.strictEqual(dry.terminal.environment.mode, 'filtered');
  assert.throws(() => createReview({
    ...parseReviewArgs([manifestPath, '--expect-backend', 'srt']),
  }, context, { root }), /expected srt.*selected podman/);

  const calls = [];
  const proposal = createReview(parseReviewArgs([
    manifestPath, '--expect-backend', 'podman',
    '--purpose', 'the deterministic review workflow',
  ]), context, { root });
  const started = createReview(parseReviewArgs([
    manifestPath, '--expect-backend', 'podman', '--record', '--no-pause', '--mock', mockPath,
    '--purpose', 'the deterministic review workflow', '--consent', 'y',
    '--proposal', proposal.proposal_id,
  ]), context, {
    root,
    spawn: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return { pid: 4242, once() {}, unref() {} };
    },
    launch: plan => {
      calls.push({ plan });
      return { strategy: 'mux' };
    },
  });
  assert.strictEqual(started.backend, 'podman');
  assert.strictEqual(calls[0].options.shell, false);
  assert.deepStrictEqual(calls[0].argv.slice(0, 2), ['/trusted/ecc-sandbox', '_supervise']);
  assert.deepStrictEqual(calls[1].argv.slice(0, 2), ['/trusted/ecc-sandbox', '_guard']);
  assert.strictEqual(calls[2].plan.executable, process.execPath);
  assert.ok(calls[2].plan.argv.includes('_ui'));
  const storedSession = readRun(started.run_id, root).session;
  assert.strictEqual(storedSession.pause_review, false);
  assert.strictEqual(storedSession.original_manifest_path, manifestPath);
  assert.strictEqual(
    path.dirname(storedSession.manifest_path),
    path.join(fs.realpathSync.native(root), started.run_id)
  );
  assert.match(storedSession.capabilities_digest, /^[a-f0-9]{64}$/);
  assert.match(storedSession.mock_digest, /^[a-f0-9]{64}$/);
  assert.strictEqual(path.dirname(storedSession.mock_path), path.dirname(storedSession.manifest_path));
  fs.writeFileSync(manifestPath, 'name: changed-after-routing\n');
  assert.strictEqual(fs.readFileSync(storedSession.manifest_path, 'utf8'), 'name: test\n');
  fs.writeFileSync(mockPath, '{"results":[{"status":99}]}\n');
  assert.strictEqual(fs.readFileSync(storedSession.mock_path, 'utf8'), '{"results":[]}\n');

  const environment = filteredSupervisorEnvironment({
    PATH: '/usr/bin', HOME: '/Users/test', LANG: 'en_US.UTF-8',
    GH_TOKEN: 'secret', OPENAI_API_KEY: 'secret', SSH_AUTH_SOCK: '/tmp/socket',
  });
  assert.deepStrictEqual(environment, {
    PATH: '/opt/podman/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/test/.local/bin',
    HOME: '/Users/test', LANG: 'en_US.UTF-8',
  });
}));

test('runs pause-free reviews through the shared journal without continue controls', () => withRoot(root => {
  const created = createRun({
    root,
    now: 1_700_000_000_000,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '4'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
    pauseReview: false,
  });
  createControl(created.run_id, root, 'ui-ready');
  const outcome = superviseRun(created.run_id, root, {
    sleep: () => {},
    now: (() => { let value = 1_700_000_000_000; return () => (value += 10); })(),
    execute: lifecycle => {
      assert.deepStrictEqual(lifecycle.ready({ backend: 'srt', resource: null }), { waited_ms: 0 });
      lifecycle.evidenceStarted({ backend: 'srt', report: 'none' });
      assert.deepStrictEqual(lifecycle.evidence({ backend: 'srt' }), { waited_ms: 0 });
      lifecycle.cleanupStarted({ backend: 'srt' });
      lifecycle.cleanupCompleted({ backend: 'srt', pass: true });
      return {
        exitCode: 0,
        report: {
          manifest: '/repo/sandbox.yaml', backend: 'srt', tier: 0,
          execution_mode: 'real', result: 'pass',
          install_diff: { method: 'none', complete: true }, notes: [],
        },
      };
    },
  });
  assert.ok(outcome.metrics.review_wait_ms > 0);
  assert.ok(outcome.metrics.review_wait_ms < outcome.metrics.wall_ms);
  assert.ok(!listEvents(created.run_id, root).some(event => event.type === 'pause.entered'));
}));

test('guardian removes only a Podman resource with matching ECC labels', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '5'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'podman', name: 'ecc-owned', id: 'b'.repeat(64),
    owner_token: created.session.owner_token,
  });
  const calls = [];
  const result = cleanupOwnedResource(created.run_id, root, {
    run: (executable, argv) => {
      calls.push([executable, ...argv]);
      if (argv[0] === 'info') return {
        status: 0, stdout: JSON.stringify({ host: { security: { rootless: true } } }), stderr: '',
      };
      if (argv[0] === 'inspect') return {
        status: 0, stdout: JSON.stringify([{ Id: 'b'.repeat(64), Config: { Labels: {
          'io.ecc.sandbox.run': created.run_id,
          'io.ecc.sandbox.owner': created.session.owner_token,
        } } }]), stderr: '',
      };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.strictEqual(result.cleaned, true);
  assert.deepStrictEqual(calls.at(-1), [
    'podman', 'rm', '--force', '--time', '0', 'b'.repeat(64),
  ]);
  assert.strictEqual(fs.existsSync(path.join(created.run_directory, 'resource.json')), false);
}));

test('guardian refuses a Podman resource when immutable ownership labels differ', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '6'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'podman', name: 'ecc-not-owned', owner_token: created.session.owner_token,
  });
  const calls = [];
  const result = cleanupOwnedResource(created.run_id, root, {
    run: (executable, argv) => {
      calls.push([executable, ...argv]);
      if (argv[0] === 'info') return {
        status: 0, stdout: JSON.stringify({ host: { security: { rootless: true } } }), stderr: '',
      };
      return { status: 0, stdout: JSON.stringify([{ Config: { Labels: {} } }]), stderr: '' };
    },
  });
  assert.strictEqual(result.cleaned, false);
  assert.strictEqual(calls.length, 2);
}));

test('successful visible-review cleanup clears exact Lima and Tart receipts', () => {
  for (const backend of ['lima', 'tart']) withRoot(root => {
    const created = createRun({
      root,
      manifestPath: `/repo/${backend}.yaml`,
      manifestDigest: 'a'.repeat(64),
      route: { backend, tier: 2, os: backend === 'lima' ? 'linux' : 'macos', arch: 'arm64' },
      pauseReview: false,
    });
    createControl(created.run_id, root, 'ui-ready');
    superviseRun(created.run_id, root, {
      sleep: () => {},
      execute: lifecycle => {
        lifecycle.resourceCreated({
          backend,
          resource: { vm: `ecc-${backend}-owned`, seed: `ecc-${backend}-seed` },
        });
        assert.strictEqual(readResources(created.run_id, root).length, 1);
        lifecycle.cleanupStarted({ backend });
        lifecycle.cleanupCompleted({ backend, pass: true });
        return {
          exitCode: 0,
          report: {
            manifest: `/repo/${backend}.yaml`, backend, tier: 2,
            execution_mode: 'real', result: 'pass',
            install_diff: { method: 'none', complete: true }, notes: [],
          },
        };
      },
    });
    assert.deepStrictEqual(readResources(created.run_id, root), []);
  });
});

test('guardian recovers only the exact recorded Lima and Tart VM names', () => {
  const cases = [
    {
      backend: 'lima', executable: 'limactl',
      inspect: ['--tty=false', 'list', 'ecc-lima-owned', '--format', 'json'],
      inspectOutput: JSON.stringify([{ name: 'ecc-lima-owned', status: 'Running' }]),
      stop: ['--tty=false', 'stop', '--force', 'ecc-lima-owned'],
      remove: ['--tty=false', 'delete', '--force', 'ecc-lima-owned'],
    },
    {
      backend: 'tart', executable: 'tart',
      inspect: ['get', 'ecc-tart-owned', '--format', 'json'],
      inspectOutput: JSON.stringify({ Name: 'ecc-tart-owned', Running: true, State: 'running' }),
      stop: ['stop', '--timeout', '30', 'ecc-tart-owned'],
      remove: ['delete', 'ecc-tart-owned'],
    },
  ];
  for (const current of cases) withRoot(root => {
    const created = createRun({
      root,
      manifestPath: `/repo/${current.backend}.yaml`,
      manifestDigest: 'b'.repeat(64),
      route: { backend: current.backend, tier: 2, os: 'macos', arch: 'arm64' },
    });
    writeResource(created.run_id, root, {
      kind: current.backend,
      name: `ecc-${current.backend}-owned`,
      seed: `ecc-${current.backend}-seed`,
      owner_token: created.session.owner_token,
    });
    const calls = [];
    const cleanup = cleanupOwnedResource(created.run_id, root, {
      run: (executable, argv) => {
        calls.push([executable, ...argv]);
        if (calls.length === 1) return { status: 0, stdout: current.inspectOutput, stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(cleanup.cleaned, true);
    assert.deepStrictEqual(calls, [
      [current.executable, ...current.inspect],
      [current.executable, ...current.stop],
      [current.executable, ...current.remove],
    ]);
    assert.deepStrictEqual(readResources(created.run_id, root), []);
  });
});

test('guardian retains a Lima receipt and fails closed when exact identity verification fails', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/lima.yaml',
    manifestDigest: 'c'.repeat(64),
    route: { backend: 'lima', tier: 2, os: 'linux', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'lima', name: 'ecc-lima-owned', seed: 'ecc-lima-seed',
    owner_token: created.session.owner_token,
  });
  const calls = [];
  const cleanup = cleanupOwnedResource(created.run_id, root, {
    run: (executable, argv) => {
      calls.push([executable, ...argv]);
      return {
        status: 0,
        stdout: JSON.stringify([{ name: 'different-vm', status: 'Running' }]),
        stderr: '',
      };
    },
  });
  assert.strictEqual(cleanup.cleaned, false);
  assert.match(cleanup.error, /identity does not match receipt/);
  assert.deepStrictEqual(calls, [[
    'limactl', '--tty=false', 'list', 'ecc-lima-owned', '--format', 'json',
  ]]);
  assert.strictEqual(readResources(created.run_id, root).length, 1);
}));

test('guardian retains a Tart receipt when inspection omits exact identity', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/tart.yaml',
    manifestDigest: 'd'.repeat(64),
    route: { backend: 'tart', tier: 2, os: 'macos', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'tart', name: 'ecc-tart-owned', seed: 'ecc-tart-seed',
    owner_token: created.session.owner_token,
  });
  const calls = [];
  const cleanup = cleanupOwnedResource(created.run_id, root, {
    run: (executable, argv) => {
      calls.push([executable, ...argv]);
      return {
        status: 0,
        stdout: JSON.stringify({ Running: true, State: 'running' }),
        stderr: '',
      };
    },
  });
  assert.strictEqual(cleanup.cleaned, false);
  assert.match(cleanup.error, /identity does not match receipt/);
  assert.deepStrictEqual(calls, [[
    'tart', 'get', 'ecc-tart-owned', '--format', 'json',
  ]]);
  assert.strictEqual(readResources(created.run_id, root).length, 1);
}));

test('guardian verifies process exit and escalates an owned process group to SIGKILL', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml', manifestDigest: '6'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  writeResource(created.run_id, root, {
    kind: 'process', name: '777', pid: 777,
    started: 'Thu Aug 13 12:00:00 2026', command: '/bin/sleep 30',
    owner_token: created.session.owner_token,
  });
  let alive = true;
  const signals = [];
  const cleanup = cleanupOwnedResource(created.run_id, root, {
    run: (_executable, argv) => {
      if (argv.includes('pgid=')) {
        return {
          status: 0,
          stdout: alive ? '777 777 Thu Aug 13 12:00:00 2026 /bin/sleep 30\n' : '',
          stderr: '',
        };
      }
      if (!alive) return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: 'Thu Aug 13 12:00:00 2026 /bin/sleep 30\n', stderr: '' };
    },
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 'SIGKILL') alive = false;
    },
    sleep: () => {},
  });
  assert.strictEqual(cleanup.cleaned, true);
  assert.deepStrictEqual(signals, [[-777, 'SIGTERM'], [-777, 'SIGKILL']]);
  assert.strictEqual(readResources(created.run_id, root).length, 0);
}));

test('gc removes expired completed runs but preserves recent evidence', () => withRoot(root => {
  const oldRun = createRun({
    root, now: 1_700_000_000_000,
    manifestPath: '/repo/old.yaml', manifestDigest: '7'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  const recent = createRun({
    root, now: 1_700_090_000_000,
    manifestPath: '/repo/recent.yaml', manifestDigest: '8'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  updateState(oldRun.run_id, root, { status: 'completed' });
  updateState(recent.run_id, root, { status: 'completed' });
  const result = gcRuns(root, { now: 1_700_100_000_000, retentionMs: 86_400_000 });
  assert.deepStrictEqual(result.removed, [oldRun.run_id]);
  assert.strictEqual(fs.existsSync(oldRun.run_directory), false);
  assert.strictEqual(fs.existsSync(recent.run_directory), true);
}));

test('gc preserves an expired run while an owned resource cannot be cleaned', () => withRoot(root => {
  const created = createRun({
    root, now: 1_700_000_000_000,
    manifestPath: '/repo/owned.yaml', manifestDigest: '8'.repeat(64),
    route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
  });
  updateState(created.run_id, root, { status: 'error', supervisor_pid: null });
  writeResource(created.run_id, root, {
    kind: 'podman', name: 'ecc-owned', id: 'b'.repeat(64),
    owner_token: created.session.owner_token,
  });
  const result = gcRuns(root, {
    now: 1_700_200_000_000,
    retentionMs: 1,
    run: (_executable, argv) => {
      if (argv[0] === 'info') return {
        status: 0, stdout: JSON.stringify({ host: { security: { rootless: true } } }), stderr: '',
      };
      if (argv[0] === 'inspect') return {
        status: 0,
        stdout: JSON.stringify([{ Id: 'b'.repeat(64), Config: { Labels: {
          'io.ecc.sandbox.run': created.run_id,
          'io.ecc.sandbox.owner': created.session.owner_token,
        } } }]),
        stderr: '',
      };
      return { status: 1, stdout: '', stderr: 'transient removal failure' };
    },
  });
  assert.ok(!result.removed.includes(created.run_id));
  assert.strictEqual(fs.existsSync(created.run_directory), true);
  assert.strictEqual(readResources(created.run_id, root).length, 1);
  assert.match(readRun(created.run_id, root).state.cleanup_error, /transient removal failure/);
}));

test('exports MP4 from the redacted journal using an argument-safe renderer plan', () => withRoot(root => {
  const created = createRun({
    root, now: 1_700_000_000_000,
    manifestPath: '/repo/sandbox.yaml', manifestDigest: '9'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  appendEvent(created.run_id, root, {
    type: 'step.output', phase: 'setup', text: 'token=super-secret-value',
  }, { now: 1_700_000_000_100, monotonicMs: 100 });
  updateState(created.run_id, root, { status: 'completed' });
  let rendererArgs;
  const result = exportMp4(created.run_id, root, {
    run: (_executable, argv) => {
      if (argv[0] === '-version') return { status: 0, stdout: 'ffmpeg version test', stderr: '' };
      rendererArgs = argv;
      fs.writeFileSync(argv.at(-1), 'fake-video', { mode: 0o600 });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.ok(rendererArgs.includes('-vf'));
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(fs.readFileSync(path.join(created.run_directory, 'review.srt'), 'utf8'), /super-secret/);
}));

test('publishes a complete redacted output line before a delayed command exits', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '1'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-exec.js'),
    created.run_id, root, 'setup', '--',
    '/bin/sh', '-c', "printf 'token=early-secret-value begin\\n'; sleep 0.5; printf 'end\\n'",
  ], { shell: false, stdio: 'ignore' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180);
  const during = listEvents(created.run_id, root);
  assert.strictEqual(during.length, 1);
  assert.strictEqual(during[0].text, '[REDACTED] begin\n');
  assert.strictEqual(during[0].redaction_count, 1);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 550);
  assert.deepStrictEqual(listEvents(created.run_id, root).map(event => event.text), [
    '[REDACTED] begin\n', 'end\n',
  ]);
}));

test('streaming runner returns captured stdout and stderr for report classification', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '4'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  const result = runStreaming('/bin/sh', [
    '-c',
    "printf 'visible stdout\\n'; printf 'permission denied\\n' >&2; exit 77",
  ], {
    encoding: 'utf8',
    shell: false,
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    streamOutput: { runId: created.run_id, root, phase: 'setup' },
  });
  assert.strictEqual(result.status, 77);
  assert.match(result.stdout, /visible stdout/);
  assert.match(result.stderr, /permission denied/);
  assert.deepStrictEqual(listEvents(created.run_id, root).map(event => event.stream), [
    'stdout', 'stderr',
  ]);
}));

test('forwards stop to the detached command group and clears its process receipt', () => withRoot(root => {
  const created = createRun({
    root,
    manifestPath: '/repo/sandbox.yaml',
    manifestDigest: '2'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  const wrapper = spawn(process.execPath, [
    path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-exec.js'),
    created.run_id, root, 'assert', '--', '/bin/sleep', '30',
  ], { shell: false, stdio: 'ignore' });
  let receipt = null;
  for (let attempt = 0; attempt < 30 && !receipt; attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    receipt = readResources(created.run_id, root).find(resource => resource.kind === 'process');
  }
  assert.ok(receipt, 'stream wrapper did not register the child process');
  const control = createControl(created.run_id, root, 'stop');
  for (let attempt = 0; attempt < 60 && readResources(created.run_id, root).length > 0; attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert.strictEqual(readResources(created.run_id, root).length, 0);
  assert.strictEqual(readControlResponse(created.run_id, root, control.control_id).stopping, true);
  assert.throws(() => process.kill(receipt.pid, 0), /ESRCH/);
  try { process.kill(wrapper.pid, 'SIGKILL'); } catch { /* wrapper already exited */ }
}));

test('retains ownership until redirected background children are cleaned', () => withRoot(root => {
  const created = createRun({
    root, manifestPath: '/repo/sandbox.yaml', manifestDigest: '3'.repeat(64),
    route: { backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' },
  });
  spawn(process.execPath, [
    path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'stream-exec.js'),
    created.run_id, root, 'setup', '--',
    '/bin/sh', '-c', 'sleep 20 >/dev/null 2>&1 &',
  ], { shell: false, stdio: 'ignore' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const receipt = readResources(created.run_id, root)[0];
  assert.strictEqual(receipt.kind, 'process');
  assert.strictEqual(receipt.pgid, receipt.pid);
  const cleanup = cleanupOwnedResource(created.run_id, root);
  assert.strictEqual(cleanup.cleaned, true);
  assert.strictEqual(readResources(created.run_id, root).length, 0);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
