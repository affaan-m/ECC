'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'release-approval-gate.js');
const {
  REQUIRED_DECISIONS,
  REQUIRED_URL_SURFACES,
  buildReport,
  parseArgs,
  renderText,
} = require(SCRIPT);

const CURRENT_RELEASE = require(path.join(__dirname, '..', '..', 'package.json')).version;
const RC_RELEASE = '2.0.0-rc.1';

function releaseDirFor(release) {
  return `docs/releases/${release}`;
}

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

function approvedPacketContent(overrides = {}, release = CURRENT_RELEASE) {
  const decisions = new Map(REQUIRED_DECISIONS.map(decision => [decision.label, 'approve']));
  for (const [label, value] of Object.entries(overrides)) {
    decisions.set(label, value);
  }

  return [
    `# ECC v${release} Owner Approval Packet`,
    '',
    '## Decision Register',
    '',
    '| Decision | Approve / defer / block | Evidence required first | Notes |',
    '| --- | --- | --- | --- |',
    ...REQUIRED_DECISIONS.map(decision => (
      `| ${decision.label} | ${decisions.get(decision.label)} | final evidence | approved fixture |`
    )),
    '',
    '## Final Evidence Commands',
    '',
    '```bash',
    'npm run release:approval-gate -- --format json',
    '```',
    '',
    'No outbound email, personal-account post, package publish, plugin tag, or billing announcement is authorized by this packet alone.',
  ].join('\n');
}

function finalLedgerContent(extra = '', release = CURRENT_RELEASE) {
  return [
    `# ECC v${release} Release URL Ledger`,
    '',
    '## Final Published URLs',
    '',
    '| Surface | URL | Verification |',
    '| --- | --- | --- |',
    ...REQUIRED_URL_SURFACES.map(surface => (
      `| ${surface.label} | ${surface.exampleUrl.split(RC_RELEASE).join(release)} | readback from final release commit |`
    )),
    '',
    '## Final Verification Commands',
    '',
    '```bash',
    'npm run release:approval-gate -- --format json',
    '```',
    '',
    extra,
  ].join('\n');
}

function manifestContent(release = CURRENT_RELEASE) {
  return [
    `# ECC v${release} Preview Pack Manifest`,
    '',
    '| Artifact | Role | Gate |',
    '| --- | --- | --- |',
    '| `scripts/release-approval-gate.js` | Final owner approval and live URL gate | Verified by `npm run release:approval-gate -- --format json` |',
    '',
    '## Final Verification Commands',
    '',
    '```bash',
    'npm run release:approval-gate -- --format json',
    '```',
  ].join('\n');
}

function seedRepo(rootDir, overrides = {}, options = {}) {
  const release = options.release || CURRENT_RELEASE;
  const releaseDir = releaseDirFor(release);
  const files = {
    'package.json': JSON.stringify({
      version: release,
      files: ['scripts/release-approval-gate.js'],
      scripts: {
        'release:approval-gate': 'node scripts/release-approval-gate.js',
      },
    }, null, 2),
    'scripts/release-approval-gate.js': 'release approval gate script',
    [`${releaseDir}/owner-approval-packet-2026-05-19.md`]: approvedPacketContent({}, release),
    [`${releaseDir}/release-url-ledger-2026-05-19.md`]: finalLedgerContent('', release),
    [`${releaseDir}/preview-pack-manifest.md`]: manifestContent(release),
    [`${releaseDir}/release-notes.md`]: 'Release notes with final URLs.',
    [`${releaseDir}/x-thread.md`]: 'X post with final URLs.',
    [`${releaseDir}/linkedin-post.md`]: 'LinkedIn post with final URLs.',
    [`${releaseDir}/article-outline.md`]: 'Article outline with final URLs.',
    [`${releaseDir}/partner-sponsor-talks-pack.md`]: 'Outbound copy with final URLs.',
    'docs/business/social-launch-copy.md': 'Business launch copy with final URLs.',
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
    timeout: 10000,
  });
}

