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

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: null,
    actor: null,
    branch: null,
    configPath: null,
    dbPath: null,
    dryRun: false,
    help: false,
    homeDir: null,
    issueNumber: null,
    json: false,
    limit: 100,
    repo: null,
    validation: null,
    review: null,
    status: null,
    projectState: null,
    positionals: [],
  };

  if (args.length > 0 && !args[0].startsWith('-')) {
    parsed.command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--repo') {
      parsed.repo = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--issue') {
      parsed.issueNumber = normalizeIssueNumber(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      parsed.actor = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--branch') {
      parsed.branch = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--config') {
      parsed.configPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--db') {
      parsed.dbPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--home') {
      parsed.homeDir = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = normalizeIssueNumber(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--validation') {
      parsed.validation = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--review') {
      parsed.review = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--status') {
      parsed.status = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--project-state') {
      parsed.projectState = readValue(args, index, arg);
      index += 1;
      continue;
    }

    if (!arg.startsWith('-')) {
      parsed.positionals.push(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.command) {
    parsed.command = 'sync';
  }

  if (!parsed.issueNumber && parsed.positionals.length > 0) {
    parsed.issueNumber = normalizeIssueNumber(parsed.positionals[0]);
  }

  return parsed;
}

async function main() {
  let store = null;

  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      usage(0);
    }

    if (!options.repo) {
      throw new Error('Missing --repo <owner/repo>.');
    }

    const policy = loadPolicy(process.cwd(), options.configPath);
    store = await openStore({
      dbPath: options.dbPath,
      homeDir: options.homeDir || process.env.HOME || os.homedir(),
    });

    let payload;

    if (options.command === 'claim') {
      if (!options.issueNumber) throw new Error('Missing issue number.');
      payload = applyClaim(options.repo, options.issueNumber, {
        actor: options.actor,
        branch: options.branch,
        configPath: options.configPath,
        dryRun: options.dryRun,
        owner: options.actor,
        projectState: options.projectState,
        review: options.review,
        status: options.status,
        validation: options.validation,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'sync') {
      payload = applySync(options.repo, {
        configPath: options.configPath,
        dryRun: options.dryRun,
        limit: options.limit,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'validate') {
      if (!options.issueNumber) throw new Error('Missing issue number.');
      payload = applyValidate(options.repo, options.issueNumber, {
        configPath: options.configPath,
        dryRun: options.dryRun,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'publish') {
      if (!options.issueNumber) throw new Error('Missing issue number.');
      payload = applyPublish(options.repo, options.issueNumber, {
        configPath: options.configPath,
        dryRun: options.dryRun,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'review') {
      if (!options.issueNumber) throw new Error('Missing issue number.');
      payload = applyReview(options.repo, options.issueNumber, {
        configPath: options.configPath,
        dryRun: options.dryRun,
        review: options.review,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'unblock') {
      payload = applyUnblock(options.repo, {
        configPath: options.configPath,
        dryRun: options.dryRun,
        limit: options.limit,
      }, { store, policy, rootDir: process.cwd() });
    } else if (options.command === 'decompose') {
      if (!options.issueNumber) throw new Error('Missing issue number.');
      payload = applyDecompose(options.repo, options.issueNumber, {
        configPath: options.configPath,
        dryRun: options.dryRun,
      }, { store, policy, rootDir: process.cwd() });
    } else {
      throw new Error(`Unknown command: ${options.command}`);
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else if (options.command === 'sync' || options.command === 'unblock') {
      process.stdout.write(formatCollection(payload));
    } else {
      process.stdout.write(formatSummary(payload));
    }
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
  main,
  parseArgs,
  usage,
};
