'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const releaseDir = path.join(repoRoot, 'docs', 'releases', '2.0.0-rc.1');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkMarkdown(rootPath) {
  const files = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(nextPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(nextPath);
    }
  }
  return files;
}

console.log('\n=== Testing ECC 2.0 release surface ===\n');

const expectedReleaseFiles = [
  'release-notes.md',
  'x-thread.md',
  'linkedin-post.md',
  'article-outline.md',
  'launch-checklist.md',
  'telegram-handoff.md',
  'demo-prompts.md',
  'quickstart.md',
  'preview-pack-manifest.md',
  'publication-readiness.md',
  'video-suite-production.md',
  'partner-sponsor-talks-pack.md',
  'owner-approval-packet-2026-05-19.md',
  'release-name-plugin-publication-checklist-2026-05-18.md',
];

test('release candidate directory includes the public launch pack', () => {
  for (const fileName of expectedReleaseFiles) {
    assert.ok(fs.existsSync(path.join(releaseDir, fileName)), `Missing ${fileName}`);
  }
});

test('README links to Hermes setup and rc.1 release notes', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('docs/HERMES-SETUP.md'), 'README must link to Hermes setup');
  assert.ok(readme.includes('docs/releases/2.0.0-rc.1/release-notes.md'), 'README must link to rc.1 release notes');
});

test('cross-harness architecture doc exists and names core harnesses', () => {
  const source = read('docs/architecture/cross-harness.md');
  for (const harness of ['Claude Code', 'Codex', 'OpenCode', 'Cursor', 'Gemini', 'Hermes']) {
    assert.ok(source.includes(harness), `Expected cross-harness doc to mention ${harness}`);
  }
});

test('Hermes import skill exists and declares sanitization rules', () => {
  const source = read('skills/hermes-imports/SKILL.md');
  assert.ok(source.includes('name: hermes-imports'));
  assert.ok(source.includes('Sanitization Checklist'));
  assert.ok(source.includes('Do not ship raw workspace exports'));
});

