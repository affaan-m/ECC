'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createInitialState,
  reduceSchedulerEvent,
} = require('../../scripts/sandbox/fabric/reducer');
const {
  advanceScheduler,
  createScheduler,
  validateDag,
} = require('../../scripts/sandbox/fabric/scheduler');
const {
  appendEventAtomic,
  readEventLog,
  replayEventLog,
} = require('../../scripts/sandbox/fabric/event-store');

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

function task(id, overrides = {}) {
  return {
    id,
    tier: 0,
    cpu: 1,
    memory_mb: 128,
    depends_on: [],
    priority: 0,
    ...overrides,
  };
}

function plan(tasks, policy = {}) {
  return {
    tasks,
    policy: {
      max_parallel: 4,
      cpu: 8,
      memory_mb: 4096,
      lease_ms: 1_000,
      per_tier: {},
      ...policy,
    },
  };
}

function event(type, taskId, overrides = {}) {
  return { type, task_id: taskId, now_ms: 1_000, ...overrides };
}

console.log('\n=== ECC execution fabric scheduler tests ===\n');

test('validates task identity, dependencies, and acyclic graphs', () => {
  assert.deepStrictEqual(validateDag([
    task('build'),
    task('test', { depends_on: ['build'] }),
  ]), ['build', 'test']);
  assert.throws(() => validateDag([task('same'), task('same')]), /duplicate task id/i);
  assert.throws(() => validateDag([task('test', { depends_on: ['missing'] })]), /unknown dependency/i);
  assert.throws(() => validateDag([task('self', { depends_on: ['self'] })]), /depend on itself/i);
  assert.throws(() => validateDag([
    task('one', { depends_on: ['two'] }),
    task('two', { depends_on: ['one'] }),
  ]), /cycle/i);
});

test('fails closed on invalid policies and unschedulable resource requests', () => {
  assert.throws(() => createScheduler(null), /plan must be an object/i);
  assert.throws(() => createScheduler({ tasks: [] }), /at least one task/i);
  assert.throws(() => createScheduler(plan([task('bad', { tier: 4 })])), /tier must be between/i);
  assert.throws(() => createScheduler(plan([task('cpu', { cpu: 9 })], { cpu: 8 })), /CPU request exceeds/i);
  assert.throws(
    () => createScheduler(plan([task('memory', { memory_mb: 500 })], { memory_mb: 400 })),
    /memory request exceeds/i
  );
  assert.throws(() => createScheduler(plan([task('bad')], { max_parallel: 0 })), /max_parallel/i);
  assert.throws(() => createScheduler(plan([task('bad')], { per_tier: { 4: 1 } })), /invalid tier quota/i);
  assert.throws(() => validateDag([task('dup', { depends_on: ['x', 'x'] })]), /duplicate dependencies/i);
  assert.throws(() => validateDag([task('bad id!')]), /task id/i);
});

test('dispatches ready tasks deterministically while honoring global and tier quotas', () => {
  const state = createScheduler(plan([
    task('z-low', { priority: 1 }),
    task('b-high', { priority: 10 }),
    task('a-high', { priority: 10 }),
    task('tier-one', { tier: 1, priority: 20 }),
  ], {
    max_parallel: 3,
    per_tier: { 0: 2, 1: 1 },
  }), { now_ms: 100 });

  const advanced = advanceScheduler(state, { now_ms: 200 });
  assert.deepStrictEqual(
    advanced.events.filter(item => item.type === 'task.started').map(item => item.task_id),
    ['tier-one', 'a-high', 'b-high']
  );
  assert.strictEqual(advanced.state.reservations.running, 3);
  assert.deepStrictEqual(advanced.state.reservations.by_tier, { 0: 2, 1: 1 });
  assert.strictEqual(advanced.state.tasks['z-low'].status, 'pending');
});

