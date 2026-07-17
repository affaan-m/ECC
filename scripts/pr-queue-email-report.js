#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');
const os = require('os');
const { spawnSync } = require('child_process');

const DEFAULT_REPO = 'affaan-m/ECC';
const DEFAULT_SINCE_DAYS = 3;
const DEFAULT_LIMIT = 100;
const DEFAULT_WORKFLOW_FILE = 'pr-queue-triage-report.yml';
const SMTP_TIMEOUT_MS = 15000;

const PR_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'isDraft',
  'mergeStateStatus',
  'reviewDecision',
  'createdAt',
  'updatedAt',
  'additions',
  'deletions',
  'changedFiles',
  'labels',
  'body',
].join(',');

const RISK_PATTERNS = Object.freeze([
  {
    id: 'external-links',
    label: 'external links',
    pattern: /https?:\/\/[^\s)"'<>]+/gi,
    severity: 1,
  },
  {
    id: 'network-egress',
    label: 'network egress or HTTP client',
    pattern: /\b(fetch|axios|request|httpx|urllib|requests\.|curl|wget|webhook|socket|WebSocket)\b/gi,
    severity: 2,
  },
  {
    id: 'secret-surface',
    label: 'secret, token, key, or credential surface',
    pattern: /\b(api[_-]?key|secret|token|bearer|authorization|password|credential|oauth|ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|xox[baprs]-)\b/gi,
    severity: 3,
  },
  {
    id: 'data-movement',
    label: 'data movement, telemetry, export, or stdout path',
    pattern: /\b(upload|download|export|telemetry|analytics|metrics|tracking|send|postMessage|process\.stdout|stdout\.write|console\.log|jsonl|transcript|task_description)\b/gi,
    severity: 2,
  },
  {
    id: 'subprocess-install',
    label: 'subprocess or dependency install path',
    pattern: /\b(child_process|spawnSync|execSync|spawn\(|exec\(|pip install|npm install|pnpm install|yarn install|bun install|npx |bash -c|sh -c)\b/gi,
    severity: 2,
  },
  {
    id: 'workflow-release',
    label: 'workflow, release, or publish surface',
    pattern: /(^diff --git a\/\.github\/workflows\/|npm publish|gh release|id-token|contents:\s*write|pull_request_target)/gim,
    severity: 3,
  },
  {
    id: 'hook-surface',
    label: 'hook lifecycle or tool payload surface',
    pattern: /\b(PostToolUse|PreToolUse|SessionStart|SessionEnd|Stop|tool_input|tool_response|hooks?\.json|CLAUDE_TRANSCRIPT_PATH)\b/gi,
    severity: 2,
  },
  {
    id: 'promo-generated',
    label: 'generated metadata, self-promotion, or unrelated promo',
    pattern: /\b(Generated with Claude Code|Co-Authored-By:\s*Claude|CodeRabbit|Cubic|sponsor|discord|twitter|x\.com|portfolio|pricing|newsletter|shout[- ]?out)\b/gi,
    severity: 2,
  },
  {
    id: 'prompt-injection',
    label: 'prompt-injection or jailbreak language',
    pattern: /\b(ignore previous|jailbreak|DAN\b|developer mode|system prompt|prompt injection|exfiltrate)\b/gi,
    severity: 3,
  },
]);

function usage() {
  console.log([
    'Usage: node scripts/pr-queue-email-report.js [options]',
    '',
    'Generate a short PR queue triage report and optionally email it.',
    '',
    'Options:',
    '  --repo <owner/repo>          Repository to inspect (default: affaan-m/ECC)',
    '  --since <iso-date>          Only include PRs created at or after this time',
    '  --since-days <n>            Fallback window in days (default: 3)',
    '  --since-last-success        Use the last successful report workflow run as the lower bound',
    '  --workflow-file <name>      Workflow file for --since-last-success',
    '  --limit <n>                 Max PRs to inspect (default: 100)',
    '  --write <path>              Write markdown report to a file',
    '  --json <path>               Write raw report JSON to a file',
    '  --send-email                Send the report via SMTP when new PRs exist',
    '  --require-email             Fail when new PRs exist but SMTP is not configured',
    '  --help, -h                  Show this help',
  ].join('\n'));
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    format: 'markdown',
    help: false,
    jsonPath: null,
    limit: DEFAULT_LIMIT,
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    requireEmail: false,
    sendEmail: false,
    since: null,
    sinceDays: DEFAULT_SINCE_DAYS,
    sinceLastSuccess: false,
    workflowFile: DEFAULT_WORKFLOW_FILE,
    writePath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--repo') {
      parsed.repo = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      parsed.repo = arg.slice('--repo='.length);
      continue;
    }

    if (arg === '--since') {
      parsed.since = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--since=')) {
      parsed.since = arg.slice('--since='.length);
      continue;
    }

    if (arg === '--since-days') {
      parsed.sinceDays = parsePositiveInteger(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--since-days=')) {
      parsed.sinceDays = parsePositiveInteger(arg.slice('--since-days='.length), '--since-days');
      continue;
    }

    if (arg === '--since-last-success') {
      parsed.sinceLastSuccess = true;
      continue;
    }

    if (arg === '--workflow-file') {
      parsed.workflowFile = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--workflow-file=')) {
      parsed.workflowFile = arg.slice('--workflow-file='.length);
      continue;
    }

    if (arg === '--limit') {
      parsed.limit = parsePositiveInteger(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      parsed.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
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

    if (arg === '--json') {
      parsed.jsonPath = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--json=')) {
      parsed.jsonPath = path.resolve(arg.slice('--json='.length));
      continue;
    }

    if (arg === '--send-email') {
      parsed.sendEmail = true;
      continue;
    }

    if (arg === '--require-email') {
      parsed.requireEmail = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(parsed.repo)) {
    throw new Error(`Invalid repo: ${parsed.repo}`);
  }

  if (parsed.since) {
    const parsedDate = new Date(parsed.since);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid --since date: ${parsed.since}`);
    }
    parsed.since = parsedDate.toISOString();
  }

  return parsed;
}

function splitRepo(repo) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo: ${repo}`);
  }
  return { owner, name };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return result.stdout || '';
}

function runGh(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };
  return runCommand(command, commandArgs, {
    env,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });
}

function runGhJson(args, options = {}) {
  const stdout = runGh(args, options);
  try {
    return JSON.parse(stdout || 'null');
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function computeFallbackSince(sinceDays, now = new Date()) {
  return new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
}

function fetchLastSuccessfulWorkflowSince(options) {
  const { owner, name } = splitRepo(options.repo);
  const payload = runGhJson([
    'api',
    `repos/${owner}/${name}/actions/workflows/${options.workflowFile}/runs`,
    '-F',
    'per_page=10',
    '-f',
    'status=success',
    '-f',
    'branch=main',
  ]);

  const runs = payload && Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  const currentRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null;
  const previous = runs.find(run => {
    if (currentRunId && Number(run.id) === currentRunId) return false;
    return run && run.conclusion === 'success' && (run.created_at || run.updated_at);
  });

  return previous ? new Date(previous.created_at || previous.updated_at).toISOString() : null;
}

function resolveSince(options) {
  if (options.since) return options.since;

  if (options.sinceLastSuccess) {
    try {
      const previous = fetchLastSuccessfulWorkflowSince(options);
      if (previous) return previous;
    } catch (error) {
      console.warn(`WARN: could not read previous workflow run; using --since-days fallback: ${error.message}`);
    }
  }

  return computeFallbackSince(options.sinceDays);
}

function fetchNewPullRequests(options, since) {
  return runGhJson([
    'pr',
    'list',
    '--repo',
    options.repo,
    '--state',
    'open',
    '--search',
    `created:>=${since}`,
    '--limit',
    String(options.limit),
    '--json',
    PR_FIELDS,
  ]);
}

function fetchPrDiff(repo, number) {
  return runGh([
    'pr',
    'diff',
    String(number),
    '--repo',
    repo,
    '--patch',
  ], { maxBuffer: 12 * 1024 * 1024 });
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    const pathHint = url.pathname && url.pathname !== '/' ? '/...' : '';
    return `${url.protocol}//${url.hostname}${pathHint}`;
  } catch {
    return '[redacted url]';
  }
}

function sanitizeFindingMatch(findingId, value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (findingId === 'external-links') {
    return sanitizeUrl(text);
  }

  if (findingId === 'secret-surface') {
    return '[redacted credential/token match]';
  }

  if (findingId === 'prompt-injection') {
    return '[redacted prompt-injection phrase]';
  }

  return text
    .replace(/https?:\/\/[^\s)"'<>]+/gi, match => sanitizeUrl(match))
    .replace(/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{16}|bearer\s+[A-Za-z0-9._-]{8,})/gi, '[redacted token]');
}

function uniqueMatches(text, pattern, limit = 6, findingId = '') {
  const matches = [];
  const seen = new Set();
  pattern.lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const value = sanitizeFindingMatch(findingId, match[0]);
    const normalized = value.toLowerCase();
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    matches.push(value.length > 120 ? `${value.slice(0, 117)}...` : value);
    if (matches.length >= limit) break;
  }

  return matches;
}

function riskFindingsForText(text) {
  return RISK_PATTERNS
    .map(pattern => ({
      id: pattern.id,
      label: pattern.label,
      severity: pattern.severity,
      matches: uniqueMatches(text, pattern.pattern, 6, pattern.id),
    }))
    .filter(finding => finding.matches.length > 0);
}

function classifyPr(pr, findings, context = {}) {
  const score = findings.reduce((sum, finding) => sum + finding.severity, 0);
  const large = Number(pr.changedFiles || 0) > 25 || Number(pr.additions || 0) + Number(pr.deletions || 0) > 1500;
  const hasHighRisk = findings.some(finding => finding.severity >= 3);

  if (context.diffError) {
    return {
      level: 'security review',
      action: 'Split or manually review before merge consideration; diff scan was unavailable or too large.',
    };
  }

  if (pr.isDraft) {
    return {
      level: 'draft',
      action: 'Wait for author to mark ready; do not review as merge-ready.',
    };
  }

  if (hasHighRisk || score >= 5 || large) {
    return {
      level: 'security review',
      action: 'Security/product review before merge consideration.',
    };
  }

  if (findings.some(finding => finding.id === 'promo-generated')) {
    return {
      level: 'cleanup required',
      action: 'Remove generated metadata or unrelated promotion before merge consideration.',
    };
  }

  if (score === 0 && Number(pr.changedFiles || 0) <= 6) {
    return {
      level: 'low-risk review',
      action: 'Maintainer can review normally; no obvious data/export/promo surface found.',
    };
  }

  return {
    level: 'maintainer review',
    action: 'Review focused behavior and tests; inspect flagged patterns below.',
  };
}

function summarizePr(pr, repo) {
  let diff = '';
  let diffError = null;
  try {
    diff = fetchPrDiff(repo, pr.number);
  } catch (error) {
    diffError = error.message;
  }

  const body = pr.body || '';
  const labels = Array.isArray(pr.labels) ? pr.labels.map(label => label.name || label).filter(Boolean) : [];
  const searchText = [
    pr.title || '',
    body,
    labels.join(' '),
    diff,
  ].join('\n');
  const findings = riskFindingsForText(searchText);
  const classification = classifyPr(pr, findings, { diffError });

  return {
    number: pr.number,
    title: pr.title || '',
    url: pr.url || '',
    author: pr.author && pr.author.login ? pr.author.login : 'unknown',
    createdAt: pr.createdAt || '',
    updatedAt: pr.updatedAt || '',
    additions: Number(pr.additions || 0),
    deletions: Number(pr.deletions || 0),
    changedFiles: Number(pr.changedFiles || 0),
    draft: Boolean(pr.isDraft),
    mergeStateStatus: pr.mergeStateStatus || '',
    reviewDecision: pr.reviewDecision || '',
    labels,
    diffError,
    findings,
    classification,
  };
}

function buildReport(options) {
  const since = resolveSince(options);
  const prs = fetchNewPullRequests(options, since);
  const summaries = Array.isArray(prs)
    ? prs.sort((a, b) => Number(a.number) - Number(b.number)).map(pr => summarizePr(pr, options.repo))
    : [];

  const totals = {
    newPrs: summaries.length,
    lowRisk: summaries.filter(pr => pr.classification.level === 'low-risk review').length,
    securityReview: summaries.filter(pr => pr.classification.level === 'security review').length,
    cleanupRequired: summaries.filter(pr => pr.classification.level === 'cleanup required').length,
    draft: summaries.filter(pr => pr.classification.level === 'draft').length,
  };

  return {
    schema_version: 'ecc.pr-queue-triage-report.v1',
    generatedAt: new Date().toISOString(),
    repo: options.repo,
    since,
    hasNewPrs: summaries.length > 0,
    totals,
    prs: summaries,
  };
}

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function renderFindingSummary(findings) {
  if (!findings.length) return 'None found';
  return findings.map(finding => finding.label).join('; ');
}

function renderMarkdown(report) {
  if (!report.hasNewPrs) {
    return [
      '# ECC PR Queue Triage',
      '',
      `Generated: ${report.generatedAt}`,
      `Repository: ${report.repo}`,
      `Window start: ${report.since}`,
      '',
      'No new open PRs were found. No email should be sent.',
      '',
    ].join('\n');
  }

  const lines = [
    '# ECC PR Queue Triage',
    '',
    `Generated: ${report.generatedAt}`,
    `Repository: ${report.repo}`,
    `Window start: ${report.since}`,
    '',
    '## Summary',
    '',
    `- New open PRs: ${report.totals.newPrs}`,
    `- Low-risk review: ${report.totals.lowRisk}`,
    `- Security/product review: ${report.totals.securityReview}`,
    `- Cleanup required: ${report.totals.cleanupRequired}`,
    `- Draft: ${report.totals.draft}`,
    '',
    '## PRs',
    '',
    '| PR | Title | Author | Size | Recommendation | Findings |',
    '| --- | --- | --- | ---: | --- | --- |',
  ];

  for (const pr of report.prs) {
    lines.push([
      `[#${pr.number}](${pr.url})`,
      markdownEscape(pr.title),
      markdownEscape(pr.author),
      `${pr.changedFiles} files, +${pr.additions}/-${pr.deletions}`,
      markdownEscape(`${pr.classification.level}: ${pr.classification.action}`),
      markdownEscape(renderFindingSummary(pr.findings)),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('', '## Findings Detail', '');

  for (const pr of report.prs) {
    lines.push(`### [#${pr.number}: ${pr.title}](${pr.url})`, '');
    lines.push(`Action: ${pr.classification.action}`);
    if (pr.diffError) {
      lines.push(`Diff scan error: ${pr.diffError}`);
    }
    if (!pr.findings.length) {
      lines.push('Pattern scan: no obvious links, data-export, credential, workflow, hook, jailbreak, or promotion patterns found.');
    } else {
      for (const finding of pr.findings) {
        lines.push(`- ${finding.label}: ${finding.matches.map(value => `\`${value.replace(/`/g, '')}\``).join(', ')}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function htmlEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(report) {
  const rows = report.prs.map(pr => `
    <tr>
      <td><a href="${htmlEscape(pr.url)}">#${pr.number}</a></td>
      <td>${htmlEscape(pr.title)}</td>
      <td>${htmlEscape(pr.author)}</td>
      <td>${pr.changedFiles} files, +${pr.additions}/-${pr.deletions}</td>
      <td>${htmlEscape(pr.classification.level)}</td>
      <td>${htmlEscape(renderFindingSummary(pr.findings))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html>
  <body>
    <h1>ECC PR Queue Triage</h1>
    <p><strong>Generated:</strong> ${htmlEscape(report.generatedAt)}<br>
    <strong>Repository:</strong> ${htmlEscape(report.repo)}<br>
    <strong>Window start:</strong> ${htmlEscape(report.since)}</p>
    <ul>
      <li>New open PRs: ${report.totals.newPrs}</li>
      <li>Low-risk review: ${report.totals.lowRisk}</li>
      <li>Security/product review: ${report.totals.securityReview}</li>
      <li>Cleanup required: ${report.totals.cleanupRequired}</li>
      <li>Draft: ${report.totals.draft}</li>
    </ul>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead>
        <tr>
          <th>PR</th>
          <th>Title</th>
          <th>Author</th>
          <th>Size</th>
          <th>Recommendation</th>
          <th>Findings</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content);
}

function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function getEmailConfig() {
  const to = process.env.PR_TRIAGE_EMAIL_TO || process.env.SMTP_TO || '';
  const host = process.env.PR_TRIAGE_SMTP_HOST || process.env.SMTP_HOST || '';
  const port = Number(process.env.PR_TRIAGE_SMTP_PORT || process.env.SMTP_PORT || 465);
  const user = process.env.PR_TRIAGE_SMTP_USER || process.env.SMTP_USER || '';
  const pass = process.env.PR_TRIAGE_SMTP_PASS || process.env.SMTP_PASS || '';
  const from = process.env.PR_TRIAGE_SMTP_FROM || process.env.SMTP_FROM || user || to;
  const secureRaw = process.env.PR_TRIAGE_SMTP_SECURE || process.env.SMTP_SECURE || '';
  const secure = secureRaw ? /^(1|true|yes|on)$/i.test(secureRaw) : port === 465;
  const startTls = !secure && !/^(0|false|no|off)$/i.test(process.env.PR_TRIAGE_SMTP_STARTTLS || process.env.SMTP_STARTTLS || '');

  return { to, host, port, user, pass, from, secure, startTls };
}

function isEmailConfigured(config) {
  return Boolean(config.to && config.host && config.port && config.from && config.user && config.pass);
}

function waitForResponse(reader, expectedCodes) {
  return reader.readResponse().then(response => {
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP expected ${expectedCodes.join('/')} but got ${response.code}: ${response.text}`);
    }
    return response;
  });
}

function createSmtpReader(socket) {
  let buffer = '';
  const pending = [];

  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    flush();
  });
  socket.on('error', error => {
    while (pending.length) pending.shift().reject(error);
  });

  function flush() {
    while (pending.length) {
      const lines = buffer.split(/\r?\n/);
      const completeIndex = lines.findIndex(line => /^\d{3} /.test(line));
      if (completeIndex === -1) return;
      const responseLines = lines.slice(0, completeIndex + 1);
      buffer = lines.slice(completeIndex + 1).join('\n');
      const last = responseLines[responseLines.length - 1];
      pending.shift().resolve({
        code: Number(last.slice(0, 3)),
        text: responseLines.join('\n'),
      });
    }
  }

  return {
    readResponse() {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        flush();
      });
    },
  };
}

