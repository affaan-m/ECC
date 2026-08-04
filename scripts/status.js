#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateStore } = require('./lib/state-store');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/status.js [--db <path>] [--json|--markdown] [--write <path>] [--limit <n>] [--exit-code]

Query the ECC SQLite state store for active sessions, recent skill runs,
install health, pending governance events, and linked work items.

Use --exit-code to return 2 when readiness needs attention.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dbPath: null,
    json: false,
    markdown: false,
    writePath: null,
    exitCode: false,
    help: false,
    limit: 5,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--db') {
      parsed.dbPath = args[index + 1] || null;
      index += 1;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--markdown') {
      parsed.markdown = true;
    } else if (arg === '--exit-code') {
      parsed.exitCode = true;
    } else if (arg === '--write') {
      parsed.writePath = args[index + 1] || null;
      index += 1;
    } else if (arg === '--limit') {
      parsed.limit = args[index + 1] || null;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.json && parsed.markdown) {
    throw new Error('Choose only one output format: --json or --markdown');
  }

  if (args.includes('--db') && !parsed.dbPath) {
    throw new Error('Missing value for --db');
  }

  if (args.includes('--write') && !parsed.writePath) {
    throw new Error('Missing value for --write');
  }

  if (args.includes('--limit') && !parsed.limit) {
    throw new Error('Missing value for --limit');
  }

  return parsed;
}

function printActiveSessions(section) {
  console.log(`Active sessions: ${section.activeCount}`);
  if (section.sessions.length === 0) {
    console.log('  - none');
    return;
  }

  for (const session of section.sessions) {
    console.log(`  - ${session.id} [${session.harness}/${session.adapterId}] ${session.state}`);
    console.log(`    Repo: ${session.repoRoot || '(unknown)'}`);
    console.log(`    Started: ${session.startedAt || '(unknown)'}`);
    console.log(`    Workers: ${session.workerCount}`);
  }
}

function printSkillRuns(section) {
  const summary = section.summary;
  const successRate = summary.successRate === null ? 'n/a' : `${summary.successRate}%`;
  const failureRate = summary.failureRate === null ? 'n/a' : `${summary.failureRate}%`;

  console.log(`Skill runs (last ${section.windowSize}):`);
  console.log(`  Success: ${summary.successCount}`);
  console.log(`  Failure: ${summary.failureCount}`);
  console.log(`  Unknown: ${summary.unknownCount}`);
  console.log(`  Success rate: ${successRate}`);
  console.log(`  Failure rate: ${failureRate}`);

  if (section.recent.length === 0) {
    console.log('  Recent runs: none');
    return;
  }

  console.log('  Recent runs:');
  for (const skillRun of section.recent.slice(0, 5)) {
    console.log(`  - ${skillRun.id} ${skillRun.outcome} ${skillRun.skillId}@${skillRun.skillVersion}`);
  }
}

function printInstallHealth(section) {
  console.log(`Install health: ${section.status}`);
  console.log(`  Targets recorded: ${section.totalCount}`);
  console.log(`  Healthy: ${section.healthyCount}`);
  console.log(`  Warning: ${section.warningCount}`);

  if (section.installations.length === 0) {
    console.log('  Installations: none');
    return;
  }

  console.log('  Installations:');
  for (const installation of section.installations.slice(0, 5)) {
    console.log(`  - ${installation.targetId} ${installation.status}`);
    console.log(`    Root: ${installation.targetRoot}`);
    console.log(`    Profile: ${installation.profile || '(custom)'}`);
    console.log(`    Modules: ${installation.moduleCount}`);
    console.log(`    Source version: ${installation.sourceVersion || '(unknown)'}`);
  }
}

function printGovernance(section) {
  console.log(`Pending governance events: ${section.pendingCount}`);
  if (section.events.length === 0) {
    console.log('  - none');
    return;
  }

  for (const event of section.events) {
    console.log(`  - ${event.id} ${event.eventType}`);
    console.log(`    Session: ${event.sessionId || '(none)'}`);
    console.log(`    Created: ${event.createdAt}`);
  }
}

function printWorkItems(section) {
  console.log(`Work items: ${section.openCount} open, ${section.blockedCount} blocked, ${section.closedCount} closed`);
  if (section.items.length === 0) {
    console.log('  - none');
    return;
  }

  for (const item of section.items.slice(0, 10)) {
    const sourceId = item.sourceId ? `#${item.sourceId}` : item.id;
    console.log(`  - ${item.source}/${sourceId} ${item.status}: ${item.title}`);
    console.log(`    Owner: ${item.owner || '(unassigned)'}`);
    console.log(`    Updated: ${item.updatedAt}`);
    if (item.url) {
      console.log(`    URL: ${item.url}`);
    }
  }
}

