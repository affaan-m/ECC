'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createStateStore } = require('./state-store');

const DEFAULT_CONFIG_FILE = 'github-native-coordination.json';
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', DEFAULT_CONFIG_FILE);
const DEFAULT_SECTION_MARKER = 'ecc-coordination';
const DEFAULT_SCHEMA_VERSION = 'ecc.github.coordination.v1';
const DEFAULT_LABELS = Object.freeze({
  epic: 'epic',
  available: 'coordination:available',
  claimed: 'coordination:claimed',
  ready: 'coordination:ready',
  blocked: 'coordination:blocked',
  validated: 'coordination:validated',
  reviewRequested: 'coordination:review-requested',
  reviewApproved: 'coordination:review-approved',
  reviewChangesRequested: 'coordination:review-changes-requested',
  published: 'coordination:published',
  synced: 'coordination:synced',
});
const DEFAULT_POLICY = Object.freeze({
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  sectionMarker: DEFAULT_SECTION_MARKER,
  labels: DEFAULT_LABELS,
  review: {
    required: true,
    defaultMode: 'required',
  },
  validation: {
    required: true,
  },
  branchModel: {
    epicOnly: true,
    taskBranches: false,
  },
  project: {
    enabled: false,
    fieldNames: {
      status: 'Status',
      owner: 'Owner',
      branch: 'Branch',
      validation: 'Validation',
      review: 'Review',
    },
  },
});

function normalizeRepo(repo) {
  const parts = String(repo || '').split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }
  const [owner, name] = parts;
  return { owner, name };
}

function slugifySegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function epicWorkItemId(repo, issueNumber) {
  return `github-${slugifySegment(repo)}-epic-${issueNumber}`;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return result.stdout || '';
}

function runGh(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };

  if (!options.useEnvGithubToken) {
    delete env.GITHUB_TOKEN;
  }

  return runCommand(command, commandArgs, { cwd: options.cwd, env });
}

function runGhJson(args, options = {}) {
  try {
    return JSON.parse(runGh(args, options) || 'null');
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function normalizeLabelValue(label) {
  if (typeof label === 'string') {
    return label.trim();
  }
  if (label && typeof label === 'object') {
    return String(label.name || label.label || '').trim();
  }
  return '';
}

function normalizeLabels(labels) {
  return Array.from(new Set((Array.isArray(labels) ? labels : []).map(normalizeLabelValue).filter(Boolean))).sort();
}

function normalizeIssueNumber(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid issue number: ${value}`);
  }
  return parsed;
}

function loadPolicy(rootDir = process.cwd(), configPath = null) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(rootDir, 'config', DEFAULT_CONFIG_FILE);

  if (!fs.existsSync(resolvedPath)) {
    return {
      ...DEFAULT_POLICY,
      sourcePath: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load policy from ${resolvedPath}: ${error.message}`);
  }
  return {
    ...DEFAULT_POLICY,
    ...parsed,
    labels: {
      ...DEFAULT_LABELS,
      ...(parsed.labels || {}),
    },
    review: {
      ...DEFAULT_POLICY.review,
      ...(parsed.review || {}),
    },
    validation: {
      ...DEFAULT_POLICY.validation,
      ...(parsed.validation || {}),
    },
    branchModel: {
      ...DEFAULT_POLICY.branchModel,
      ...(parsed.branchModel || {}),
    },
    project: {
      ...DEFAULT_POLICY.project,
      ...(parsed.project || {}),
      fieldNames: {
        ...DEFAULT_POLICY.project.fieldNames,
        ...((parsed.project || {}).fieldNames || {}),
      },
    },
    sourcePath: resolvedPath,
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBodyForComparison(body) {
  return (body || '').replace(/lastSyncAt:\s*[^\n]+/g, 'lastSyncAt: NORMALIZED');
}

function extractCoordinationState(body, policy = DEFAULT_POLICY) {
  const marker = escapeRegExp(policy.sectionMarker || DEFAULT_SECTION_MARKER);
  const regex = new RegExp(
    `<!--\\s*${marker}:start\\s*-->\\s*` +
    '```json\\s*([\\s\\S]*?)\\s*```' +
    `\\s*<!--\\s*${marker}:end\\s*-->`,
    'm'
  );
  const match = String(body || '').match(regex);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function extractIssueReferences(text) {
  const refs = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/(?:^|[^\d])#(\d+)\b/g)) {
    refs.add(Number.parseInt(match[1], 10));
  }
  return Array.from(refs).filter(Number.isFinite).sort((a, b) => a - b);
}

function extractTasks(body) {
  const lines = String(body || '').split(/\r?\n/);
  const tasks = [];
  let inTasks = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{2,3}\s+tasks\b/i.test(line) || /^#{2,3}\s+task list\b/i.test(line)) {
      inTasks = true;
      continue;
    }
    if (inTasks && /^#{2,3}\s+\S/.test(line)) {
      break;
    }
    if (inTasks) {
      const taskMatch = line.match(/^- \[( |x)\]\s+(.+)$/i);
      if (taskMatch) {
        tasks.push({
          title: taskMatch[2].trim(),
          done: taskMatch[1].toLowerCase() === 'x',
        });
      }
    }
  }

  return tasks;
}