test('reserves CPU and memory, then releases both when a task completes', () => {
  let state = createScheduler(plan([
    task('large', { cpu: 3, memory_mb: 700, priority: 10 }),
    task('small', { cpu: 2, memory_mb: 400 }),
  ], { max_parallel: 2, cpu: 4, memory_mb: 900 }), { now_ms: 0 });

  let advanced = advanceScheduler(state, { now_ms: 10 });
  assert.deepStrictEqual(advanced.events.map(item => item.task_id), ['large']);
  assert.deepStrictEqual(advanced.state.reservations, {
    running: 1,
    cpu: 3,
    memory_mb: 700,
    by_tier: { 0: 1 },
  });

  const leaseId = advanced.state.tasks.large.lease_id;
  state = reduceSchedulerEvent(advanced.state, event('task.completed', 'large', {
    lease_id: leaseId,
    result: 'pass',
    now_ms: 20,
  }));
  advanced = advanceScheduler(state, { now_ms: 21 });
  assert.deepStrictEqual(advanced.events.map(item => item.task_id), ['small']);
  assert.strictEqual(advanced.state.reservations.cpu, 2);
  assert.strictEqual(advanced.state.reservations.memory_mb, 400);
});

test('defaults Tier 2 concurrency to one without restricting other tiers', () => {
  const state = createScheduler(plan([
    task('vm-a', { tier: 2 }),
    task('vm-b', { tier: 2 }),
    task('host', { tier: 0 }),
  ]), { now_ms: 0 });
  const advanced = advanceScheduler(state, { now_ms: 5 });
  const started = advanced.events.map(item => item.task_id);
  assert.deepStrictEqual(started, ['host', 'vm-a']);
  assert.strictEqual(advanced.state.tasks['vm-b'].status, 'pending');
});

test('uses unpredictable default lease IDs while retaining an injected deterministic factory', () => {
  const first = advanceScheduler(
    createScheduler(plan([task('worker')]), { now_ms: 0 }),
    { now_ms: 10 }
  ).state.tasks.worker.lease_id;
  const second = advanceScheduler(
    createScheduler(plan([task('worker')]), { now_ms: 0 }),
    { now_ms: 10 }
  ).state.tasks.worker.lease_id;
  assert.match(first, /^lease_[a-f0-9]{64}$/);
  assert.match(second, /^lease_[a-f0-9]{64}$/);
  assert.notStrictEqual(first, second);

  const deterministic = advanceScheduler(
    createScheduler(plan([task('worker')]), { now_ms: 0 }),
    { now_ms: 10, lease_id_factory: () => 'lease-test-fixed' }
  );
  assert.strictEqual(deterministic.state.tasks.worker.lease_id, 'lease-test-fixed');
});

test('reducer returns new state without mutating its input', () => {
  const initial = createInitialState(plan([task('one')]), { now_ms: 0 });
  const snapshot = JSON.parse(JSON.stringify(initial));
  const next = reduceSchedulerEvent(initial, event('task.started', 'one', {
    lease_id: 'lease-one',
    lease_expires_ms: 2_000,
  }));
  assert.deepStrictEqual(initial, snapshot);
  assert.notStrictEqual(next, initial);
  assert.notStrictEqual(next.tasks, initial.tasks);
  assert.strictEqual(next.tasks.one.status, 'running');
});

test('reducer rejects premature dispatch, exhausted capacity, and invalid terminal events', () => {
  let state = createInitialState(plan([
    task('root', { tier: 2 }),
    task('dependent', { depends_on: ['root'] }),
    task('second-vm', { tier: 2 }),
  ]), { now_ms: 0 });
  assert.throws(() => reduceSchedulerEvent(state, event('task.started', 'dependent', {
    lease_id: 'early', lease_expires_ms: 2_000,
  })), /dependencies are not satisfied/i);
  state = reduceSchedulerEvent(state, event('task.started', 'root', {
    lease_id: 'active', lease_expires_ms: 2_000,
  }));
  assert.throws(() => reduceSchedulerEvent(state, event('task.started', 'second-vm', {
    lease_id: 'over-capacity', lease_expires_ms: 2_000,
  })), /cannot reserve scheduler capacity/i);
  assert.throws(() => reduceSchedulerEvent(state, event('task.completed', 'root', {
    lease_id: 'active', result: 'unknown',
  })), /invalid task result/i);
  assert.throws(() => reduceSchedulerEvent(state, event('task.lease_expired', 'root', {
    lease_id: 'active', now_ms: 1_999,
  })), /lease is still active/i);
  assert.throws(() => reduceSchedulerEvent(state, event('unsupported', 'root')), /unsupported scheduler event/i);
  assert.throws(() => reduceSchedulerEvent(null, event('task.cancelled', 'root')), /invalid scheduler state/i);
  assert.throws(() => reduceSchedulerEvent(state, {}), /requires a type/i);
});

