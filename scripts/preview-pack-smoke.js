#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RELEASE = '2.0.0-rc.1';
const RELEASE_DIR = `docs/releases/${RELEASE}`;
const SCHEMA_VERSION = 'ecc.preview-pack-smoke.v1';

const REQUIRED_ARTIFACTS = [
  'README.md',
  'docs/HERMES-SETUP.md',
  'skills/hermes-imports/SKILL.md',
  'docs/architecture/cross-harness.md',
  'docs/architecture/harness-adapter-compliance.md',
  'docs/architecture/observability-readiness.md',
  'docs/architecture/progress-sync-contract.md',
  'scripts/preview-pack-smoke.js',
  `${RELEASE_DIR}/release-notes.md`,
  `${RELEASE_DIR}/quickstart.md`,
  `${RELEASE_DIR}/launch-checklist.md`,
  `${RELEASE_DIR}/publication-readiness.md`,
  `${RELEASE_DIR}/publication-evidence-2026-05-15.md`,
  `${RELEASE_DIR}/publication-evidence-2026-05-16.md`,
  `${RELEASE_DIR}/publication-evidence-2026-05-17.md`,
  `${RELEASE_DIR}/publication-evidence-2026-05-18.md`,
  `${RELEASE_DIR}/publication-evidence-2026-05-19.md`,
  `${RELEASE_DIR}/operator-readiness-dashboard-2026-05-17.md`,
  `${RELEASE_DIR}/operator-readiness-dashboard-2026-05-18.md`,
  `${RELEASE_DIR}/operator-readiness-dashboard-2026-05-19.md`,
  `${RELEASE_DIR}/owner-approval-packet-2026-05-19.md`,
  `${RELEASE_DIR}/release-url-ledger-2026-05-19.md`,
  `${RELEASE_DIR}/video-suite-production.md`,
  `${RELEASE_DIR}/partner-sponsor-talks-pack.md`,
  `${RELEASE_DIR}/naming-and-publication-matrix.md`,
  `${RELEASE_DIR}/release-name-plugin-publication-checklist-2026-05-18.md`,
  `${RELEASE_DIR}/x-thread.md`,
  `${RELEASE_DIR}/linkedin-post.md`,
  `${RELEASE_DIR}/article-outline.md`,
  `${RELEASE_DIR}/telegram-handoff.md`,
  `${RELEASE_DIR}/demo-prompts.md`,
];

const REQUIRED_VERIFICATION_COMMANDS = [
  'git status --short --branch',
  'node scripts/platform-audit.js --json',
  'npm run preview-pack:smoke',
  'npm run release:video-suite -- --format json',
  'npm run harness:adapters -- --check',
  'npm run harness:audit -- --format json',
  'npm run observability:ready',
  'npm run security:ioc-scan',
  'npm audit --audit-level=moderate',
  'npm audit signatures',
  'node tests/docs/ecc2-release-surface.test.js',
  'node tests/run-all.js',
  'cd ecc2 && cargo test',
];

const REQUIRED_PUBLICATION_BLOCKERS = [
  'GitHub prerelease `v2.0.0-rc.1`',
  'npm `ecc-universal@2.0.0-rc.1`',
  'Claude plugin tag',
  'Codex repo-marketplace distribution evidence',
  'ECC Tools billing/product readiness',
];

const HERMES_BOUNDARY_MARKERS = [
  'Public Release Candidate Scope',
  'ECC v2.0.0-rc.1 documents the Hermes surface',
  'Sanitization Checklist',
  'Do not ship raw workspace exports',
  'Output Contract',
];

