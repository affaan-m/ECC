/**
 * Tests for scripts/operator-readiness-dashboard.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'operator-readiness-dashboard.js');
const { buildReport, parseArgs, renderMarkdown, renderText } = require(SCRIPT);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(rootDir, relativePath, content) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function seedRepo(rootDir, overrides = {}) {
  const files = {
    'package.json': JSON.stringify({
      name: 'everything-claude-code',
      files: [
        'scripts/observability-readiness.js',
        'scripts/operator-readiness-dashboard.js',
        'scripts/platform-audit.js',
        'scripts/preview-pack-smoke.js',
        'scripts/release-video-suite.js'
      ],
      scripts: {
        'discussion:audit': 'node scripts/discussion-audit.js',
        'observability:ready': 'node scripts/observability-readiness.js',
        'operator:dashboard': 'node scripts/operator-readiness-dashboard.js',
        'platform:audit': 'node scripts/platform-audit.js',
        'preview-pack:smoke': 'node scripts/preview-pack-smoke.js',
        'release:video-suite': 'node scripts/release-video-suite.js',
        'security:ioc-scan': 'node scripts/ci/scan-supply-chain-iocs.js',
        'security:advisory-sources': 'node scripts/ci/supply-chain-advisory-sources.js'
      }
    }, null, 2),
    'scripts/operator-readiness-dashboard.js': 'operator dashboard generator',
    'scripts/preview-pack-smoke.js': [
      'ecc.preview-pack-smoke.v1',
      'preview-pack-artifacts-present',
      'hermes-boundary-sanitized',
      'publication-blockers-preserved'
    ].join('\n'),
    'scripts/release-video-suite.js': [
      'ecc.release-video-suite.v1',
      'video-source-assets-present',
      'video-release-artifacts-present'
    ].join('\n'),
    'docs/ECC-2.0-GA-ROADMAP.md': [
      'https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1',
      'Linear ITO-44 ITO-59',
      'AgentShield PR #92 #78-#92 checksum-backed policy export policy promote checksum-verified policy promotion',
      'AgentShield Enterprise Iteration',
      'ECC-Tools PR #78',
      'hosted promotion',
      'operator-visible promotion output values',
      'hosted promotion judge audit traces',
      'package-manager hardening Action outputs',
      'production Marketplace readback state',
      'eb69412',
      'Marketplace webhook provenance',
      '2859678',
      'Wrangler OAuth readback',
      '42653f9',
      'target account billing readback',
      '632e059',
      'select-ready-target',
      'selected-target official announcement gate',
      'billing gate env-file operator path',
      'non-breaking operator bearer path',
      'announcementGateReady` is `true',
      'd3d62df83fa075660fa4530c3e0edc311a4355fe',
      '72119a1',
      '16a5bb3',
      'f14ed2fe-a219-470c-8119-63429e197027',
      'old "no Marketplace-managed Pro target billing-state" blocker is cleared',
      '30f60710',
      '26135974576',
      '467d148a-712a-4777-aad9-95593e9f1739',
      '7642ee9c-3107-400c-a229-53e2895a8914',
      '69ca535',
      'team feedback controls',
      'e56fc1a',
      '1Password CLI authorization timed out',
      'Cloudflare API auth returned `Authentication error [code: 10000]`',
      'announcementGate',
      'ITO-55',
      'Linear live sync is current for the May 17 merge batch',
      'operator progress snapshot'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/publication-readiness.md': 'Claude plugin Codex plugin release-name-plugin-publication-checklist-2026-05-18.md',
    'docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md': 'Claude plugin Codex plugin npm package Publication Paths',
    'docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md': [
      'Ship `v2.0.0-rc.1` as **ECC**',
      'affaan-m/ECC',
      'ecc-universal',
      'claude plugin tag .claude-plugin --dry-run',
      'codex plugin marketplace add',
      'Do not rename the npm package until rc.1 is published'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/preview-pack-manifest.md': [
      'publication-readiness.md release-notes.md quickstart.md',
      'release-name-plugin-publication-checklist-2026-05-18.md',
      'owner-approval-packet-2026-05-19.md',
      '`scripts/preview-pack-smoke.js`',
      'npm run preview-pack:smoke'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md': [
      'Owner Approval Packet',
      'Decision Register',
      'GitHub prerelease',
      'npm `next` publish',
      'Claude plugin tag',
      'Video upload',
      'Final URL Fill-In',
      'Do Not Approve If',
      'No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/release-notes.md': 'release notes',
    'docs/releases/2.0.0-rc.1/x-thread.md': 'x thread',
    'docs/releases/2.0.0-rc.1/linkedin-post.md': 'linkedin post',
    'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-18.md': [
      'This dashboard is generated by `npm run operator:dashboard`',
      'operator:dashboard',
      'Prompt-To-Artifact Checklist',
      'Next Work Order',
      'ITO-44',
      'ITO-59',
      'PR queue',
      'Not complete'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-19.md': [
      'This dashboard is generated by `npm run operator:dashboard`',
      'operator:dashboard',
      'Growth Baseline',
      'hypergrowth release command center',
      'Prompt-To-Artifact Checklist',
      'Next Work Order',
      'ITO-44',
      'ITO-59',
      'PR queue',
      'Not complete'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md': [
      'This dashboard is generated by `npm run operator:dashboard`',
      'operator:dashboard',
      'Growth Baseline',
      'hypergrowth release command center',
      'Prompt-To-Artifact Checklist',
      'Next Work Order',
      'ITO-44',
      'ITO-59',
      'PR queue',
      'Not complete'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/owner-queue-cleanup-2026-05-18.md': [
      'Owner-wide open PRs after cleanup: 0.',
      'Owner-wide open issues after cleanup: 0.',
      'Stale dependency-bot PRs closed: 24.',
      'Stale legacy payments/0EM roadmap issues closed: 72.'
    ].join('\n'),
    'docs/HERMES-SETUP.md': 'Hermes setup Public Release Candidate Scope',
    'skills/hermes-imports/SKILL.md': 'Hermes imports Sanitization Checklist Do not ship raw workspace exports Output Contract',
    'docs/stale-pr-salvage-ledger.md': [
      'Remaining Manual-Review Backlog',
      'Linear ITO-55',
      '#1687 zh-CN localization tail',
      '#1609 Persian README translation',
      '#1563 zh-TW README sync',
      '#1564 Turkish README sync',
      '#1565 pt-BR README sync',
      'not a release-blocking salvage task'
    ].join('\n'),
    'docs/legacy-artifact-inventory.md': [
      'Translator/manual review',
      'ITO-55',
      '#1687 zh-CN localization tail',
      '#1609 Persian README translation',
      '#1563 zh-TW README sync',
      '#1564 Turkish README sync',
      '#1565 pt-BR README sync',
      'no automatic import remains release-blocking'
    ].join('\n'),
    'docs/architecture/progress-sync-contract.md': [
      'GitHub PRs/issues/discussions Linear project local handoff repo roadmap scripts/work-items.js',
      'node scripts/work-items.js sync-github --repo <owner/repo>',
      'node scripts/status.js --json',
      'Linear remains the external status surface'
    ].join('\n'),
    'docs/architecture/observability-readiness.md': 'observability-readiness.js',
    'docs/security/supply-chain-incident-response.md': 'TanStack Mini Shai-Hulud node-ipc scan-supply-chain-iocs.js supply-chain-advisory-sources.js',
    'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-18.md': [
      'TanStack',
      'Mini Shai-Hulud',
      'Home persistence IOC scan',
      'Supply-Chain Watch',
      'npm signatures',
      'Node IPC follow-up node-ipc IOC scan'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md': [
      'Release video suite',
      'growth outreach',
      'Operator dashboard',
      'GitGuardian',
      'macOS/Ubuntu/Windows test matrix',
      '2568 passed',
      'Business baseline',
      '$1,728/mo',
      '$8,272/mo'
    ].join('\n'),
    'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md': [
      'harness-native operator system',
      '| MRR | `$1,728/mo` | `$10,000/mo` | `$8,272/mo` |',
      'Video Suite',
      'Distribution Plan',
      'Owner Approvals'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/video-suite-production.md': [
      'ECC 2.0 Video Suite Production Manifest',
      'Primary launch video',
      'Self-Eval Gate',
      'timeline'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md': [
      'Sponsor Outbound',
      'Platform Partner DM',
      'Consulting Intro',
      'Talk And Podcast Pitch',
      'GitHub Discussion Announcement',
      'Do Not Send Or Publish If'
    ].join('\n'),
    '.github/workflows/supply-chain-watch.yml': 'name: Supply-Chain Watch supply-chain-advisory-sources.js supply-chain-advisory-sources.json'
  };

  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) {
      continue;
    }
    writeFile(rootDir, relativePath, content);
  }
}

function run(args = [], options = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function runProcess(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function buildSeededReport(rootDir) {
  return buildReport({
    allowUntracked: [],
    exitCode: false,
    format: 'json',
    generatedAt: '2026-05-15T00:00:00.000Z',
    help: false,
    repos: [],
    root: rootDir,
    skipGithub: true,
    thresholds: { maxOpenPrs: 20, maxOpenIssues: 20, maxDirtyFiles: 0 },
    useEnvGithubToken: false,
    writePath: null
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing operator-readiness-dashboard.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts dashboard flags and rejects invalid values', () => {
    const rootDir = createTempDir('operator-dashboard-args-');

    try {
      const parsed = parseArgs([
        'node',
        'script',
        '--format=json',
        `--root=${rootDir}`,
        '--skip-github',
        '--allow-untracked',
        'docs/drafts/',
        '--repo',
        'affaan-m/ECC',
        '--generated-at',
        '2026-05-15T00:00:00.000Z'
      ]);

      assert.strictEqual(parsed.format, 'json');
      assert.strictEqual(parsed.root, path.resolve(rootDir));
      assert.strictEqual(parsed.skipGithub, true);
      assert.deepStrictEqual(parsed.allowUntracked, ['docs/drafts/']);
      assert.deepStrictEqual(parsed.repos, ['affaan-m/ECC']);
      assert.strictEqual(parsed.generatedAt, '2026-05-15T00:00:00.000Z');

      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format/);
      assert.throws(() => parseArgs(['node', 'script', '--write', 'dashboard.md', '--format', 'text']), /--write requires/);
      assert.throws(() => parseArgs(['node', 'script', '--max-open-prs', 'x']), /Invalid --max-open-prs/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument/);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('seeded repo emits an objective audit with remaining work', () => {
    const rootDir = createTempDir('operator-dashboard-report-');

    try {
      seedRepo(rootDir);
      const report = buildSeededReport(rootDir);

      assert.strictEqual(report.schema_version, 'ecc.operator-readiness-dashboard.v1');
      assert.strictEqual(report.generatedAt, '2026-05-15T00:00:00.000Z');
      assert.strictEqual(report.dashboardReady, true);
      assert.strictEqual(report.ready, false);
      assert.strictEqual(report.publicationReady, false);
      assert.ok(report.requirements.some(item => item.id === 'completion-dashboard' && item.status === 'complete'));
      assert.ok(report.requirements.some(item => (
        item.id === 'ecc-preview-pack'
          && item.status === 'current'
          && item.evidence.includes('deterministic smoke gate')
          && item.gap === 'repeat clean-checkout preview-pack smoke before publication'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'hermes-specialized-skills'
          && item.status === 'current'
          && item.evidence.includes('covered by preview-pack smoke')
          && item.gap === 'repeat preview-pack smoke before release review'
      )));
      assert.ok(report.requirements.some(item => item.id === 'ecc-tools-next-level' && item.status === 'in_progress'));
      assert.ok(report.requirements.some(item => (
        item.id === 'agentshield-enterprise-iteration'
          && item.gap === 'deepen live operator approval/readback after Marketplace/payment gates'
          && item.evidence.includes('policy-promotion Action outputs')
          && item.evidence.includes('hosted promotion judge audit traces')
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'ecc-tools-next-level'
          && item.gap === 'repeat KV readback and selected-target announcement gate immediately before launch; keep native-payments copy behind the final release, plugin, URL, and owner-approval gates'
          && item.evidence.includes('operator-visible promotion output details')
          && item.evidence.includes('hosted promotion judge audit traces')
          && item.evidence.includes('selected-target announcement gate')
          && item.evidence.includes('billing gate env-file operator path')
          && item.evidence.includes('non-breaking operator bearer path')
          && item.evidence.includes('billing announcement preflight')
          && item.evidence.includes('aggregate production billing KV readback')
          && item.evidence.includes('Wrangler selected-target readback')
          && item.evidence.includes('target-account billing readback')
          && item.evidence.includes('provenance-aware Marketplace billing-state gates')
          && item.evidence.includes('ready Marketplace Pro target selection')
          && item.evidence.includes('hosted team-learning feedback controls')
          && item.evidence.includes('ECC-Tools Dependabot alert remediation')
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'naming-and-plugin-publication'
          && item.artifact.includes('release-name-plugin-publication checklist')
          && item.evidence.includes('release publication checklist')
          && item.gap === 'real tag/push, marketplace submission, and final channel choice remain approval-gated'
      )));
      assert.deepStrictEqual(report.growth, {
        currentMrr: '$1,728/mo',
        targetMrr: '$10,000/mo',
        gapMrr: '$8,272/mo',
        lanes: [
          'GitHub Sponsors and OSS partner sponsors',
          'ECC Tools Pro subscriptions',
          'consulting and implementation contracts',
          'talks, podcasts, conference demos, and partner webinars',
        ],
      });
      assert.ok(report.requirements.some(item => (
        item.id === 'hypergrowth-command-center'
          && item.status === 'current'
          && item.evidence.includes('current MRR')
          && item.gap === 'refresh after every MRR, channel, or approval-state change before public launch'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'release-video-suite'
          && item.status === 'in_progress'
          && item.evidence.includes('deterministic video-suite gate')
          && item.gap === 'render final owner-approved MP4s, captions, platform reframes, and editable timeline before posting'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'partner-sponsor-talks-pack'
          && item.status === 'in_progress'
          && item.evidence.includes('sponsor outbound')
          && item.gap === 'replace final URLs after publication gates, then get explicit approval before outbound or personal-account posts'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'owner-approval-packet'
          && item.status === 'current'
          && item.evidence.includes('release, package, plugin, video, billing, social, and outbound decisions')
          && item.gap === 'review owner approvals from the final release commit before any publication or outbound action'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'supply-chain-local-protection'
          && item.artifact.includes('AgentShield package-manager hardening')
          && item.evidence.includes('known AI-tool persistence IOCs')
          && item.evidence.includes('unsupported npm age-key drift')
          && item.gap === 'repeat advisory/source refresh and Linear sync after each significant supply-chain batch'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'legacy-salvage'
          && item.status === 'current'
          && item.evidence.includes('all localization tails are attached to Linear ITO-55')
          && item.gap === 'repeat legacy scan before release'
      )));
      assert.ok(report.requirements.some(item => (
        item.id === 'linear-roadmap-and-progress'
          && item.status === 'current'
          && item.evidence.includes('May 20 Marketplace Pro release-gate comments')
          && item.gap === 'repeat Linear/project status update and local work-items sync after each significant merge batch'
      )));
      assert.ok(report.top_actions.some(item => item.id === 'naming-and-plugin-publication'));
      assert.ok(report.top_actions.some(item => item.id === 'release-video-suite'));
      assert.ok(report.top_actions.some(item => item.id === 'partner-sponsor-talks-pack'));
      assert.ok(!report.top_actions.some(item => item.id === 'owner-approval-packet'));
      assert.ok(!report.top_actions.some(item => item.id === 'ecc-preview-pack'));
      assert.ok(!report.top_actions.some(item => item.id === 'hermes-specialized-skills'));
      assert.ok(!report.top_actions.some(item => item.id === 'hypergrowth-command-center'));
      assert.ok(!report.top_actions.some(item => item.id === 'legacy-salvage'));
      assert.ok(!report.top_actions.some(item => item.id === 'linear-roadmap-and-progress'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('release video suite moves current when publish-candidate evidence is recorded', () => {
    const rootDir = createTempDir('operator-dashboard-video-current-');

    try {
      seedRepo(rootDir, {
        'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md': [
          'Release video suite',
          'growth outreach',
          'Operator dashboard',
          'GitGuardian',
          'macOS/Ubuntu/Windows test matrix',
          '2568 passed',
          'Business baseline',
          '$1,728/mo',
          '$8,272/mo',
          'Ready true',
          '15/15 source assets present',
          '13/13 render, timeline, caption, EDL, and segment artifacts present',
          '12/12 publish-candidate outputs present with zero detected black-frame segments',
          'primary rough render self-eval passed'
        ].join('\n')
      });

      const report = buildSeededReport(rootDir);
      const releaseVideo = report.requirements.find(item => item.id === 'release-video-suite');

      assert.strictEqual(releaseVideo.status, 'current');
      assert.ok(releaseVideo.evidence.includes('15/15 source assets'));
      assert.ok(releaseVideo.evidence.includes('12/12 publish candidates'));
      assert.ok(releaseVideo.evidence.includes('zero detected black-frame segments'));
      assert.strictEqual(releaseVideo.gap, 'final owner approval, upload, and public video URLs remain approval-gated');
      assert.ok(!report.top_actions.some(item => item.id === 'release-video-suite'));
      assert.ok(report.next_work_order.some(item => item.includes('Review the owner-approved primary launch video candidates')));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('Linear progress stays in progress until live sync evidence is mirrored', () => {
    const rootDir = createTempDir('operator-dashboard-linear-progress-');

    try {
      seedRepo(rootDir, {
        'docs/ECC-2.0-GA-ROADMAP.md': [
          'https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1',
          'Linear ITO-44 ITO-59',
          'AgentShield Enterprise Iteration',
          'ECC-Tools PR #78',
          'hosted promotion',
          'announcementGate',
          'ITO-55'
        ].join('\n')
      });

      const report = buildSeededReport(rootDir);
      const linearProgress = report.requirements.find(item => item.id === 'linear-roadmap-and-progress');
      assert.strictEqual(linearProgress.status, 'in_progress');
      assert.strictEqual(linearProgress.evidence, 'repo mirror and progress-sync contract are present');
      assert.strictEqual(linearProgress.gap, 'recurring Linear status sync and productized realtime sync remain pending');
      assert.ok(report.top_actions.some(item => item.id === 'linear-roadmap-and-progress'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('preview pack and Hermes gates stay in progress until smoke gate is wired', () => {
    const rootDir = createTempDir('operator-dashboard-preview-smoke-');

    try {
      seedRepo(rootDir, {
        'package.json': JSON.stringify({
          files: [
            'scripts/observability-readiness.js',
            'scripts/operator-readiness-dashboard.js',
            'scripts/platform-audit.js'
          ],
          scripts: {
            'discussion:audit': 'node scripts/discussion-audit.js',
            'observability:ready': 'node scripts/observability-readiness.js',
            'operator:dashboard': 'node scripts/operator-readiness-dashboard.js',
            'platform:audit': 'node scripts/platform-audit.js',
            'security:ioc-scan': 'node scripts/ci/scan-supply-chain-iocs.js',
            'security:advisory-sources': 'node scripts/ci/supply-chain-advisory-sources.js'
          }
        }, null, 2),
        'scripts/preview-pack-smoke.js': null,
        'docs/releases/2.0.0-rc.1/preview-pack-manifest.md': 'publication-readiness.md release-notes.md quickstart.md'
      });

      const report = buildSeededReport(rootDir);
      const previewPack = report.requirements.find(item => item.id === 'ecc-preview-pack');
      const hermes = report.requirements.find(item => item.id === 'hermes-specialized-skills');

      assert.strictEqual(previewPack.status, 'in_progress');
      assert.strictEqual(previewPack.gap, 'final clean-checkout release approval and publish evidence still pending');
      assert.strictEqual(hermes.status, 'in_progress');
      assert.strictEqual(hermes.gap, 'final preview-pack smoke and release review pending');
      assert.ok(report.top_actions.some(item => item.id === 'ecc-preview-pack'));
      assert.ok(report.top_actions.some(item => item.id === 'hermes-specialized-skills'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('owner approval packet fails closed when it is missing from the release pack', () => {
    const rootDir = createTempDir('operator-dashboard-owner-packet-');

    try {
      seedRepo(rootDir, {
        'docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md': null,
        'docs/releases/2.0.0-rc.1/preview-pack-manifest.md': [
          'publication-readiness.md release-notes.md quickstart.md',
          'release-name-plugin-publication-checklist-2026-05-18.md',
          '`scripts/preview-pack-smoke.js`',
          'npm run preview-pack:smoke'
        ].join('\n')
      });

      const report = buildSeededReport(rootDir);
      const ownerPacket = report.requirements.find(item => item.id === 'owner-approval-packet');

      assert.strictEqual(ownerPacket.status, 'not_complete');
      assert.strictEqual(ownerPacket.evidence, 'owner approval packet is missing or incomplete');
      assert.strictEqual(ownerPacket.gap, 'add the owner decision sheet before publication review');
      assert.ok(report.top_actions.some(item => item.id === 'owner-approval-packet'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('AgentShield enterprise evidence covers export and policy promotion markers', () => {
    const cases = [
      {
        marker: 'AgentShield PR #92',
        gap: 'workflow automation around protected rollout and richer runtime review UX pending after policy promotion shipped'
      },
      {
        marker: 'AgentShield #92',
        gap: 'workflow automation around protected rollout and richer runtime review UX pending after policy promotion shipped'
      },
      {
        marker: 'policy promote',
        gap: 'workflow automation around protected rollout and richer runtime review UX pending after policy promotion shipped'
      },
      {
        marker: 'checksum-verified policy promotion',
        gap: 'workflow automation around protected rollout and richer runtime review UX pending after policy promotion shipped'
      },
      {
        marker: 'hosted promotion judge audit traces',
        gap: 'deepen live operator approval/readback after Marketplace/payment gates'
      },
      {
        marker: '#78-#91',
        gap: 'workflow automation plus policy promotion/review UX pending after policy export shipped'
      },
      {
        marker: 'AgentShield PR #91',
        gap: 'workflow automation plus policy promotion/review UX pending after policy export shipped'
      },
      {
        marker: 'AgentShield #91',
        gap: 'workflow automation plus policy promotion/review UX pending after policy export shipped'
      },
      {
        marker: 'checksum-backed policy export',
        gap: 'workflow automation plus policy promotion/review UX pending after policy export shipped'
      },
      {
        marker: '#78-#90',
        gap: 'durable policy export and fleet-review workflow automation remain pending after reviewItems shipped'
      }
    ];

    for (const { marker, gap } of cases) {
      const rootDir = createTempDir('operator-dashboard-agentshield-');

      try {
        seedRepo(rootDir, {
          'docs/ECC-2.0-GA-ROADMAP.md': [
            'https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1',
            'Linear ITO-44 ITO-59',
            'AgentShield Enterprise Iteration',
            marker,
            'ECC-Tools PR #78',
            'hosted promotion',
            'announcementGate',
            'ITO-55'
          ].join('\n')
        });

        const report = buildSeededReport(rootDir);
        const item = report.requirements.find(requirement => requirement.id === 'agentshield-enterprise-iteration');
        assert.strictEqual(item.status, 'in_progress', marker);
        assert.strictEqual(item.gap, gap, marker);
      } finally {
        cleanup(rootDir);
      }
    }
  })) passed++; else failed++;

  if (test('legacy salvage recognizes the real manual-review backlog heading', () => {
    const rootDir = createTempDir('operator-dashboard-legacy-salvage-');

    try {
      seedRepo(rootDir, {
        'docs/ECC-2.0-GA-ROADMAP.md': [
          'https://linear.app/itomarkets/project/ecc-platform-roadmap-52b328ee03e1',
          'Linear ITO-44 ITO-59',
          'AgentShield PR #92 #78-#92 checksum-backed policy export policy promote checksum-verified policy promotion',
          'AgentShield Enterprise Iteration',
          'ECC-Tools PR #78',
          'hosted promotion',
          'announcementGate'
        ].join('\n'),
        'docs/stale-pr-salvage-ledger.md': [
          '# Stale PR Salvage Ledger',
          '',
          '## Remaining Manual-Review Backlog',
          '',
          '- #1609 Persian README translation',
          '- #1563 zh-TW README sync'
        ].join('\n')
      });

      const report = buildSeededReport(rootDir);

      const legacySalvage = report.requirements.find(item => item.id === 'legacy-salvage');
      assert.strictEqual(legacySalvage.status, 'in_progress');
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('markdown output can be written as the dashboard artifact', () => {
    const rootDir = createTempDir('operator-dashboard-markdown-');
    const outputPath = path.join(rootDir, 'artifacts', 'dashboard.md');

    try {
      seedRepo(rootDir);
      const stdout = run([
        '--markdown',
        '--skip-github',
        `--root=${rootDir}`,
        '--generated-at=2026-05-15T00:00:00.000Z',
        '--write',
        outputPath
      ], { cwd: rootDir });
      const written = fs.readFileSync(outputPath, 'utf8');

      assert.strictEqual(stdout, written);
      assert.ok(written.includes('# ECC Operator Readiness Dashboard'));
      assert.ok(written.includes('Generated: 2026-05-15T00:00:00.000Z'));
      assert.ok(written.includes('## Growth Baseline'));
      assert.ok(written.includes('| MRR | $1,728/mo | $10,000/mo | $8,272/mo |'));
      assert.ok(written.includes('## Prompt-To-Artifact Checklist'));
      assert.ok(written.includes('Build ITO-44 completion dashboard into a repeatable command'));
      assert.ok(written.includes('## Next Work Order'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('text output renders compact status and top actions', () => {
    const rootDir = createTempDir('operator-dashboard-text-');

    try {
      seedRepo(rootDir);
      const stdout = run([
        '--format=text',
        '--skip-github',
        `--root=${rootDir}`,
        '--generated-at=2026-05-15T00:00:00.000Z'
      ], { cwd: rootDir });

      assert.ok(stdout.includes('ECC Operator Readiness Dashboard'));
      assert.ok(stdout.includes('work remaining'));
      assert.ok(stdout.includes('Dashboard ready: true'));
      assert.ok(stdout.includes('Publication ready: false'));
      assert.ok(stdout.includes('MRR: $1,728/mo -> $10,000/mo (gap $8,272/mo)'));
      assert.ok(stdout.includes('Top actions:'));
      assert.ok(stdout.includes('naming-and-plugin-publication'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('renderers handle a ready report with no top actions', () => {
    const report = {
      dashboardReady: true,
      generatedAt: '2026-05-15T00:00:00.000Z',
      head: 'abc123',
      next_work_order: ['Ship release evidence'],
      platform: {
        blockingDirtyCount: 0,
        discussionsMissingAcceptedAnswer: 0,
        discussionsNeedingMaintainerTouch: 0,
        githubSkipped: false,
        ignoredDirtyCount: 0,
        openIssues: 1,
        openPrs: 1,
        ready: true
      },
      publicationReady: true,
      ready: true,
      requirements: [
        {
          artifact: 'artifact.md',
          evidence: 'verified',
          gap: '',
          id: 'release',
          requirement: 'Release is approved',
          status: 'complete'
        }
      ],
      top_actions: []
    };

    const text = renderText(report);
    assert.ok(text.includes('objective ready'));
    assert.ok(text.includes('Commit: abc123'));
    assert.ok(text.includes('  none'));

    const markdown = renderMarkdown(report);
    assert.ok(markdown.includes('Status: objective ready'));
    assert.ok(markdown.includes('| PR queue | Current | 1 open PRs across tracked repos |'));
    assert.ok(markdown.includes('| Publication | Ready |'));
    assert.ok(markdown.includes('- none'));
  })) passed++; else failed++;

  if (test('exit-code mode fails closed while macro objective has gaps', () => {
    const rootDir = createTempDir('operator-dashboard-exit-');

    try {
      seedRepo(rootDir);
      const result = runProcess([
        '--json',
        '--skip-github',
        `--root=${rootDir}`,
        '--generated-at=2026-05-15T00:00:00.000Z',
        '--exit-code'
      ], { cwd: rootDir });

      assert.strictEqual(result.status, 2);
      assert.strictEqual(result.stderr, '');
      assert.ok(result.stdout.includes('"ready": false'));
      assert.ok(result.stdout.includes('"publicationReady": false'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('cli help exits successfully and invalid cli flags fail before reporting', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.strictEqual(help.stderr, '');
    assert.ok(help.stdout.includes('Usage: node scripts/operator-readiness-dashboard.js'));
    assert.ok(help.stdout.includes('--write <path>'));

    const invalid = runProcess(['--format=xml']);
    assert.strictEqual(invalid.status, 1);
    assert.strictEqual(invalid.stdout, '');
    assert.match(invalid.stderr, /Error: Invalid format/);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}
