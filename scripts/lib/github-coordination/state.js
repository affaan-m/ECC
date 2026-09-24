'use strict';

const { DEFAULT_POLICY, DEFAULT_SCHEMA_VERSION } = require('./policy');
const { extractIssueReferences, extractTasks } = require('./parsing');
const { normalizeLabels, listIssues, editIssue } = require('./gh-api');

function slugifySegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function defaultCoordinationState(issue, policy = DEFAULT_POLICY) {
  return {
    schemaVersion: policy.schemaVersion || DEFAULT_SCHEMA_VERSION,
    kind: 'epic',
    status: 'available',
    owner: issue && issue.author && issue.author.login ? issue.author.login : null,
    branch: null,
    validation: 'pending',
    review: 'not-requested',
    project: {
      state: 'backlog',
      fields: {},
    },
    dependencies: extractIssueReferences(issue && issue.body ? issue.body : ''),
    tasks: extractTasks(issue && issue.body ? issue.body : ''),
    labels: normalizeLabels(issue && issue.labels),
    lastAction: 'sync',
    lastActionAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    notes: null,
  };
}

function getCoordinationState(issue, policy = DEFAULT_POLICY) {
  const { extractCoordinationState } = require('./parsing'); // lazy to avoid circular init order
  let existing;
  try {
    existing = extractCoordinationState(issue && issue.body, policy);
  } catch (error) {
    process.stderr.write(`[github-coordination] Warning: ${error.message} (issue #${issue && issue.number})\n`);
    existing = null;
  }
  if (existing) {
    return {
      ...defaultCoordinationState(issue, policy),
      ...existing,
      project: {
        ...defaultCoordinationState(issue, policy).project,
        ...(existing.project || {}),
      },
      tasks: Array.isArray(existing.tasks) ? existing.tasks : extractTasks(issue && issue.body ? issue.body : ''),
      dependencies: Array.isArray(existing.dependencies) ? existing.dependencies : extractIssueReferences(issue && issue.body ? issue.body : ''),
      labels: Array.isArray(existing.labels) ? existing.labels : normalizeLabels(issue && issue.labels),
    };
  }
  return defaultCoordinationState(issue, policy);
}

function buildIssueStateFromAction(issue, currentState, action, options = {}, policy = DEFAULT_POLICY) {
  const now = new Date().toISOString();
  const next = {
    ...currentState,
    schemaVersion: policy.schemaVersion || DEFAULT_SCHEMA_VERSION,
    kind: 'epic',
    lastAction: action,
    lastActionAt: now,
    lastSyncAt: now,
    labels: normalizeLabels(issue.labels),
    dependencies: Array.isArray(currentState.dependencies) ? currentState.dependencies : extractIssueReferences(issue.body),
    tasks: Array.isArray(currentState.tasks) ? currentState.tasks : extractTasks(issue.body),
  };

  if (options.owner !== undefined) next.owner = options.owner;
  if (options.branch !== undefined) next.branch = options.branch;
  if (options.validation !== undefined) next.validation = options.validation;
  if (options.review !== undefined) next.review = options.review;
  if (options.status !== undefined) next.status = options.status;
  if (options.projectState !== undefined) {
    next.project = { ...(next.project || {}), state: options.projectState };
  }
  if (options.notes !== undefined) next.notes = options.notes;
  if (options.tasks !== undefined) next.tasks = options.tasks;
  if (options.dependencies !== undefined) next.dependencies = options.dependencies;

  return next;
}

function desiredLabelsForState(state, policy = DEFAULT_POLICY) {
  const labels = [];
  const known = policy.labels || DEFAULT_POLICY.labels;

  labels.push(known.epic);
  labels.push(known.synced);

  if (state.status === 'available') labels.push(known.available);
  if (state.status === 'claimed') labels.push(known.claimed);
  if (state.status === 'ready') labels.push(known.ready);
  if (state.status === 'blocked') labels.push(known.blocked);
  if (state.validation === 'passed') labels.push(known.validated);
  if (state.review === 'requested') labels.push(known.reviewRequested);
  if (state.review === 'approved') labels.push(known.reviewApproved);
  if (state.review === 'changes-requested') labels.push(known.reviewChangesRequested);
  if (state.status === 'published') labels.push(known.published);

  return Array.from(new Set(labels.filter(Boolean))).sort();
}