test('release docs do not contain private local workspace paths', () => {
  const offenders = [];
  for (const filePath of walkMarkdown(releaseDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('/Users/') || source.includes('/.hermes/')) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('release docs do not contain unresolved public-link placeholders', () => {
  const offenders = [];
  for (const filePath of walkMarkdown(releaseDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('<repo-link>')) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('business launch copy stays aligned with the rc.1 public surface', () => {
  const source = read('docs/business/social-launch-copy.md');
  assert.ok(source.includes('ECC v2.0.0-rc.1'), 'business launch copy should use the rc.1 release');
  assert.ok(
    source.includes('preview pack is ready for final release review'),
    'business launch copy should stay pre-publication until release URLs exist'
  );
  assert.ok(
    source.includes('https://github.com/affaan-m/ECC'),
    'business launch copy should include the public repo URL'
  );
  assert.ok(
    source.includes(
      'https://github.com/affaan-m/ECC/blob/main/docs/releases/2.0.0-rc.1/release-notes.md'
    ),
    'business launch copy should link to the rc.1 release notes'
  );
  assert.ok(!source.includes('<repo-link>'), 'business launch copy should not contain repo placeholders');
  assert.ok(!source.includes('v1.8.0'), 'business launch copy should not stay pinned to v1.8.0');
});

test('announcement drafts avoid live-release claims before publication', () => {
  const announcementFiles = [
    'docs/releases/2.0.0-rc.1/linkedin-post.md',
    'docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md',
    'docs/business/social-launch-copy.md',
  ];

  for (const relativePath of announcementFiles) {
    const source = read(relativePath);
    assert.ok(
      !/ECC v2\.0\.0-rc\.1 is live\./.test(source),
      `${relativePath} must not claim rc.1 is live before the release gate completes`
    );
  }
});

test('Hermes setup uses release-candidate wording for the rc.1 surface', () => {
  const source = read('docs/HERMES-SETUP.md');
  assert.ok(source.includes('Public Release Candidate Scope'));
  assert.ok(source.includes('ECC v2.0.0-rc.1 documents the Hermes surface'));
  assert.ok(!source.includes('Public Preview Scope'));
});

test('Hermes setup cross-links adjacent migration and architecture docs', () => {
  const source = read('docs/HERMES-SETUP.md');
  assert.ok(source.includes('HERMES-OPENCLAW-MIGRATION.md'));
  assert.ok(source.includes('architecture/cross-harness.md'));
  assert.ok(source.includes('Plan and scaffold migration artifacts'));
  assert.ok(!source.includes('0.5. Generate and review artifacts with `ecc migrate plan` /'));
});

test('release docs preserve the ECC/Hermes boundary', () => {
  const releaseNotes = read('docs/releases/2.0.0-rc.1/release-notes.md');
  assert.ok(releaseNotes.includes('ECC is the reusable substrate'));
  assert.ok(releaseNotes.includes('Hermes as the operator shell'));
});

test('release notes route new contributors through the rc.1 quickstart', () => {
  const releaseNotes = read('docs/releases/2.0.0-rc.1/release-notes.md');
  assert.ok(releaseNotes.includes('[rc.1 quickstart](quickstart.md)'));
});

test('preview pack manifest assembles release, Hermes, and publication gates', () => {
  const manifest = read('docs/releases/2.0.0-rc.1/preview-pack-manifest.md');

  for (const artifact of [
    'docs/HERMES-SETUP.md',
    'skills/hermes-imports/SKILL.md',
    'docs/architecture/harness-adapter-compliance.md',
    'scripts/preview-pack-smoke.js',
    'docs/releases/2.0.0-rc.1/publication-readiness.md',
    'docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md',
    'docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md',
    'docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md',
    'docs/releases/2.0.0-rc.1/video-suite-production.md',
    'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md',
    'docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md',
  ]) {
    assert.ok(manifest.includes(artifact), `preview pack manifest missing ${artifact}`);
  }

  for (const blocker of [
    'GitHub prerelease `v2.0.0-rc.1`',
    'npm `ecc-universal@2.0.0-rc.1`',
    'Claude plugin tag',
    'Codex repo-marketplace distribution evidence',
    'ECC Tools billing/product readiness',
  ]) {
    assert.ok(manifest.includes(blocker), `preview pack manifest missing blocker ${blocker}`);
  }

  assert.ok(manifest.includes('no raw workspace exports'));
  assert.ok(manifest.includes('Final Verification Commands'));
  assert.ok(manifest.includes('npm run preview-pack:smoke'));
  assert.ok(manifest.includes('npm run release:video-suite -- --format json'));
  assert.ok(manifest.includes('Reference-Inspired Adapter Direction'));
});

test('owner approval packet consolidates the final gated decisions', () => {
  const packet = read('docs/releases/2.0.0-rc.1/owner-approval-packet-2026-05-19.md');
  const manifest = read('docs/releases/2.0.0-rc.1/preview-pack-manifest.md');
  const publicationReadiness = read('docs/releases/2.0.0-rc.1/publication-readiness.md');
  const hypergrowth = read('docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');

  for (const marker of [
    'Owner Approval Packet',
    'Source commit',
    'Decision Register',
    'GitHub prerelease',
    'npm `next` publish',
    'Claude plugin tag',
    'Video upload',
    'Final URL Fill-In',
    'Do Not Approve If',
    'No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.',
  ]) {
    assert.ok(packet.includes(marker), `owner approval packet missing ${marker}`);
  }

  for (const command of [
    'node scripts/platform-audit.js --json',
    'npm run preview-pack:smoke -- --format json',
    'npm run release:video-suite -- --format json',
    'node tests/run-all.js',
  ]) {
    assert.ok(packet.includes(command), `owner approval packet missing command ${command}`);
  }

  for (const urlSurface of [
    'GitHub prerelease URL',
    'npm rc package URL',
    'Claude plugin tag URL',
    'Primary launch video URL',
    'ECC Tools billing/readiness URL',
  ]) {
    assert.ok(packet.includes(urlSurface), `owner approval packet missing ${urlSurface}`);
  }

  assert.ok(manifest.includes('owner-approval-packet-2026-05-19.md'));
  assert.ok(publicationReadiness.includes('owner-approval-packet-2026-05-19.md'));
  assert.ok(hypergrowth.includes('owner-approval-packet-2026-05-19.md'));
});

test('rc.1 quickstart gives a clone-to-cross-harness path', () => {
  const quickstart = read('docs/releases/2.0.0-rc.1/quickstart.md');
  for (const heading of ['Clone', 'Install', 'Verify', 'First Skill', 'Switch Harness']) {
    assert.ok(quickstart.includes(`## ${heading}`), `Missing ${heading} section`);
  }
  assert.ok(quickstart.includes('git clone https://github.com/affaan-m/ECC.git'));
  assert.ok(quickstart.includes('cd ECC'));
  assert.ok(quickstart.includes('node tests/run-all.js'));
  assert.ok(quickstart.includes('skills/hermes-imports/SKILL.md'));
});

test('cross-harness doc includes a worked skill portability example', () => {
  const source = read('docs/architecture/cross-harness.md');
  assert.ok(source.includes('## Worked Example'));
  assert.ok(source.includes('same skill source'));
  for (const harness of ['Claude Code', 'Codex', 'OpenCode']) {
    assert.ok(source.includes(harness), `Expected worked example to mention ${harness}`);
  }
});

test('release docs use release-candidate wording consistently', () => {
  const releaseNotes = read('docs/releases/2.0.0-rc.1/release-notes.md');
  assert.ok(releaseNotes.includes('## Release Candidate Boundaries'));
  assert.ok(!releaseNotes.includes('## Preview Boundaries'));
});

test('launch checklist records the ecc2 alpha version policy', () => {
  const cargoToml = read('ecc2/Cargo.toml');
  const launchChecklist = read('docs/releases/2.0.0-rc.1/launch-checklist.md');
  assert.ok(cargoToml.includes('version = "0.1.0"'));
  assert.ok(launchChecklist.includes('`ecc2/Cargo.toml` stays at `0.1.0`'));
  assert.ok(!launchChecklist.includes('confirm whether `ecc2/Cargo.toml` moves'));
});

test('release video suite manifest gates the content launch lane', () => {
  const videoManifest = read('docs/releases/2.0.0-rc.1/video-suite-production.md');
  const launchChecklist = read('docs/releases/2.0.0-rc.1/launch-checklist.md');
  const hypergrowth = read('docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');
  const packageJson = JSON.parse(read('package.json'));

  for (const marker of [
    'ECC 2.0 Video Suite Production Manifest',
    'ECC_VIDEO_SOURCE_ROOT',
    'ECC_VIDEO_RELEASE_SUITE_ROOT',
    'video-use compatible workflow',
    'Self-Eval Gate',
    'Do Not Publish If',
    'renders/ecc-2-primary-launch-rough-v1.mp4',
    'timelines/primary-launch-v1.timeline.json',
    'Primary launch video',
  ]) {
    assert.ok(videoManifest.includes(marker), `video suite manifest missing ${marker}`);
  }

  for (const asset of [
    'longform-full-wide.mp4',
    'sf-thread-2-whatisecc.mp4',
    'thread-2-ghapp-money.mp4',
    'coverage-montage-wide.mp4',
    'star_history.png',
    'x_analytics.png',
  ]) {
    assert.ok(videoManifest.includes(asset), `video suite manifest missing asset ${asset}`);
  }

  assert.ok(launchChecklist.includes('npm run release:video-suite -- --format json'));
  assert.ok(hypergrowth.includes('Pick final video cuts, upload after approval, and attach public URLs'));
  assert.strictEqual(packageJson.scripts['release:video-suite'], 'node scripts/release-video-suite.js');
  assert.ok(packageJson.files.includes('scripts/release-video-suite.js'));
});

test('partner sponsor talks pack gates the hypergrowth outbound lane', () => {
  const partnerPack = read('docs/releases/2.0.0-rc.1/partner-sponsor-talks-pack.md');
  const manifest = read('docs/releases/2.0.0-rc.1/preview-pack-manifest.md');
  const releaseNotes = read('docs/releases/2.0.0-rc.1/release-notes.md');
  const launchChecklist = read('docs/releases/2.0.0-rc.1/launch-checklist.md');
  const hypergrowth = read('docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');

  for (const marker of [
    'Partner, Sponsor, and Talks Pack',
    '$1,728/mo',
    '$10,000/mo',
    '$8,272/mo',
    'Pilot sponsor',
    'Business sponsor',
    'Strategic partner',
    'Consulting sprint',
    'Talk or podcast',
    'Sponsor Outbound',
    'Platform Partner DM',
    'Consulting Intro',
    'Talk And Podcast Pitch',
    'GitHub Discussion Announcement',
    'Video CTA Hooks',
    'Do Not Send Or Publish If',
    'The user has not approved outbound sponsor, partner, consulting, or media',
  ]) {
    assert.ok(partnerPack.includes(marker), `partner pack missing ${marker}`);
  }

  assert.ok(partnerPack.includes('SPONSORS.md'));
  assert.ok(partnerPack.includes('SPONSORING.md'));
  assert.ok(manifest.includes('partner-sponsor-talks-pack.md'));
  assert.ok(releaseNotes.includes('partner/sponsor/talk outreach'));
  assert.ok(launchChecklist.includes('partner-sponsor-talks-pack.md'));
  assert.ok(hypergrowth.includes('partner-sponsor-talks-pack.md'));
});

test('release video suite public docs do not expose private media paths', () => {
  const releaseVideoDocs = [
    'docs/releases/2.0.0-rc.1/video-suite-production.md',
    'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md',
  ];

  const offenders = [];
  for (const relativePath of releaseVideoDocs) {
    const source = read(relativePath);
    if (/\/Users\/[A-Za-z0-9._-]+|\/home\/(?!user|runner)[A-Za-z0-9._-]+/.test(source)) {
      offenders.push(relativePath);
    }
  }

  assert.deepStrictEqual(offenders, []);
});

test('publication readiness checklist gates public release actions on evidence', () => {
  const source = read('docs/releases/2.0.0-rc.1/publication-readiness.md');
  const may15Evidence = read('docs/releases/2.0.0-rc.1/publication-evidence-2026-05-15.md');
  const discussionPlaybook = read('docs/architecture/discussion-response-playbook.md');

  for (const section of [
    '## Release Identity Matrix',
    '## Publication Gates',
    '## Required Command Evidence',
    '## Do Not Publish If',
    '## Announcement Order',
  ]) {
    assert.ok(source.includes(section), `publication readiness missing ${section}`);
  }

  for (const field of [
    'Fresh check',
    'Evidence artifact',
    'Owner',
    'Status',
    'Blocker field',
    'Recorded output',
  ]) {
    assert.ok(source.includes(field), `publication readiness missing ${field}`);
  }

  for (const surface of [
    'GitHub release',
    'npm package',
    'Claude plugin',
    'Codex plugin',
    'Codex repo marketplace',
    'OpenCode package',
    'ECC Tools billing reference',
    'Announcement copy',
  ]) {
    assert.ok(source.includes(surface), `publication readiness missing ${surface}`);
  }

  assert.ok(source.includes('publication-evidence-2026-05-15.md'));
  assert.ok(source.includes('Preview-pack smoke'));
  assert.ok(source.includes('npm run preview-pack:smoke'));
  assert.ok(may15Evidence.includes('PR #1921'));
  assert.ok(may15Evidence.includes('PR #1933'));
  assert.ok(may15Evidence.includes('PR #1934'));
  assert.ok(may15Evidence.includes('PR #1935'));
  assert.ok(may15Evidence.includes('AgentShield PR #83'));
  assert.ok(may15Evidence.includes('AgentShield PR #85'));
  assert.ok(may15Evidence.includes('AgentShield PR #86'));
  assert.ok(may15Evidence.includes('ci-context.json'));
  assert.ok(may15Evidence.includes('ECC Tools PR #73'));
  assert.ok(may15Evidence.includes('ECC-Tools PR #75'));
  assert.ok(may15Evidence.includes('| Platform audit |'));
  assert.ok(may15Evidence.includes('Ready; open PRs 0/20'));
  assert.ok(may15Evidence.includes('passed 15/15'));
  assert.ok(may15Evidence.includes('restore-only'));
  assert.ok(may15Evidence.includes('462/462'));
  assert.ok(may15Evidence.includes('## Codex Marketplace Evidence'));
  assert.ok(may15Evidence.includes('codex plugin marketplace add <local-checkout>'));
  assert.ok(may15Evidence.includes('Plugin Directory publishing is still blocked'));
  assert.ok(may15Evidence.includes('announcementGate.ready === true'));
  assert.ok(source.includes('ECC-Tools #73 added announcementGate'));
  assert.ok(source.includes('do not claim official Plugin Directory listing before OpenAI submission evidence'));
  assert.ok(source.includes('release-name-plugin-publication-checklist-2026-05-18.md'));
  assert.ok(source.includes('Release name and plugin publication checklist'));
  assert.ok(may15Evidence.includes('| Trunk discussions | GraphQL discussion count and maintainer-touch sweep | 58 total discussions;'));
  assert.ok(source.includes('platform audit sampled 58 trunk discussions'));
  assert.ok(source.includes('0 needing maintainer touch'));
  assert.ok(source.includes('discussion-response-playbook.md'));
  for (const expected of [
    'Public Support',
    'Maintainer Coordination',
    'Stale Or Concluded',
    'Release Announcement',
    'Security Escalation',
    'classified as informational',
  ]) {
    assert.ok(discussionPlaybook.includes(expected), `discussion playbook missing ${expected}`);
  }
  assert.ok(may15Evidence.includes('env -u GITHUB_TOKEN'));
  assert.ok(may15Evidence.includes('ITO-44'));
  assert.ok(may15Evidence.includes('0 open PRs, 0 open issues'));
});

test('release name and plugin publication checklist freezes rc.1 surfaces', () => {
  const checklist = read(
    'docs/releases/2.0.0-rc.1/release-name-plugin-publication-checklist-2026-05-18.md'
  );
  const launchChecklist = read('docs/releases/2.0.0-rc.1/launch-checklist.md');
  const referenceArchitecture = read('docs/ECC-2.0-REFERENCE-ARCHITECTURE.md');

  for (const value of [
    'Ship `v2.0.0-rc.1` as **ECC**',
    '`affaan-m/ECC`',
    '`ecc-universal`',
    '`ecc` on npm is occupied',
    '`@affaan-m/ecc` is unclaimed on npm',
    'Claude plugin',
    'Codex plugin',
    'do not claim official directory listing until OpenAI publishing path is available',
    'Do not rename the npm package until rc.1 is published',
    'Do not announce billing, Marketplace, or native payments',
  ]) {
    assert.ok(checklist.includes(value), `release name/plugin checklist missing ${value}`);
  }

  for (const command of [
    'claude plugin validate .claude-plugin/plugin.json',
    'claude plugin tag .claude-plugin --dry-run',
    'codex plugin marketplace add --help',
    'npm publish --tag next --dry-run',
    'npm run preview-pack:smoke',
  ]) {
    assert.ok(checklist.includes(command), `release name/plugin checklist missing command ${command}`);
  }

  assert.ok(launchChecklist.includes('release-name-plugin-publication-checklist-2026-05-18.md'));
  assert.ok(referenceArchitecture.includes('Keep the release/name/plugin publication checklist current'));
});

test('active release identity surfaces use canonical ECC repo URLs', () => {
  const activeFiles = [
    'README.md',
    '.codex-plugin/README.md',
    '.codex-plugin/plugin.json',
    '.opencode/README.md',
    '.opencode/package.json',
    'docs/business/metrics-and-sponsorship.md',
    'docs/releases/2.0.0-rc.1/quickstart.md',
    'docs/releases/2.0.0-rc.1/x-thread.md',
    'docs/releases/2.0.0-rc.1/publication-readiness.md',
    'docs/releases/2.0.0-rc.1/naming-and-publication-matrix.md',
    'docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-19.md',
    'ecc2/Cargo.toml',
    'scripts/platform-audit.js',
    'scripts/discussion-audit.js',
  ];

  const offenders = [];
  for (const relativePath of activeFiles) {
    const source = read(relativePath);
    if (source.includes('affaan-m/everything-claude-code')) {
      offenders.push(relativePath);
    }
  }

  assert.deepStrictEqual(offenders, []);
});

test('release checklist and roadmap link to publication readiness evidence gate', () => {
  const launchChecklist = read('docs/releases/2.0.0-rc.1/launch-checklist.md');
  const roadmap = read('docs/ECC-2.0-GA-ROADMAP.md');

  assert.ok(launchChecklist.includes('publication-readiness.md'));
  assert.ok(launchChecklist.includes('fresh evidence'));
  assert.ok(roadmap.includes('docs/releases/2.0.0-rc.1/publication-readiness.md'));
  assert.ok(roadmap.includes('npm dist-tag'));
});

test('localized changelogs include rc.1 and 1.10.0 release entries', () => {
  for (const relativePath of ['docs/tr/CHANGELOG.md', 'docs/zh-CN/CHANGELOG.md']) {
    const source = read(relativePath);
    assert.ok(source.includes('## 2.0.0-rc.1 - 2026-04-28'), `${relativePath} missing rc.1 entry`);
    assert.ok(source.includes('## 1.10.0 - 2026-04-05'), `${relativePath} missing 1.10.0 entry`);
  }
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
