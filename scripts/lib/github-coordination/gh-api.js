'use strict';

const { spawnSync } = require('child_process');

function normalizeRepo(repo) {
  const parts = String(repo || '').split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }
  const [owner, name] = parts;
  return { owner, name };
}

function normalizeIssueNumber(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid issue number: ${value}`);
  }
  return parsed;
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

// ECC_GH_SHIM creates a trust boundary: when set, shimPath replaces the real
// `gh` binary and command/commandArgs execute an arbitrary script via
// process.execPath. This variable MUST only be set in trusted, isolated test
// environments (e.g., a test's own temp directory). Never set ECC_GH_SHIM in
// production — doing so allows arbitrary script execution under the caller's
// privileges.
function runGh(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };

  if (options.stripGithubToken) {
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

module.exports = {
  commentIssue,
  editIssue,
  getIssue,
  listIssues,
  normalizeIssueNumber,
  normalizeLabels,
  normalizeRepo,
  runGh,
  runGhJson,
};
