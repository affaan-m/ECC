#!/usr/bin/env node
'use strict';

const { buildLifecycleReport, planCleanup } = require('./lib/worktree-lifecycle/lifecycle');

function parseArgs(argv = process.argv) {
  const args = argv.slice(2);
  const options = {
    json: false,
    conflictsOnly: false,
    staleOnly: false,
    cleanupPlan: false,
    help: false,
    baseBranch: 'main',
    staleDays: 7,
    repoRoot: process.cwd()
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--conflicts') {
      options.conflictsOnly = true;
    } else if (arg === '--stale') {
      options.staleOnly = true;
    } else if (arg === '--cleanup-plan') {
      options.cleanupPlan = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--base') {
      options.baseBranch = args[i + 1] || options.baseBranch;
      i += 1;
    } else if (arg === '--stale-days') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        options.staleDays = value;
      }
      i += 1;
    } else if (arg === '--repo') {
      options.repoRoot = args[i + 1] || options.repoRoot;
      i += 1;
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: worktree-lifecycle [options]',
    '',
    'Analyze every git worktree in a repo and classify its lifecycle state',
    '(dirty, merge-ready, conflict, merged, stale, idle). Predicts merge',
    'conflicts without touching the working tree (git merge-tree) and proposes',
    'a safe cleanup plan that never removes dirty or unmerged worktrees.',
    '',
    'Options:',
    '  --json            Print the full ecc.worktree-lifecycle.v1 report as JSON',
    '  --conflicts       Only show worktrees that would conflict on merge',
    '  --stale           Only show stale (clean, inactive) worktrees',
    '  --cleanup-plan    Show which worktrees are safe to remove and why',
    '  --base <branch>   Base branch to compare against (default: main)',
    '  --stale-days <n>  Days of inactivity before a clean worktree is stale (default: 7)',
    '  --repo <path>     Repository root (default: cwd)',
    '  -h, --help        Show this help'
  ].join('\n');
}

function formatReport(report, options = {}) {
  const lines = [];
  const a = report.aggregates;

  lines.push(`Worktree Lifecycle (${report.baseBranch})`);
  lines.push(
    `  ${a.worktreeCount} worktrees | ${a.mergeReadyCount} merge-ready, `
    + `${a.conflictCount} conflict, ${a.staleCount} stale`
  );
  lines.push('');

  if (options.conflictsOnly) {
    if (report.conflictQueue.length === 0) {
      lines.push('No worktrees would conflict on merge.');
    } else {
      lines.push('Conflict queue:');
      for (const w of report.conflictQueue) {
        const files = w.conflictFiles.length > 0 ? `  [${w.conflictFiles.slice(0, 5).join(', ')}]` : '';
        lines.push(`  ${w.branch}  (${w.ahead} ahead)${files}`);
      }
    }
    return lines.join('\n');
  }

  if (options.staleOnly) {
    if (report.staleQueue.length === 0) {
      lines.push('No stale worktrees.');
    } else {
      lines.push('Stale queue:');
      for (const w of report.staleQueue) {
        lines.push(`  ${w.branch}  (${Math.round((w.ageMs || 0) / 86400000)}d old)  ${w.path}`);
      }
    }
    return lines.join('\n');
  }

  if (options.cleanupPlan) {
    const plan = planCleanup(report);
    lines.push(`Safe to remove (${plan.remove.length}):`);
    for (const item of plan.remove) {
      lines.push(`  ${item.branch || '(detached)'}  -  ${item.reason}`);
    }
    lines.push('');
    lines.push(`Salvage first, then remove (${plan.salvage.length}):`);
    for (const item of plan.salvage) {
      lines.push(`  ${item.branch || '(detached)'}  -  ${item.reason}`);
    }
    lines.push('');
    lines.push(`Kept (${plan.keep.length}):`);
    for (const item of plan.keep) {
      lines.push(`  ${item.branch || '(detached)'}  -  ${item.reason}`);
    }
    return lines.join('\n');
  }

  lines.push('Worktrees:');
  for (const w of report.worktrees) {
    const counts = w.ahead !== null ? `  +${w.ahead}/-${w.behind}` : '';
    lines.push(`  ${(w.branch || '(detached)').padEnd(28)} ${w.state}${counts}`);
  }

  return lines.join('\n');
}

function main(argv = process.argv) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  const report = buildLifecycleReport(options.repoRoot, {
    baseBranch: options.baseBranch,
    staleThresholdMs: options.staleDays * 24 * 60 * 60 * 1000
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReport(report, options));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  usage,
  formatReport,
  main
};
