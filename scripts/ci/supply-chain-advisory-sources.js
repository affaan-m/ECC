#!/usr/bin/env node
/**
 * Build a refreshable source report for active supply-chain advisories.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const DEFAULT_GENERATED_AT = () => new Date().toISOString();
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

const DEFAULT_ADVISORY_SOURCES = [
  {
    id: 'tanstack-postmortem',
    title: 'TanStack npm supply-chain compromise postmortem',
    publisher: 'TanStack',
    url: 'https://tanstack.com/blog/npm-supply-chain-compromise-postmortem',
    sourceType: 'primary-incident-postmortem',
    ecosystems: ['npm', 'GitHub Actions'],
    signals: ['tanstack', 'trusted-publishing-limits', 'github-actions-cache-poisoning'],
  },
  {
    id: 'github-ghsa-g7cv-rxg3-hmpx',
    title: 'GitHub Advisory GHSA-g7cv-rxg3-hmpx / CVE-2026-45321',
    publisher: 'GitHub Advisory Database',
    url: 'https://github.com/advisories/GHSA-g7cv-rxg3-hmpx',
    sourceType: 'security-advisory',
    ecosystems: ['npm', 'AI developer tooling'],
    signals: ['credential-theft', 'malicious-lifecycle-script', 'tanstack'],
  },
  {
    id: 'tanstack-followup',
    title: 'TanStack incident follow-up',
    publisher: 'TanStack',
    url: 'https://tanstack.com/blog/incident-followup',
    sourceType: 'primary-incident-followup',
    ecosystems: ['npm', 'GitHub Actions'],
    signals: ['remediation', 'trusted-publishing-limits'],
  },
  {
    id: 'stepsecurity-mini-shai-hulud',
    title: 'Mini Shai-Hulud campaign analysis',
    publisher: 'StepSecurity',
    url: 'https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem',
    sourceType: 'incident-analysis',
    ecosystems: ['npm', 'PyPI', 'AI developer tooling'],
    signals: ['mini-shai-hulud', 'claude-code-persistence', 'vscode-persistence', 'os-persistence'],
  },
  {
    id: 'openai-tanstack-response',
    title: 'OpenAI response to the TanStack npm supply-chain attack',
    publisher: 'OpenAI',
    url: 'https://openai.com/index/our-response-to-the-tanstack-npm-supply-chain-attack/',
    sourceType: 'vendor-response',
    ecosystems: ['npm', 'AI developer tooling'],
    signals: ['codex-update', 'developer-tooling-exposure', 'remediation'],
  },
  {
    id: 'wiz-mini-shai-hulud',
    title: 'Mini Shai-Hulud broader npm campaign coverage',
    publisher: 'Wiz',
    url: 'https://www.wiz.io/blog/mini-shai-hulud-strikes-again-tanstack-more-npm-packages-compromised',
    sourceType: 'incident-analysis',
    ecosystems: ['npm', 'PyPI', 'AI developer tooling'],
    signals: ['mini-shai-hulud', 'opensearch', 'mistral-ai', 'uipath', 'squawk'],
  },
  {
    id: 'socket-node-ipc',
    title: 'node-ipc package compromise',
    publisher: 'Socket',
    url: 'https://socket.dev/blog/node-ipc-package-compromised',
    sourceType: 'incident-analysis',
    ecosystems: ['npm'],
    signals: ['node-ipc', 'payload-hash', 'destructive-package-behavior'],
  },
  {
    id: 'npm-trusted-publishers',
    title: 'npm trusted publishing documentation',
    publisher: 'npm',
    url: 'https://docs.npmjs.com/trusted-publishers/',
    sourceType: 'registry-control-reference',
    ecosystems: ['npm', 'GitHub Actions'],
    signals: ['trusted-publishing-limits', 'provenance'],
  },
  {
    id: 'cisa-npm-compromise',
    title: 'CISA widespread supply-chain compromise impacting npm ecosystem',
    publisher: 'CISA',
    url: 'https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem',
    sourceType: 'government-alert',
    ecosystems: ['npm'],
    signals: ['incident-response', 'credential-rotation', 'npm-compromise'],
  },
];

function normalizeArray(values) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function createCheck(id, status, summary, fix) {
  return { id, status, summary, fix };
}

function uniqueValues(sources, field) {
  return new Set(sources.flatMap(source => normalizeArray(source[field])));
}

function validateSources(sources) {
  const checks = [];
  const ids = new Set();
  const duplicateIds = [];
  const invalidSources = [];

  for (const source of sources) {
    if (ids.has(source.id)) duplicateIds.push(source.id);
    ids.add(source.id);
    if (!source.id || !source.title || !source.publisher || !source.url) {
      invalidSources.push(source.id || '(missing id)');
    }
  }

  checks.push(createCheck(
    'advisory-source-count',
    sources.length >= 8 ? 'pass' : 'fail',
    `${sources.length} advisory sources registered`,
    'Track at least eight sources spanning primary advisories, vendor responses, and registry controls.',
  ));

  checks.push(createCheck(
    'advisory-source-shape',
    invalidSources.length === 0 && duplicateIds.length === 0 ? 'pass' : 'fail',
    invalidSources.length === 0 && duplicateIds.length === 0
      ? 'all sources include id, title, publisher, and URL'
      : `invalid sources: ${[...invalidSources, ...duplicateIds].join(', ')}`,
    'Fix duplicate or incomplete advisory source records before relying on the watch artifact.',
  ));

  const ecosystems = uniqueValues(sources, 'ecosystems');
  const requiredEcosystems = ['npm', 'PyPI', 'AI developer tooling'];
  const missingEcosystems = requiredEcosystems.filter(ecosystem => !ecosystems.has(ecosystem));
  checks.push(createCheck(
    'advisory-ecosystem-coverage',
    missingEcosystems.length === 0 ? 'pass' : 'fail',
    missingEcosystems.length === 0
      ? 'sources cover npm, PyPI, and AI developer tooling'
      : `missing ecosystem coverage: ${missingEcosystems.join(', ')}`,
    'Add sources for every active ecosystem touched by the campaign.',
  ));

  const signals = uniqueValues(sources, 'signals');
  const requiredSignals = [
    'tanstack',
    'mini-shai-hulud',
    'claude-code-persistence',
    'vscode-persistence',
    'os-persistence',
    'node-ipc',
    'trusted-publishing-limits',
    'remediation',
  ];
  const missingSignals = requiredSignals.filter(signal => !signals.has(signal));
  checks.push(createCheck(
    'advisory-signal-coverage',
    missingSignals.length === 0 ? 'pass' : 'fail',
    missingSignals.length === 0
      ? 'sources cover package versions, persistence hooks, provenance limits, and remediation'
      : `missing signal coverage: ${missingSignals.join(', ')}`,
    'Update the source registry before adding or removing scanner indicators.',
  ));

  return checks;
}

function refreshStatusFromResult(result) {
  if (result && result.ok) {
    return {
      status: 'ok',
      statusCode: result.statusCode || null,
      finalUrl: result.finalUrl || null,
      checkedAt: result.checkedAt || null,
    };
  }

  return {
    status: 'warning',
    statusCode: result && result.statusCode ? result.statusCode : null,
    finalUrl: result && result.finalUrl ? result.finalUrl : null,
    checkedAt: result && result.checkedAt ? result.checkedAt : null,
    error: result && result.error ? String(result.error) : 'source refresh failed',
  };
}

async function defaultFetchSource(source, options = {}) {
  const checkedAt = options.checkedAt || DEFAULT_GENERATED_AT();
  try {
    const result = await requestUrl(source.url, {
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      redirectsRemaining: MAX_REDIRECTS,
      method: 'HEAD',
    });

    if (result.statusCode === 405 || result.statusCode === 403) {
      return requestUrl(source.url, {
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        redirectsRemaining: MAX_REDIRECTS,
        method: 'GET',
        checkedAt,
      });
    }

    return { ...result, checkedAt };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      finalUrl: source.url,
      checkedAt,
      error: error.message,
    };
  }
}

function requestUrl(url, options) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method: options.method || 'HEAD',
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      headers: {
        'User-Agent': 'ecc-supply-chain-watch/2.0',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    }, response => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (
        statusCode >= 300
        && statusCode < 400
        && location
        && options.redirectsRemaining > 0
      ) {
        response.resume();
        const nextUrl = new URL(location, parsed).toString();
        resolve(requestUrl(nextUrl, {
          ...options,
          redirectsRemaining: options.redirectsRemaining - 1,
        }));
        return;
      }

      response.resume();
      response.on('end', () => {
        resolve({
          ok: statusCode >= 200 && statusCode < 400,
          statusCode,
          finalUrl: url,
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`timed out after ${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms`));
    });

    request.on('error', error => {
      resolve({
        ok: false,
        statusCode: null,
        finalUrl: url,
        error: error.message,
      });
    });

    request.end();
  });
}

function buildLinearStatus(report, sources) {
  const primaryEvidence = sources
    .filter(source => [
      'primary-incident-postmortem',
      'security-advisory',
      'vendor-response',
      'incident-analysis',
    ].includes(source.sourceType))
    .slice(0, 5)
    .map(source => `${source.publisher}: ${source.title}`);

  return {
    issueId: 'ITO-57',
    status: 'in_progress',
    summary: report.ready
      ? 'Advisory sources current; scheduled supply-chain watch now emits source refresh evidence.'
      : 'Advisory source coverage needs repair before release readiness.',
    evidence: primaryEvidence,
    remaining: 'Linear status synchronization still needs a live connector/status-update pass after each significant merge batch.',
  };
}

async function buildAdvisorySourceReport(options = {}) {
  const generatedAt = options.generatedAt || DEFAULT_GENERATED_AT();
  const sources = (options.sources || DEFAULT_ADVISORY_SOURCES).map(source => ({
    ...source,
    ecosystems: normalizeArray(source.ecosystems),
    signals: normalizeArray(source.signals),
  }));
  const checks = validateSources(sources);
  const refreshEnabled = Boolean(options.refresh);
  const fetchSource = options.fetchSource || defaultFetchSource;
  let refreshWarnings = 0;

  const reportSources = [];
  for (const source of sources) {
    let refreshStatus = { status: 'not_requested' };
    if (refreshEnabled && source.refresh !== false) {
      const result = await fetchSource(source, {
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        checkedAt: generatedAt,
      });
      refreshStatus = refreshStatusFromResult(result);
      if (refreshStatus.status !== 'ok') refreshWarnings += 1;
    }
    reportSources.push({ ...source, refreshStatus });
  }

  if (refreshEnabled) {
    checks.push(createCheck(
      'advisory-refresh',
      refreshWarnings === 0 ? 'pass' : 'warn',
      refreshWarnings === 0
        ? 'all advisory source URLs responded during refresh'
        : `${refreshWarnings} advisory source URL(s) returned warnings during refresh`,
      'Review warning sources manually before changing IOC coverage or release evidence.',
    ));
  } else {
    checks.push(createCheck(
      'advisory-refresh',
      'pass',
      'live advisory refresh not requested for this offline source contract report',
      'Run with --refresh in the scheduled watch to capture live URL status evidence.',
    ));
  }

  const ready = checks.every(check => check.status !== 'fail');
  const report = {
    schema_version: 'ecc.supply-chain-advisory-sources.v1',
    generatedAt,
    ready,
    refresh: {
      enabled: refreshEnabled,
      ok: refreshEnabled ? refreshWarnings === 0 : null,
      warningCount: refreshWarnings,
    },
    sources: reportSources,
    checks,
  };

  report.linear = {
    status: buildLinearStatus(report, reportSources),
  };

  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--refresh') {
      options.refresh = true;
    } else if (arg === '--strict-refresh') {
      options.strictRefresh = true;
      options.refresh = true;
    } else if (arg === '--generated-at') {
      options.generatedAt = argv[++i];
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i]);
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive number');
      }
    } else if (arg === '--write') {
      options.writePath = argv[++i];
      if (!options.writePath) throw new Error('--write requires a path');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/ci/supply-chain-advisory-sources.js [options]

Build the active supply-chain advisory source report used by the scheduled
watch workflow and Linear ITO-57 status updates.

Options:
  --json              Emit JSON instead of text
  --refresh           Check source URLs and record warning status
  --strict-refresh    Fail when a refreshed source URL returns a warning
  --generated-at <ts> Override the report timestamp
  --timeout-ms <n>    Per-source refresh timeout (default: ${DEFAULT_TIMEOUT_MS})
  --write <path>      Write the report to a file
  --help, -h          Show this help
`);
}

function renderText(report) {
  const lines = [
    `Supply-chain advisory sources: ${report.ready ? 'ready' : 'blocked'}`,
    `Sources: ${report.sources.length}`,
    `Refresh: ${report.refresh.enabled ? (report.refresh.ok ? 'ok' : `warnings=${report.refresh.warningCount}`) : 'not requested'}`,
    `Linear ${report.linear.status.issueId}: ${report.linear.status.summary}`,
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }

  return `${lines.join('\n')}\n`;
}

function writeReport(report, writePath) {
  const absolutePath = path.resolve(writePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseArgs(process.argv.slice(2));
      if (options.help) {
        printHelp();
        process.exit(0);
      }

      const report = await buildAdvisorySourceReport(options);
      if (options.writePath) writeReport(report, options.writePath);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        process.stdout.write(renderText(report));
      }

      const failed = !report.ready || (options.strictRefresh && report.refresh.enabled && !report.refresh.ok);
      process.exit(failed ? 1 : 0);
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
  })();
}

module.exports = {
  DEFAULT_ADVISORY_SOURCES,
  buildAdvisorySourceReport,
  parseArgs,
  renderText,
};
