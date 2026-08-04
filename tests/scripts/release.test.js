/**
 * Source-level tests for scripts/release.sh
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'release.sh');
const source = fs.readFileSync(scriptPath, 'utf8');
const releaseWorkflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
const reusableReleaseWorkflowPath = path.join(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'reusable-release.yml'
);
const ciWorkflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
const releaseWorkflowSource = fs.readFileSync(releaseWorkflowPath, 'utf8');
const reusableReleaseWorkflowSource = fs.readFileSync(reusableReleaseWorkflowPath, 'utf8');
const ciWorkflowSource = fs.readFileSync(ciWorkflowPath, 'utf8');
const normalizedCiWorkflowSource = ciWorkflowSource.replace(/\r\n/g, '\n');

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
  console.log('\n=== Testing release.sh ===\n');

  let passed = 0;
  let failed = 0;

  if (test('release script rejects untracked files when checking cleanliness', () => {
    assert.ok(
      source.includes('git status --porcelain --untracked-files=all'),
      'release.sh should use git status --porcelain --untracked-files=all for cleanliness checks'
    );
  })) passed++; else failed++;

  if (test('release script reruns release metadata sync validation before commit/tag', () => {
    const syncCheckIndex = source.lastIndexOf('node tests/plugin-manifest.test.js');
    const commitIndex = source.indexOf('git commit -m "chore: bump plugin version to $VERSION"');

    assert.ok(syncCheckIndex >= 0, 'release.sh should run plugin-manifest.test.js');
    assert.ok(commitIndex >= 0, 'release.sh should create the release commit');
    assert.ok(
      syncCheckIndex < commitIndex,
      'plugin-manifest.test.js should run before the release commit is created'
    );
  })) passed++; else failed++;

  if (test('release script verifies npm pack payload after version updates and before commit/tag', () => {
    const updateIndex = source.indexOf('update_version "$ROOT_PACKAGE_JSON"');
    const packCheckIndex = source.indexOf('node tests/scripts/build-opencode.test.js');
    const commitIndex = source.indexOf('git commit -m "chore: bump plugin version to $VERSION"');

    assert.ok(updateIndex >= 0, 'release.sh should update package version fields');
    assert.ok(packCheckIndex >= 0, 'release.sh should run build-opencode.test.js');
    assert.ok(commitIndex >= 0, 'release.sh should create the release commit');
    assert.ok(
      updateIndex < packCheckIndex,
      'build-opencode.test.js should run after versioned files are updated'
    );
    assert.ok(
      packCheckIndex < commitIndex,
      'build-opencode.test.js should run before the release commit is created'
    );
  })) passed++; else failed++;

  if (test('release script supports prerelease semver and release heading sync', () => {
    assert.ok(
      source.includes('2.0.0-rc.1'),
      'release.sh should document an accepted prerelease semver example'
    );
    assert.ok(
      source.includes('(-[0-9A-Za-z.-]+)?'),
      'release.sh should allow prerelease semver suffixes'
    );
    assert.ok(
      source.includes('update_latest_release_heading "$ROOT_ZH_CN_README_FILE"'),
      'release.sh should update localized latest-release headings that plugin-manifest.test.js verifies'
    );
  })) passed++; else failed++;

  if (test('release workflows mark prerelease tags as GitHub prereleases', () => {
    assert.ok(
      releaseWorkflowSource.includes('prerelease: ${{ contains(github.ref_name, \'-\') }}'),
      'release.yml should mark hyphenated tag pushes as GitHub prereleases'
    );
    assert.ok(
      releaseWorkflowSource.includes('make_latest: ${{ contains(github.ref_name, \'-\') && \'false\' || \'true\' }}'),
      'release.yml should avoid making hyphenated prereleases the latest GitHub release'
    );
    assert.ok(
      reusableReleaseWorkflowSource.includes('prerelease: ${{ contains(inputs.tag, \'-\') }}'),
      'reusable-release.yml should mark hyphenated manual tags as GitHub prereleases'
    );
    assert.ok(
      reusableReleaseWorkflowSource.includes('make_latest: ${{ contains(inputs.tag, \'-\') && \'false\' || \'true\' }}'),
      'reusable-release.yml should avoid making hyphenated prereleases the latest GitHub release'
    );
  })) passed++; else failed++;

  if (test('reusable release checks out the requested tag before validating and publishing', () => {
    const checkoutIndex = reusableReleaseWorkflowSource.indexOf('uses: actions/checkout@');
    const refIndex = reusableReleaseWorkflowSource.indexOf('ref: ${{ inputs.tag }}');
    const validateIndex = reusableReleaseWorkflowSource.indexOf('name: Validate version tag');

    assert.ok(checkoutIndex >= 0, 'reusable-release.yml should check out repository content');
    assert.ok(refIndex >= 0, 'reusable-release.yml checkout should use inputs.tag as ref');
    assert.ok(validateIndex >= 0, 'reusable-release.yml should validate requested tag');
    assert.ok(
      checkoutIndex < refIndex && refIndex < validateIndex,
      'reusable release should check out inputs.tag before tag validation and publish steps'
    );
  })) passed++; else failed++;

  if (test('CI runs for release branches and version tags before release workflows execute', () => {
    const pushBlockMatch = normalizedCiWorkflowSource.match(/on:\n\s+push:\n([\s\S]*?)\n\s+pull_request:/);
    const pushBlock = pushBlockMatch ? pushBlockMatch[1] : '';

    assert.ok(pushBlock, 'ci.yml should define a push trigger block');
    assert.match(
      pushBlock,
      /branches:\s*\[[^\]]*main[^\]]*['"]release\/\*\*['"][^\]]*\]/,
      'ci.yml push branches should include release/**'
    );
    assert.match(
      pushBlock,
      /tags:\s*\[[^\]]*['"]v\*['"][^\]]*\]/,
      'ci.yml push tags should include v*'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
