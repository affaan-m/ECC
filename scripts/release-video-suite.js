#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RELEASE = '2.0.0-rc.1';
const SCHEMA_VERSION = 'ecc.release-video-suite.v1';
const VIDEO_MANIFEST_PATH = `docs/releases/${RELEASE}/video-suite-production.md`;
const HYPERGROWTH_DOC_PATH = 'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md';

const REQUIRED_DOC_MARKERS = [
  'ECC 2.0 Video Suite Production Manifest',
  'video-use compatible workflow',
  'ECC_VIDEO_SOURCE_ROOT',
  'ECC_VIDEO_RELEASE_SUITE_ROOT',
  'Primary launch video',
  'Self-Eval Gate',
  'Do Not Publish If',
];

const REQUIRED_SOURCE_ASSETS = [
  {
    id: 'primary-longform-wide',
    file: 'longform-full-wide.mp4',
    lane: 'primary-launch',
    proof: 'operator system, control-plane direction, closing proof',
  },
  {
    id: 'primary-shortform-full',
    file: 'sf-longform-full.mp4',
    lane: 'primary-launch',
    proof: 'structured context opener',
  },
  {
    id: 'what-is-ecc-wide',
    file: 'sf-thread-2-whatisecc.mp4',
    lane: 'what-is-ecc',
    proof: 'category clarity and GitHub App explanation',
  },
  {
    id: 'security-wide',
    file: 'sf-thread-4-security.mp4',
    lane: 'security-proof',
    proof: 'AgentShield, hooks, MCP, permission risk',
  },
  {
    id: 'money-proof-wide',
    file: 'thread-2-ghapp-money.mp4',
    lane: 'money-proof',
    proof: 'OSS plus paid hosting and services',
  },
  {
    id: 'architecture-wide',
    file: 'architecture-2-wide.mp4',
    lane: 'b-roll',
    proof: 'harness-native architecture',
  },
  {
    id: 'terminal-scan-wide',
    file: 'terminal-scan-2-wide.mp4',
    lane: 'install-proof',
    proof: 'terminal workflow and install confidence',
  },
  {
    id: 'site-raw',
    file: 'new_site_raw.mp4',
    lane: 'b-roll',
    proof: 'site and product surface',
  },
  {
    id: 'coverage-montage',
    file: 'coverage-montage-wide.mp4',
    lane: 'coverage-proof',
    proof: 'distribution and social proof',
  },
  {
    id: 'metrics-ticker-wide',
    file: 'metrics-ticker-2-wide.mp4',
    lane: 'money-proof',
    proof: 'traction and funnel proof',
  },
  {
    id: 'growth-timeline-wide',
    file: 'growth-timeline-2-wide.mp4',
    lane: 'coverage-proof',
    proof: 'release momentum timeline',
  },
  {
    id: 'github-app-proof-1',
    file: 'gh_app_1.png',
    lane: 'money-proof',
    proof: 'hosted GitHub App surface',
  },
  {
    id: 'stars',
    file: 'star_history.png',
    lane: 'coverage-proof',
    proof: 'OSS adoption chart',
  },
  {
    id: 'x-analytics',
    file: 'x_analytics.png',
    lane: 'coverage-proof',
    proof: 'social distribution proof',
  },
  {
    id: '100k-proof',
    file: '100k.png',
    lane: 'coverage-proof',
    proof: 'reach milestone proof',
  },
];

const REQUIRED_SUITE_ARTIFACTS = [
  {
    id: 'primary-edl',
    relativePath: 'edl/primary-launch.edl.md',
    kind: 'edl',
  },
  {
    id: 'primary-timeline-v1',
    relativePath: 'timelines/primary-launch-v1.timeline.json',
    kind: 'timeline',
  },
  {
    id: 'primary-captions-v1',
    relativePath: 'renders/ecc-2-primary-launch-rough-v1.captions.srt',
    kind: 'captions',
  },
  {
    id: 'primary-render-v1',
    relativePath: 'renders/ecc-2-primary-launch-rough-v1.mp4',
    kind: 'video',
    minDurationSeconds: 90,
    maxDurationSeconds: 150,
  },
  {
    id: 'segment-structured-context',
    relativePath: 'segments/primary-launch-v1/01-structured-context.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentic-harness-optimization',
    relativePath: 'segments/primary-launch-v1/02-agentic-harness-optimization.mp4',
    kind: 'video',
  },
  {
    id: 'segment-not-another-harness',
    relativePath: 'segments/primary-launch-v1/03-not-another-harness.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentic-ide-surface',
    relativePath: 'segments/primary-launch-v1/04-agentic-ide-surface.mp4',
    kind: 'video',
  },
  {
    id: 'segment-github-app-proof',
    relativePath: 'segments/primary-launch-v1/05-github-app-proof.mp4',
    kind: 'video',
  },
  {
    id: 'segment-security-risk',
    relativePath: 'segments/primary-launch-v1/06-security-risk.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentshield-proof',
    relativePath: 'segments/primary-launch-v1/07-agentshield-proof.mp4',
    kind: 'video',
  },
  {
    id: 'segment-oss-paid-model',
    relativePath: 'segments/primary-launch-v1/08-oss-paid-model.mp4',
    kind: 'video',
  },
  {
    id: 'segment-close-shipping-system',
    relativePath: 'segments/primary-launch-v1/09-close-shipping-system.mp4',
    kind: 'video',
  },
];

