#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildReport: buildPlatformReport } = require('./platform-audit');

const SCHEMA_VERSION = 'ecc.operator-readiness-dashboard.v1';
const DEFAULT_THRESHOLDS = Object.freeze({
  maxOpenPrs: 20,
  maxOpenIssues: 20,
  maxDirtyFiles: 0,
});

function usage() {
  console.log([
    'Usage: node scripts/operator-readiness-dashboard.js [options]',
    '',
    'Generate the ECC operator readiness dashboard and prompt-to-artifact audit.',
    '',
    'Options:',
    '  --format <text|json|markdown>',
    '                             Output format (default: markdown)',
    '  --json                     Alias for --format json',
    '  --markdown                 Alias for --format markdown',
    '  --write <path>             Write json or markdown output to a file',
    '  --root <dir>               Repository root to inspect (default: cwd)',
    '  --repo <owner/repo>        GitHub repo to inspect; repeatable',
    '  --skip-github              Skip live GitHub queue/discussion checks',
    '  --max-open-prs <n>         PR budget passed through to platform:audit',
    '  --max-open-issues <n>      Issue budget passed through to platform:audit',
    '  --max-dirty-files <n>      Dirty-file budget passed through to platform:audit',
    '  --allow-untracked <path>   Ignore untracked files under path; repeatable',
    '  --use-env-github-token     Keep GITHUB_TOKEN when invoking gh',
    '  --generated-at <iso>       Override generatedAt for deterministic tests',
    '  --exit-code                Return 2 when the objective is not ready',
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

function normalizeRelativePrefix(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
  return normalized ? `${normalized}/` : '';
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    allowUntracked: [],
    exitCode: false,
    format: 'markdown',
    generatedAt: null,
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

    if (arg === '--write') {
      parsed.writePath = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--write=')) {
      parsed.writePath = path.resolve(arg.slice('--write='.length));
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

    if (arg === '--generated-at') {
      parsed.generatedAt = readValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--generated-at=')) {
      parsed.generatedAt = arg.slice('--generated-at='.length);
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

  parsed.allowUntracked = parsed.allowUntracked.map(normalizeRelativePrefix).filter(Boolean);

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

function includesAll(text, needles) {
  return needles.every(needle => text.includes(needle));
}

const LOCALIZATION_MANUAL_REVIEW_TAIL = [
  '#1687 zh-CN localization tail',
  '#1609 Persian README translation',
  '#1563 zh-TW README sync',
  '#1564 Turkish README sync',
  '#1565 pt-BR README sync',
];

function hasLegacySalvageTracking({ stalePrSalvage, legacyInventory, roadmap }) {
  return stalePrSalvage.includes('Manual review tail')
    || stalePrSalvage.includes('Remaining Manual-Review Backlog')
    || stalePrSalvage.includes('Translator/manual review')
    || legacyInventory.includes('Translator/manual review')
    || roadmap.includes('ITO-55');
}

function hasAttachedLegacyManualReviewTail({ stalePrSalvage, legacyInventory, roadmap }) {
  return stalePrSalvage.includes('Linear ITO-55')
    && legacyInventory.includes('ITO-55')
    && roadmap.includes('ITO-55')
    && LOCALIZATION_MANUAL_REVIEW_TAIL.every(item => (
      stalePrSalvage.includes(item) && legacyInventory.includes(item)
    ));
}

function legacySalvageStatus(context) {
  if (hasAttachedLegacyManualReviewTail(context)) {
    return 'current';
  }

  return hasLegacySalvageTracking(context) ? 'in_progress' : 'not_complete';
}

function legacySalvageEvidence(context) {
  if (hasAttachedLegacyManualReviewTail(context)) {
    return 'legacy salvage ledger and inventory are current; all localization tails are attached to Linear ITO-55 for manual language-owner review';
  }

  return 'legacy salvage ledger and ITO-55 tracking are present';
}

function legacySalvageGap(context) {
  if (hasAttachedLegacyManualReviewTail(context)) {
    return 'repeat legacy scan before release';
  }

  return 'final translation/manual-review tail remains';
}

function hasAgentShieldEnterpriseTracking(roadmap) {
  return roadmap.includes('AgentShield Enterprise Iteration')
    && (
      roadmap.includes('#78-#92')
      || roadmap.includes('AgentShield PR #92')
      || roadmap.includes('AgentShield #92')
      || roadmap.includes('policy promote')
      || roadmap.includes('checksum-verified policy promotion')
      || roadmap.includes('#78-#91')
      || roadmap.includes('AgentShield PR #91')
      || roadmap.includes('AgentShield #91')
      || roadmap.includes('checksum-backed policy export')
      || roadmap.includes('#78-#90')
      || roadmap.includes('hosted promotion judge audit traces')
      || roadmap.includes('operator-visible promotion output values')
    );
}

function agentShieldEnterpriseGap(roadmap) {
  if (roadmap.includes('hosted promotion judge audit traces')
    || roadmap.includes('operator-visible promotion output values')) {
    return 'deepen live operator approval/readback after Marketplace/payment gates';
  }

  if (roadmap.includes('#78-#92')
    || roadmap.includes('AgentShield PR #92')
    || roadmap.includes('AgentShield #92')
    || roadmap.includes('policy promote')
    || roadmap.includes('checksum-verified policy promotion')) {
    return 'workflow automation around protected rollout and richer runtime review UX pending after policy promotion shipped';
  }

  return roadmap.includes('#78-#91')
    || roadmap.includes('AgentShield PR #91')
    || roadmap.includes('AgentShield #91')
    || roadmap.includes('checksum-backed policy export')
    ? 'workflow automation plus policy promotion/review UX pending after policy export shipped'
    : 'durable policy export and fleet-review workflow automation remain pending after reviewItems shipped';
}

function agentShieldEnterpriseEvidence(roadmap) {
  if (roadmap.includes('hosted promotion judge audit traces')
    || roadmap.includes('operator-visible promotion output values')) {
    return 'AgentShield policy promotion `reviewItems` landed in `87aec47`; package-manager hardening drift detection landed in `28d08c7`; workflow action runtime pins were refreshed in `659f569`; npm age-gate guidance was corrected in `ee585cd`; package-manager hardening Action outputs landed in `1124535`; policy-promotion Action outputs and runtime-smoke job-summary evidence landed in `1593925`; fleet review ticket payloads and current Mini Shai-Hulud IOC breadcrumbs landed in `840952a`; ECC-Tools consumes those outputs in `8658951`, surfaces operator-readable status/pack/count/digest telemetry in `16c537f`, and renders hosted promotion judge audit traces in `05d4e82`; all are mirrored in the GA roadmap';
  }

  return 'AgentShield enterprise PR evidence is mirrored in the GA roadmap';
}

function eccToolsNextLevelEvidence(roadmap) {
  if (roadmap.includes('announcementGateReady` is `true')
    || roadmap.includes('Native GitHub payments announcement gate is ready')
    || roadmap.includes('d3d62df83fa075660fa4530c3e0edc311a4355fe')) {
    return 'billing announcement gate, selected-target announcement gate, billing gate env-file operator path, non-breaking operator bearer path, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler selected-target readback, target-account billing readback, provenance-aware Marketplace billing-state gates, sanitized Marketplace plan/action provenance counts, ready Marketplace Pro target selection, hosted team-learning feedback controls, and ECC-Tools Dependabot alert remediation are mirrored in the GA roadmap';
  }

  if (roadmap.includes('selected-target official announcement gate')
    || roadmap.includes('billing gate env-file operator path')
    || roadmap.includes('72119a1')
    || roadmap.includes('16a5bb3')
    || roadmap.includes('select-ready-target')
    || roadmap.includes('f14ed2fe-a219-470c-8119-63429e197027')) {
    return 'billing announcement gate, selected-target announcement gate, billing gate env-file operator path, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler OAuth readback, target-account billing readback, provenance-aware Marketplace billing-state gates, sanitized Marketplace plan/action provenance counts, ready Marketplace Pro target selection, hosted team-learning feedback controls, and ECC-Tools Dependabot alert remediation are mirrored in the GA roadmap';
  }

  if (roadmap.includes('69ca535')
    || roadmap.includes('team feedback controls')
    || roadmap.includes('e56fc1a')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler OAuth readback, target-account billing readback, provenance-aware Marketplace billing-state gates, sanitized Marketplace plan/action provenance counts, hosted team-learning feedback controls, and ECC-Tools Dependabot alert remediation are mirrored in the GA roadmap';
  }

  if (roadmap.includes('d5f60db')
    || roadmap.includes('Marketplace-source provenance counts')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler OAuth readback, target-account billing readback, provenance-aware Marketplace billing-state gates, and sanitized Marketplace plan/action provenance counts are mirrored in the GA roadmap';
  }

  if (roadmap.includes('target account billing readback')
    || roadmap.includes('632e059')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler OAuth readback, target-account billing readback, and provenance-aware Marketplace billing-state gates are mirrored in the GA roadmap';
  }

  if (roadmap.includes('Wrangler OAuth readback')
    || roadmap.includes('42653f9')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, Wrangler OAuth readback, and provenance-aware Marketplace billing-state gates are mirrored in the GA roadmap';
  }

  if (roadmap.includes('Marketplace webhook provenance')
    || roadmap.includes('2859678')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, aggregate production billing KV readback, and provenance-aware Marketplace billing-state gates are mirrored in the GA roadmap';
  }

  if (roadmap.includes('billing:kv-readback')
    || roadmap.includes('95d0bec')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, and aggregate production billing KV readback are mirrored in the GA roadmap';
  }

  if (roadmap.includes('production Marketplace readback state')
    || roadmap.includes('eb69412')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, hosted promotion judge audit traces, billing announcement preflight, and production KV readback state are mirrored in the GA roadmap';
  }

  if (roadmap.includes('hosted promotion judge audit traces')
    || roadmap.includes('operator-visible promotion output values')) {
    return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, harness-route policy linking, policy-promotion Action-output telemetry, operator-visible promotion output details, and hosted promotion judge audit traces are mirrored in the GA roadmap';
  }

  return 'billing announcement gate, hosted analysis lanes, AgentShield fleet-summary consumption, hosted finding evidence paths, and harness-route policy linking are mirrored in the GA roadmap';
}

function eccToolsNextLevelGap(roadmap) {
  if (roadmap.includes('announcementGateReady` is `true')
    || roadmap.includes('Native GitHub payments announcement gate is ready')
    || roadmap.includes('d3d62df83fa075660fa4530c3e0edc311a4355fe')) {
    return 'repeat KV readback and selected-target announcement gate immediately before launch; keep native-payments copy behind the final release, plugin, URL, and owner-approval gates';
  }

  if (roadmap.includes('selected-target official announcement gate')
    || roadmap.includes('billing gate env-file operator path')
    || roadmap.includes('72119a1')
    || roadmap.includes('16a5bb3')
    || roadmap.includes('select-ready-target')
    || roadmap.includes('f14ed2fe-a219-470c-8119-63429e197027')
    || roadmap.includes('old "no Marketplace-managed Pro target billing-state" blocker is cleared')) {
    return 'obtain or rotate the local/internal INTERNAL_API_SECRET bearer-token path, via exported env or ignored --env-file, then run the live selected-target billing announcement gate before publishing native-payments copy';
  }

  if (roadmap.includes('1Password CLI authorization timed out')
    || roadmap.includes('Cloudflare API auth returned `Authentication error [code: 10000]`')) {
    return 'authorize Cloudflare API or 1Password CLI access, configure the target Marketplace Pro account and INTERNAL_API_SECRET, create or replay Marketplace Pro webhook state, then rerun target readback and the live announcement gate';
  }

  if (roadmap.includes('Wrangler OAuth now works')
    || roadmap.includes('6904e4fb-bec7-4787-90e2-759f077a628c')) {
    return 'create or verify Marketplace-managed Pro target billing-state with webhook provenance, configure the target account and INTERNAL_API_SECRET, then rerun target readback and the live announcement gate';
  }

  if (roadmap.includes('d5f60db')
    || roadmap.includes('Marketplace-source provenance counts')) {
    return 'create or verify Marketplace-managed Pro target billing-state with webhook provenance, then run `billing:kv-readback -- --wrangler --wrangler-bin ./node_modules/.bin/wrangler --account <github-login> --require-ready`, followed by the live announcement gate';
  }

  if (roadmap.includes('target account billing readback')
    || roadmap.includes('632e059')) {
    return 'create or verify Marketplace-managed Pro target billing-state with webhook provenance, then run `billing:kv-readback -- --account <github-login> --require-ready` with working Cloudflare API auth or repaired Wrangler OAuth, followed by the live announcement gate';
  }

  if (roadmap.includes('Wrangler OAuth readback')
    || roadmap.includes('42653f9')) {
    return 'create or verify Marketplace-managed Pro billing-state with webhook provenance, then run `billing:kv-readback -- --require-ready` with working Cloudflare API auth or repaired Wrangler OAuth, followed by the live announcement gate';
  }

  if (roadmap.includes('Marketplace webhook provenance')
    || roadmap.includes('2859678')) {
    return 'replace the invalid Cloudflare credential, create or verify Marketplace-managed Pro billing-state with webhook provenance, then run `billing:kv-readback -- --require-ready` and the live announcement gate';
  }

  if (roadmap.includes('billing:kv-readback')
    || roadmap.includes('95d0bec')) {
    return 'create or verify a Marketplace-managed Pro billing-state, then run the official live announcement gate';
  }

  if (roadmap.includes('production Marketplace readback state')
    || roadmap.includes('eb69412')) {
    return 'complete Marketplace purchase/webhook readback, then run the live announcement gate';
  }

  if (roadmap.includes('hosted promotion judge audit traces')
    || roadmap.includes('operator-visible promotion output values')) {
    return 'live Marketplace test-account readback pending';
  }

  return 'live Marketplace test-account readback, hosted promotion telemetry, and richer operator review UX pending';
}

function supplyChainLocalProtectionEvidence({ roadmap, scripts }) {
  if (scripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
    && roadmap.includes('package-manager hardening Action outputs')) {
    return 'scheduled supply-chain watch emits IOC/advisory-source refresh artifacts; ECC scanner covers gh-token-monitor token-store persistence; AgentShield now detects known AI-tool persistence IOCs, npm lifecycle/token drift, unsupported npm age-key drift, and pnpm/Yarn cooldown drift; current-head watch evidence and ITO-57 May 18 Linear evidence updates are current';
  }

  return scripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
    ? 'scheduled supply-chain watch now emits IOC and advisory-source refresh artifacts'
    : 'scheduled supply-chain watch or advisory-source command is missing';
}

function supplyChainLocalProtectionGap({ roadmap, scripts }) {
  if (scripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
    && roadmap.includes('package-manager hardening Action outputs')) {
    return 'repeat advisory/source refresh and Linear sync after each significant supply-chain batch';
  }

  return 'Linear status synchronization remains ITO-57 follow-up after each significant merge batch';
}

function hasCurrentLinearProgressSync({ roadmap, progressSync }) {
  const hasOperatorProgressSurface = roadmap.includes('operator progress snapshot')
    || roadmap.includes('operator progress comment');
  const hasMay19ProgressSurface = roadmap.includes('ecc-may-19-post-pr-2002-sync-64cef8f668e0')
    && roadmap.includes('a6411e3a-8c8e-4a58-adba-687e77d4c543')
    && roadmap.includes('ITO-56');
  const hasMay20ReleaseGateSurface = roadmap.includes('467d148a-712a-4777-aad9-95593e9f1739')
    && roadmap.includes('7642ee9c-3107-400c-a229-53e2895a8914')
    && roadmap.includes('30f60710')
    && roadmap.includes('26135974576');

  return roadmap.includes('Linear live sync is current')
    && (hasOperatorProgressSurface || hasMay19ProgressSurface || hasMay20ReleaseGateSurface)
    && includesAll(progressSync, [
    'node scripts/work-items.js sync-github --repo <owner/repo>',
    'node scripts/status.js --json',
    'Linear remains the external status surface',
  ]);
}

function hasLinearProgressContract({ roadmap, progressSync }) {
  return includesAll(roadmap, ['ITO-44', 'ITO-59', 'Linear'])
    && includesAll(progressSync, ['GitHub', 'Linear', 'handoff', 'repo roadmap']);
}

function linearProgressStatus(context) {
  if (hasCurrentLinearProgressSync(context)) {
    return 'current';
  }

  return hasLinearProgressContract(context) ? 'in_progress' : 'not_complete';
}

function linearProgressEvidence(context) {
  if (hasCurrentLinearProgressSync(context)) {
    if (context.roadmap.includes('467d148a-712a-4777-aad9-95593e9f1739')
      && context.roadmap.includes('7642ee9c-3107-400c-a229-53e2895a8914')) {
      return 'Linear live sync is current with the May 20 Marketplace Pro release-gate comments on ITO-61 and the ECC platform roadmap; progress-sync contract defines the file-backed work-items/status path';
    }

    if (context.roadmap.includes('ecc-may-19-post-pr-2002-sync-64cef8f668e0')) {
      return 'Linear live sync is current with the May 19 post-PR #2002 sync document, project comment, and active issue-lane updates; progress-sync contract defines the file-backed work-items/status path';
    }

    return 'Linear live sync and project progress surface are current; progress-sync contract defines the file-backed work-items/status path';
  }

  return 'repo mirror and progress-sync contract are present';
}

function linearProgressGap(context) {
  if (hasCurrentLinearProgressSync(context)) {
    return 'repeat Linear/project status update and local work-items sync after each significant merge batch';
  }

  return 'recurring Linear status sync and productized realtime sync remain pending';
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || '').trim();
}

function readPackage(rootDir) {
  const text = readText(rootDir, 'package.json');
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return {};
  }
}

function buildRequirement(id, requirement, artifact, status, evidence, gap) {
  return { id, requirement, artifact, status, evidence, gap };
}

function extractLabeledCount(text, label) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\d+)`, 'i');
  const match = text.match(pattern);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentOrComplete(status) {
  return status === 'current' || status === 'complete';
}

function extractGrowthBaseline(hypergrowth) {
  const mrrMatch = hypergrowth.match(/\| MRR \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \|/);

  if (!mrrMatch) {
    return {
      currentMrr: 'unknown',
      targetMrr: 'unknown',
      gapMrr: 'unknown',
    };
  }

  return {
    currentMrr: mrrMatch[1],
    targetMrr: mrrMatch[2],
    gapMrr: mrrMatch[3],
  };
}

function buildGrowthSummary(rootDir) {
  const hypergrowth = readText(rootDir, 'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');
  const partnerPack = readText(rootDir, 'docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md');
  const baseline = extractGrowthBaseline(hypergrowth || partnerPack);

  return {
    ...baseline,
    lanes: [
      'GitHub Sponsors and OSS partner sponsors',
      'ECC Tools Pro subscriptions',
      'consulting and implementation contracts',
      'talks, podcasts, conference demos, and partner webinars',
    ],
  };
}

function buildRequirements(rootDir, platformReport) {
  const roadmap = readText(rootDir, 'docs/ECC-2.0-GA-ROADMAP.md');
  const publicationReadiness = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-readiness.md');
  const namingMatrix = readText(rootDir, 'docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md');
  const releasePublicationChecklist = readText(rootDir, 'docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md');
  const releaseUrlLedger = readText(rootDir, 'docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md');
  const publicationEvidenceMay19 = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md');
  const hypergrowthCommandCenter = readText(rootDir, 'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');
  const partnerSponsorTalksPack = readText(rootDir, 'docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md');
  const releaseVideoProduction = readText(rootDir, 'docs/releases/2.0.0-rc.1/video-suite-production.md');
  const ownerQueueCleanup = readText(rootDir, 'docs/releases/2.0.0-rc.1/owner-queue-cleanup-2026-05-18.md');
  const ownerApprovalPacket = readText(rootDir, 'docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md');
  const previewManifest = readText(rootDir, 'docs/releases/2.0.0-rc.1/preview-pack-manifest.md');
  const previewPackSmoke = readText(rootDir, 'scripts/preview-pack-smoke.js');
  const releaseVideoSuite = readText(rootDir, 'scripts/release-video-suite.js');
  const progressSync = readText(rootDir, 'docs/architecture/progress-sync-contract.md');
  const observabilityReadiness = readText(rootDir, 'docs/architecture/observability-readiness.md');
  const stalePrSalvage = readText(rootDir, 'docs/stale-pr-salvage-ledger.md');
  const legacyInventory = readText(rootDir, 'docs/legacy-artifact-inventory.md');
  const supplyChainRunbook = readText(rootDir, 'docs/security/supply-chain-incident-response.md');
  const supplyChainWorkflow = readText(rootDir, '.github/workflows/supply-chain-watch.yml');
  const packageJson = readPackage(rootDir);
  const scripts = packageJson.scripts || {};
  const legacyContext = { stalePrSalvage, legacyInventory, roadmap };
  const previewPackManifestReady = includesAll(previewManifest, [
    'publication-readiness.md',
    'release-notes.md',
    'quickstart.md'
  ]);
  const previewPackSmokeReady = scripts['preview-pack:smoke'] === 'node scripts/preview-pack-smoke.js'
    && fileExists(rootDir, 'scripts/preview-pack-smoke.js')
    && includesAll(previewManifest, ['scripts/preview-pack-smoke.js', 'npm run preview-pack:smoke'])
    && includesAll(previewPackSmoke, [
      'ecc.preview-pack-smoke.v1',
      'preview-pack-artifacts-present',
      'hermes-boundary-sanitized',
      'publication-blockers-preserved'
    ]);
  const hermesArtifactsReady = fileExists(rootDir, 'docs/HERMES-SETUP.md')
    && fileExists(rootDir, 'skills/hermes-imports/SKILL.md');
  const hypergrowthCommandCenterReady = includesAll(hypergrowthCommandCenter, [
    'harness-native operator system',
    '$1,728/mo',
    '$10,000/mo',
    'Video Suite',
    'Distribution Plan',
    'Owner Approvals',
  ]) && includesAll(publicationEvidenceMay19, [
    'Business baseline',
    '$1,728/mo',
    '$8,272/mo',
  ]);
  const releaseVideoSuiteReady = scripts['release:video-suite'] === 'node scripts/release-video-suite.js'
    && fileExists(rootDir, 'scripts/release-video-suite.js')
    && includesAll(releaseVideoProduction, [
      'ECC 2.0 Video Suite Production Manifest',
      'Primary launch video',
      'Self-Eval Gate',
      'timeline',
    ])
    && includesAll(releaseVideoSuite, [
      'ecc.release-video-suite.v1',
      'video-source-assets-present',
      'video-release-artifacts-present',
    ]);
  const releaseVideoPublishCandidatesReady = releaseVideoSuiteReady
    && includesAll(publicationEvidenceMay19, [
      'Ready true',
      '15/15 source assets present',
      '13/13 render, timeline, caption, EDL, and segment artifacts present',
      '12/12 publish-candidate outputs present',
      'zero detected black-frame segments',
      'primary rough render self-eval passed',
    ]);
  const partnerSponsorTalksReady = includesAll(partnerSponsorTalksPack, [
    'Sponsor Outbound',
    'Platform Partner DM',
    'Consulting Intro',
    'Talk And Podcast Pitch',
    'GitHub Discussion Announcement',
    'Do Not Send Or Publish If',
  ]);
  const ownerApprovalPacketReady = includesAll(ownerApprovalPacket, [
    'Owner Approval Packet',
    'Decision Register',
    'GitHub prerelease',
    'npm `next` publish',
    'Claude plugin tag',
    'Video upload',
    'Final URL Fill-In',
    'Do Not Approve If',
    'No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.'
  ]) && includesAll(previewManifest, ['owner-approval-packet-2026-05-19.md']);

  const githubLive = !platformReport.github.skipped && platformReport.github.totals.errors === 0;
  const ownerWideOpenPrs = extractLabeledCount(ownerQueueCleanup, 'Owner-wide open PRs after cleanup');
  const ownerWideOpenIssues = extractLabeledCount(ownerQueueCleanup, 'Owner-wide open issues after cleanup');
  const trackedPrQueueCurrent = githubLive
    && platformReport.github.totals.openPrs <= platformReport.thresholds.maxOpenPrs;
  const trackedIssueQueueCurrent = githubLive
    && platformReport.github.totals.openIssues <= platformReport.thresholds.maxOpenIssues;
  const ownerPrQueueCurrent = ownerWideOpenPrs === null
    || ownerWideOpenPrs <= platformReport.thresholds.maxOpenPrs;
  const ownerIssueQueueCurrent = ownerWideOpenIssues === null
    || ownerWideOpenIssues <= platformReport.thresholds.maxOpenIssues;
  const ownerPrEvidence = ownerWideOpenPrs === null
    ? ''
    : `; ${ownerWideOpenPrs} owner-wide open PRs after cleanup`;
  const ownerIssueEvidence = ownerWideOpenIssues === null
    ? ''
    : `; ${ownerWideOpenIssues} owner-wide open issues after cleanup`;
  const discussionsCurrent = githubLive
    && platformReport.github.totals.discussionsNeedingMaintainerTouch === 0
    && platformReport.github.totals.discussionsMissingAcceptedAnswer === 0;

  return [
    buildRequirement(
      'public-pr-budget',
      'Keep public PRs below 20',
      ownerWideOpenPrs === null
        ? 'scripts/platform-audit.js live GitHub sweep'
        : 'scripts/platform-audit.js live GitHub sweep plus owner-wide queue cleanup ledger',
      trackedPrQueueCurrent && ownerPrQueueCurrent ? 'current' : 'in_progress',
      githubLive
        ? `${platformReport.github.totals.openPrs} open PRs across ${platformReport.github.repos.length} tracked repos${ownerPrEvidence}`
        : 'live GitHub queue readback was skipped or failed',
      trackedPrQueueCurrent && ownerPrQueueCurrent
        ? 'repeat platform:audit and owner-wide gh search before release'
        : 'run live platform:audit and owner-wide gh search, then drain PR queue'
    ),
    buildRequirement(
      'public-issue-budget',
      'Keep public issues below 20',
      ownerWideOpenIssues === null
        ? 'scripts/platform-audit.js live GitHub sweep'
        : 'scripts/platform-audit.js live GitHub sweep plus owner-wide queue cleanup ledger',
      trackedIssueQueueCurrent && ownerIssueQueueCurrent ? 'current' : 'in_progress',
      githubLive
        ? `${platformReport.github.totals.openIssues} open issues across ${platformReport.github.repos.length} tracked repos${ownerIssueEvidence}`
        : 'live GitHub queue readback was skipped or failed',
      trackedIssueQueueCurrent && ownerIssueQueueCurrent
        ? 'repeat platform:audit and owner-wide gh search before release'
        : 'run live platform:audit and owner-wide gh search, then drain issue queue'
    ),
    buildRequirement(
      'repository-discussions',
      'Respond and manage repository discussions',
      'scripts/platform-audit.js discussion summary',
      discussionsCurrent ? 'current' : 'in_progress',
      githubLive
        ? `${platformReport.github.totals.discussionsNeedingMaintainerTouch} need maintainer touch; ${platformReport.github.totals.discussionsMissingAcceptedAnswer} answerable discussions missing accepted answer`
        : 'live discussion readback was skipped or failed',
      discussionsCurrent ? 'repeat before release' : 'respond, answer, or route remaining discussions'
    ),
    buildRequirement(
      'completion-dashboard',
      'Build ITO-44 completion dashboard into a repeatable command',
      'npm run operator:dashboard',
      scripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        && fileExists(rootDir, 'scripts/operator-readiness-dashboard.js')
        ? 'complete'
        : 'in_progress',
      scripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        ? 'operator:dashboard package script exists'
        : 'operator:dashboard package script missing',
      'keep generated dashboard attached to publication evidence'
    ),
    buildRequirement(
      'ecc-preview-pack',
      'ECC 2.0 preview pack ready',
      'docs/releases/2.0.0-rc.1/preview-pack-manifest.md',
      previewPackManifestReady && previewPackSmokeReady ? 'current' : previewPackManifestReady ? 'in_progress' : 'not_complete',
      previewPackManifestReady && previewPackSmokeReady
        ? 'preview pack manifest and deterministic smoke gate are in-tree'
        : previewPackManifestReady
        ? 'preview pack manifest is in-tree'
        : 'preview pack manifest is incomplete',
      previewPackManifestReady && previewPackSmokeReady
        ? 'repeat clean-checkout preview-pack smoke before publication'
        : 'final clean-checkout release approval and publish evidence still pending'
    ),
    buildRequirement(
      'hermes-specialized-skills',
      'Include Hermes specialized skills safely',
      'docs/HERMES-SETUP.md and skills/hermes-imports/SKILL.md',
      hermesArtifactsReady && previewPackSmokeReady ? 'current' : hermesArtifactsReady ? 'in_progress' : 'not_complete',
      hermesArtifactsReady && previewPackSmokeReady
        ? 'Hermes setup/import artifacts are covered by preview-pack smoke'
        : hermesArtifactsReady
        ? 'Hermes setup and import skill are present'
        : 'Hermes setup/import artifacts missing',
      hermesArtifactsReady && previewPackSmokeReady
        ? 'repeat preview-pack smoke before release review'
        : 'final preview-pack smoke and release review pending'
    ),
    buildRequirement(
      'naming-and-plugin-publication',
      'Prepare name-change, Claude plugin, and Codex plugin paths',
      'naming-and-publication-matrix plus release-name-plugin-publication checklist plus publication-readiness',
      includesAll(namingMatrix, ['Claude plugin', 'Codex plugin', 'npm package', 'Publication Paths'])
        && includesAll(releasePublicationChecklist, [
          'Ship `v2.0.0-rc.1` as **ECC**',
          'affaan-m/ECC',
          'ecc-universal',
          'claude plugin tag .claude-plugin --dry-run',
          'codex plugin marketplace add',
          'Do not rename the npm package until rc.1 is published'
        ])
        && includesAll(publicationReadiness, ['Claude plugin', 'Codex plugin'])
        ? 'in_progress'
        : 'not_complete',
      'naming matrix, release publication checklist, and plugin readiness gates exist',
      'real tag/push, marketplace submission, and final channel choice remain approval-gated'
    ),
    buildRequirement(
      'release-notes-and-notifications',
      'Prepare release notes, articles, tweets, and push notifications',
      'docs/releases/2.0.0-rc.1 social and release-copy files',
      fileExists(rootDir, 'docs/releases/2.0.0-rc.1/release-notes.md')
        && fileExists(rootDir, 'docs/releases/2.0.0-rc.1/x-thread.md')
        && fileExists(rootDir, 'docs/releases/2.0.0-rc.1/linkedin-post.md')
        ? 'in_progress'
        : 'not_complete',
      includesAll(releaseUrlLedger, ['Live Now', 'Approval-Gated URLs', 'Codex marketplace CLI docs'])
        ? 'release notes, X thread, LinkedIn draft, and URL ledger are present'
        : 'release notes, X thread, and LinkedIn draft are present',
      includesAll(releaseUrlLedger, ['Live Now', 'Approval-Gated URLs', 'Codex marketplace CLI docs'])
        ? 'final live release/npm/plugin/billing URLs and publish approval still pending'
        : 'URL-backed refresh and publish approval still pending'
    ),
    buildRequirement(
      'owner-approval-packet',
      'Prepare final owner approval packet',
      'docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md',
      ownerApprovalPacketReady ? 'current' : 'not_complete',
      ownerApprovalPacketReady
        ? 'owner approval packet covers release, package, plugin, video, billing, social, and outbound decisions'
        : 'owner approval packet is missing or incomplete',
      ownerApprovalPacketReady
        ? 'review owner approvals from the final release commit before any publication or outbound action'
        : 'add the owner decision sheet before publication review'
    ),
    buildRequirement(
      'hypergrowth-command-center',
      'Create a second-phase hypergrowth release command center',
      'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md plus May 19 evidence',
      hypergrowthCommandCenterReady ? 'current' : 'in_progress',
      hypergrowthCommandCenterReady
        ? 'current MRR, target MRR, gap, release claim, video lane, distribution plan, and approval boundaries are in-tree'
        : 'hypergrowth command center or May 19 business baseline evidence is incomplete',
      hypergrowthCommandCenterReady
        ? 'refresh after every MRR, channel, or approval-state change before public launch'
        : 'add current MRR, target gap, channel plan, video lane, and approval boundaries'
    ),
    buildRequirement(
      'release-video-suite',
      'Produce the ECC 2.0 release video suite',
      'docs/releases/2.0.0-rc.1/video-suite-production.md and npm run release:video-suite',
      releaseVideoPublishCandidatesReady ? 'current' : releaseVideoSuiteReady ? 'in_progress' : 'not_complete',
      releaseVideoPublishCandidatesReady
        ? 'video-suite gate is ready with 15/15 source assets, 13/13 suite artifacts, 12/12 publish candidates, primary self-eval, and zero detected black-frame segments recorded in May 19 evidence'
        : releaseVideoSuiteReady
        ? 'video production manifest and deterministic video-suite gate are wired for launch video, short clips, captions, timeline, and self-eval evidence'
        : 'video production manifest or release:video-suite gate is incomplete',
      releaseVideoPublishCandidatesReady
        ? 'final owner approval, upload, and public video URLs remain approval-gated'
        : releaseVideoSuiteReady
        ? 'render final owner-approved MP4s, captions, platform reframes, and editable timeline before posting'
        : 'wire release:video-suite and production manifest before final content work'
    ),
    buildRequirement(
      'partner-sponsor-talks-pack',
      'Prepare sponsor, partner, consulting, podcast, talk, and Discussion copy',
      'docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md',
      partnerSponsorTalksReady ? 'in_progress' : 'not_complete',
      partnerSponsorTalksReady
        ? 'sponsor outbound, platform partner DM, consulting intro, talk/podcast pitch, GitHub Discussion announcement, CTA hooks, and do-not-send gate are drafted'
        : 'partner, sponsor, consulting, talk, or discussion copy is missing',
      partnerSponsorTalksReady
        ? 'replace final URLs after publication gates, then get explicit approval before outbound or personal-account posts'
        : 'draft the full outbound pack and approval gate'
    ),
    buildRequirement(
      'agentshield-enterprise-iteration',
      'Advance AgentShield enterprise iteration',
      'AgentShield PR evidence plus enterprise roadmap',
      hasAgentShieldEnterpriseTracking(roadmap)
        ? 'in_progress'
        : 'not_complete',
      agentShieldEnterpriseEvidence(roadmap),
      agentShieldEnterpriseGap(roadmap)
    ),
    buildRequirement(
      'ecc-tools-next-level',
      'Advance ECC Tools native payments and AI-native harness-agnostic app',
      'ECC Tools PR evidence, billing gate, hosted analysis lanes',
      includesAll(roadmap, ['ECC-Tools PR #78', 'hosted promotion', 'announcementGate'])
        ? 'in_progress'
        : 'not_complete',
      eccToolsNextLevelEvidence(roadmap),
      eccToolsNextLevelGap(roadmap)
    ),
    buildRequirement(
      'legacy-salvage',
      'Audit, prune, or attach legacy work',
      'docs/stale-pr-salvage-ledger.md and legacy inventory',
      legacySalvageStatus(legacyContext),
      legacySalvageEvidence(legacyContext),
      legacySalvageGap(legacyContext)
    ),
    buildRequirement(
      'linear-roadmap-and-progress',
      'Keep Linear roadmap detailed and progress tracking synchronized',
      'Linear project mirror plus progress-sync contract',
      linearProgressStatus({ roadmap, progressSync }),
      linearProgressEvidence({ roadmap, progressSync }),
      linearProgressGap({ roadmap, progressSync })
    ),
    buildRequirement(
      'observability-for-self-use',
      'Provide ECC 2.0 observability for self-use',
      'observability readiness gate',
      scripts['observability:ready'] === 'node scripts/observability-readiness.js'
        && includesAll(observabilityReadiness, ['observability-readiness.js'])
        ? 'complete'
        : 'in_progress',
      scripts['observability:ready'] === 'node scripts/observability-readiness.js'
        ? 'observability:ready command and readiness doc exist'
        : 'observability readiness command missing',
      'runtime/dashboard implementation can continue after release gates'
    ),
    buildRequirement(
      'supply-chain-local-protection',
      'Keep Mini Shai-Hulud/TanStack protection loop current',
      'supply-chain watch plus runbook plus AgentShield package-manager hardening',
      includesAll(supplyChainRunbook, ['TanStack', 'Mini Shai-Hulud', 'scan-supply-chain-iocs.js', 'supply-chain-advisory-sources.js'])
        && includesAll(supplyChainWorkflow, ['supply-chain-advisory-sources.js', 'supply-chain-advisory-sources.json'])
        && scripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
        && fileExists(rootDir, '.github/workflows/supply-chain-watch.yml')
        ? 'current'
        : 'in_progress',
      supplyChainLocalProtectionEvidence({ roadmap, scripts }),
      supplyChainLocalProtectionGap({ roadmap, scripts })
    ),
  ];
}

function buildReport(options) {
  const rootDir = path.resolve(options.root);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const platformReport = buildPlatformReport({
    allowUntracked: options.allowUntracked,
    exitCode: false,
    format: 'json',
    help: false,
    repos: options.repos,
    root: rootDir,
    skipGithub: options.skipGithub,
    thresholds: options.thresholds,
    useEnvGithubToken: options.useEnvGithubToken,
    writePath: null,
  });
  const requirements = buildRequirements(rootDir, platformReport);
  const incompleteRequirements = requirements.filter(item => !isCurrentOrComplete(item.status));
  const topActions = incompleteRequirements.map(item => ({
    id: item.id,
    summary: item.requirement,
    fix: item.gap,
  }));
  const head = runCommand('git', ['rev-parse', 'HEAD'], { cwd: rootDir });
  const growth = buildGrowthSummary(rootDir);
  const releaseVideoRequirement = requirements.find(item => item.id === 'release-video-suite');
  const releaseVideoWorkOrder = releaseVideoRequirement && releaseVideoRequirement.status === 'current'
    ? 'Review the owner-approved primary launch video candidates, choose the final cuts, upload after approval, and attach public video URLs to the release pack.'
    : 'Render the owner-approved primary launch video, short clips, captions, reframes, and editable timeline from the video-suite production manifest.';

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt,
    root: rootDir,
    head,
    growth,
    ready: incompleteRequirements.length === 0,
    dashboardReady: platformReport.ready,
    publicationReady: false,
    platform: {
      ready: platformReport.ready,
      branch: platformReport.git.branch,
      blockingDirtyCount: platformReport.git.blockingDirtyCount,
      ignoredDirtyCount: platformReport.git.ignoredDirty.length,
      openPrs: platformReport.github.totals.openPrs,
      openIssues: platformReport.github.totals.openIssues,
      discussionsNeedingMaintainerTouch: platformReport.github.totals.discussionsNeedingMaintainerTouch,
      discussionsMissingAcceptedAnswer: platformReport.github.totals.discussionsMissingAcceptedAnswer,
      githubErrors: platformReport.github.totals.errors,
      githubSkipped: platformReport.github.skipped,
    },
    requirements,
    top_actions: topActions,
    next_work_order: [
      'Regenerate this dashboard from the final release commit before publication evidence is recorded.',
      'Review the owner approval packet from the final release commit and approve, defer, or block each publication and outbound lane.',
      releaseVideoWorkOrder,
      'Replace final release, npm, plugin, billing, and video URLs in the partner/sponsor/talk pack, then get explicit approval before outbound.',
      'Repeat ITO-57 Linear/project status sync after the next significant merge batch or advisory-source refresh.',
      'Repeat KV readback and the selected-target billing announcement gate immediately before launch; keep native-payments copy behind the final release, plugin, URL, and owner-approval gates.',
    ],
  };
}

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function renderText(report) {
  const lines = [
    `ECC Operator Readiness Dashboard: ${report.ready ? 'objective ready' : 'work remaining'}`,
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.head || 'unknown'}`,
    `Dashboard ready: ${report.dashboardReady}`,
    `Publication ready: ${report.publicationReady}`,
    '',
    'Growth baseline:',
    `  MRR: ${report.growth ? report.growth.currentMrr : 'unknown'} -> ${report.growth ? report.growth.targetMrr : 'unknown'} (gap ${report.growth ? report.growth.gapMrr : 'unknown'})`,
    '',
    'Platform:',
    `  PRs: ${report.platform.openPrs}`,
    `  Issues: ${report.platform.openIssues}`,
    `  Discussions needing touch: ${report.platform.discussionsNeedingMaintainerTouch}`,
    `  Missing accepted answers: ${report.platform.discussionsMissingAcceptedAnswer}`,
    `  Blocking dirty files: ${report.platform.blockingDirtyCount}`,
    '',
    'Requirements:',
  ];

  for (const item of report.requirements) {
    lines.push(`  ${item.status.toUpperCase()} ${item.id}: ${item.requirement}`);
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
    '# ECC Operator Readiness Dashboard',
    '',
    'This dashboard is generated by `npm run operator:dashboard`. It is an operator snapshot, not release approval.',
    '',
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.head || 'unknown'}`,
    `Status: ${report.ready ? 'objective ready' : 'work remaining'}`,
    '',
    '## Current Status',
    '',
    '| Area | Status | Evidence |',
    '| --- | --- | --- |',
    `| PR queue | ${report.platform.openPrs < 20 && !report.platform.githubSkipped ? 'Current' : 'Needs work'} | ${report.platform.openPrs} open PRs across tracked repos |`,
    `| Issue queue | ${report.platform.openIssues < 20 && !report.platform.githubSkipped ? 'Current' : 'Needs work'} | ${report.platform.openIssues} open issues across tracked repos |`,
    `| Discussions | ${report.platform.discussionsNeedingMaintainerTouch === 0 && report.platform.discussionsMissingAcceptedAnswer === 0 && !report.platform.githubSkipped ? 'Current' : 'Needs work'} | ${report.platform.discussionsNeedingMaintainerTouch} need maintainer touch; ${report.platform.discussionsMissingAcceptedAnswer} missing accepted answer |`,
    `| Local worktree | ${report.platform.blockingDirtyCount === 0 ? 'Current' : 'Needs work'} | ${report.platform.blockingDirtyCount} blocking dirty files; ${report.platform.ignoredDirtyCount} ignored dirty entries |`,
    `| Dashboard generation | ${report.dashboardReady ? 'Current' : 'Needs work'} | platform audit ready: ${report.platform.ready}; GitHub skipped: ${report.platform.githubSkipped} |`,
    `| Publication | ${report.publicationReady ? 'Ready' : 'Not complete'} | release, npm, plugin, billing, and announcement gates are tracked below |`,
    '',
    '## Growth Baseline',
    '',
    '| Metric | Current | Target | Gap |',
    '| --- | ---: | ---: | ---: |',
    `| MRR | ${markdownEscape(report.growth ? report.growth.currentMrr : 'unknown')} | ${markdownEscape(report.growth ? report.growth.targetMrr : 'unknown')} | ${markdownEscape(report.growth ? report.growth.gapMrr : 'unknown')} |`,
    '',
    'Growth lanes: GitHub Sponsors and OSS partner sponsors; ECC Tools Pro subscriptions; consulting and implementation contracts; talks, podcasts, conference demos, and partner webinars.',
    '',
    '## Prompt-To-Artifact Checklist',
    '',
    '| Objective requirement | Artifact or gate | Status | Evidence | Gap |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const item of report.requirements) {
    lines.push(`| ${markdownEscape(item.requirement)} | ${markdownEscape(item.artifact)} | ${markdownEscape(item.status)} | ${markdownEscape(item.evidence)} | ${markdownEscape(item.gap)} |`);
  }

  lines.push('', '## Top Actions', '');
  if (report.top_actions.length === 0) {
    lines.push('- none');
  } else {
    for (const action of report.top_actions) {
      lines.push(`- \`${markdownEscape(action.id)}\`: ${markdownEscape(action.fix)}`);
    }
  }

  lines.push('', '## Next Work Order', '');
  report.next_work_order.forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });

  return `${lines.join('\n')}\n`;
}

function renderReport(report, format) {
  if (format === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === 'text') {
    return renderText(report);
  }

  return renderMarkdown(report);
}

function writeOutput(writePath, output) {
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, output, 'utf8');
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
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