function parseStringList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
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
  const existing = extractCoordinationState(issue && issue.body, policy);
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

function renderCoordinationState(state, policy = DEFAULT_POLICY) {
  const marker = policy.sectionMarker || DEFAULT_SECTION_MARKER;
  const payload = {
    schemaVersion: state.schemaVersion || policy.schemaVersion || DEFAULT_SCHEMA_VERSION,
    kind: state.kind || 'epic',
    status: state.status || 'available',
    owner: state.owner || null,
    branch: state.branch || null,
    validation: state.validation || 'pending',
    review: state.review || 'not-requested',
    project: state.project || { state: 'backlog', fields: {} },
    dependencies: Array.isArray(state.dependencies) ? state.dependencies : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    labels: Array.isArray(state.labels) ? state.labels : [],
    lastAction: state.lastAction || 'sync',
    lastActionAt: state.lastActionAt || new Date().toISOString(),
    lastSyncAt: state.lastSyncAt || new Date().toISOString(),
    notes: state.notes || null,
  };

  return [
    `<!-- ${marker}:start -->`,
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    `<!-- ${marker}:end -->`,
  ].join('\n');
}

function mergeIssueBody(issue, nextState, policy = DEFAULT_POLICY) {
  const body = String(issue.body || '');
  const markerEscaped = escapeRegExp(policy.sectionMarker || DEFAULT_SECTION_MARKER);
  const rendered = renderCoordinationState(nextState, policy);
  const regex = new RegExp(
    `\\n?<!--\\s*${markerEscaped}:start\\s*-->[\\s\\S]*?<!--\\s*${markerEscaped}:end\\s*-->\\n?`,
    'm'
  );

  if (regex.test(body)) {
    return body.replace(regex, `\n${rendered}\n`).trim() + '\n';
  }

  const trimmed = body.trimEnd();
  if (!trimmed) {
    return `${rendered}\n`;
  }
  return `${trimmed}\n\n${rendered}\n`;
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

function upsertCoordinationWorkItem(store, repo, issue, state, action, options = {}) {
  if (!store) {
    return null;
  }

  const now = new Date().toISOString();
  const metadata = {
    schemaVersion: state.schemaVersion || DEFAULT_SCHEMA_VERSION,
    repo,
    issueNumber: issue.number,
    issueUrl: issue.url || null,
    issueTitle: issue.title || null,
    labels: normalizeLabels(issue.labels),
    coordination: state,
    projectProjection: summarizeProjectProjection(state, options.policy || DEFAULT_POLICY),
    action,
    actionAt: now,
    syncedBy: 'ecc-github-coordination',
  };

  return store.upsertWorkItem({
    id: epicWorkItemId(repo, issue.number),
    source: 'github-epic',
    sourceId: String(issue.number),
    title: `Epic #${issue.number}: ${issue.title}`,
    status: mapStateToWorkItemStatus(state.status),
    priority: state.status === 'blocked' ? 'high' : 'normal',
    url: issue.url || null,
    owner: state.owner || (issue.author && issue.author.login) || null,
    repoRoot: options.repoRoot || process.cwd(),
    sessionId: options.sessionId || null,
    metadata,
    updatedAt: now,
  });
}

function getIssue(repo, issueNumber, options = {}) {
  const { owner, name } = normalizeRepo(repo);
  const json = runGhJson([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    `${owner}/${name}`,
    '--json',
    'number,title,body,url,state,labels,author,updatedAt,assignees',
  ], options);

  if (!json) {
    throw new Error(`Unable to load issue #${issueNumber} from ${repo}`);
  }

  return json;
}

function listIssues(repo, options = {}) {
  const { owner, name } = normalizeRepo(repo);
  const limit = Number.isFinite(options.limit) ? options.limit : 100;
  const state = options.state || 'all';
  return runGhJson([
    'issue',
    'list',
    '--repo',
    `${owner}/${name}`,
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,title,body,url,state,labels,author,updatedAt,assignees',
  ], options) || [];
}

function editIssue(repo, issueNumber, options = {}) {
  const { owner, name } = normalizeRepo(repo);
  const args = [
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    `${owner}/${name}`,
  ];

  if (options.body !== undefined) {
    args.push('--body', options.body);
  }

  for (const label of options.addLabels || []) {
    args.push('--add-label', label);
  }

  for (const label of options.removeLabels || []) {
    args.push('--remove-label', label);
  }

  if (options.title) {
    args.push('--title', options.title);
  }

  if (options.assignee) {
    args.push('--add-assignee', options.assignee);
  }

  return runGh(args, options);
}

function commentIssue(repo, issueNumber, body, options = {}) {
  const { owner, name } = normalizeRepo(repo);
  return runGh([
    'issue',
    'comment',
    String(issueNumber),
    '--repo',
    `${owner}/${name}`,
    '--body',
    body,
  ], options);
}

function findIssueByNumber(issues, issueNumber) {
  return issues.find(issue => Number(issue.number) === Number(issueNumber)) || null;
}

function desiredLabelsForState(state, policy = DEFAULT_POLICY) {
  const labels = [];
  const known = policy.labels || DEFAULT_LABELS;

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

  if (options.owner !== undefined) {
    next.owner = options.owner;
  }
  if (options.branch !== undefined) {
    next.branch = options.branch;
  }
  if (options.validation !== undefined) {
    next.validation = options.validation;
  }
  if (options.review !== undefined) {
    next.review = options.review;
  }
  if (options.status !== undefined) {
    next.status = options.status;
  }
  if (options.projectState !== undefined) {
    next.project = {
      ...(next.project || {}),
      state: options.projectState,
    };
  }
  if (options.notes !== undefined) {
    next.notes = options.notes;
  }
  if (options.tasks !== undefined) {
    next.tasks = options.tasks;
  }
  if (options.dependencies !== undefined) {
    next.dependencies = options.dependencies;
  }

  return next;
}

function assertIssueClaimable(issue, state) {
  if (String(issue.state || '').toLowerCase() !== 'open') {
    throw new Error(`Issue #${issue.number} is not open`);
  }

  if (state.status === 'claimed' && state.owner) {
    throw new Error(`Issue #${issue.number} is already claimed by ${state.owner}`);
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
    workItemId: epicWorkItemId(repo, issue.number),
    lastActionAt: state.lastActionAt || null,
    lastSyncAt: state.lastSyncAt || null,
  };
}

function applyClaim(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issue = getIssue(repo, issueNumber, options);
  const currentState = getCoordinationState(issue, policy);

  assertIssueClaimable(issue, currentState);

  const nextState = buildIssueStateFromAction(issue, currentState, 'claim', {
    owner: options.actor || options.owner || currentState.owner || issue.author?.login || null,
    branch: options.branch || currentState.branch || null,
    status: options.status || 'claimed',
    validation: options.validation || currentState.validation || 'pending',
    review: options.review || currentState.review || (policy.review.required ? 'requested' : 'not-requested'),
    projectState: options.projectState || 'in-progress',
  }, policy);

  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };
  const body = mergeIssueBody(issue, nextState, policy);
  if (!options.dryRun) {
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('claimed', repo, issueNumber, nextState), options);
    upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'claim', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'claim', policy);
}

