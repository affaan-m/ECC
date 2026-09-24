'use strict';

/**
 * Shared work-item mutation helpers for the agent+human JIT board.
 *
 * Used by both the `work-items.js` CLI (`claim`) and the control-pane local
 * server (interactive claim / move), so the two surfaces never diverge.
 */

const DONE_STATUSES = new Set(['done', 'closed', 'resolved', 'merged', 'cancelled']);
const PRIORITY_RANK = { critical: 0, high: 1, urgent: 1, medium: 2, normal: 2, low: 3 };

// Kanban lanes the board renders, and the canonical status each maps to on a move.
const LANE_TO_STATUS = {
  ready: 'open',
  running: 'running',
  blocked: 'blocked',
  done: 'done'
};
const VALID_LANES = new Set(Object.keys(LANE_TO_STATUS));
const VALID_ASSIGNEE_KINDS = new Set(['agent', 'human']);

function isOpenStatus(status) {
  return !DONE_STATUSES.has(
    String(status || '')
      .trim()
      .toLowerCase()
  );
}

function priorityRank(priority) {
  return PRIORITY_RANK[String(priority || '').toLowerCase()] ?? 2;
}

/**
 * Resolve which work item a claim targets: an explicit id, otherwise the
 * highest-priority unassigned open item (the JIT pickup queue).
 */
function selectClaimTarget(store, { id } = {}) {
  if (id) {
    const item = store.getWorkItemById(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }
    return item;
  }
  const { items } = store.listWorkItems({ limit: 100 });
  return items.filter(item => !item.owner && isOpenStatus(item.status)).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))[0] || null;
}

/**
 * Claim an unassigned work item for an agent or human. Sets the owner (and
 * optional assigneeKind) and moves the card to running unless an explicit
 * status is supplied. Returns { claimed, item } or { claimed: false, reason }.
 */
function claimWorkItem(store, { id, owner, assigneeKind, sessionId, status } = {}) {
  if (!owner) {
    throw new Error('claim requires an owner.');
  }
  const kind = assigneeKind ? String(assigneeKind).toLowerCase() : null;
  if (kind && !VALID_ASSIGNEE_KINDS.has(kind)) {
    throw new Error("assigneeKind must be 'agent' or 'human'.");
  }
  const target = selectClaimTarget(store, { id });
  if (!target) {
    return { claimed: false, reason: 'no-unassigned-open-items' };
  }
  if (!isOpenStatus(target.status)) {
    throw new Error(`Work item ${target.id} is already done; cannot claim.`);
  }
  const metadata = { ...(target.metadata || {}) };
  if (kind) {
    metadata.assigneeKind = kind;
  }
  const item = store.upsertWorkItem({
    ...target,
    owner,
    sessionId: sessionId ?? target.sessionId ?? null,
    status: status ?? 'running',
    metadata,
    updatedAt: new Date().toISOString()
  });
  return { claimed: true, item };
}

/**
 * Move a work item to a kanban lane (ready | running | blocked | done).
 */
function moveWorkItem(store, { id, lane } = {}) {
  if (!id) {
    throw new Error('move requires a work item id.');
  }
  const laneKey = String(lane || '')
    .trim()
    .toLowerCase();
  if (!VALID_LANES.has(laneKey)) {
    throw new Error(`Invalid lane '${lane}'. Expected one of ${[...VALID_LANES].join(', ')}.`);
  }
  const target = store.getWorkItemById(id);
  if (!target) {
    throw new Error(`Work item not found: ${id}`);
  }
  const item = store.upsertWorkItem({
    ...target,
    status: LANE_TO_STATUS[laneKey],
    updatedAt: new Date().toISOString()
  });
  return { moved: true, item };
}

module.exports = {
  DONE_STATUSES,
  LANE_TO_STATUS,
  VALID_LANES,
  VALID_ASSIGNEE_KINDS,
  isOpenStatus,
  priorityRank,
  selectClaimTarget,
  claimWorkItem,
  moveWorkItem
};
