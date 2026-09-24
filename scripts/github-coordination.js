#!/usr/bin/env node
'use strict';

const os = require('os');

const {
  applyClaim,
  applyDecompose,
  applyPublish,
  applyReview,
  applySync,
  applyUnblock,
  applyValidate,
  formatCollection,
  formatSummary,
  loadPolicy,
  normalizeIssueNumber,
  openStore,
} = require('./lib/github-coordination');

function usage(exitCode = 0) {
  console.log([
    'Usage: node scripts/github-coordination.js <command> [options]',
    '',
    'Commands:',
    '  claim <issue-number>     Claim an epic issue and stamp coordination state',
    '  sync                     Sync epic issue bodies, labels, and local snapshots',
    '  validate <issue-number>  Validate epic readiness and dependency status',
    '  publish <issue-number>   Publish a validated epic update/comment',
    '  review <issue-number>    Mark review requested/approved/blocked',
    '  unblock                  Sweep blocked epics whose dependencies are closed',
    '  decompose <issue-number> Reconcile epic task breakdown from issue body',
    '',
    'Options:',
    '  --repo <owner/repo>      GitHub repository',
    '  --issue <number>         Issue number for actions that target one issue',
    '  --actor <login>          Claim owner / coordination actor',
    '  --branch <name>          Epic branch name to stamp into the coordination body',
    '  --config <path>          Optional coordination policy config',
    '  --db <path>              SQLite state store path',
    '  --home <dir>             Override home directory used by the state store',
    '  --limit <n>              Limit issues scanned by sync/unblock',
    '  --dry-run                Preview changes without modifying GitHub or state',
    '  --json                   Emit machine-readable JSON',
    '  --help, -h               Show this help',
  ].join('\n'));
  process.exit(exitCode);
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

// Boolean flags: map flag string → setter(parsed)
const BOOL_FLAGS = new Map([
  ['--help',    p => { p.help = true; }],
  ['-h',        p => { p.help = true; }],
  ['--json',    p => { p.json = true; }],
  ['--dry-run', p => { p.dryRun = true; }],
]);

// Value flags: map flag string → setter(parsed, value)
const VALUE_FLAGS = new Map([
  ['--repo',          (p, v) => { p.repo = v; }],
  ['--actor',         (p, v) => { p.actor = v; }],
  ['--branch',        (p, v) => { p.branch = v; }],
  ['--config',        (p, v) => { p.configPath = v; }],
  ['--db',            (p, v) => { p.dbPath = v; }],
  ['--home',          (p, v) => { p.homeDir = v; }],
  ['--validation',    (p, v) => { p.validation = v; }],
  ['--review',        (p, v) => { p.review = v; }],
  ['--status',        (p, v) => { p.status = v; }],
  ['--project-state', (p, v) => { p.projectState = v; }],
  ['--issue',         (p, v) => { p.issueNumber = normalizeIssueNumber(v); }],
  ['--limit',         (p, v) => { p.limit = normalizeIssueNumber(v); }],
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: null, actor: null, branch: null, configPath: null,
    dbPath: null, dryRun: false, help: false, homeDir: null,
    issueNumber: null, json: false, limit: 100, repo: null,
    validation: null, review: null, status: null, projectState: null,
    positionals: [],
  };

  if (args.length > 0 && !args[0].startsWith('-')) {
    parsed.command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (BOOL_FLAGS.has(arg)) {
      BOOL_FLAGS.get(arg)(parsed);
    } else if (VALUE_FLAGS.has(arg)) {
      VALUE_FLAGS.get(arg)(parsed, readValue(args, i, arg));
      i += 1;
    } else if (!arg.startsWith('-')) {
      parsed.positionals.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.command) parsed.command = 'sync';
  if (!parsed.issueNumber && parsed.positionals.length > 0) {
    parsed.issueNumber = normalizeIssueNumber(parsed.positionals[0]);
  }

  return parsed;
}

function dispatchCommand(options, ctx) {
  const { store, policy, rootDir } = ctx;
  const base = { configPath: options.configPath, dryRun: options.dryRun };

  if (options.command === 'claim') {
    if (!options.issueNumber) throw new Error('Missing issue number.');
    return applyClaim(options.repo, options.issueNumber, {
      ...base, actor: options.actor, branch: options.branch, owner: options.actor,
      projectState: options.projectState, review: options.review,
      status: options.status, validation: options.validation,
    }, { store, policy, rootDir });
  }
  if (options.command === 'sync') {
    return applySync(options.repo, { ...base, limit: options.limit }, { store, policy, rootDir });
  }
  if (options.command === 'validate') {
    if (!options.issueNumber) throw new Error('Missing issue number.');
    return applyValidate(options.repo, options.issueNumber, base, { store, policy, rootDir });
  }
  if (options.command === 'publish') {
    if (!options.issueNumber) throw new Error('Missing issue number.');
    return applyPublish(options.repo, options.issueNumber, base, { store, policy, rootDir });
  }
  if (options.command === 'review') {
    if (!options.issueNumber) throw new Error('Missing issue number.');
    return applyReview(options.repo, options.issueNumber, { ...base, review: options.review }, { store, policy, rootDir });
  }
  if (options.command === 'unblock') {
    return applyUnblock(options.repo, { ...base, limit: options.limit }, { store, policy, rootDir });
  }
  if (options.command === 'decompose') {
    if (!options.issueNumber) throw new Error('Missing issue number.');
    return applyDecompose(options.repo, options.issueNumber, base, { store, policy, rootDir });
  }
  throw new Error(`Unknown command: ${options.command}`);
}

function formatOutput(payload, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (options.command === 'sync' || options.command === 'unblock') {
    process.stdout.write(formatCollection(payload));
  } else {
    process.stdout.write(formatSummary(payload));
  }
}

async function main() {
  let store = null;
  try {
    const options = parseArgs(process.argv);
    if (options.help) usage(0);
    if (!options.repo) throw new Error('Missing --repo <owner/repo>.');

    const policy = loadPolicy(process.cwd(), options.configPath);
    store = await openStore({
      dbPath: options.dbPath,
      homeDir: options.homeDir || process.env.HOME || os.homedir(),
    });

    const payload = dispatchCommand(options, { store, policy, rootDir: process.cwd() });
    formatOutput(payload, options);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (store) store.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  usage,
};
