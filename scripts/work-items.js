#!/usr/bin/env node
'use strict';

const os = require('os');
const { spawnSync } = require('child_process');
const { createStateStore } = require('./lib/state-store');
const { claimWorkItem } = require('./lib/control-pane/work-item-mutations');

const VALUE_FLAGS = new Set([
  '--as',
  '--db',
  '--github-repo',
  '--id',
  '--limit',
  '--metadata-json',
  '--owner',
  '--priority',
  '--repo',
  '--repo-root',
  '--session',
  '--session-id',
  '--source',
  '--source-id',
  '--status',
  '--title',
  '--url'
]);

function showHelp(exitCode = 0) {
  console.log(`
Usage:
  node scripts/work-items.js list [--db <path>] [--json] [--limit <n>]
  node scripts/work-items.js show <id> [--db <path>] [--json]
  node scripts/work-items.js upsert [<id>] --title <title> [options] [--json]
  node scripts/work-items.js close <id> [--status done] [--db <path>] [--json]
  node scripts/work-items.js claim [<id>] --owner <name> [--as agent|human] [--db <path>] [--json]
  node scripts/work-items.js sync-github --repo <owner/repo> [--db <path>] [--json]

Track Linear, GitHub, handoff, and manual roadmap items in the ECC SQLite state
store so "ecc status" can include linked work and blocked operator follow-up.

Options:
  --id <id>                 Stable local work-item id for upsert
  --source <source>         Source system, e.g. linear, github, handoff, manual
  --source-id <id>          Source-local identifier, e.g. ECC-20 or PR number
  --status <status>         Status such as open, in-progress, blocked, done
  --priority <priority>     Optional priority label
  --url <url>               Optional source URL
  --owner <owner>           Optional owner label (required for claim)
  --as <agent|human>        On claim, record whether the owner is an agent or human
  --repo-root <path>        Optional repo root to associate with this item
  --repo <path>             GitHub repo for sync-github, otherwise alias for --repo-root
  --github-repo <owner/repo> Explicit GitHub repo for sync-github
  --session-id <id>         Optional ECC session id
  --session <id>            Alias for --session-id
  --metadata-json <json>    Optional JSON metadata payload
  --db <path>               SQLite state database path
  --json                    Emit JSON
`);
  process.exit(exitCode);
}

function assignOption(options, flag, value) {
  if (flag === '--as') options.claimAs = value;
  else if (flag === '--db') options.dbPath = value;
  else if (flag === '--github-repo') options.githubRepo = value;
  else if (flag === '--id') options.id = value;
  else if (flag === '--limit') options.limit = value;
  else if (flag === '--metadata-json') options.metadataJson = value;
  else if (flag === '--owner') options.owner = value;
  else if (flag === '--priority') options.priority = value;
  else if (flag === '--repo' && options.command === 'sync-github') options.githubRepo = value;
  else if (flag === '--repo' || flag === '--repo-root') options.repoRoot = value;
  else if (flag === '--session' || flag === '--session-id') options.sessionId = value;
  else if (flag === '--source') options.source = value;
  else if (flag === '--source-id') options.sourceId = value;
  else if (flag === '--status') options.status = value;
  else if (flag === '--title') options.title = value;
  else if (flag === '--url') options.url = value;
  else throw new Error(`Unknown argument: ${flag}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: 'list',
    dbPath: null,
    help: false,
    json: false,
    limit: 20,
    positionals: []
  };

  if (args[0] && !args[0].startsWith('-')) {
    parsed.command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      assignOption(parsed, arg, value);
      index += 1;
    } else if (!arg.startsWith('-')) {
      parsed.positionals.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parseMetadataJson(value) {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid --metadata-json: ${error.message}`);
  }
}

function resolveWorkItemId(options) {
  return options.id || options.positionals[0] || null;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: ${value}`);
  }
  return parsed;
}

function runGhJson(args) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const displayCommand = shimPath ? `node ${shimPath} ${args.join(' ')}` : `gh ${args.join(' ')}`;
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Failed to run gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${displayCommand} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  try {
    return JSON.parse(result.stdout || '[]');
  } catch (error) {
    throw new Error(`${displayCommand} returned invalid JSON: ${error.message}`);
  }
}

function slugifyWorkItemSegment(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function githubWorkItemId(repo, type, number) {
  return `github-${slugifyWorkItemSegment(repo)}-${type}-${number}`;
}

function githubPrStatus(pr) {
  if (pr.isDraft || pr.mergeStateStatus === 'DIRTY') {
    return 'blocked';
  }

  return 'needs-review';
}

function githubAuthorLogin(item) {
  return item && item.author && item.author.login ? item.author.login : null;
}

function buildGithubPrWorkItem(repo, pr, options = {}) {
  return {
    id: githubWorkItemId(repo, 'pr', pr.number),
    source: 'github-pr',
    sourceId: String(pr.number),
    title: `PR #${pr.number}: ${pr.title}`,
    status: githubPrStatus(pr),
    priority: pr.isDraft || pr.mergeStateStatus === 'DIRTY' ? 'high' : 'normal',
    url: pr.url || null,
    owner: githubAuthorLogin(pr),
    repoRoot: options.repoRoot || process.cwd(),
    sessionId: options.sessionId || null,
    metadata: {
      repo,
      type: 'pull_request',
      mergeStateStatus: pr.mergeStateStatus || null,
      isDraft: Boolean(pr.isDraft),
      headRefName: pr.headRefName || null,
      sourceUpdatedAt: pr.updatedAt || null,
      syncedBy: 'ecc-work-items-sync-github'
    }
  };
}

