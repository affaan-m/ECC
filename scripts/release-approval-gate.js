#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'ecc.release-approval-gate.v1';
const SCRIPT_PATH = 'scripts/release-approval-gate.js';
const REQUIRED_COMMAND = 'npm run release:approval-gate -- --format json';

const REQUIRED_DECISIONS = [
  {
    id: 'github-prerelease',
    label: 'GitHub prerelease',
  },
  {
    id: 'npm-next-publish',
    label: 'npm `next` publish',
  },
  {
    id: 'claude-plugin-tag',
    label: 'Claude plugin tag',
  },
  {
    id: 'codex-repo-marketplace',
    label: 'Codex repo marketplace',
  },
  {
    id: 'ecc-tools-billing-language',
    label: 'ECC Tools billing language',
  },
  {
    id: 'video-upload',
    label: 'Video upload',
  },
  {
    id: 'social-and-longform',
    label: 'X, LinkedIn, GitHub Discussion, longform',
  },
  {
    id: 'outbound-growth',
    label: 'Sponsor, partner, consulting, conference, podcast outreach',
  },
];

const REQUIRED_URL_SURFACES = [
  {
    id: 'github-prerelease-url',
    label: 'GitHub prerelease URL',
    exampleUrl: 'https://github.com/affaan-m/ECC/releases/tag/v2.0.0-rc.1',
  },
  {
    id: 'npm-rc-package-url',
    label: 'npm rc package URL',
    exampleUrl: 'https://www.npmjs.com/package/ecc-universal/v/2.0.0-rc.1',
  },
  {
    id: 'claude-plugin-tag-url',
    label: 'Claude plugin tag URL',
    exampleUrl: 'https://github.com/affaan-m/ECC/releases/tag/ecc--v2.0.0-rc.1',
  },
  {
    id: 'codex-repo-marketplace-evidence',
    label: 'Codex repo-marketplace evidence',
    exampleUrl: 'https://github.com/affaan-m/ECC/tree/v2.0.0-rc.1/.codex-plugin',
  },
  {
    id: 'primary-launch-video-url',
    label: 'Primary launch video URL',
    exampleUrl: 'https://x.com/affaanmustafa/status/0000000000000000000',
  },
  {
    id: 'short-clip-urls',
    label: 'Short clip URLs',
    exampleUrl: 'https://x.com/affaanmustafa/status/0000000000000000001',
  },
  {
    id: 'ecc-tools-billing-readiness-url',
    label: 'ECC Tools billing/readiness URL',
    exampleUrl: 'https://github.com/ECC-Tools',
  },
];

const ANNOUNCEMENT_FILE_NAMES = [
  'release-notes.md',
  'x-thread.md',
  'linkedin-post.md',
  'article-outline.md',
  'partner-sponsor-talks-pack.md',
];

function usage() {
  console.log([
    'Usage: node scripts/release-approval-gate.js [--format <text|json>] [--root <dir>]',
    '',
    'Final approval gate for the release version declared by package.json.',
    '',
    'Options:',
    '  --format <text|json>  Output format (default: text)',
    '  --json                Alias for --format json',
    '  --root <dir>          Repository root to inspect (default: cwd)',
    '  --help, -h            Show this help',
  ].join('\n'));
}

function readArgValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    format: 'text',
    help: false,
    root: path.resolve(process.cwd()),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--json') {
      parsed.format = 'json';
      continue;
    }

    if (arg === '--format') {
      parsed.format = readArgValue(args, index, arg).toLowerCase();
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length).toLowerCase();
      continue;
    }

    if (arg === '--root') {
      parsed.root = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text or json.`);
  }

  return parsed;
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
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function resolveRelease(packageJson, options = {}) {
  if (typeof options.release === 'string' && options.release.trim()) {
    return options.release.trim();
  }

  return typeof packageJson.version === 'string' ? packageJson.version.trim() : '';
}

function releaseDirFor(release) {
  return `docs/releases/${release}`;
}

function releasePathsFor(release) {
  const releaseDir = releaseDirFor(release);

  return {
    ownerPacketPath: `${releaseDir}/owner-approval-packet-2026-05-19.md`,
    urlLedgerPath: `${releaseDir}/release-url-ledger-2026-05-19.md`,
    previewManifestPath: `${releaseDir}/preview-pack-manifest.md`,
    announcementFiles: [
      ...ANNOUNCEMENT_FILE_NAMES.map(fileName => `${releaseDir}/${fileName}`),
      'docs/business/social-launch-copy.md',
    ],
  };
}

function normalizeLabel(value) {
  return String(value)
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeState(value) {
  return String(value)
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitMarkdownRow(row) {
  const trimmed = row.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim());
}

function parseDecisionRegister(packet) {
  const decisions = new Map();

  for (const line of packet.split('\n')) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 4) {
      continue;
    }

    const [decision, state] = cells;
    const normalizedDecision = normalizeLabel(decision);
    if (
      !normalizedDecision
      || normalizedDecision === 'decision'
      || /^-+$/.test(normalizedDecision)
    ) {
      continue;
    }

    decisions.set(normalizedDecision, normalizeState(state));
  }

  return decisions;
}

function isApproved(state) {
  return state === 'approve' || state === 'approved';
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function findAnnouncementOffenders(rootDir, relativePaths) {
  const offenders = [];
  const privatePathPattern = /\/Users\/(?!\.\.\.)[A-Za-z0-9._-]+|\/home\/(?!user|runner)[A-Za-z0-9._-]+/g;
  const anglePlaceholderPattern = /<(?!(?:https?:\/\/|mailto:|#))[^>\n]*(?:url|link|todo|tbd|placeholder)[^>\n]*>/gi;
  const barePlaceholderPattern = /\bTODO\b|\bTBD\b|\bPLACEHOLDER\b/g;

  for (const relativePath of relativePaths) {
    const text = readText(rootDir, relativePath);
    if (!text) {
      offenders.push({
        path: relativePath,
        line: 1,
        marker: 'missing file',
      });
      continue;
    }

    for (const match of text.matchAll(privatePathPattern)) {
      offenders.push({
        path: relativePath,
        line: lineNumberForIndex(text, match.index),
        marker: match[0],
      });
    }

    for (const match of text.matchAll(anglePlaceholderPattern)) {
      offenders.push({
        path: relativePath,
        line: lineNumberForIndex(text, match.index),
        marker: match[0],
      });
    }

    for (const match of text.matchAll(barePlaceholderPattern)) {
      offenders.push({
        path: relativePath,
        line: lineNumberForIndex(text, match.index),
        marker: match[0],
      });
    }
  }

  return offenders;
}

function ledgerBlockers(ledger) {
  const blockers = [];

  if (/^##\s+Approval-Gated URLs\s*$/im.test(ledger)) {
    blockers.push('approval-gated URL section still present');
  }

  for (const [pattern, label] of [
    [/not published yet/i, 'not-published marker still present'],
    [/must return/i, 'must-return readback marker still present'],
    [/Gate before use/i, 'gate-before-use column still present'],
    [/\bpending\b/i, 'pending marker still present'],
    [/\bblocked\b/i, 'blocked marker still present'],
  ]) {
    if (pattern.test(ledger)) {
      blockers.push(label);
    }
  }

  return blockers;
}

function makeCheck(id, status, evidence, fix) {
  return {
    id,
    status,
    evidence,
    fix: status === 'pass' ? '' : fix,
  };
}

function topActionsForChecks(checks) {
  const actions = [];
  const failedIds = new Set(checks.filter(check => check.status !== 'pass').map(check => check.id));

  if (failedIds.has('release-approval-script-registered')) {
    actions.push('Wire release:approval-gate into package.json, package files, and the preview-pack manifest.');
  }

  if (failedIds.has('owner-decisions-approved')) {
    actions.push('Approve, defer, or block each owner decision row explicitly after final evidence is rerun from the release commit.');
  }

  if (failedIds.has('release-url-ledger-finalized')) {
    actions.push('Replace approval-gated URL ledger rows with live readback URLs from the approved release, package, plugin, video, and billing surfaces.');
  }

  if (failedIds.has('final-evidence-command-listed')) {
    actions.push('Add release:approval-gate to the final evidence command lists before asking for publication approval.');
  }

  if (failedIds.has('announcement-copy-finalized')) {
    actions.push('Remove unresolved placeholders and private local paths from launch, social, and outbound copy.');
  }

  if (failedIds.has('public-action-guard-present')) {
    actions.push('Restore the explicit no-outbound/no-publish authorization boundary in the owner packet.');
  }

  return actions;
}

function buildReport(options = {}) {
  const rootDir = path.resolve(options.root || process.cwd());
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const release = resolveRelease(packageJson, options);
  const releasePaths = releasePathsFor(release);
  const packageScripts = packageJson.scripts || {};
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const ownerPacket = readText(rootDir, releasePaths.ownerPacketPath);
  const ledger = readText(rootDir, releasePaths.urlLedgerPath);
  const manifest = readText(rootDir, releasePaths.previewManifestPath);
  const decisions = parseDecisionRegister(ownerPacket);

  const missingDecisions = [];
  const unapprovedDecisions = [];
  for (const decision of REQUIRED_DECISIONS) {
    const state = decisions.get(normalizeLabel(decision.label));
    if (!state) {
      missingDecisions.push(decision.label);
    } else if (!isApproved(state)) {
      unapprovedDecisions.push(`${decision.label}=${state}`);
    }
  }

  const missingUrlSurfaces = REQUIRED_URL_SURFACES
    .filter(surface => !ledger.includes(surface.label))
    .map(surface => surface.label);
  const urlBlockers = ledgerBlockers(ledger);
  const announcementOffenders = findAnnouncementOffenders(rootDir, releasePaths.announcementFiles);
  const commandListedIn = [
    ownerPacket.includes(REQUIRED_COMMAND) ? releasePaths.ownerPacketPath : '',
    ledger.includes(REQUIRED_COMMAND) ? releasePaths.urlLedgerPath : '',
    manifest.includes(REQUIRED_COMMAND) ? releasePaths.previewManifestPath : '',
  ].filter(Boolean);

  const checks = [
    makeCheck(
      'release-approval-script-registered',
      packageScripts['release:approval-gate'] === `node ${SCRIPT_PATH}`
        && packageFiles.includes(SCRIPT_PATH)
        && fileExists(rootDir, SCRIPT_PATH)
        && manifest.includes(`\`${SCRIPT_PATH}\``)
        && manifest.includes(REQUIRED_COMMAND)
        ? 'pass'
        : 'fail',
      'package script, npm package file entry, local script, and preview-pack manifest reference',
      'Add release:approval-gate to package scripts, package files, and preview-pack-manifest.md.'
    ),
    makeCheck(
      'owner-decisions-approved',
      missingDecisions.length === 0 && unapprovedDecisions.length === 0 ? 'pass' : 'fail',
      missingDecisions.length === 0 && unapprovedDecisions.length === 0
        ? `${REQUIRED_DECISIONS.length} owner decision rows are approved`
        : `missing decisions: ${missingDecisions.join(', ') || 'none'}; pending decisions: ${unapprovedDecisions.join(', ') || 'none'}`,
      'Set every required owner decision row to approve only after the final release evidence has been rerun.'
    ),
    makeCheck(
      'release-url-ledger-finalized',
      ledger
        && missingUrlSurfaces.length === 0
        && urlBlockers.length === 0
        ? 'pass'
        : 'fail',
      ledger && missingUrlSurfaces.length === 0 && urlBlockers.length === 0
        ? `${REQUIRED_URL_SURFACES.length} final URL surfaces are recorded without approval-gated blockers`
        : `missing URL surfaces: ${missingUrlSurfaces.join(', ') || 'none'}; blockers: ${urlBlockers.join(', ') || 'none'}`,
      'Regenerate the release URL ledger after the approved publication actions and record live readback URLs.'
    ),
    makeCheck(
      'final-evidence-command-listed',
      commandListedIn.length === 3 ? 'pass' : 'fail',
      commandListedIn.length === 3
        ? `${REQUIRED_COMMAND} is listed in owner packet, URL ledger, and preview manifest`
        : `${REQUIRED_COMMAND} listed in: ${commandListedIn.join(', ') || 'none'}`,
      'List release:approval-gate in every final evidence command block.'
    ),
    makeCheck(
      'announcement-copy-finalized',
      announcementOffenders.length === 0 ? 'pass' : 'fail',
      announcementOffenders.length === 0
        ? `${releasePaths.announcementFiles.length} launch/outbound copy files have no placeholders or private paths`
        : `offenders: ${announcementOffenders.map(item => `${item.path}:${item.line}`).join(', ')}`,
      'Replace placeholders with live URLs and remove private local paths from launch/outbound copy.'
    ),
    makeCheck(
      'public-action-guard-present',
      ownerPacket.includes(
        'No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.'
      )
        ? 'pass'
        : 'fail',
      'owner packet preserves the explicit no-public-action authorization boundary',
      'Restore the owner-packet sentence that blocks outbound, posts, package publish, plugin tags, and billing announcements.'
    ),
  ];

  const failed = checks.filter(check => check.status !== 'pass');
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(checks.map(check => [check.id, check.status, check.evidence])))
    .digest('hex')
    .slice(0, 12);

  return {
    schema_version: SCHEMA_VERSION,
    release,
    ready: failed.length === 0,
    digest,
    summary: {
      passed: checks.length - failed.length,
      failed: failed.length,
      total: checks.length,
    },
    top_actions: topActionsForChecks(checks),
    checks,
  };
}

function renderText(report) {
  const lines = [
    'ECC release approval gate',
    `Release: ${report.release}`,
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    `Digest: ${report.digest}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status} ${check.id}: ${check.evidence}`);
    if (check.fix) {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  if (report.top_actions.length > 0) {
    lines.push('');
    lines.push('Top actions:');
    for (const action of report.top_actions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push('');
  lines.push(`Passed: ${report.summary.passed}`);
  lines.push(`Failed: ${report.summary.failed}`);

  return `${lines.join('\n')}\n`;
}

function main() {
  let parsed;

  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (parsed.help) {
    usage();
    return;
  }

  const report = buildReport({ root: parsed.root });

  if (parsed.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderText(report));
  }

  if (!report.ready) {
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ANNOUNCEMENT_FILE_NAMES,
  REQUIRED_COMMAND,
  REQUIRED_DECISIONS,
  REQUIRED_URL_SURFACES,
  buildReport,
  releasePathsFor,
  parseArgs,
  renderText,
};
