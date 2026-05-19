/**
 * Tests for scripts/release-video-suite.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'release-video-suite.js');
const {
  REQUIRED_PUBLISH_CANDIDATES,
  REQUIRED_SOURCE_ASSETS,
  REQUIRED_SUITE_ARTIFACTS,
  buildReport,
  parseArgs,
  renderText,
  summarizeReport,
} = require(SCRIPT);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(rootDir, relativePath, content = 'fixture') {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function seedRepo(rootDir, overrides = {}) {
  const files = {
    'package.json': JSON.stringify({
      name: 'ecc-universal',
      files: ['scripts/release-video-suite.js'],
      scripts: {
        'release:video-suite': 'node scripts/release-video-suite.js',
      },
    }, null, 2),
    'docs/releases/2.0.0-rc.1/video-suite-production.md': [
      '# ECC 2.0 Video Suite Production Manifest',
      'ECC_VIDEO_SOURCE_ROOT',
      'ECC_VIDEO_RELEASE_SUITE_ROOT',
      'Primary launch video',
      'video-use compatible workflow',
      'Self-Eval Gate',
      'Do Not Publish If',
      'Do not commit raw footage, transcript JSON, or timeline exports',
    ].join('\n'),
    'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md': [
      'Keep raw absolute paths out of public docs',
      'Validate `video-suite-production.md`',
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/preview-pack-manifest.md': 'video-suite-production.md',
    'docs/releases/2.0.0-rc.1/launch-checklist.md': 'release video suite',
  };

  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) {
      continue;
    }
    writeFile(rootDir, relativePath, content);
  }
}

function seedMedia(sourceRoot, suiteRoot) {
  for (const asset of REQUIRED_SOURCE_ASSETS) {
    writeFile(sourceRoot, asset.file, `source ${asset.id}`);
  }

  for (const artifact of REQUIRED_SUITE_ARTIFACTS) {
    writeFile(suiteRoot, artifact.relativePath, `artifact ${artifact.id}`);
  }

  for (const candidate of REQUIRED_PUBLISH_CANDIDATES) {
    writeFile(suiteRoot, candidate.relativePath, `candidate ${candidate.id}`);
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
  console.log('\n=== Testing release-video-suite.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts release video flags and rejects invalid values', () => {
    const rootDir = createTempDir('release-video-args-');
    const sourceRoot = createTempDir('release-video-source-');
    const suiteRoot = createTempDir('release-video-suite-');

    try {
      const parsed = parseArgs([
        'node',
        'script',
        '--json',
        `--root=${rootDir}`,
        '--source-root',
        sourceRoot,
        `--suite-root=${suiteRoot}`,
        '--skip-probe',
        '--summary',
      ]);

      assert.strictEqual(parsed.format, 'json');
      assert.strictEqual(parsed.root, path.resolve(rootDir));
      assert.strictEqual(parsed.sourceRoot, path.resolve(sourceRoot));
      assert.strictEqual(parsed.suiteRoot, path.resolve(suiteRoot));
      assert.strictEqual(parsed.skipProbe, true);
      assert.strictEqual(parsed.summary, true);

      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format/);
      assert.throws(() => parseArgs(['node', 'script', '--source-root']), /--source-root requires a value/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument/);
    } finally {
      cleanup(rootDir);
      cleanup(sourceRoot);
      cleanup(suiteRoot);
    }
  })) passed++; else failed++;

  if (test('buildReport passes with a sanitized manifest and complete local media fixture', () => {
    const rootDir = createTempDir('release-video-report-');
    const sourceRoot = createTempDir('release-video-source-');
    const suiteRoot = createTempDir('release-video-suite-');

    try {
      seedRepo(rootDir);
      seedMedia(sourceRoot, suiteRoot);

      const report = buildReport({
        root: rootDir,
        sourceRoot,
        suiteRoot,
        skipProbe: true,
        generatedAt: '2026-05-19T00:00:00.000Z',
      });

      assert.strictEqual(report.schema_version, 'ecc.release-video-suite.v1');
      assert.strictEqual(report.ready, true);
      assert.strictEqual(report.mediaPathsRedacted, true);
      assert.ok(report.checks.every(check => check.status === 'pass'));
      assert.ok(report.checks.some(check => (
        check.id === 'video-primary-render-self-eval'
          && check.summary.includes('skipped by --skip-probe')
      )));
      assert.strictEqual(report.sourceAssets.length, REQUIRED_SOURCE_ASSETS.length);
      assert.strictEqual(report.suiteArtifacts.length, REQUIRED_SUITE_ARTIFACTS.length);
      assert.strictEqual(report.publishCandidates.length, REQUIRED_PUBLISH_CANDIDATES.length);
      assert.ok(renderText(report).includes('Ready: yes'));
      assert.strictEqual(summarizeReport(report).sourceAssetSummary.present, REQUIRED_SOURCE_ASSETS.length);
      assert.strictEqual(
        summarizeReport(report).publishCandidateSummary.present,
        REQUIRED_PUBLISH_CANDIDATES.length
      );
    } finally {
      cleanup(rootDir);
      cleanup(sourceRoot);
      cleanup(suiteRoot);
    }
  })) passed++; else failed++;

  if (test('publish candidate videos require visual blank-frame QA', () => {
    const publishVideos = REQUIRED_PUBLISH_CANDIDATES.filter(candidate => candidate.kind === 'video');

    assert.ok(publishVideos.length > 0);
    assert.ok(publishVideos.every(candidate => candidate.noBlackFrames === true));
  })) passed++; else failed++;

  if (test('missing local roots keep the release video gate blocked', () => {
    const rootDir = createTempDir('release-video-missing-roots-');

    try {
      seedRepo(rootDir);

      const report = buildReport({
        root: rootDir,
        skipProbe: true,
        generatedAt: '2026-05-19T00:00:00.000Z',
      });

      assert.strictEqual(report.ready, false);
      assert.ok(report.top_actions.some(action => action.includes('ECC_VIDEO_SOURCE_ROOT')));
      assert.ok(report.top_actions.some(action => action.includes('ECC_VIDEO_RELEASE_SUITE_ROOT')));
      assert.ok(report.checks.some(check => check.id === 'video-source-assets-present' && check.status === 'fail'));
      assert.ok(report.checks.some(check => check.id === 'video-release-artifacts-present' && check.status === 'fail'));
      assert.ok(report.checks.some(check => check.id === 'video-primary-render-self-eval' && check.status === 'fail'));
      assert.ok(report.checks.some(check => check.id === 'video-publish-candidates-present' && check.status === 'fail'));
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('private media paths in public docs fail sanitization', () => {
    const rootDir = createTempDir('release-video-private-path-');
    const sourceRoot = createTempDir('release-video-source-');
    const suiteRoot = createTempDir('release-video-suite-');

    try {
      seedRepo(rootDir, {
        'docs/releases/2.0.0-rc.1/video-suite-production.md': [
          '# ECC 2.0 Video Suite Production Manifest',
          'ECC_VIDEO_SOURCE_ROOT',
          'ECC_VIDEO_RELEASE_SUITE_ROOT',
          'Primary launch video',
          'video-use compatible workflow',
          'Self-Eval Gate',
          'Do Not Publish If',
          'Do not commit raw footage, transcript JSON, or timeline exports',
          '/Users/affoon/private-media',
        ].join('\n'),
      });
      seedMedia(sourceRoot, suiteRoot);

      const report = buildReport({
        root: rootDir,
        sourceRoot,
        suiteRoot,
        skipProbe: true,
        generatedAt: '2026-05-19T00:00:00.000Z',
      });

      assert.strictEqual(report.ready, false);
      assert.ok(report.checks.some(check => check.id === 'video-suite-public-sanitization' && check.status === 'fail'));
    } finally {
      cleanup(rootDir);
      cleanup(sourceRoot);
      cleanup(suiteRoot);
    }
  })) passed++; else failed++;

  if (test('CLI emits JSON and exits successfully for complete fixture', () => {
    const rootDir = createTempDir('release-video-cli-');
    const sourceRoot = createTempDir('release-video-source-');
    const suiteRoot = createTempDir('release-video-suite-');

    try {
      seedRepo(rootDir);
      seedMedia(sourceRoot, suiteRoot);

      const output = run([
        '--format=json',
        `--root=${rootDir}`,
        `--source-root=${sourceRoot}`,
        `--suite-root=${suiteRoot}`,
        '--skip-probe',
        '--summary',
      ], { cwd: rootDir });
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.ready, true);
      assert.strictEqual(parsed.sourceRootConfigured, true);
      assert.strictEqual(parsed.suiteRootConfigured, true);
      assert.strictEqual(parsed.sourceAssetSummary.present, REQUIRED_SOURCE_ASSETS.length);
      assert.strictEqual(parsed.suiteArtifactSummary.present, REQUIRED_SUITE_ARTIFACTS.length);
      assert.strictEqual(parsed.publishCandidateSummary.present, REQUIRED_PUBLISH_CANDIDATES.length);
    } finally {
      cleanup(rootDir);
      cleanup(sourceRoot);
      cleanup(suiteRoot);
    }
  })) passed++; else failed++;

  if (test('CLI exits nonzero when media roots are missing', () => {
    const rootDir = createTempDir('release-video-cli-blocked-');

    try {
      seedRepo(rootDir);

      const result = runProcess([
        '--format=json',
        `--root=${rootDir}`,
        '--skip-probe',
        '--summary',
      ], { cwd: rootDir });

      assert.strictEqual(result.status, 1);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.ready, false);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  runTests();
}