test('cancels direct and transitive dependents after a failed task', () => {
  let state = createScheduler(plan([
    task('compile'),
    task('unit', { depends_on: ['compile'] }),
    task('package', { depends_on: ['unit'] }),
    task('independent'),
  ]), { now_ms: 0 });
  let advanced = advanceScheduler(state, { now_ms: 10 });
  const leaseId = advanced.state.tasks.compile.lease_id;
  state = reduceSchedulerEvent(advanced.state, event('task.completed', 'compile', {
    lease_id: leaseId,
    result: 'fail',
    now_ms: 20,
  }));
  advanced = advanceScheduler(state, { now_ms: 21 });
  assert.deepStrictEqual(
    advanced.events.filter(item => item.type === 'task.cancelled').map(item => item.task_id),
    ['unit', 'package']
  );
  assert.strictEqual(advanced.state.tasks.unit.reason, 'dependency compile fail');
  assert.strictEqual(advanced.state.tasks.package.reason, 'dependency unit cancelled');
  assert.notStrictEqual(advanced.state.tasks.independent.status, 'cancelled');
});

test('expires leases, cascades cancellation, and rejects stale worker completion', () => {
  let state = createScheduler(plan([
    task('worker'),
    task('consumer', { depends_on: ['worker'] }),
  ], { lease_ms: 50 }), { now_ms: 0 });
  let advanced = advanceScheduler(state, { now_ms: 100 });
  const leaseId = advanced.state.tasks.worker.lease_id;
  advanced = advanceScheduler(advanced.state, { now_ms: 151 });
  assert.deepStrictEqual(advanced.events.map(item => item.type), [
    'task.lease_expired',
    'task.cancelled',
  ]);
  assert.strictEqual(advanced.state.tasks.worker.status, 'failed');
  assert.strictEqual(advanced.state.tasks.consumer.status, 'cancelled');
  assert.throws(() => reduceSchedulerEvent(
    advanced.state,
    event('task.completed', 'worker', { lease_id: leaseId, result: 'pass', now_ms: 152 })
  ), /not running/i);
});

test('renews only the active lease and honors the extended deadline', () => {
  let state = createScheduler(plan([task('worker')], { lease_ms: 100 }), { now_ms: 0 });
  state = advanceScheduler(state, { now_ms: 10 }).state;
  const leaseId = state.tasks.worker.lease_id;
  assert.throws(() => reduceSchedulerEvent(state, event('task.lease_renewed', 'worker', {
    lease_id: 'stale-lease', lease_expires_ms: 500, now_ms: 100,
  })), /lease does not match/i);
  state = reduceSchedulerEvent(state, event('task.lease_renewed', 'worker', {
    lease_id: leaseId, lease_expires_ms: 500, now_ms: 100,
  }));
  const advanced = advanceScheduler(state, { now_ms: 499 });
  assert.deepStrictEqual(advanced.events, []);
  assert.strictEqual(advanced.state.tasks.worker.status, 'running');
});

test('global cancellation releases reservations and cancels unfinished work', () => {
  let state = createScheduler(plan([task('a'), task('b')]), { now_ms: 0 });
  state = advanceScheduler(state, { now_ms: 1 }).state;
  state = reduceSchedulerEvent(state, {
    type: 'scheduler.cancelled', now_ms: 2, reason: 'operator requested stop',
  });
  assert.strictEqual(state.cancelled, true);
  assert.strictEqual(state.tasks.a.status, 'cancelled');
  assert.strictEqual(state.tasks.b.status, 'cancelled');
  assert.deepStrictEqual(state.reservations, {
    running: 0, cpu: 0, memory_mb: 0, by_tier: {},
  });
});

