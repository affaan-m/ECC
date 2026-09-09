'use strict';

const crypto = require('crypto');
const {
  createInitialState,
  normalizePolicy,
  normalizeTask,
  reduceSchedulerEvent,
} = require('./reducer');

function validateDag(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('scheduler plan requires at least one task');
  }
  const normalized = tasks.map(normalizeTask);
  const byId = new Map();
  for (const task of normalized) {
    if (byId.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    byId.set(task.id, task);
  }
  for (const task of normalized) {
    for (const dependency of task.depends_on) {
      if (dependency === task.id) throw new Error(`task ${task.id} cannot depend on itself`);
      if (!byId.has(dependency)) {
        throw new Error(`task ${task.id} has unknown dependency ${dependency}`);
      }
    }
  }

  const incoming = new Map(normalized.map(task => [task.id, task.depends_on.length]));
  const dependents = new Map(normalized.map(task => [task.id, []]));
  for (const task of normalized) {
    for (const dependency of task.depends_on) dependents.get(dependency).push(task.id);
  }
  const ready = normalized.filter(task => incoming.get(task.id) === 0).map(task => task.id).sort();
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const dependent of dependents.get(id).sort()) {
      incoming.set(dependent, incoming.get(dependent) - 1);
      if (incoming.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (ordered.length !== normalized.length) throw new Error('scheduler task graph contains a cycle');
  return ordered;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('scheduler plan must be an object');
  }
  const order = validateDag(plan.tasks);
  const policy = normalizePolicy(plan.policy);
  for (const source of plan.tasks) {
    const task = normalizeTask(source);
    if (task.tier > 3) throw new Error(`task ${task.id} tier must be between 0 and 3`);
    if (task.cpu > policy.cpu) throw new Error(`task ${task.id} CPU request exceeds scheduler budget`);
    if (task.memory_mb > policy.memory_mb) {
      throw new Error(`task ${task.id} memory request exceeds scheduler budget`);
    }
  }
  return { order, policy };
}

function createScheduler(plan, options = {}) {
  validatePlan(plan);
  return createInitialState(plan, options);
}

function deterministicReadyTasks(state) {
  return Object.values(state.tasks)
    .filter(task => task.status === 'pending')
    .filter(task => task.depends_on.every(id => state.tasks[id].status === 'passed'))
    .sort((left, right) => (
      right.priority - left.priority || left.id.localeCompare(right.id)
    ));
}

function canReserve(state, task) {
  const { policy, reservations } = state;
  const tierLimit = policy.per_tier[task.tier] ?? policy.max_parallel;
  return (
    reservations.running < policy.max_parallel
    && (reservations.by_tier[task.tier] || 0) < tierLimit
    && reservations.cpu + task.cpu <= policy.cpu
    && reservations.memory_mb + task.memory_mb <= policy.memory_mb
  );
}

function applyAndRecord(state, events, event) {
  events.push(event);
  return reduceSchedulerEvent(state, event);
}

function expireLeases(state, events, nowMs) {
  let next = state;
  const expired = Object.values(next.tasks)
    .filter(task => task.status === 'running' && task.lease_expires_ms <= nowMs)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const task of expired) {
    next = applyAndRecord(next, events, {
      type: 'task.lease_expired',
      task_id: task.id,
      lease_id: task.lease_id,
      now_ms: nowMs,
    });
  }
  return next;
}

function cancelBlockedDependencies(state, events, nowMs) {
  let next = state;
  let changed = true;
  while (changed) {
    changed = false;
    const pending = Object.values(next.tasks)
      .filter(task => task.status === 'pending')
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const task of pending) {
      const failedDependency = [...task.depends_on]
        .sort()
        .map(id => next.tasks[id])
        .find(dependency => ['failed', 'cancelled'].includes(dependency.status));
      if (!failedDependency) continue;
      next = applyAndRecord(next, events, {
        type: 'task.cancelled',
        task_id: task.id,
        reason: `dependency ${failedDependency.id} ${failedDependency.status === 'failed' ? failedDependency.result : 'cancelled'}`,
        now_ms: nowMs,
      });
      changed = true;
    }
  }
  return next;
}

function defaultLeaseId() {
  return `lease_${crypto.randomBytes(32).toString('hex')}`;
}

function dispatchReadyTasks(state, events, nowMs, leaseIdFactory) {
  let next = state;
  for (const candidate of deterministicReadyTasks(next)) {
    const task = next.tasks[candidate.id];
    if (!canReserve(next, task)) continue;
    const leaseId = leaseIdFactory(task, nowMs);
    if (typeof leaseId !== 'string' || leaseId.length === 0) {
      throw new Error(`lease factory returned an invalid lease for ${task.id}`);
    }
    next = applyAndRecord(next, events, {
      type: 'task.started',
      task_id: task.id,
      lease_id: leaseId,
      lease_expires_ms: nowMs + next.policy.lease_ms,
      now_ms: nowMs,
    });
  }
  return next;
}

function advanceScheduler(state, options = {}) {
  if (!state || state.schema_version !== 1) throw new Error('invalid scheduler state');
  const nowMs = options.now_ms;
  if (!Number.isSafeInteger(nowMs) || nowMs < state.updated_ms) {
    throw new Error('advanceScheduler now_ms must be a monotonic non-negative integer');
  }
  if (state.cancelled) return { state, events: [] };
  const events = [];
  let next = expireLeases(state, events, nowMs);
  next = cancelBlockedDependencies(next, events, nowMs);
  next = dispatchReadyTasks(
    next,
    events,
    nowMs,
    options.lease_id_factory || defaultLeaseId
  );
  return { state: next, events };
}

module.exports = {
  advanceScheduler,
  canReserve,
  createScheduler,
  deterministicReadyTasks,
  validateDag,
  validatePlan,
};