function buildGithubIssueWorkItem(repo, issue, options = {}) {
  return {
    id: githubWorkItemId(repo, 'issue', issue.number),
    source: 'github-issue',
    sourceId: String(issue.number),
    title: `Issue #${issue.number}: ${issue.title}`,
    status: 'needs-review',
    priority: 'normal',
    url: issue.url || null,
    owner: githubAuthorLogin(issue),
    repoRoot: options.repoRoot || process.cwd(),
    sessionId: options.sessionId || null,
    metadata: {
      repo,
      type: 'issue',
      labels: Array.isArray(issue.labels) ? issue.labels.map(label => label.name || label).filter(Boolean) : [],
      sourceUpdatedAt: issue.updatedAt || null,
      syncedBy: 'ecc-work-items-sync-github'
    }
  };
}

function closeStaleGithubItems(store, repo, activeIds, options = {}) {
  const payload = store.listWorkItems({ limit: options.limit || 10000 });
  const closed = [];
  for (const item of payload.items) {
    if (!item.metadata || item.metadata.syncedBy !== 'ecc-work-items-sync-github') {
      continue;
    }
    if (item.metadata.repo !== repo || activeIds.has(item.id)) {
      continue;
    }
    if (item.status === 'closed' || item.status === 'done') {
      continue;
    }
    closed.push(
      store.upsertWorkItem({
        ...item,
        status: 'closed',
        updatedAt: new Date().toISOString(),
        metadata: {
          ...item.metadata,
          sourceClosedAt: new Date().toISOString()
        }
      })
    );
  }
  return closed;
}