function applySync(repo, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issues = listIssues(repo, { ...options, state: options.state || 'all', limit: options.limit || 100 });
  const syncedAt = new Date().toISOString();
  const results = [];

  for (const issue of issues) {
    const currentState = getCoordinationState(issue, policy);
    const nextState = buildIssueStateFromAction(issue, currentState, 'sync', {
      status: currentState.status,
      validation: currentState.validation,
      review: currentState.review,
      projectState: currentState.project && currentState.project.state ? currentState.project.state : 'backlog',
    }, policy);

    const trackedIssue = {
      ...issue,
      labels: desiredLabelsForState(nextState, policy),
    };
    const body = mergeIssueBody(issue, nextState, policy);
    const labelPlan = syncIssueLabels(repo, issue, nextState, policy, options);

    if (!options.dryRun && (normalizeBodyForComparison(body) !== normalizeBodyForComparison(issue.body) || labelPlan.addLabels.length > 0 || labelPlan.removeLabels.length > 0)) {
      editIssue(repo, issue.number, {
        body,
        addLabels: labelPlan.addLabels,
        removeLabels: labelPlan.removeLabels,
      }, options);
    }

    const snapshot = upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'sync', { ...context, policy });
    results.push({
      ...summarizeStateForOutput(repo, trackedIssue, nextState, 'sync', policy),
      syncedAt,
      labelPlan,
      snapshot: snapshot || null,
    });
  }

  return {
    repo,
    syncedAt,
    count: results.length,
    items: results,
  };
}