function runProcess(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
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
  console.log('\n=== Testing release-approval-gate.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts approval gate flags and rejects invalid values', () => {
    const rootDir = createTempDir('release-approval-args-');

    try {
      const parsed = parseArgs([
        'node',
        'script',
        '--format=json',
        `--root=${rootDir}`,
      ]);

      assert.strictEqual(parsed.format, 'json');
      assert.strictEqual(parsed.root, path.resolve(rootDir));
      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format/);
      assert.throws(() => parseArgs(['node', 'script', '--root']), /--root requires a value/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument/);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('seeded approved release passes every publication approval check', () => {
    const rootDir = createTempDir('release-approval-pass-');

    try {
      seedRepo(rootDir);
      const report = buildReport({ root: rootDir });

      assert.strictEqual(report.schema_version, 'ecc.release-approval-gate.v1');
      assert.strictEqual(report.release, CURRENT_RELEASE);
      assert.strictEqual(report.ready, true);
      assert.strictEqual(report.summary.failed, 0);
      assert.deepStrictEqual(report.top_actions, []);
      assert.ok(report.checks.every(check => check.status === 'pass'));

      const text = renderText(report);
      assert.ok(text.includes('Ready: yes'));
      assert.ok(text.includes('Failed: 0'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('release override keeps rc.1 approval fixtures testable', () => {
    const rootDir = createTempDir('release-approval-rc-');

    try {
      seedRepo(rootDir, {}, { release: RC_RELEASE });
      const report = buildReport({ root: rootDir, release: RC_RELEASE });

      assert.strictEqual(report.release, RC_RELEASE);
      assert.strictEqual(report.ready, true);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('deferred owner decisions keep the publication gate blocked', () => {
    const rootDir = createTempDir('release-approval-deferred-');

    try {
      const releaseDir = releaseDirFor(CURRENT_RELEASE);
      seedRepo(rootDir, {
        [`${releaseDir}/owner-approval-packet-2026-05-19.md`]: approvedPacketContent({
          'GitHub prerelease': 'defer',
          'Sponsor, partner, consulting, conference, podcast outreach': 'block',
        }),
      });

      const report = buildReport({ root: rootDir });
      const decisions = report.checks.find(check => check.id === 'owner-decisions-approved');

      assert.strictEqual(report.ready, false);
      assert.strictEqual(decisions.status, 'fail');
      assert.ok(decisions.evidence.includes('GitHub prerelease=defer'));
      assert.ok(decisions.evidence.includes('Sponsor, partner, consulting, conference, podcast outreach=block'));
      assert.ok(report.top_actions.some(action => action.includes('Approve, defer, or block')));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('approval-gated URL ledger rows keep the publication gate blocked', () => {
    const rootDir = createTempDir('release-approval-ledger-');

    try {
      const releaseDir = releaseDirFor(CURRENT_RELEASE);
      seedRepo(rootDir, {
        [`${releaseDir}/release-url-ledger-2026-05-19.md`]: [
          `# ECC v${CURRENT_RELEASE} Release URL Ledger`,
          '',
          '## Approval-Gated URLs',
          '',
          '| Surface | Intended URL or command | Gate before use |',
          '| --- | --- | --- |',
          `| GitHub prerelease | https://github.com/affaan-m/ECC/releases/tag/v${CURRENT_RELEASE} | must return the prerelease |`,
        ].join('\n'),
      });

      const report = buildReport({ root: rootDir });
      const ledger = report.checks.find(check => check.id === 'release-url-ledger-finalized');

      assert.strictEqual(report.ready, false);
      assert.strictEqual(ledger.status, 'fail');
      assert.ok(ledger.evidence.includes('approval-gated URL section still present'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('announcement drafts fail on unresolved placeholders and private paths', () => {
    const rootDir = createTempDir('release-approval-copy-');

    try {
      const releaseDir = releaseDirFor(CURRENT_RELEASE);
      seedRepo(rootDir, {
        [`${releaseDir}/x-thread.md`]: 'Ship copy with <video-url> and /Users/affaan/raw-footage.',
      });

      const report = buildReport({ root: rootDir });
      const copy = report.checks.find(check => check.id === 'announcement-copy-finalized');

      assert.strictEqual(report.ready, false);
      assert.strictEqual(copy.status, 'fail');
      assert.ok(copy.evidence.includes(`${releaseDir}/x-thread.md:1`));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('CLI emits json and uses status 2 for blocked approval reports', () => {
    const rootDir = createTempDir('release-approval-cli-');

    try {
      seedRepo(rootDir);
      const stdout = run(['--format=json', `--root=${rootDir}`], { cwd: rootDir });
      const parsed = JSON.parse(stdout);
      assert.strictEqual(parsed.ready, true);
      assert.strictEqual(parsed.release, CURRENT_RELEASE);

      const releaseDir = releaseDirFor(CURRENT_RELEASE);
      writeFile(
        rootDir,
        `${releaseDir}/owner-approval-packet-2026-05-19.md`,
        approvedPacketContent({ 'Video upload': 'defer' })
      );
      const failedRun = runProcess(['--format=json', `--root=${rootDir}`], { cwd: rootDir });
      assert.strictEqual(failedRun.status, 2);
      assert.strictEqual(failedRun.stderr, '');
      assert.ok(failedRun.stdout.includes('"ready": false'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('CLI help exits successfully and invalid flags fail before reporting', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.strictEqual(help.stderr, '');
    assert.ok(help.stdout.includes('Usage: node scripts/release-approval-gate.js'));

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