test('atomic event store appends a verified hash chain and replays reducer state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-events-'));
  try {
    const logPath = path.join(root, 'events.jsonl');
    const source = event('task.started', 'one', {
      lease_id: 'lease-one', lease_expires_ms: 500, now_ms: 100,
    });
    const sourceSnapshot = JSON.parse(JSON.stringify(source));
    appendEventAtomic(logPath, source, { now: () => 100 });
    appendEventAtomic(logPath, event('task.completed', 'one', {
      lease_id: 'lease-one', result: 'pass', now_ms: 200,
    }), { now: () => 200 });

    assert.deepStrictEqual(source, sourceSnapshot);
    assert.strictEqual(fs.statSync(logPath).mode & 0o777, 0o600);
    const records = readEventLog(logPath);
    assert.deepStrictEqual(records.map(record => record.seq), [1, 2]);
    assert.strictEqual(records[1].prev_sha256, records[0].sha256);
    assert.match(records[1].sha256, /^[a-f0-9]{64}$/);

    const initial = createInitialState(plan([task('one')]), { now_ms: 0 });
    const replayed = replayEventLog(logPath, initial, reduceSchedulerEvent);
    assert.strictEqual(replayed.tasks.one.status, 'passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('event store rejects tampering and symbolic-link logs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-tamper-'));
  try {
    const logPath = path.join(root, 'events.jsonl');
    appendEventAtomic(logPath, { type: 'scheduler.cancelled', now_ms: 1 }, { now: () => 1 });
    const record = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    record.event.reason = 'substituted';
    fs.writeFileSync(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    assert.throws(() => readEventLog(logPath), /hash mismatch/i);

    const target = path.join(root, 'target.jsonl');
    fs.writeFileSync(target, '', { mode: 0o600 });
    const linked = path.join(root, 'linked.jsonl');
    fs.symlinkSync(target, linked);
    assert.throws(
      () => appendEventAtomic(linked, { type: 'scheduler.cancelled', now_ms: 2 }),
      /symbolic link/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('event store rejects shared parents and symlink swaps during append', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-event-race-'));
  const sharedRoot = path.join(root, 'shared');
  fs.mkdirSync(sharedRoot, { mode: 0o777 });
  fs.chmodSync(sharedRoot, 0o777);
  try {
    assert.throws(
      () => appendEventAtomic(path.join(sharedRoot, 'events.jsonl'), { type: 'first' }),
      /private|permissions/i
    );

    const logPath = path.join(root, 'events.jsonl');
    const target = path.join(root, 'target.jsonl');
    fs.writeFileSync(logPath, '', { mode: 0o600 });
    fs.writeFileSync(target, '', { mode: 0o600 });
    const originalOpenSync = fs.openSync;
    let swapped = false;
    fs.openSync = function swapBeforeOpen(candidate, flags, mode) {
      if (!swapped && path.resolve(candidate) === path.resolve(logPath)) {
        swapped = true;
        fs.unlinkSync(logPath);
        fs.symlinkSync(target, logPath);
      }
      return originalOpenSync.call(fs, candidate, flags, mode);
    };
    try {
      assert.throws(
        () => appendEventAtomic(logPath, { type: 'first' }),
        /symbolic link|too many levels|ELOOP/i
      );
    } finally {
      fs.openSync = originalOpenSync;
    }
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('event store rejects invalid records, timestamps, locks, and event shapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-invalid-events-'));
  try {
    const logPath = path.join(root, 'events.jsonl');
    assert.deepStrictEqual(readEventLog(logPath), []);
    assert.throws(() => appendEventAtomic(logPath, null), /event must be an object/i);
    assert.throws(() => appendEventAtomic(logPath, {}), /event requires a type/i);
    assert.throws(
      () => appendEventAtomic(logPath, { type: 'large', value: 'x'.repeat(300_000) }),
      /event exceeds/i
    );
    assert.throws(
      () => appendEventAtomic(logPath, { type: 'first' }, { now: () => -1 }),
      /timestamp must be a non-negative integer/i
    );
    appendEventAtomic(logPath, { type: 'first' }, { now: () => 10 });
    assert.throws(
      () => appendEventAtomic(logPath, { type: 'older' }, { now: () => 9 }),
      /timestamp must be monotonic/i
    );
    fs.mkdirSync(`${logPath}.lock`);
    try {
      assert.throws(() => appendEventAtomic(logPath, { type: 'locked' }), /locked by another writer/i);
    } finally {
      fs.rmdirSync(`${logPath}.lock`);
    }
    fs.writeFileSync(logPath, '{broken\n', { mode: 0o600 });
    assert.throws(() => readEventLog(logPath), /invalid JSON/i);
    assert.throws(() => replayEventLog(logPath, {}, null), /requires a reducer/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