function usage() {
  console.log([
    'Usage: node scripts/preview-pack-smoke.js [--format <text|json>] [--root <dir>]',
    '',
    'Deterministic smoke gate for the ECC 2.0 rc.1 preview pack.',
    '',
    'Options:',
    '  --format <text|json>  Output format (default: text)',
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

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function findForbiddenContent(rootDir, relativePaths) {
  const offenders = [];
  const privatePathPattern = /\/Users\/(?!\.\.\.)[A-Za-z0-9._-]+|\/home\/(?!user|runner)[A-Za-z0-9._-]+/g;

  for (const relativePath of relativePaths) {
    const text = readText(rootDir, relativePath);
    if (!text) {
      continue;
    }

    for (const match of text.matchAll(privatePathPattern)) {
      offenders.push({
        path: relativePath,
        line: lineNumberForIndex(text, match.index),
        marker: match[0],
      });
    }
  }

  return offenders;
}

function makeCheck(id, status, evidence, fix) {
  return {
    id,
    status,
    evidence,
    fix: status === 'pass' ? '' : fix,
  };
}

function buildReport(options = {}) {
  const rootDir = path.resolve(options.root || process.cwd());
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const packageScripts = packageJson.scripts || {};
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const manifestPath = `${RELEASE_DIR}/preview-pack-manifest.md`;
  const manifest = readText(rootDir, manifestPath);
  const hermesSetup = readText(rootDir, 'docs/HERMES-SETUP.md');
  const hermesSkill = readText(rootDir, 'skills/hermes-imports/SKILL.md');

  const missingArtifacts = REQUIRED_ARTIFACTS.filter(relativePath => !fileExists(rootDir, relativePath));
  const unlistedArtifacts = REQUIRED_ARTIFACTS.filter(relativePath => !manifest.includes(`\`${relativePath}\``));
  const missingCommands = REQUIRED_VERIFICATION_COMMANDS.filter(command => !manifest.includes(command));
  const missingBlockers = REQUIRED_PUBLICATION_BLOCKERS.filter(blocker => !manifest.includes(blocker));
  const missingHermesMarkers = HERMES_BOUNDARY_MARKERS.filter(marker => !`${hermesSetup}\n${hermesSkill}`.includes(marker));
  const forbiddenContent = findForbiddenContent(rootDir, [
    ...REQUIRED_ARTIFACTS,
    manifestPath,
    'docs/business/social-launch-copy.md',
  ]);

  const checks = [
    makeCheck(
      'preview-pack-script-registered',
      packageScripts['preview-pack:smoke'] === 'node scripts/preview-pack-smoke.js'
        && packageFiles.includes('scripts/preview-pack-smoke.js')
        && fileExists(rootDir, 'scripts/preview-pack-smoke.js')
        ? 'pass'
        : 'fail',
      'package script and npm package file entry for preview-pack smoke gate',
      'Add preview-pack:smoke to package scripts and include scripts/preview-pack-smoke.js in package files.'
    ),
    makeCheck(
      'preview-pack-artifacts-present',
      missingArtifacts.length === 0 && unlistedArtifacts.length === 0 ? 'pass' : 'fail',
      missingArtifacts.length === 0 && unlistedArtifacts.length === 0
        ? `${REQUIRED_ARTIFACTS.length} required artifacts exist and are listed in the manifest`
        : `missing artifacts: ${missingArtifacts.join(', ') || 'none'}; unlisted artifacts: ${unlistedArtifacts.join(', ') || 'none'}`,
      'Restore missing preview-pack artifacts and list every required artifact in preview-pack-manifest.md.'
    ),
    makeCheck(
      'final-verification-commands-listed',
      missingCommands.length === 0 ? 'pass' : 'fail',
      missingCommands.length === 0
        ? `${REQUIRED_VERIFICATION_COMMANDS.length} final verification commands are listed`
        : `missing commands: ${missingCommands.join('; ')}`,
      'Add the missing final verification commands to preview-pack-manifest.md.'
    ),
    makeCheck(
      'hermes-boundary-sanitized',
      missingHermesMarkers.length === 0 && forbiddenContent.length === 0 ? 'pass' : 'fail',
      missingHermesMarkers.length === 0 && forbiddenContent.length === 0
        ? 'Hermes setup and import skill preserve the public sanitization boundary'
        : `missing markers: ${missingHermesMarkers.join(', ') || 'none'}; forbidden content: ${forbiddenContent.map(item => `${item.path}:${item.line}`).join(', ') || 'none'}`,
      'Restore Hermes sanitization language and remove private local paths from preview-pack docs.'
    ),
    makeCheck(
      'publication-blockers-preserved',
      missingBlockers.length === 0
        && /approval-gated release, package, plugin, and\s+announcement steps/.test(manifest)
        ? 'pass'
        : 'fail',
      missingBlockers.length === 0
        ? 'publication remains explicitly approval-gated'
        : `missing blockers: ${missingBlockers.join(', ')}`,
      'Keep publication blockers explicit until the live release, package, plugin, and billing surfaces exist.'
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
    release: RELEASE,
    ready: failed.length === 0,
    digest,
    summary: {
      passed: checks.length - failed.length,
      failed: failed.length,
      total: checks.length,
    },
    checks,
  };
}

function renderText(report) {
  const lines = [
    'ECC preview pack smoke',
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
  REQUIRED_ARTIFACTS,
  REQUIRED_PUBLICATION_BLOCKERS,
  REQUIRED_VERIFICATION_COMMANDS,
  buildReport,
  parseArgs,
  renderText,
};