function summarizeGithubCoordination(workItems) {
  const epicItems = workItems.items.filter(item => item.source === 'github-epic');
  const summary = {
    totalCount: epicItems.length,
    availableCount: 0,
    claimedCount: 0,
    readyCount: 0,
    blockedCount: 0,
    validatedCount: 0,
    publishedCount: 0,
    recent: epicItems.slice(0, 10),
  };

  for (const item of epicItems) {
    const state = item.metadata && item.metadata.coordination ? item.metadata.coordination.status : item.status;
    switch (state) {
      case 'available':
        summary.availableCount += 1;
        break;
      case 'claimed':
        summary.claimedCount += 1;
        break;
      case 'ready':
        summary.readyCount += 1;
        break;
      case 'blocked':
        summary.blockedCount += 1;
        break;
      case 'validated':
        summary.validatedCount += 1;
        break;
      case 'published':
        summary.publishedCount += 1;
        break;
      default:
        summary.availableCount += 1;
        break;
    }
  }

  return summary;
}

function printGithubCoordination(section) {
  console.log(`GitHub epic coordination: ${section.totalCount} tracked`);
  if (section.totalCount === 0) {
    console.log('  - none');
    return;
  }

  console.log(`  Available: ${section.availableCount}`);
  console.log(`  Claimed: ${section.claimedCount}`);
  console.log(`  Ready: ${section.readyCount}`);
  console.log(`  Blocked: ${section.blockedCount}`);
  console.log(`  Validated: ${section.validatedCount}`);
  console.log(`  Published: ${section.publishedCount}`);

  for (const item of section.recent) {
    console.log(`  - ${item.source}/${item.sourceId || item.id} ${item.status}: ${item.title}`);
    if (item.metadata && item.metadata.coordination) {
      const coordination = item.metadata.coordination;
      console.log(`    Epic status: ${coordination.status}`);
      console.log(`    Owner: ${coordination.owner || '(unassigned)'}`);
      console.log(`    Branch: ${coordination.branch || '(none)'}`);
    }
  }
}

function printReadiness(section) {
  console.log(`Readiness: ${section.status}`);
  console.log(`  Attention items: ${section.attentionCount}`);
  console.log(`  Active sessions: ${section.activeSessions}`);
  console.log(`  Failed skill runs: ${section.failedSkillRuns}`);
  console.log(`  Warning installs: ${section.warningInstallations}`);
  console.log(`  Pending governance: ${section.pendingGovernanceEvents}`);
  console.log(`  Blocked work items: ${section.blockedWorkItems}`);
}

function printHuman(payload) {
  console.log('ECC status\n');
  console.log(`Database: ${payload.dbPath}\n`);
  printReadiness(payload.readiness);
  console.log();
  printActiveSessions(payload.activeSessions);
  console.log();
  printSkillRuns(payload.skillRuns);
  console.log();
  printInstallHealth(payload.installHealth);
  console.log();
  printGovernance(payload.governance);
  console.log();
  if (payload.githubCoordination) {
    printGithubCoordination(payload.githubCoordination);
    console.log();
  }
  printWorkItems(payload.workItems);
}

function formatPercent(value) {
  return value === null ? 'n/a' : `${value}%`;
}

function formatCode(value) {
  return `\`${String(value || '').replace(/`/g, '\\`')}\``;
}

