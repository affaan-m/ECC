'use strict';

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'cancelled']);
const TASK_RESULTS = new Set(['pass', 'fail', 'error']);
const DEFAULT_POLICY = Object.freeze({
  max_parallel: 4,
  cpu: 8,
  memory_mb: 4096,
  lease_ms: 60_000,
  per_tier: Object.freeze({ 2: 1 }),
});

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function normalizePolicy(policy = {}) {
  const perTier = { 2: 1 };
  for (const [tier, limit] of Object.entries(policy.per_tier || {})) {
    if (!/^[0-3]$/.test(tier)) throw new Error(`invalid tier quota: ${tier}`);
    perTier[Number(tier)] = requireInteger(limit, `Tier ${tier} quota`, 1);
  }
  return {
    max_parallel: requireInteger(
      policy.max_parallel ?? DEFAULT_POLICY.max_parallel,
      'max_parallel',
      1
    ),
    cpu: requireInteger(policy.cpu ?? DEFAULT_POLICY.cpu, 'cpu budget', 1),
    memory_mb: requireInteger(
      policy.memory_mb ?? DEFAULT_POLICY.memory_mb,
      'memory budget',
      1
    ),
    lease_ms: requireInteger(policy.lease_ms ?? DEFAULT_POLICY.lease_ms, 'lease_ms', 1),
    per_tier: perTier,
  };
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('task definitions must be objects');
  }
  if (typeof task.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(task.id)) {
    throw new Error('task id must use 1-120 letters, digits, dots, underscores, or hyphens');
  }
  const dependencies = task.depends_on ?? [];
  if (!Array.isArray(dependencies) || dependencies.some(value => typeof value !== 'string')) {
    throw new Error(`task ${task.id} depends_on must be an array of task ids`);
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new Error(`task ${task.id} contains duplicate dependencies`);
  }
  return {
    id: task.id,
    tier: requireInteger(task.tier ?? 0, `task ${task.id} tier`, 0),
    cpu: requireInteger(task.cpu ?? 1, `task ${task.id} cpu`, 1),
    memory_mb: requireInteger(task.memory_mb ?? 0, `task ${task.id} memory_mb`, 0),
    depends_on: [...dependencies],
    priority: requireInteger(task.priority ?? 0, `task ${task.id} priority`, 0),
  };
}

function calculateReservations(tasks) {
  const reservations = { running: 0, cpu: 0, memory_mb: 0, by_tier: {} };
  for (const task of Object.values(tasks)) {
    if (task.status !== 'running') continue;
    reservations.running += 1;
    reservations.cpu += task.cpu;
    reservations.memory_mb += task.memory_mb;
    reservations.by_tier[task.tier] = (reservations.by_tier[task.tier] || 0) + 1;
  }
  return reservations;
}

function createInitialState(plan, options = {}) {
  if (!plan || !Array.isArray(plan.tasks)) throw new Error('scheduler plan requires a tasks array');
  const policy = normalizePolicy(plan.policy);
  const tasks = {};
  for (const source of plan.tasks) {
    const definition = normalizeTask(source);
    if (definition.tier > 3) throw new Error(`task ${definition.id} tier must be between 0 and 3`);
    if (tasks[definition.id]) throw new Error(`duplicate task id: ${definition.id}`);
    tasks[definition.id] = {
      ...definition,
      status: 'pending',
      attempt: 0,
      lease_id: null,
      lease_expires_ms: null,
      result: null,
      reason: null,
      started_ms: null,
      finished_ms: null,
    };
  }
  const nowMs = requireInteger(options.now_ms ?? 0, 'now_ms', 0);
  return {
    schema_version: 1,
    created_ms: nowMs,
    updated_ms: nowMs,
    event_count: 0,
    cancelled: false,
    cancellation_reason: null,
    policy,
    tasks,
    reservations: calculateReservations(tasks),
  };
}

function taskForEvent(state, event) {
  const task = state.tasks[event.task_id];
  if (!task) throw new Error(`unknown scheduler task: ${event.task_id}`);
  return task;
}

function requireLease(task, event) {
  if (typeof event.lease_id !== 'string' || event.lease_id.length === 0) {
    throw new Error(`event ${event.type} requires a lease id`);
  }
  if (task.lease_id !== event.lease_id) {
    throw new Error(`task ${task.id} lease does not match its active lease`);
  }
}

function withTask(state, task) {
  const tasks = { ...state.tasks, [task.id]: task };
  return { ...state, tasks, reservations: calculateReservations(tasks) };
}