function syncGithubWorkItems(store, options) {
  const repo = options.githubRepo;
  if (!repo) {
    throw new Error('Missing GitHub repo. Pass --repo <owner/repo>.');
  }

  const limit = normalizeLimit(options.limit);
  const prs = runGhJson(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', String(limit), '--json', 'number,title,author,url,updatedAt,mergeStateStatus,isDraft,headRefName']);
  const issues = runGhJson(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', String(limit), '--json', 'number,title,author,url,updatedAt,labels']);

  const syncedAt = new Date().toISOString();
  const activeIds = new Set();
  const items = [];
  for (const pr of prs) {
    const payload = buildGithubPrWorkItem(repo, pr, options);
    activeIds.add(payload.id);
    items.push(
      store.upsertWorkItem({
        ...payload,
        createdAt: undefined,
        updatedAt: syncedAt
      })
    );
  }
  for (const issue of issues) {
    const payload = buildGithubIssueWorkItem(repo, issue, options);
    activeIds.add(payload.id);
    items.push(
      store.upsertWorkItem({
        ...payload,
        createdAt: undefined,
        updatedAt: syncedAt
      })
    );
  }

  const closedItems = closeStaleGithubItems(store, repo, activeIds, { limit: Math.max(limit * 4, 1000) });
  return {
    repo,
    syncedAt,
    prCount: prs.length,
    issueCount: issues.length,
    closedCount: closedItems.length,
    items,
    closedItems
  };
}

function buildUpsertPayload(options, existing = null) {
  const id = resolveWorkItemId(options);
  if (!id) {
    throw new Error('Missing work item id. Pass <id> or --id <id>.');
  }

  const title = options.title ?? (existing && existing.title);
  if (!title) {
    throw new Error('Missing --title for a new work item.');
  }

  return {
    id,
    source: options.source ?? (existing && existing.source) ?? 'manual',
    sourceId: options.sourceId ?? (existing && existing.sourceId) ?? null,
    title,
    status: options.status ?? (existing && existing.status) ?? 'open',
    priority: options.priority ?? (existing && existing.priority) ?? null,
    url: options.url ?? (existing && existing.url) ?? null,
    owner: options.owner ?? (existing && existing.owner) ?? null,
    repoRoot: options.repoRoot ?? (existing && existing.repoRoot) ?? process.cwd(),
    sessionId: options.sessionId ?? (existing && existing.sessionId) ?? null,
    metadata: options.metadataJson !== undefined ? parseMetadataJson(options.metadataJson) : ((existing && existing.metadata) ?? null),
    createdAt: existing ? existing.createdAt : undefined,
    updatedAt: new Date().toISOString()
  };
}

function printWorkItem(item) {
  const sourceId = item.sourceId ? `#${item.sourceId}` : item.id;
  console.log(`${item.source}/${sourceId} ${item.status}: ${item.title}`);
  console.log(`ID: ${item.id}`);
  console.log(`Priority: ${item.priority || '(none)'}`);
  console.log(`Owner: ${item.owner || '(unassigned)'}`);
  console.log(`Repo: ${item.repoRoot || '(none)'}`);
  console.log(`Session: ${item.sessionId || '(none)'}`);
  console.log(`Updated: ${item.updatedAt}`);
  if (item.url) {
    console.log(`URL: ${item.url}`);
  }
}

function printWorkItemList(payload) {
  console.log(`Work items: ${payload.items.length} shown / ${payload.totalCount} total`);
  if (payload.items.length === 0) {
    console.log('  - none');
    return;
  }

  for (const item of payload.items) {
    const sourceId = item.sourceId ? `#${item.sourceId}` : item.id;
    console.log(`  - ${item.source}/${sourceId} ${item.status}: ${item.title}`);
    console.log(`    ID: ${item.id}`);
    console.log(`    Owner: ${item.owner || '(unassigned)'}`);
    console.log(`    Updated: ${item.updatedAt}`);
    if (item.url) {
      console.log(`    URL: ${item.url}`);
    }
  }
}

function printGithubSyncResult(payload) {
  console.log(`GitHub sync: ${payload.repo}`);
  console.log(`  Open PRs: ${payload.prCount}`);
  console.log(`  Open issues: ${payload.issueCount}`);
  console.log(`  Closed stale items: ${payload.closedCount}`);
  if (payload.items.length === 0 && payload.closedItems.length === 0) {
    console.log('  Work items changed: none');
    return;
  }
  for (const item of [...payload.items, ...payload.closedItems]) {
    console.log(`  - ${item.id} ${item.status}: ${item.title}`);
  }
}

// Thin CLI adapter over the shared claimWorkItem helper, preserving the
// flag-specific error messages (--owner / --as) for the command line.
function claimWorkItemCli(store, options) {
  if (!options.owner) {
    throw new Error('claim requires --owner <name>.');
  }
  const assigneeKind = options.claimAs ? String(options.claimAs).toLowerCase() : null;
  if (assigneeKind && assigneeKind !== 'agent' && assigneeKind !== 'human') {
    throw new Error("--as must be 'agent' or 'human'.");
  }
  return claimWorkItem(store, {
    id: resolveWorkItemId(options),
    owner: options.owner,
    assigneeKind,
    sessionId: options.sessionId,
    status: options.status
  });
}

async function main() {
  let store = null;

  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    store = await createStateStore({
      dbPath: options.dbPath,
      homeDir: process.env.HOME || os.homedir()
    });

    if (options.command === 'list') {
      const payload = store.listWorkItems({ limit: normalizeLimit(options.limit) });
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        printWorkItemList(payload);
      }
      return;
    }

    if (options.command === 'show') {
      const id = resolveWorkItemId(options);
      if (!id) {
        throw new Error('Missing work item id.');
      }
      const item = store.getWorkItemById(id);
      if (!item) {
        throw new Error(`Work item not found: ${id}`);
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        printWorkItem(item);
      }
      return;
    }

    if (options.command === 'upsert') {
      const id = resolveWorkItemId(options);
      const existing = id ? store.getWorkItemById(id) : null;
      const item = store.upsertWorkItem(buildUpsertPayload(options, existing));
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        printWorkItem(item);
      }
      return;
    }

    if (options.command === 'close') {
      const id = resolveWorkItemId(options);
      if (!id) {
        throw new Error('Missing work item id.');
      }
      const existing = store.getWorkItemById(id);
      if (!existing) {
        throw new Error(`Work item not found: ${id}`);
      }
      const item = store.upsertWorkItem(
        buildUpsertPayload(
          {
            ...options,
            id,
            status: options.status || 'done'
          },
          existing
        )
      );
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        printWorkItem(item);
      }
      return;
    }

    if (options.command === 'claim') {
      const result = claimWorkItemCli(store, options);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!result.claimed) {
        console.log('No unassigned open work items to claim.');
      } else {
        console.log(`Claimed by ${result.item.owner}:`);
        printWorkItem(result.item);
      }
      return;
    }

    if (options.command === 'sync-github') {
      const payload = syncGithubWorkItems(store, options);
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        printGithubSyncResult(payload);
      }
      return;
    }

    throw new Error(`Unknown command: ${options.command}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (store) {
      store.close();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildUpsertPayload,
  buildGithubIssueWorkItem,
  buildGithubPrWorkItem,
  main,
  parseArgs,
  syncGithubWorkItems
};
