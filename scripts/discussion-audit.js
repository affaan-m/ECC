#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_DISCUSSION_FIRST,
  emptyDiscussionSummary,
  fetchDiscussionSummary,
} = require('./lib/github-discussions');

const SCHEMA_VERSION = 'ecc.discussion-audit.v1';
const DEFAULT_REPOS = Object.freeze([
  'affaan-m/ECC',
  'affaan-m/agentshield',
  'affaan-m/JARVIS',
  'ECC-Tools/ECC-Tools',
  'ECC-Tools/ECC-website',
]);

function usage() {
  console.log([
    'Usage: node scripts/discussion-audit.js [options]',
    '',
    'Audit GitHub discussions for maintainer touch and accepted-answer gaps.',
    '',
    'Options:',
    '  --format <text|json|markdown>',
    '                             Output format (default: text)',
    '  --json                     Alias for --format json',
    '  --markdown                 Alias for --format markdown',
    '  --write <path>             Write json or markdown output to a file',
    '  --repo <owner/repo>        GitHub repo to inspect; repeatable',
    '  --first <n>                Discussions to sample per repo (default: 100)',
    '  --use-env-github-token     Keep GITHUB_TOKEN when invoking gh',
    '  --exit-code                Return 2 when the audit is not ready',
    '  --help, -h                 Show this help',
  ].join('\n'));
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseIntegerFlag(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    exitCode: false,
    first: DEFAULT_DISCUSSION_FIRST,
    format: 'text',
    help: false,
    repos: [],
    useEnvGithubToken: false,
    writePath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--format') {
      parsed.format = readValue(args, index, arg).toLowerCase();
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length).toLowerCase();
      continue;
    }

    if (arg === '--json') {
      parsed.format = 'json';
      continue;
    }

    if (arg === '--markdown') {
      parsed.format = 'markdown';
      continue;
    }

    if (arg === '--write') {
      parsed.writePath = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--write=')) {
      parsed.writePath = path.resolve(arg.slice('--write='.length));
      continue;
    }

    if (arg === '--repo') {
      parsed.repos.push(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--repo=')) {
      parsed.repos.push(arg.slice('--repo='.length));
      continue;
    }

    if (arg === '--first') {
      parsed.first = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--first=')) {
      parsed.first = parseIntegerFlag(arg.slice('--first='.length), '--first');
      continue;
    }

    if (arg === '--use-env-github-token') {
      parsed.useEnvGithubToken = true;
      continue;
    }

    if (arg === '--exit-code') {
      parsed.exitCode = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json', 'markdown'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text, json, or markdown.`);
  }

  if (parsed.writePath && parsed.format === 'text') {
    throw new Error('--write requires --json, --markdown, or --format json|markdown');
  }

  return parsed;
}