function renderMarkdown(payload) {
  const lines = [
    '# ECC Status',
    '',
    `Generated: ${payload.generatedAt}`,
    `Database: ${formatCode(payload.dbPath)}`,
    '',
    '## Readiness',
    '',
    `Status: ${payload.readiness.status}`,
    `Attention items: ${payload.readiness.attentionCount}`,
    `Active sessions: ${payload.readiness.activeSessions}`,
    `Failed skill runs: ${payload.readiness.failedSkillRuns}`,
    `Warning installs: ${payload.readiness.warningInstallations}`,
    `Pending governance: ${payload.readiness.pendingGovernanceEvents}`,
    `Blocked work items: ${payload.readiness.blockedWorkItems}`,
    '',
    '## Active Sessions',
    '',
    `Active sessions: ${payload.activeSessions.activeCount}`,
  ];

  if (payload.activeSessions.sessions.length === 0) {
    lines.push('- none');
  } else {
    for (const session of payload.activeSessions.sessions) {
      lines.push(`- ${formatCode(session.id)} [${session.harness}/${session.adapterId}] ${session.state}`);
      lines.push(`  - Repo: ${session.repoRoot || '(unknown)'}`);
      lines.push(`  - Started: ${session.startedAt || '(unknown)'}`);
      lines.push(`  - Workers: ${session.workerCount}`);
    }
  }

  const skillSummary = payload.skillRuns.summary;
  lines.push(
    '',
    '## Skill Runs',
    '',
    `Window size: ${payload.skillRuns.windowSize}`,
    `Success: ${skillSummary.successCount}`,
    `Failure: ${skillSummary.failureCount}`,
    `Unknown: ${skillSummary.unknownCount}`,
    `Success rate: ${formatPercent(skillSummary.successRate)}`,
    `Failure rate: ${formatPercent(skillSummary.failureRate)}`
  );

  if (payload.skillRuns.recent.length === 0) {
    lines.push('', 'Recent runs: none');
  } else {
    lines.push('', 'Recent runs:');
    for (const skillRun of payload.skillRuns.recent.slice(0, 5)) {
      lines.push(`- ${formatCode(skillRun.id)} ${skillRun.outcome} ${skillRun.skillId}@${skillRun.skillVersion}`);
    }
  }

  lines.push(
    '',
    '## Install Health',
    '',
    `Install health: ${payload.installHealth.status}`,
    `Targets recorded: ${payload.installHealth.totalCount}`,
    `Healthy: ${payload.installHealth.healthyCount}`,
    `Warning: ${payload.installHealth.warningCount}`
  );

  if (payload.installHealth.installations.length === 0) {
    lines.push('', 'Installations: none');
  } else {
    lines.push('', 'Installations:');
    for (const installation of payload.installHealth.installations.slice(0, 5)) {
      lines.push(`- ${formatCode(installation.targetId)} ${installation.status}`);
      lines.push(`  - Root: ${installation.targetRoot}`);
      lines.push(`  - Profile: ${installation.profile || '(custom)'}`);
      lines.push(`  - Modules: ${installation.moduleCount}`);
      lines.push(`  - Source version: ${installation.sourceVersion || '(unknown)'}`);
    }
  }

  lines.push(
    '',
    '## Governance',
    '',
    `Pending governance events: ${payload.governance.pendingCount}`
  );

  if (payload.governance.events.length === 0) {
    lines.push('- none');
  } else {
    for (const event of payload.governance.events) {
      lines.push(`- ${formatCode(event.id)} ${event.eventType}`);
      lines.push(`  - Session: ${event.sessionId || '(none)'}`);
      lines.push(`  - Created: ${event.createdAt}`);
    }
  }

  lines.push(
    '',
    '## Work Items',
    '',
    `Open: ${payload.workItems.openCount}`,
    `Blocked: ${payload.workItems.blockedCount}`,
    `Closed: ${payload.workItems.closedCount}`
  );

  if (payload.workItems.items.length === 0) {
    lines.push('', '- none');
  } else {
    lines.push('', 'Recent work items:');
    for (const item of payload.workItems.items.slice(0, 10)) {
      const sourceId = item.sourceId ? `#${item.sourceId}` : item.id;
      lines.push(`- ${formatCode(item.source)} ${formatCode(sourceId)} ${item.status}: ${item.title}`);
      lines.push(`  - Owner: ${item.owner || '(unassigned)'}`);
      lines.push(`  - Updated: ${item.updatedAt}`);
      if (item.url) {
        lines.push(`  - URL: ${item.url}`);
      }
    }
  }

  if (payload.githubCoordination) {
    lines.push(
      '',
      '## GitHub Epic Coordination',
      '',
      `Tracked: ${payload.githubCoordination.totalCount}`,
      `Available: ${payload.githubCoordination.availableCount}`,
      `Claimed: ${payload.githubCoordination.claimedCount}`,
      `Ready: ${payload.githubCoordination.readyCount}`,
      `Blocked: ${payload.githubCoordination.blockedCount}`,
      `Validated: ${payload.githubCoordination.validatedCount}`,
      `Published: ${payload.githubCoordination.publishedCount}`
    );

    if (payload.githubCoordination.recent.length === 0) {
      lines.push('', '- none');
    } else {
      lines.push('', 'Recent epics:');
      for (const item of payload.githubCoordination.recent) {
        lines.push(`- ${formatCode(item.source)} ${formatCode(item.sourceId || item.id)} ${item.status}: ${item.title}`);
        if (item.metadata && item.metadata.coordination) {
          lines.push(`  - Epic status: ${item.metadata.coordination.status}`);
          lines.push(`  - Owner: ${item.metadata.coordination.owner || '(unassigned)'}`);
          lines.push(`  - Branch: ${item.metadata.coordination.branch || '(none)'}`);
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeOutput(writePath, output) {
  const absolutePath = path.resolve(writePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, output, 'utf8');
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

    const payload = {
      dbPath: store.dbPath,
      ...store.getStatus({
        activeLimit: options.limit,
        recentSkillRunLimit: 20,
        pendingLimit: options.limit,
        workItemLimit: options.limit,
      }),
    };
    payload.githubCoordination = summarizeGithubCoordination(payload.workItems);

    if (options.json) {
      const output = `${JSON.stringify(payload, null, 2)}\n`;
      if (options.writePath) {
        writeOutput(options.writePath, output);
      }
      process.stdout.write(output);
    } else if (options.markdown) {
      const output = renderMarkdown(payload);
      if (options.writePath) {
        writeOutput(options.writePath, output);
      }
      process.stdout.write(output);
    } else {
      if (options.writePath) {
        throw new Error('--write requires --json or --markdown');
      }
      printHuman(payload);
    }

    if (options.exitCode && payload.readiness.status !== 'ok') {
      process.exitCode = 2;
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
  renderMarkdown,
};