function syncIssueLabels(repo, issue, state, policy = DEFAULT_POLICY, options = {}) {
  const desired = new Set(desiredLabelsForState(state, policy));
  const current = new Set(normalizeLabels(issue.labels));
  const addLabels = Array.from(desired).filter(label => !current.has(label));
  const removeLabels = Array.from(current).filter(label => {
    if (!label.startsWith('coordination:') && label !== (policy.labels && policy.labels.epic)) {
      return false;
    }
    return !desired.has(label);
  });

  if (options.dryRun || (addLabels.length === 0 && removeLabels.length === 0)) {
    return { addLabels, removeLabels };
  }

  if (addLabels.length > 0 || removeLabels.length > 0) {
    editIssue(repo, issue.number, { ...options, addLabels, removeLabels });
  }

  return { addLabels, removeLabels };
}

function findIssueByNumber(issues, issueNumber) {
  return issues.find(issue => Number(issue.number) === Number(issueNumber)) || null;
}

function buildIssueComment(action, repo, issueNumber, state, extra = {}) {
  const summary = [
    `ECC coordination ${action}`,
    `Repo: ${repo}`,
    `Issue: #${issueNumber}`,
    `Status: ${state.status}`,
    `Owner: ${state.owner || '(unassigned)'}`,
    `Branch: ${state.branch || '(none)'}`,
    `Validation: ${state.validation || 'pending'}`,
    `Review: ${state.review || 'not-requested'}`,
  ];

  for (const [key, value] of Object.entries(extra)) {
    summary.push(`${key}: ${value}`);
  }

  summary.push('', 'This comment is part of the append-only coordination audit trail.');
  return summary.join('\n');
}

function mapStateToWorkItemStatus(state) {
  switch (state) {
    case 'blocked':
      return 'blocked';
    case 'published':
      return 'done';
    case 'validated':
    case 'reviewing':
    case 'claimed':
    case 'ready':
      return 'in-progress';
    case 'changes-requested':
      return 'needs-review';
    case 'available':
    default:
      return 'open';
  }
}

function summarizeProjectProjection(state, policy = DEFAULT_POLICY) {
  return {
    enabled: Boolean(policy.project && policy.project.enabled),
    state: state.project && state.project.state ? state.project.state : 'backlog',
    fields: {
      ...(state.project && state.project.fields ? state.project.fields : {}),
    },
  };
}

function summarizeStateForOutput(repo, issue, state, action, policy = DEFAULT_POLICY) {
  return {
    schemaVersion: state.schemaVersion || policy.schemaVersion || DEFAULT_SCHEMA_VERSION,
    repo,
    issueNumber: issue.number,
    issueUrl: issue.url || null,
    issueTitle: issue.title,
    action,
    status: state.status,
    owner: state.owner || null,
    branch: state.branch || null,
    validation: state.validation || 'pending',
    review: state.review || 'not-requested',
    project: summarizeProjectProjection(state, policy),
    dependencies: Array.isArray(state.dependencies) ? state.dependencies : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    labels: normalizeLabels(issue.labels),
    workItemId: `github-${slugifySegment(repo)}-epic-${issue.number}`,
    lastActionAt: state.lastActionAt || null,
    lastSyncAt: state.lastSyncAt || null,
  };
}

function assertIssueClaimable(issue, state) {
  if (String(issue.state || '').toLowerCase() !== 'open') {
    throw new Error(`Issue #${issue.number} is not open`);
  }

  if (state.status === 'claimed') {
    throw new Error(`Issue #${issue.number} is already claimed by ${state.owner || 'unknown'}`);
  }
}

function verifyDependenciesClosed(repo, dependencyNumbers, options = {}, allIssues = null) {
  if (!Array.isArray(dependencyNumbers) || dependencyNumbers.length === 0) {
    return [];
  }

  const issueList = allIssues || listIssues(repo, { ...options, state: 'all', limit: options.limit || 200 });
  const closed = [];
  for (const dependencyNumber of dependencyNumbers) {
    const issue = findIssueByNumber(issueList, dependencyNumber);
    if (!issue) {
      process.stderr.write(`[github-coordination] Warning: dependency issue #${dependencyNumber} not found in issue list (may be in a different repo or beyond limit)\n`);
    } else if (String(issue.state || '').toLowerCase() === 'closed') {
      closed.push(dependencyNumber);
    }
  }

  return closed;
}

module.exports = {
  assertIssueClaimable,
  buildIssueComment,
  buildIssueStateFromAction,
  defaultCoordinationState,
  desiredLabelsForState,
  findIssueByNumber,
  getCoordinationState,
  mapStateToWorkItemStatus,
  slugifySegment,
  summarizeProjectProjection,
  summarizeStateForOutput,
  syncIssueLabels,
  verifyDependenciesClosed,
};
