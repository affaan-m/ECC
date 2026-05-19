#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  emptyDiscussionSummary,
  fetchDiscussionSummary,
} = require('./lib/github-discussions');

const SCHEMA_VERSION = 'ecc.platform-audit.v1';
const DEFAULT_REPOS = Object.freeze([
  'affaan-m/ECC',
  'affaan-m/agentshield',
  'affaan-m/JARVIS',
  'ECC-Tools/ECC-Tools',
  'ECC-Tools/ECC-website',
]);
const DEFAULT_THRESHOLDS = Object.freeze({
  maxOpenPrs: 20,
  maxOpenIssues: 20,
  maxDirtyFiles: 0,
});
function usage() {
  console.log([
    'Usage: node scripts/platform-audit.js [options]',
    '',
    'Operator readiness audit for ECC queue, discussion, roadmap, release, and security evidence.',
    '',
    'Options:',
    '  --format <text|json|markdown>',
    '                             Output format (default: text)',
    '  --json                     Alias for --format json',
    '  --markdown                 Alias for --format markdown',
    '  --write <path>             Write json or markdown output to a file',
    '  --root <dir>               Repository root to inspect (default: cwd)',
    '  --repo <owner/repo>        GitHub repo to inspect; repeatable',
    '  --skip-github              Skip live GitHub queue/discussion checks',
    '  --max-open-prs <n>         Fail when open PR count is above n (default: 20)',
    '  --max-open-issues <n>      Fail when open issue count is above n (default: 20)',
    '  --max-dirty-files <n>      Fail when blocking dirty file count is above n (default: 0)',
    '  --allow-untracked <path>   Ignore untracked files under path; repeatable',
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
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    allowUntracked: [],
    exitCode: false,
    format: 'text',
    help: false,
    repos: [],
    root: path.resolve(process.cwd()),
    skipGithub: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
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

    if (arg === '--root') {
      parsed.root = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
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

    if (arg === '--skip-github') {
      parsed.skipGithub = true;
      continue;
    }

    if (arg === '--allow-untracked') {
      parsed.allowUntracked.push(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--allow-untracked=')) {
      parsed.allowUntracked.push(arg.slice('--allow-untracked='.length));
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

    if (arg === '--max-open-prs') {
      parsed.thresholds.maxOpenPrs = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-open-prs=')) {
      parsed.thresholds.maxOpenPrs = parseIntegerFlag(arg.slice('--max-open-prs='.length), '--max-open-prs');
      continue;
    }

    if (arg === '--max-open-issues') {
      parsed.thresholds.maxOpenIssues = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-open-issues=')) {
      parsed.thresholds.maxOpenIssues = parseIntegerFlag(arg.slice('--max-open-issues='.length), '--max-open-issues');
      continue;
    }

    if (arg === '--max-dirty-files') {
      parsed.thresholds.maxDirtyFiles = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-dirty-files=')) {
      parsed.thresholds.maxDirtyFiles = parseIntegerFlag(arg.slice('--max-dirty-files='.length), '--max-dirty-files');
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

  parsed.allowUntracked = parsed.allowUntracked.map(normalizeRelativePrefix);

  return parsed;
}

function normalizeRelativePrefix(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '') + (String(value || '').endsWith('/') ? '/' : '');
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

function runGhJson(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };

  if (!options.useEnvGithubToken) {
    delete env.GITHUB_TOKEN;
  }

  const stdout = runCommand(command, commandArgs, { env });
  try {
    return JSON.parse(stdout || 'null');
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function readText(rootDir, relativePath) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  } catch (_error) {
    return '';
  }
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function safeParseJson(text) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function includesAll(text, needles) {
  return needles.every(needle => text.includes(needle));
}

function buildCheck(id, status, summary, details = {}) {
  return { id, status, summary, ...details };
}

function parseGitStatus(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines[0] || '';
  const dirtyLines = lines.slice(1);
  return {
    branch: branchLine.replace(/^##\s*/, '') || null,
    dirtyLines,
  };
}

function isAllowedUntracked(statusLine, allowUntracked) {
  if (!statusLine.startsWith('?? ')) {
    return false;
  }

  const relativePath = statusLine.slice(3).replace(/\\/g, '/');
  return allowUntracked.some(prefix => relativePath === prefix || relativePath.startsWith(prefix));
}

function inspectGit(rootDir, options) {
  try {
    const parsed = parseGitStatus(runCommand('git', ['status', '--short', '--branch'], { cwd: rootDir }));
    const ignoredDirty = parsed.dirtyLines.filter(line => isAllowedUntracked(line, options.allowUntracked));
    const blockingDirty = parsed.dirtyLines.filter(line => !isAllowedUntracked(line, options.allowUntracked));

    return {
      available: true,
      branch: parsed.branch,
      dirtyLines: parsed.dirtyLines,
      ignoredDirty,
      blockingDirty,
      blockingDirtyCount: blockingDirty.length,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      branch: null,
      dirtyLines: [],
      ignoredDirty: [],
      blockingDirty: [],
      blockingDirtyCount: 0,
    };
  }
}

function fetchGithubRepo(repo, options) {
  const prs = runGhJson([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--json',
    'number,title,isDraft,mergeStateStatus,updatedAt,url,author',
  ], options);
  const issues = runGhJson([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--json',
    'number,title,updatedAt,url,author,labels',
  ], options);
  const discussionSummary = fetchDiscussionSummary(repo, options);

  return {
    repo,
    openPrs: Array.isArray(prs) ? prs.length : 0,
    openIssues: Array.isArray(issues) ? issues.length : 0,
    discussions: discussionSummary,
    dirtyPrs: (Array.isArray(prs) ? prs : []).filter(pr => pr.mergeStateStatus === 'DIRTY').map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
    })),
  };
}

function buildGithubReport(options) {
  const repos = options.repos.length > 0 ? options.repos : DEFAULT_REPOS;

  if (options.skipGithub) {
    return {
      skipped: true,
      repos: repos.map(repo => ({ repo, skipped: true })),
      totals: {
        openPrs: 0,
        openIssues: 0,
        discussionsNeedingMaintainerTouch: 0,
        discussionsMissingAcceptedAnswer: 0,
        dirtyPrs: 0,
        errors: 0,
      },
    };
  }

  const repoReports = repos.map(repo => {
    try {
      return fetchGithubRepo(repo, options);
    } catch (error) {
      return {
        repo,
        error: error.message,
        openPrs: 0,
        openIssues: 0,
        discussions: emptyDiscussionSummary(),
        dirtyPrs: [],
      };
    }
  });

  return {
    skipped: false,
    repos: repoReports,
    totals: {
      openPrs: repoReports.reduce((sum, repo) => sum + repo.openPrs, 0),
      openIssues: repoReports.reduce((sum, repo) => sum + repo.openIssues, 0),
      discussionsNeedingMaintainerTouch: repoReports.reduce((sum, repo) => sum + repo.discussions.needingMaintainerTouch.length, 0),
      discussionsMissingAcceptedAnswer: repoReports.reduce((sum, repo) => sum + repo.discussions.answerableWithoutAcceptedAnswer.length, 0),
      dirtyPrs: repoReports.reduce((sum, repo) => sum + repo.dirtyPrs.length, 0),
      errors: repoReports.filter(repo => repo.error).length,
    },
  };
}

function buildLocalEvidenceChecks(rootDir) {
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const packageScripts = packageJson.scripts || {};
  const roadmap = readText(rootDir, 'docs/ECC-2.0-GA-ROADMAP.md');
  const progressSync = readText(rootDir, 'docs/architecture/progress-sync-contract.md');
  const supplyChain = readText(rootDir, 'docs/security/supply-chain-incident-response.md');
  const evidence = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md');
  const operatorDashboard = readText(rootDir, 'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md');

  return [
    buildCheck(
      'platform-audit-cli-surface',
      packageScripts['platform:audit'] === 'node scripts/platform-audit.js'
        && packageScripts['discussion:audit'] === 'node scripts/discussion-audit.js'
        && packageScripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        ? 'pass'
        : 'fail',
      'package.json exposes platform, discussion, and operator dashboard audit commands',
      { fix: 'Add platform:audit, discussion:audit, and operator:dashboard commands to package.json.' }
    ),
    buildCheck(
      'operator-dashboard-command',
      fileExists(rootDir, 'scripts/operator-readiness-dashboard.js')
        && packageScripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        ? 'pass'
        : 'fail',
      'operator dashboard is generated by the repeatable ITO-44 command',
      { path: 'scripts/operator-readiness-dashboard.js' }
    ),
    buildCheck(
      'roadmap-linear-mirror',
      includesAll(roadmap, ['linear.app/itomarkets/project/ecc-platform-roadmap', 'ITO-44', 'ITO-59']) ? 'pass' : 'fail',
      'repo roadmap mirrors the Linear roadmap and security/operator lanes',
      { path: 'docs/ECC-2.0-GA-ROADMAP.md' }
    ),
    buildCheck(
      'progress-sync-contract',
      includesAll(progressSync, ['GitHub PRs/issues/discussions', 'Linear project', 'local handoff', 'repo roadmap', 'scripts/work-items.js']) ? 'pass' : 'fail',
      'progress sync contract names GitHub, Linear, handoff, roadmap, and work-items surfaces',
      { path: 'docs/architecture/progress-sync-contract.md' }
    ),
    buildCheck(
      'supply-chain-runbook',
      includesAll(supplyChain, ['TanStack', 'Mini Shai-Hulud', 'node-ipc', 'scan-supply-chain-iocs.js', 'supply-chain-advisory-sources.js'])
        && packageScripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
        ? 'pass'
        : 'fail',
      'supply-chain runbook covers the current TanStack/Mini Shai-Hulud/node-ipc scanner and advisory-source lanes',
      { path: 'docs/security/supply-chain-incident-response.md' }
    ),
    buildCheck(
      'release-evidence-current',
      includesAll(evidence, ['Release video suite', 'growth outreach', 'Operator dashboard', 'GitGuardian', 'macOS/Ubuntu/Windows test matrix', '2547 passed']) ? 'pass' : 'fail',
      'rc.1 evidence includes current release, video, growth, and CI artifacts',
      { path: 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md' }
    ),
    buildCheck(
      'operator-readiness-dashboard',
      includesAll(operatorDashboard, [
        'This dashboard is generated by `npm run operator:dashboard`',
        'Growth Baseline',
        'hypergrowth release command center',
        'Prompt-To-Artifact Checklist',
        'PR queue',
        'Not complete',
        'Next Work Order',
      ]) ? 'pass' : 'fail',
      'operator dashboard maps macro-goal requirements to current evidence and open gaps',
      { path: 'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md' }
    ),
  ];
}

function buildReport(options) {
  const rootDir = path.resolve(options.root);
  const git = inspectGit(rootDir, options);
  const github = buildGithubReport(options);
  const checks = [];

  checks.push(buildCheck(
    'git-worktree-blockers',
    !git.available ? 'warn' : (git.blockingDirtyCount <= options.thresholds.maxDirtyFiles ? 'pass' : 'fail'),
    !git.available
      ? 'git status is unavailable for this root'
      : `blocking dirty files: ${git.blockingDirtyCount}`,
    {
      branch: git.branch,
      ignoredDirtyCount: git.ignoredDirty.length,
      blockingDirty: git.blockingDirty,
      fix: 'Commit, stash, or explicitly allow unrelated untracked files before claiming release readiness.',
    }
  ));

  checks.push(buildCheck(
    'github-fetch',
    github.skipped ? 'warn' : (github.totals.errors === 0 ? 'pass' : 'fail'),
    github.skipped ? 'live GitHub checks skipped' : `GitHub fetch errors: ${github.totals.errors}`,
    { fix: 'Re-run with working gh authentication or ECC_GH_SHIM for deterministic tests.' }
  ));

  checks.push(buildCheck(
    'github-open-pr-budget',
    github.totals.openPrs <= options.thresholds.maxOpenPrs ? 'pass' : 'fail',
    `open PRs: ${github.totals.openPrs}/${options.thresholds.maxOpenPrs}`,
    { fix: 'Triage, merge, close, or attach open PRs to roadmap issues until under budget.' }
  ));

  checks.push(buildCheck(
    'github-open-issue-budget',
    github.totals.openIssues <= options.thresholds.maxOpenIssues ? 'pass' : 'fail',
    `open issues: ${github.totals.openIssues}/${options.thresholds.maxOpenIssues}`,
    { fix: 'Triage, close, or attach open issues to Linear/project lanes until under budget.' }
  ));

  checks.push(buildCheck(
    'github-discussion-touch',
    github.totals.discussionsNeedingMaintainerTouch === 0 ? 'pass' : 'fail',
    `discussions needing maintainer touch: ${github.totals.discussionsNeedingMaintainerTouch}`,
    { fix: 'Respond to or route discussions without maintainer touch before marking the queue current.' }
  ));

  checks.push(buildCheck(
    'github-discussion-answers',
    github.totals.discussionsMissingAcceptedAnswer === 0 ? 'pass' : 'fail',
    `answerable discussions missing accepted answer: ${github.totals.discussionsMissingAcceptedAnswer}`,
    { fix: 'Mark an accepted answer or route Q&A discussions that still need resolution.' }
  ));

  checks.push(buildCheck(
    'github-conflict-queue',
    github.totals.dirtyPrs === 0 ? 'pass' : 'fail',
    `conflicting open PRs: ${github.totals.dirtyPrs}`,
    { fix: 'Update, rebase, salvage, or close conflicting open PRs.' }
  ));

  checks.push(...buildLocalEvidenceChecks(rootDir));

  const topActions = checks
    .filter(check => check.status === 'fail')
    .map(check => ({
      id: check.id,
      summary: check.summary,
      fix: check.fix || 'Review and remediate this failed check.',
    }));

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: rootDir,
    ready: topActions.length === 0,
    thresholds: options.thresholds,
    git,
    github,
    checks,
    top_actions: topActions,
  };
}

function renderText(report) {
  const lines = [
    `ECC Platform Audit: ${report.ready ? 'ready' : 'attention required'}`,
    `Generated: ${report.generatedAt}`,
    `Root: ${report.root}`,
    '',
    `Git: ${report.git.available ? report.git.branch : 'unavailable'}`,
    `Blocking dirty files: ${report.git.blockingDirtyCount}`,
    `Ignored dirty files: ${report.git.ignoredDirty.length}`,
    '',
    `GitHub skipped: ${report.github.skipped ? 'yes' : 'no'}`,
    `Open PRs: ${report.github.totals.openPrs}/${report.thresholds.maxOpenPrs}`,
    `Open issues: ${report.github.totals.openIssues}/${report.thresholds.maxOpenIssues}`,
    `Discussions needing maintainer touch: ${report.github.totals.discussionsNeedingMaintainerTouch}`,
    `Answerable discussions missing accepted answer: ${report.github.totals.discussionsMissingAcceptedAnswer}`,
    `Conflicting open PRs: ${report.github.totals.dirtyPrs}`,
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

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function markdownStatus(status) {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'warn':
      return 'WARN';
    default:
      return String(status || 'UNKNOWN').toUpperCase();
  }
}

function renderMarkdown(report) {
  const lines = [
    '# ECC Platform Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.ready ? 'ready' : 'attention required'}`,
    `Root: \`${report.root}\``,
    '',
    '## Queue Summary',
    '',
    '| Surface | Count | Threshold | Status |',
    '| --- | ---: | ---: | --- |',
    `| Open PRs | ${report.github.totals.openPrs} | ${report.thresholds.maxOpenPrs} | ${report.github.totals.openPrs <= report.thresholds.maxOpenPrs ? 'PASS' : 'FAIL'} |`,
    `| Open issues | ${report.github.totals.openIssues} | ${report.thresholds.maxOpenIssues} | ${report.github.totals.openIssues <= report.thresholds.maxOpenIssues ? 'PASS' : 'FAIL'} |`,
    `| Discussions needing maintainer touch | ${report.github.totals.discussionsNeedingMaintainerTouch} | 0 | ${report.github.totals.discussionsNeedingMaintainerTouch === 0 ? 'PASS' : 'FAIL'} |`,
    `| Answerable discussions missing accepted answer | ${report.github.totals.discussionsMissingAcceptedAnswer} | 0 | ${report.github.totals.discussionsMissingAcceptedAnswer === 0 ? 'PASS' : 'FAIL'} |`,
    `| Conflicting open PRs | ${report.github.totals.dirtyPrs} | 0 | ${report.github.totals.dirtyPrs === 0 ? 'PASS' : 'FAIL'} |`,
    `| Blocking dirty files | ${report.git.blockingDirtyCount} | ${report.thresholds.maxDirtyFiles} | ${report.git.blockingDirtyCount <= report.thresholds.maxDirtyFiles ? 'PASS' : 'FAIL'} |`,
    '',
    '## Repositories',
    '',
    '| Repository | PRs | Issues | Discussions sampled | Needs maintainer | Missing answers | Dirty PRs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const repo of report.github.repos) {
    lines.push(
      `| \`${markdownEscape(repo.repo)}\` | ${repo.openPrs || 0} | ${repo.openIssues || 0} | ${repo.discussions ? repo.discussions.sampledCount : 0} | ${repo.discussions ? repo.discussions.needingMaintainerTouch.length : 0} | ${repo.discussions ? repo.discussions.answerableWithoutAcceptedAnswer.length : 0} | ${repo.dirtyPrs ? repo.dirtyPrs.length : 0} |`
    );
  }

  lines.push(
    '',
    '## Checks',
    '',
    '| Status | Check | Summary | Evidence |',
    '| --- | --- | --- | --- |'
  );

  for (const check of report.checks) {
    lines.push(
      `| ${markdownStatus(check.status)} | \`${markdownEscape(check.id)}\` | ${markdownEscape(check.summary)} | ${check.path ? `\`${markdownEscape(check.path)}\`` : ''} |`
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

  lines.push('', '## Git State', '');
  lines.push(`- Branch: ${report.git.branch ? `\`${markdownEscape(report.git.branch)}\`` : '(unknown)'}`);
  lines.push(`- Ignored dirty files: ${report.git.ignoredDirty.length}`);
  if (report.git.ignoredDirty.length > 0) {
    for (const line of report.git.ignoredDirty) {
      lines.push(`  - \`${markdownEscape(line)}\``);
    }
  }
  lines.push(`- Blocking dirty files: ${report.git.blockingDirty.length}`);
  if (report.git.blockingDirty.length > 0) {
    for (const line of report.git.blockingDirty) {
      lines.push(`  - \`${markdownEscape(line)}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeOutput(writePath, output) {
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, output, 'utf8');
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      usage();
      return;
    }

    const report = buildReport(options);
    const output = options.format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : options.format === 'markdown'
        ? renderMarkdown(report)
        : renderText(report);
    if (options.writePath) {
      writeOutput(options.writePath, output);
    }
    process.stdout.write(output);

    if (options.exitCode && !report.ready) {
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  parseArgs,
  renderMarkdown,
  renderText,
  runGhJson,
};
