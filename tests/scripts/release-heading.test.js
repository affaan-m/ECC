/**
 * Behavioral regression tests for release.sh's update_latest_release_heading.
 *
 * tests/scripts/release.test.js only greps release.sh for the call sites, and
 * tests/plugin-manifest.test.js only checks the headings that are committed
 * right now. Neither one executes the rewrite, so a regression that made the
 * helper silently no-op on a missing heading would ship green. This file runs
 * the real embedded program against fixtures and pins the fail-closed contract.
 *
 * Runs standalone: node tests/scripts/release-heading.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'release.sh');
const source = fs.readFileSync(scriptPath, 'utf8');

/**
 * Pull the node program out of the shell function so the test exercises the
 * exact code release.sh ships rather than a copy that can drift from it.
 */
function extractHeadingProgram() {
  const match = source.match(
    /update_latest_release_heading\(\)\s*\{[\s\S]*?node -e '([\s\S]*?)'\s*"\$file"/
  );
  assert.ok(
    match,
    'release.sh should define update_latest_release_heading as a node -e program taking "$file"'
  );
  return match[1];
}

const headingProgram = extractHeadingProgram();

function runHeadingUpdate(contents, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-release-heading-'));
  const file = path.join(dir, 'README.md');
  try {
    fs.writeFileSync(file, contents);
    // release.sh passes the previous version as the helper's third argument.
    // Derive it from the fixture so this harness exercises the real call shape;
    // keep a deterministic value for fixtures intentionally missing a heading.
    const oldVersion = contents.match(/^### v([^ ]+)/m)?.[1] || '2.0.0';
    const result = spawnSync(process.execPath, ['-e', headingProgram, file, version, oldVersion], {
      encoding: 'utf8',
    });
    return {
      status: result.status,
      stderr: result.stderr || '',
      contents: fs.readFileSync(file, 'utf8'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing release.sh latest-release heading sync ===\n');

  let passed = 0;
  let failed = 0;

  if (test('rewrites a stable release heading and leaves the rest of the file intact', () => {
    const before = '# Title\n\n### v2.0.0 — Highlights\n\nBody text with v2.0.0 left alone.\n';
    const result = runHeadingUpdate(before, '2.1.0');

    assert.strictEqual(result.status, 0, `expected success, got stderr: ${result.stderr}`);
    assert.ok(
      result.contents.includes('### v2.1.0 — Highlights'),
      'heading should be bumped to the new version and keep its trailing text'
    );
    assert.ok(
      result.contents.includes('Body text with v2.0.0 left alone.'),
      'only the heading line should be rewritten'
    );
  })) passed++; else failed++;

  if (test('rewrites a prerelease heading', () => {
    const result = runHeadingUpdate('### v2.0.0-rc.1 — Preview\n', '2.0.0-rc.2');

    assert.strictEqual(result.status, 0, `expected success, got stderr: ${result.stderr}`);
    assert.ok(
      result.contents.includes('### v2.0.0-rc.2 — Preview'),
      'prerelease headings should be bumped like stable ones'
    );
  })) passed++; else failed++;

  if (test('fails closed and does not write when the release heading is missing', () => {
    const before = '# Title\n\nNo release heading anywhere in this document.\n';
    const result = runHeadingUpdate(before, '2.1.0');

    assert.notStrictEqual(result.status, 0, 'a missing heading must be a hard failure');
    assert.match(
      result.stderr,
      /could not update release heading/i,
      'the failure should name the unmet expectation'
    );
    assert.strictEqual(
      result.contents,
      before,
      'a failed heading update must leave the file byte-identical'
    );
  })) passed++; else failed++;

  if (test('fails closed when the heading has no trailing description', () => {
    // The regex requires a space plus trailing text, so a bare "### v2.0.0"
    // is not a match. That must surface as an error, not a silent skip.
    const before = '### v2.0.0\n';
    const result = runHeadingUpdate(before, '2.1.0');

    assert.notStrictEqual(result.status, 0, 'a bare heading is not a supported match');
    assert.strictEqual(result.contents, before, 'nothing should be written on failure');
  })) passed++; else failed++;

  if (test('every localized README with a release heading is bumped by release.sh', () => {
    // docs/zh-CN/README.md regressed once because it got a version-row bump
    // without a heading bump. Pin all five call sites so a dropped one fails
    // here instead of during a release.
    const requiredFileVariables = [
      'README_FILE',
      'ROOT_ZH_CN_README_FILE',
      'TR_README_FILE',
      'PT_BR_README_FILE',
      'ZH_CN_README_FILE',
    ];

    for (const variable of requiredFileVariables) {
      assert.ok(
        source.includes(`update_latest_release_heading "$${variable}"`),
        `release.sh should update the latest release heading for $${variable}`
      );
    }
  })) passed++; else failed++;

  if (test('heading updates run before the release commit is created', () => {
    const lastHeadingUpdate = source.lastIndexOf('update_latest_release_heading "$');
    const commitIndex = source.indexOf('git commit -m "chore: bump plugin version to $VERSION"');

    assert.ok(lastHeadingUpdate >= 0, 'release.sh should update release headings');
    assert.ok(commitIndex >= 0, 'release.sh should create the release commit');
    assert.ok(
      lastHeadingUpdate < commitIndex,
      'heading updates should happen before the release commit'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