function applyValidate(repo, issueNumber, options = {}, context = {}, existingIssue = null) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = existingIssue || getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const dependencyNumbers = Array.isArray(state.dependencies) ? state.dependencies : [];
  const closedDependencies = verifyDependenciesClosed(repo, dependencyNumbers, options);
  const missingDependencies = dependencyNumbers.filter(number => !closedDependencies.includes(number));
  const validations = [];

  if (policy.validation.required && state.validation !== 'passed') {
    validations.push({ check: 'validation-status', ok: false, detail: `validation=${state.validation}` });
  } else {
    validations.push({ check: 'validation-status', ok: true, detail: state.validation });
  }

  if (missingDependencies.length > 0) {
    validations.push({ check: 'dependencies', ok: false, detail: missingDependencies.join(',') });
  } else {
    validations.push({ check: 'dependencies', ok: true, detail: 'closed' });
  }

  const ok = validations.every(entry => entry.ok);
  const nextState = buildIssueStateFromAction(issue, state, 'validate', {
    status: ok ? (state.status === 'blocked' ? 'blocked' : 'validated') : state.status,
    validation: ok ? 'passed' : 'failed',
    projectState: ok ? 'ready' : (state.project && state.project.state) || 'backlog',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'validate', { ...context, policy });
  }

  return {
    ...summarizeStateForOutput(repo, trackedIssue, nextState, 'validate', policy),
    ok,
    validations,
    missingDependencies,
  };
}