function writeSmtp(socket, line) {
  socket.write(`${line}\r\n`);
}

function dotEscape(message) {
  return message.replace(/^\./gm, '..');
}

function validateEmailHeader(value, name) {
  const text = String(value || '');
  if (/[\r\n]/.test(text)) {
    throw new Error(`Invalid email header ${name}: CRLF is not allowed`);
  }
  return text;
}

function buildMimeMessage(config, subject, textBody, htmlBody) {
  const from = validateEmailHeader(config.from, 'from');
  const to = validateEmailHeader(config.to, 'to');
  const safeSubject = validateEmailHeader(subject, 'subject');
  const boundary = `ecc-pr-triage-${Date.now().toString(36)}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function sendSmtpMail(config, subject, textBody, htmlBody) {
  let socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('SMTP connection timed out')));
  let reader = createSmtpReader(socket);

  await waitForResponse(reader, [220]);
  writeSmtp(socket, `EHLO ${os.hostname() || 'localhost'}`);
  await waitForResponse(reader, [250]);

  if (!config.secure && config.startTls) {
    writeSmtp(socket, 'STARTTLS');
    await waitForResponse(reader, [220]);
    socket = tls.connect({ socket, servername: config.host });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('SMTP connection timed out')));
    reader = createSmtpReader(socket);
    writeSmtp(socket, `EHLO ${os.hostname() || 'localhost'}`);
    await waitForResponse(reader, [250]);
  }

  writeSmtp(socket, 'AUTH LOGIN');
  await waitForResponse(reader, [334]);
  writeSmtp(socket, Buffer.from(config.user).toString('base64'));
  await waitForResponse(reader, [334]);
  writeSmtp(socket, Buffer.from(config.pass).toString('base64'));
  await waitForResponse(reader, [235]);

  writeSmtp(socket, `MAIL FROM:<${config.from}>`);
  await waitForResponse(reader, [250]);
  for (const recipient of config.to.split(',').map(value => value.trim()).filter(Boolean)) {
    writeSmtp(socket, `RCPT TO:<${recipient}>`);
    await waitForResponse(reader, [250, 251]);
  }
  writeSmtp(socket, 'DATA');
  await waitForResponse(reader, [354]);
  socket.write(`${dotEscape(buildMimeMessage(config, subject, textBody, htmlBody))}\r\n.\r\n`);
  await waitForResponse(reader, [250]);
  writeSmtp(socket, 'QUIT');
  await waitForResponse(reader, [221]);
  socket.end();
}

async function maybeSendEmail(report, markdown, options) {
  if (!options.sendEmail || !report.hasNewPrs) {
    return { sent: false, skipped: !report.hasNewPrs ? 'no-new-prs' : 'email-disabled' };
  }

  const config = getEmailConfig();
  if (!isEmailConfigured(config)) {
    const message = 'SMTP email is not configured. Set PR_TRIAGE_SMTP_HOST, PR_TRIAGE_SMTP_USER, PR_TRIAGE_SMTP_PASS, and optional PR_TRIAGE_SMTP_PORT/PR_TRIAGE_SMTP_FROM.';
    if (options.requireEmail) {
      throw new Error(message);
    }
    console.warn(`WARN: ${message}`);
    return { sent: false, skipped: 'smtp-not-configured' };
  }

  const subject = `ECC PR triage: ${report.totals.newPrs} new PR${report.totals.newPrs === 1 ? '' : 's'}`;
  await sendSmtpMail(config, subject, markdown, renderHtml(report));
  return { sent: true, skipped: '' };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }

  const report = buildReport(options);
  const markdown = renderMarkdown(report);

  if (options.writePath && report.hasNewPrs) {
    writeFile(options.writePath, markdown);
  }
  if (options.jsonPath && report.hasNewPrs) {
    writeFile(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  let emailResult = { sent: false, skipped: 'not-attempted' };
  let emailError = null;
  try {
    emailResult = await maybeSendEmail(report, markdown, options);
  } catch (error) {
    emailError = error;
    emailResult = { sent: false, skipped: 'email-error' };
  }

  writeGithubOutput({
    has_report: report.hasNewPrs ? 'true' : 'false',
    email_sent: emailResult.sent ? 'true' : 'false',
    email_error: emailError ? 'true' : 'false',
    report_path: options.writePath || '',
  });

  if (report.hasNewPrs) {
    process.stdout.write(markdown);
  } else {
    console.log(`No new open PRs for ${report.repo} since ${report.since}; skipping report email.`);
  }

  if (emailError) {
    throw emailError;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildMimeMessage,
  buildReport,
  classifyPr,
  computeFallbackSince,
  getEmailConfig,
  parseArgs,
  renderMarkdown,
  riskFindingsForText,
  sanitizeFindingMatch,
};
