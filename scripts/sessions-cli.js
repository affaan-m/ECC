#!/usr/bin/env node
'use strict';

const os = require('os');
const { createStateStore } = require('./lib/state-store');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/sessions-cli.js [<session-id>] [--db <path>] [--json] [--limit <n>]

List recent ECC sessions from the SQLite state store or inspect a single session
with worker, skill-run, and decision detail.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dbPath: null,
    help: false,
    json: false,
    limit: 10,
    sessionId: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--db') {
      if (!args[index + 1] || args[index + 1].startsWith('--') || args[index + 1] === '-h') {
        throw new Error(`Missing value for ${arg}`);
      }
      parsed.dbPath = args[index + 1] || null;
      index += 1;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--limit') {
      if (!args[index + 1] || args[index + 1].startsWith('--') || args[index + 1] === '-h') {
        throw new Error(`Missing value for ${arg}`);
      }
      parsed.limit = args[index + 1] || null;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (!arg.startsWith('--') && !parsed.sessionId) {
      parsed.sessionId = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printSessionList(payload) {
  console.log('Recent sessions:\n');

  if (payload.sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const session of payload.sessions) {
    console.log(`- ${session.id} [${session.harness}/${session.adapterId}] ${session.state}`);
    console.log(`  Repo: ${session.repoRoot || '(unknown)'}`);
    console.log(`  Started: ${session.startedAt || '(unknown)'}`);
    console.log(`  Ended: ${session.endedAt || '(active)'}`);
    console.log(`  Workers: ${session.workerCount}`);
  }

  console.log(`\nTotal sessions: ${payload.totalCount}`);
}

function printWorkers(workers) {
  console.log(`Workers: ${workers.length}`);
  if (workers.length === 0) {
    console.log('  - none');
    return;
  }

  for (const worker of workers) {
    console.log(`  - ${worker.id || worker.label || '(unknown)'} ${worker.state || 'unknown'}`);
    console.log(`    Branch: ${worker.branch || '(unknown)'}`);
    console.log(`    Worktree: ${worker.worktree || '(unknown)'}`);
  }
}

function printSkillRuns(skillRuns) {
  console.log(`Skill runs: ${skillRuns.length}`);
  if (skillRuns.length === 0) {
    console.log('  - none');
    return;
  }

  for (const skillRun of skillRuns) {
    console.log(`  - ${skillRun.id} ${skillRun.outcome} ${skillRun.skillId}@${skillRun.skillVersion}`);
    console.log(`    Task: ${skillRun.taskDescription}`);
    console.log(`    Duration: ${skillRun.durationMs ?? '(unknown)'} ms`);
  }
}

function printDecisions(decisions) {
  console.log(`Decisions: ${decisions.length}`);
  if (decisions.length === 0) {
    console.log('  - none');
    return;
  }

  for (const decision of decisions) {
    console.log(`  - ${decision.id} ${decision.status}`);
    console.log(`    Title: ${decision.title}`);
    console.log(`    Alternatives: ${decision.alternatives.join(', ') || '(none)'}`);
  }
}

function printSessionDetail(payload) {
  console.log(`Session: ${payload.session.id}`);
  console.log(`Harness: ${payload.session.harness}`);
  console.log(`Adapter: ${payload.session.adapterId}`);
  console.log(`State: ${payload.session.state}`);
  console.log(`Repo: ${payload.session.repoRoot || '(unknown)'}`);
  console.log(`Started: ${payload.session.startedAt || '(unknown)'}`);
  console.log(`Ended: ${payload.session.endedAt || '(active)'}`);
  console.log();
  printWorkers(payload.workers);
  console.log();
  printSkillRuns(payload.skillRuns);
  console.log();
  printDecisions(payload.decisions);
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
      homeDir: process.env.HOME || os.homedir(),
    });

    if (!options.sessionId) {
      const payload = store.listRecentSessions({ limit: options.limit });
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        printSessionList(payload);
      }
      return;
    }

    const payload = store.getSessionDetail(options.sessionId);
    if (!payload) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printSessionDetail(payload);
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
};