function applyTaskEvent(state, event) {
  const task = taskForEvent(state, event);
  if (event.type === 'task.started') {
    if (task.status !== 'pending') throw new Error(`task ${task.id} is not pending`);
    if (state.cancelled) throw new Error('scheduler is cancelled');
    if (!task.depends_on.every(id => state.tasks[id]?.status === 'passed')) {
      throw new Error(`task ${task.id} dependencies are not satisfied`);
    }
    const tierLimit = state.policy.per_tier[task.tier] ?? state.policy.max_parallel;
    if (
      state.reservations.running >= state.policy.max_parallel
      || (state.reservations.by_tier[task.tier] || 0) >= tierLimit
      || state.reservations.cpu + task.cpu > state.policy.cpu
      || state.reservations.memory_mb + task.memory_mb > state.policy.memory_mb
    ) {
      throw new Error(`task ${task.id} cannot reserve scheduler capacity`);
    }
    if (typeof event.lease_id !== 'string' || event.lease_id.length === 0) {
      throw new Error('task.started requires a lease id');
    }
    requireInteger(event.lease_expires_ms, 'lease_expires_ms', 1);
    if (event.lease_expires_ms <= event.now_ms) {
      throw new Error('task lease must expire after task start');
    }
    return withTask(state, {
      ...task,
      status: 'running',
      attempt: task.attempt + 1,
      lease_id: event.lease_id,
      lease_expires_ms: event.lease_expires_ms,
      started_ms: event.now_ms,
      reason: null,
    });
  }

  if (event.type === 'task.lease_renewed') {
    if (task.status !== 'running') throw new Error(`task ${task.id} is not running`);
    requireLease(task, event);
    requireInteger(event.lease_expires_ms, 'lease_expires_ms', 1);
    if (event.lease_expires_ms <= task.lease_expires_ms) {
      throw new Error('renewed lease must extend the active deadline');
    }
    return withTask(state, { ...task, lease_expires_ms: event.lease_expires_ms });
  }

  if (event.type === 'task.lease_expired') {
    if (task.status !== 'running') throw new Error(`task ${task.id} is not running`);
    requireLease(task, event);
    if (event.now_ms < task.lease_expires_ms) throw new Error(`task ${task.id} lease is still active`);
    return withTask(state, {
      ...task,
      status: 'failed',
      result: 'error',
      reason: 'lease expired',
      lease_id: null,
      lease_expires_ms: null,
      finished_ms: event.now_ms,
    });
  }

  if (event.type === 'task.completed') {
    if (task.status !== 'running') throw new Error(`task ${task.id} is not running`);
    requireLease(task, event);
    if (!TASK_RESULTS.has(event.result)) throw new Error(`invalid task result: ${event.result}`);
    return withTask(state, {
      ...task,
      status: event.result === 'pass' ? 'passed' : 'failed',
      result: event.result,
      reason: event.reason || null,
      lease_id: null,
      lease_expires_ms: null,
      finished_ms: event.now_ms,
    });
  }

  if (event.type === 'task.cancelled') {
    if (TERMINAL_STATUSES.has(task.status)) throw new Error(`task ${task.id} is already terminal`);
    return withTask(state, {
      ...task,
      status: 'cancelled',
      result: null,
      reason: event.reason || 'cancelled',
      lease_id: null,
      lease_expires_ms: null,
      finished_ms: event.now_ms,
    });
  }

  throw new Error(`unsupported scheduler event: ${event.type}`);
}

function cancelScheduler(state, event) {
  if (state.cancelled) throw new Error('scheduler is already cancelled');
  const reason = event.reason || 'scheduler cancelled';
  const tasks = Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => (
    TERMINAL_STATUSES.has(task.status)
      ? [id, task]
      : [id, {
        ...task,
        status: 'cancelled',
        result: null,
        reason,
        lease_id: null,
        lease_expires_ms: null,
        finished_ms: event.now_ms,
      }]
  )));
  return {
    ...state,
    cancelled: true,
    cancellation_reason: reason,
    tasks,
    reservations: calculateReservations(tasks),
  };
}

function reduceSchedulerEvent(state, event) {
  if (!state || state.schema_version !== 1) throw new Error('invalid scheduler state');
  if (!event || typeof event.type !== 'string') throw new Error('scheduler event requires a type');
  requireInteger(event.now_ms, 'event now_ms', 0);
  const changed = event.type === 'scheduler.cancelled'
    ? cancelScheduler(state, event)
    : applyTaskEvent(state, event);
  return {
    ...changed,
    updated_ms: event.now_ms,
    event_count: state.event_count + 1,
  };
}

module.exports = {
  DEFAULT_POLICY,
  TERMINAL_STATUSES,
  calculateReservations,
  createInitialState,
  normalizePolicy,
  normalizeTask,
  reduceSchedulerEvent,
};