function usage() {
  console.log([
    'Usage: node scripts/release-video-suite.js [options]',
    '',
    'Validates the ECC 2.0 release video production lane without committing raw media paths.',
    '',
    'Options:',
    '  --format <text|json>     Output format (default: text)',
    '  --json                   Alias for --format json',
    '  --root <dir>             Repository root to inspect (default: cwd)',
    '  --source-root <dir>      Directory containing ECC 2 source media, with optional _edited subdir',
    '  --suite-root <dir>       Directory containing render/timeline/transcript outputs',
    '  --skip-probe             Skip ffprobe duration reads for fixture or dry-run checks',
    '  --summary                Emit compact JSON when used with --format json',
    '  --help, -h               Show this help',
    '',
    'Environment:',
    '  ECC_VIDEO_SOURCE_ROOT',
    '  ECC_VIDEO_RELEASE_SUITE_ROOT',
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
    sourceRoot: process.env.ECC_VIDEO_SOURCE_ROOT || '',
    suiteRoot: process.env.ECC_VIDEO_RELEASE_SUITE_ROOT || '',
    skipProbe: false,
    summary: false,
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

    if (arg === '--skip-probe') {
      parsed.skipProbe = true;
      continue;
    }

    if (arg === '--summary') {
      parsed.summary = true;
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

    if (arg === '--source-root') {
      parsed.sourceRoot = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--source-root=')) {
      parsed.sourceRoot = path.resolve(arg.slice('--source-root='.length));
      continue;
    }

    if (arg === '--suite-root') {
      parsed.suiteRoot = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--suite-root=')) {
      parsed.suiteRoot = path.resolve(arg.slice('--suite-root='.length));
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

function scanForbiddenPaths(rootDir, relativePaths) {
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

function makeCheck(id, status, summary, fix, details = {}) {
  return {
    id,
    status,
    summary,
    fix: status === 'pass' ? '' : fix,
    ...details,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return null;
  }

  return Number((bytes / 1024 / 1024).toFixed(2));
}

function probeMedia(filePath, skipProbe) {
  const stat = fs.statSync(filePath);
  const result = {
    sizeBytes: stat.size,
    sizeMb: formatBytes(stat.size),
    durationSeconds: null,
    probe: skipProbe ? 'skipped' : 'unavailable',
  };

  if (skipProbe) {
    return result;
  }

  const probe = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });

  if (probe.error) {
    result.probe = `error: ${probe.error.message}`;
    return result;
  }

  if (probe.status !== 0) {
    result.probe = `failed: ${(probe.stderr || '').trim() || `exit ${probe.status}`}`;
    return result;
  }

  const parsed = safeParseJson(probe.stdout);
  const duration = Number(parsed && parsed.format && parsed.format.duration);
  if (Number.isFinite(duration)) {
    result.durationSeconds = Number(duration.toFixed(3));
    result.probe = 'ok';
  }

  return result;
}

function resolveSourceAssetPath(sourceRoot, fileName) {
  const candidates = [
    path.join(sourceRoot, fileName),
    path.join(sourceRoot, '_edited', fileName),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function inspectSourceAssets(sourceRoot, skipProbe) {
  return REQUIRED_SOURCE_ASSETS.map(asset => {
    if (!sourceRoot) {
      return {
        ...asset,
        status: 'missing',
        configured: false,
      };
    }

    const filePath = resolveSourceAssetPath(sourceRoot, asset.file);
    if (!fs.existsSync(filePath)) {
      return {
        ...asset,
        status: 'missing',
        configured: true,
      };
    }

    const media = asset.file.endsWith('.mp4') ? probeMedia(filePath, skipProbe) : {
      sizeBytes: fs.statSync(filePath).size,
      sizeMb: formatBytes(fs.statSync(filePath).size),
      durationSeconds: null,
      probe: 'not-media',
    };

    return {
      ...asset,
      status: 'present',
      configured: true,
      ...media,
    };
  });
}

function inspectSuiteArtifacts(suiteRoot, skipProbe) {
  return REQUIRED_SUITE_ARTIFACTS.map(artifact => {
    if (!suiteRoot) {
      return {
        ...artifact,
        status: 'missing',
        configured: false,
      };
    }

    const filePath = path.join(suiteRoot, artifact.relativePath);
    if (!fs.existsSync(filePath)) {
      return {
        ...artifact,
        status: 'missing',
        configured: true,
      };
    }

    const media = artifact.kind === 'video' ? probeMedia(filePath, skipProbe) : {
      sizeBytes: fs.statSync(filePath).size,
      sizeMb: formatBytes(fs.statSync(filePath).size),
      durationSeconds: null,
      probe: 'not-media',
    };

    let durationStatus = 'pass';
    if (
      artifact.kind === 'video'
      && Number.isFinite(artifact.minDurationSeconds)
      && Number.isFinite(media.durationSeconds)
      && media.durationSeconds < artifact.minDurationSeconds
    ) {
      durationStatus = 'fail';
    }

    if (
      artifact.kind === 'video'
      && Number.isFinite(artifact.maxDurationSeconds)
      && Number.isFinite(media.durationSeconds)
      && media.durationSeconds > artifact.maxDurationSeconds
    ) {
      durationStatus = 'fail';
    }

    if (
      artifact.kind === 'video'
      && Number.isFinite(artifact.minDurationSeconds)
      && !skipProbe
      && media.durationSeconds === null
    ) {
      durationStatus = 'fail';
    }

    return {
      ...artifact,
      status: durationStatus === 'pass' ? 'present' : 'invalid',
      configured: true,
      ...media,
    };
  });
}

function buildReport(options = {}) {
  const rootDir = path.resolve(options.root || process.cwd());
  const sourceRoot = options.sourceRoot ? path.resolve(options.sourceRoot) : '';
  const suiteRoot = options.suiteRoot ? path.resolve(options.suiteRoot) : '';
  const skipProbe = Boolean(options.skipProbe);
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const packageScripts = packageJson.scripts || {};
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const manifest = readText(rootDir, VIDEO_MANIFEST_PATH);
  const hypergrowth = readText(rootDir, HYPERGROWTH_DOC_PATH);

  const missingDocMarkers = REQUIRED_DOC_MARKERS.filter(marker => !manifest.includes(marker));
  const forbiddenPaths = scanForbiddenPaths(rootDir, [
    VIDEO_MANIFEST_PATH,
    HYPERGROWTH_DOC_PATH,
    `docs/releases/${RELEASE}/preview-pack-manifest.md`,
    `docs/releases/${RELEASE}/launch-checklist.md`,
  ]);
  const sourceAssets = inspectSourceAssets(sourceRoot, skipProbe);
  const suiteArtifacts = inspectSuiteArtifacts(suiteRoot, skipProbe);
  const missingSourceAssets = sourceAssets.filter(asset => asset.status !== 'present');
  const missingSuiteArtifacts = suiteArtifacts.filter(artifact => artifact.status !== 'present');

  const checks = [
    makeCheck(
      'video-suite-command-registered',
      packageScripts['release:video-suite'] === 'node scripts/release-video-suite.js'
        && packageFiles.includes('scripts/release-video-suite.js')
        ? 'pass'
        : 'fail',
      'package script and npm package entry for the release video suite validator',
      'Add release:video-suite to package scripts and include scripts/release-video-suite.js in package files.'
    ),
    makeCheck(
      'video-suite-manifest-present',
      manifest && missingDocMarkers.length === 0 ? 'pass' : 'fail',
      manifest && missingDocMarkers.length === 0
        ? `${VIDEO_MANIFEST_PATH} includes the required production markers`
        : `missing markers: ${missingDocMarkers.join(', ') || 'manifest file missing'}`,
      'Restore the video production manifest and required production markers.'
    ),
    makeCheck(
      'video-suite-public-sanitization',
      forbiddenPaths.length === 0
        && manifest.includes('Do not commit raw footage, transcript JSON, or timeline exports')
        && /Keep raw\s+absolute paths out of public docs/.test(hypergrowth)
        ? 'pass'
        : 'fail',
      forbiddenPaths.length === 0
        ? 'public launch docs avoid private media paths and keep raw assets local'
        : `private path markers: ${forbiddenPaths.map(item => `${item.path}:${item.line}`).join(', ')}`,
      'Remove private absolute paths from public release docs and keep raw media in the local production workspace.',
      { forbiddenPaths }
    ),
    makeCheck(
      'video-source-assets-present',
      missingSourceAssets.length === 0 ? 'pass' : 'fail',
      missingSourceAssets.length === 0
        ? `${sourceAssets.length} source assets are present`
        : `missing source assets: ${missingSourceAssets.map(asset => asset.file).join(', ')}`,
      'Set ECC_VIDEO_SOURCE_ROOT or pass --source-root to the edited ECC 2 media directory.',
      {
        configured: Boolean(sourceRoot),
        missing: missingSourceAssets.map(asset => asset.file),
      }
    ),
    makeCheck(
      'video-release-artifacts-present',
      missingSuiteArtifacts.length === 0 ? 'pass' : 'fail',
      missingSuiteArtifacts.length === 0
        ? `${suiteArtifacts.length} render, timeline, caption, EDL, and segment artifacts are present`
        : `missing or invalid suite artifacts: ${missingSuiteArtifacts.map(artifact => artifact.relativePath).join(', ')}`,
      'Set ECC_VIDEO_RELEASE_SUITE_ROOT or pass --suite-root to the ECC 2 release suite workspace.',
      {
        configured: Boolean(suiteRoot),
        missing: missingSuiteArtifacts.map(artifact => artifact.relativePath),
      }
    ),
  ];

  const failed = checks.filter(check => check.status !== 'pass');
  const topActions = [];

  if (!sourceRoot) {
    topActions.push('Set ECC_VIDEO_SOURCE_ROOT to the edited ECC 2 media directory.');
  }

  if (!suiteRoot) {
    topActions.push('Set ECC_VIDEO_RELEASE_SUITE_ROOT to the local release suite workspace.');
  }

  for (const check of failed) {
    if (check.fix && !topActions.includes(check.fix)) {
      topActions.push(check.fix);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    release: RELEASE,
    generatedAt: options.generatedAt || new Date().toISOString(),
    root: rootDir,
    sourceRootConfigured: Boolean(sourceRoot),
    suiteRootConfigured: Boolean(suiteRoot),
    mediaPathsRedacted: true,
    ready: failed.length === 0,
    checks,
    sourceAssets,
    suiteArtifacts,
    top_actions: topActions,
  };
}

function summarizeItems(items) {
  const present = items.filter(item => item.status === 'present');
  const missing = items.filter(item => item.status !== 'present');

  return {
    total: items.length,
    present: present.length,
    missing: missing.map(item => item.file || item.relativePath),
  };
}

function summarizeReport(report) {
  const primaryRender = report.suiteArtifacts.find(item => item.id === 'primary-render-v1') || null;

  return {
    schema_version: report.schema_version,
    release: report.release,
    generatedAt: report.generatedAt,
    root: report.root,
    sourceRootConfigured: report.sourceRootConfigured,
    suiteRootConfigured: report.suiteRootConfigured,
    mediaPathsRedacted: report.mediaPathsRedacted,
    ready: report.ready,
    checks: report.checks.map(check => ({
      id: check.id,
      status: check.status,
      summary: check.summary,
      fix: check.fix,
    })),
    sourceAssetSummary: summarizeItems(report.sourceAssets),
    suiteArtifactSummary: summarizeItems(report.suiteArtifacts),
    primaryRender: primaryRender ? {
      status: primaryRender.status,
      durationSeconds: primaryRender.durationSeconds,
      sizeMb: primaryRender.sizeMb,
    } : null,
    top_actions: report.top_actions,
  };
}

function renderText(report) {
  const lines = [
    `ECC ${report.release} release video suite`,
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    `Source root configured: ${report.sourceRootConfigured ? 'yes' : 'no'}`,
    `Suite root configured: ${report.suiteRootConfigured ? 'yes' : 'no'}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }

  const primaryRender = report.suiteArtifacts.find(item => item.id === 'primary-render-v1');
  if (primaryRender && primaryRender.status === 'present') {
    lines.push('');
    lines.push(
      `Primary rough render: ${primaryRender.relativePath}`
        + (Number.isFinite(primaryRender.durationSeconds) ? ` (${primaryRender.durationSeconds}s)` : '')
    );
  }

  if (report.top_actions.length > 0) {
    lines.push('');
    lines.push('Top actions:');
    for (const action of report.top_actions) {
      lines.push(`- ${action}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  if (options.help) {
    usage();
    return;
  }

  const report = buildReport(options);
  const outputReport = options.summary ? summarizeReport(report) : report;

  if (options.format === 'json') {
    console.log(JSON.stringify(outputReport, null, 2));
  } else {
    process.stdout.write(renderText(report));
  }

  process.exit(report.ready ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_SOURCE_ASSETS,
  REQUIRED_SUITE_ARTIFACTS,
  buildReport,
  parseArgs,
  renderText,
  summarizeReport,
};
