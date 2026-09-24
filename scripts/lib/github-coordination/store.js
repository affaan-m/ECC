'use strict';

const os = require('os');

const { createStateStore } = require('../state-store');
const { DEFAULT_SCHEMA_VERSION, DEFAULT_POLICY } = require('./policy');
const { normalizeLabels } = require('./gh-api');
const { slugifySegment, mapStateToWorkItemStatus, summarizeProjectProjection } = require('./state');

function epicWorkItemId(repo, issueNumber) {
  return `github-${slugifySegment(repo)}-epic-${issueNumber}`;
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
  epicWorkItemId,
  openStore,
  upsertCoordinationWorkItem,
};