function buildReport(options) {
  const repos = options.repos.length > 0 ? options.repos : DEFAULT_REPOS;
  const repoReports = repos.map(repo => {
    try {
      return {
        repo,
        discussions: fetchDiscussionSummary(repo, options),
      };
    } catch (error) {
      return {
        repo,
        error: error.message,
        discussions: emptyDiscussionSummary(),
      };
    }
  });

  const totals = {
    repos: repoReports.length,
    totalDiscussions: repoReports.reduce((sum, repo) => sum + repo.discussions.totalCount, 0),
    sampledDiscussions: repoReports.reduce((sum, repo) => sum + repo.discussions.sampledCount, 0),
    needingMaintainerTouch: repoReports.reduce((sum, repo) => sum + repo.discussions.needingMaintainerTouch.length, 0),
    missingAcceptedAnswer: repoReports.reduce((sum, repo) => sum + repo.discussions.answerableWithoutAcceptedAnswer.length, 0),
    errors: repoReports.filter(repo => repo.error).length,
  };

  const checks = [
    {
      id: 'discussion-fetch',
      status: totals.errors === 0 ? 'pass' : 'fail',
      summary: `GitHub discussion fetch errors: ${totals.errors}`,
      fix: 'Re-run with working gh authentication or ECC_GH_SHIM for deterministic tests.',
    },
    {
      id: 'discussion-maintainer-touch',
      status: totals.needingMaintainerTouch === 0 ? 'pass' : 'fail',
      summary: `discussions needing maintainer touch: ${totals.needingMaintainerTouch}`,
      fix: 'Respond to or route discussions without maintainer touch.',
    },
    {
      id: 'discussion-accepted-answers',
      status: totals.missingAcceptedAnswer === 0 ? 'pass' : 'fail',
      summary: `answerable discussions missing accepted answer: ${totals.missingAcceptedAnswer}`,
      fix: 'Mark an accepted answer or route Q&A discussions that still need resolution.',
    },
  ];
  const topActions = checks
    .filter(check => check.status === 'fail')
    .map(check => ({
      id: check.id,
      summary: check.summary,
      fix: check.fix,
    }));

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ready: topActions.length === 0,
    sampleFirst: options.first,
    repos: repoReports,
    totals,
    checks,
    top_actions: topActions,
  };
}

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function renderText(report) {
  const lines = [
    `ECC Discussion Audit: ${report.ready ? 'ready' : 'attention required'}`,
    `Generated: ${report.generatedAt}`,
    `Repos: ${report.totals.repos}`,
    `Discussions sampled: ${report.totals.sampledDiscussions}/${report.totals.totalDiscussions}`,
    `Needs maintainer touch: ${report.totals.needingMaintainerTouch}`,
    `Missing accepted answers: ${report.totals.missingAcceptedAnswer}`,
    `Fetch errors: ${report.totals.errors}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`  ${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }

  lines.push('', 'Top actions:');
  if (report.top_actions.length === 0) {
    lines.push('  none');
  } else {
    for (const action of report.top_actions) {
      lines.push(`  - ${action.id}: ${action.fix}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderMarkdown(report) {
  const lines = [
    '# ECC Discussion Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.ready ? 'ready' : 'attention required'}`,
    '',
    '## Summary',
    '',
    '| Surface | Count | Target | Status |',
    '| --- | ---: | ---: | --- |',
    `| Fetch errors | ${report.totals.errors} | 0 | ${report.totals.errors === 0 ? 'PASS' : 'FAIL'} |`,
    `| Discussions needing maintainer touch | ${report.totals.needingMaintainerTouch} | 0 | ${report.totals.needingMaintainerTouch === 0 ? 'PASS' : 'FAIL'} |`,
    `| Answerable discussions missing accepted answer | ${report.totals.missingAcceptedAnswer} | 0 | ${report.totals.missingAcceptedAnswer === 0 ? 'PASS' : 'FAIL'} |`,
    '',
    '## Repositories',
    '',
    '| Repository | Total | Sampled | Needs maintainer | Missing answers |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];

  for (const repo of report.repos) {
    lines.push(
      `| \`${markdownEscape(repo.repo)}\` | ${repo.discussions.totalCount} | ${repo.discussions.sampledCount} | ${repo.discussions.needingMaintainerTouch.length} | ${repo.discussions.answerableWithoutAcceptedAnswer.length} |`
    );
  }

  lines.push('', '## Top Actions', '');
  if (report.top_actions.length === 0) {
    lines.push('- none');
  } else {
    for (const action of report.top_actions) {
      lines.push(`- \`${markdownEscape(action.id)}\`: ${markdownEscape(action.fix)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeOutput(writePath, output) {
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, output, 'utf8');
}

function renderReport(report, format) {
  if (format === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === 'markdown') {
    return renderMarkdown(report);
  }

  return renderText(report);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (options.help) {
    usage();
    return;
  }

  const report = buildReport(options);
  const output = renderReport(report, options.format);

  if (options.writePath) {
    writeOutput(options.writePath, output);
  }

  process.stdout.write(output);

  if (options.exitCode && !report.ready) {
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  parseArgs,
  renderMarkdown,
  renderReport,
  renderText,
};