function applyPublish(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const validation = applyValidate(repo, issueNumber, { ...options, dryRun: true }, context, issue);

  if (!validation.ok) {
    throw new Error(`Issue #${issueNumber} is not ready to publish: ${validation.validations.map(entry => `${entry.check}=${entry.ok}`).join(', ')}`);
  }

  const nextState = buildIssueStateFromAction(issue, state, 'publish', {
    status: 'published',
    validation: 'passed',
    review: state.review === 'changes-requested' ? state.review : 'approved',
    projectState: 'done',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('published', repo, issueNumber, nextState, {
      validation: 'passed',
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'publish', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'publish', policy);
}

function applyReview(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const reviewState = options.review || 'approved';
  const nextState = buildIssueStateFromAction(issue, state, 'review', {
    status: reviewState === 'approved' ? 'ready' : reviewState === 'requested' ? 'claimed' : 'blocked',
    review: reviewState,
    projectState: reviewState === 'approved' ? 'ready' : 'blocked',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('reviewed', repo, issueNumber, nextState, {
      review: reviewState,
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'review', { ...context, policy });
  }

  return summarizeStateForOutput(repo, trackedIssue, nextState, 'review', policy);
}

function applyDecompose(repo, issueNumber, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const issue = getIssue(repo, issueNumber, options);
  const state = getCoordinationState(issue, policy);
  const tasks = extractTasks(issue.body);
  const dependencies = extractIssueReferences(issue.body);
  const nextState = buildIssueStateFromAction(issue, state, 'decompose', {
    tasks,
    dependencies,
    status: tasks.some(task => !task.done) ? 'claimed' : state.status,
    projectState: tasks.some(task => !task.done) ? 'in-progress' : (state.project && state.project.state) || 'backlog',
  }, policy);
  const trackedIssue = {
    ...issue,
    labels: desiredLabelsForState(nextState, policy),
  };

  if (!options.dryRun) {
    const body = mergeIssueBody(issue, nextState, policy);
    editIssue(repo, issueNumber, {
      body,
      addLabels: trackedIssue.labels,
      removeLabels: [],
    }, options);
    commentIssue(repo, issueNumber, buildIssueComment('decomposed', repo, issueNumber, nextState, {
      taskCount: String(tasks.length),
      dependencyCount: String(dependencies.length),
    }), options);
    upsertCoordinationWorkItem(context.store || null, repo, trackedIssue, nextState, 'decompose', { ...context, policy });
  }

  return {
    ...summarizeStateForOutput(repo, trackedIssue, nextState, 'decompose', policy),
    tasks,
    dependencyCount: dependencies.length,
  };
}

function applyUnblock(repo, options = {}, context = {}) {
  const policy = context.policy || loadPolicy(context.rootDir || process.cwd(), options.configPath);
  const store = context.store || null;
  const issues = listIssues(repo, { ...options, state: 'all', limit: options.limit || 100 });
  const results = [];

  for (const issue of issues) {
    const state = getCoordinationState(issue, policy);
    if (state.status !== 'blocked') {
      continue;
    }

    const dependencyNumbers = Array.isArray(state.dependencies) ? state.dependencies : [];
    const closedDependencies = verifyDependenciesClosed(repo, dependencyNumbers, options, issues);
    if (dependencyNumbers.length > 0 && closedDependencies.length !== dependencyNumbers.length) {
      continue;
    }

    const nextState = buildIssueStateFromAction(issue, state, 'unblock', {
      status: 'ready',
      projectState: 'ready',
      validation: state.validation === 'failed' ? 'pending' : state.validation,
    }, policy);
    const trackedIssue = {
      ...issue,
      labels: desiredLabelsForState(nextState, policy),
    };

    if (!options.dryRun) {
      const body = mergeIssueBody(issue, nextState, policy);
      editIssue(repo, issue.number, {
        body,
        addLabels: trackedIssue.labels,
        removeLabels: [],
      }, options);
      commentIssue(repo, issue.number, buildIssueComment('unblocked', repo, issue.number, nextState, {
        dependencies: dependencyNumbers.length > 0 ? dependencyNumbers.join(',') : 'none',
      }), options);
      upsertCoordinationWorkItem(store, repo, trackedIssue, nextState, 'unblock', { ...context, policy });
    }

    results.push(summarizeStateForOutput(repo, trackedIssue, nextState, 'unblock', policy));
  }

  return {
    repo,
    count: results.length,
    items: results,
  };
}

function formatSummary(payload) {
  const lines = [
    `${payload.action || 'sync'} epic #${payload.issueNumber}: ${payload.issueTitle}`,
    `Repo: ${payload.repo}`,
    `Status: ${payload.status}`,
    `Owner: ${payload.owner || '(unassigned)'}`,
    `Branch: ${payload.branch || '(none)'}`,
    `Validation: ${payload.validation || 'pending'}`,
    `Review: ${payload.review || 'not-requested'}`,
  ];
  if (payload.tasks && payload.tasks.length > 0) {
    lines.push(`Tasks: ${payload.tasks.length}`);
  }
  if (payload.dependencies && payload.dependencies.length > 0) {
    lines.push(`Dependencies: ${payload.dependencies.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatCollection(payload) {
  const lines = [
    `Repo: ${payload.repo}`,
    `Items: ${payload.count}`,
  ];
  for (const item of payload.items || []) {
    lines.push(`- #${item.issueNumber} ${item.status}: ${item.issueTitle}`);
  }
  return `${lines.join('\n')}\n`;
}

async function openStore(options = {}) {
  if (options.dbPath === false) {
    return null;
  }

  return createStateStore({
    dbPath: options.dbPath,
    homeDir: options.homeDir || process.env.HOME || os.homedir(),
  });
}

module.exports = {
  DEFAULT_CONFIG_FILE,
  DEFAULT_CONFIG_PATH,
  DEFAULT_POLICY,
  DEFAULT_SCHEMA_VERSION,
  applyClaim,
  applyDecompose,
  applyPublish,
  applyReview,
  applySync,
  applyUnblock,
  applyValidate,
  buildIssueComment,
  buildIssueStateFromAction,
  commentIssue,
  defaultCoordinationState,
  desiredLabelsForState,
  editIssue,
  epicWorkItemId,
  extractCoordinationState,
  extractIssueReferences,
  extractTasks,
  formatCollection,
  formatSummary,
  getCoordinationState,
  getIssue,
  listIssues,
  loadPolicy,
  mapStateToWorkItemStatus,
  mergeIssueBody,
  normalizeIssueNumber,
  normalizeLabels,
  normalizeRepo,
  openStore,
  renderCoordinationState,
  runGh,
  runGhJson,
  slugifySegment,
  syncIssueLabels,
  summarizeStateForOutput,
  upsertCoordinationWorkItem,
  verifyDependenciesClosed,
};
