'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

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

function load(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

console.log('\n=== Testing release publish workflow ===\n');

for (const workflow of [
  '.github/workflows/release.yml',
  '.github/workflows/reusable-release.yml',
]) {
  const content = load(workflow);
  const jobsIndex = content.search(/^jobs:\s*$/m);
  const workflowHeader = jobsIndex >= 0 ? content.slice(0, jobsIndex) : content;

  test(`${workflow} scopes id-token to the publish job for npm provenance`, () => {
    assert.doesNotMatch(workflowHeader, /id-token:\s*write/);
    assert.match(content, /\n\s+permissions:\n\s+contents:\s*write\n\s+id-token:\s*write/m);
  });

  test(`${workflow} configures the npm registry`, () => {
    assert.match(content, /registry-url:\s*['"]https:\/\/registry\.npmjs\.org['"]/);
  });

  test(`${workflow} ignores dependency lifecycle scripts before privileged publish`, () => {
    assert.match(content, /npm ci --ignore-scripts/);
  });

  test(`${workflow} checks whether the tagged npm version already exists`, () => {
    assert.match(content, /Check npm publish state/);
    assert.match(content, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/);
    assert.match(content, /E404/);
    assert.match(content, /npm registry lookup failed/i);
  });

  test(`${workflow} requires the release commit to equal origin main`, () => {
    assert.match(content, /git fetch origin main --no-tags/);
    assert.match(content, /git rev-parse origin\/main/);
    assert.match(content, /release commit.*origin\/main/i);
  });

  test(`${workflow} selects reviewed release notes from the release version`, () => {
    assert.match(content, /RELEASE_VERSION="\$\{RELEASE_TAG#v\}"/);
    assert.match(content, /docs\/releases\/\$\{RELEASE_VERSION\}\/release-notes\.md/);
  });

  test(`${workflow} publishes only the reviewed release notes`, () => {
    assert.match(content, /body_path:\s*release_body\.md[\s\S]{0,160}generate_release_notes:\s*false/);
    assert.doesNotMatch(content, /generate_release_notes:\s*(?:true|\$\{\{)/);
  });

  test(`${workflow} publishes new tag versions to npm`, () => {
    assert.match(content, /ECC_RELEASE_PACKAGE:\s*\$\{\{ needs\.verify\.outputs\.package_file \}\}/);
    assert.match(content, /npm publish "\.\/\$\{ECC_RELEASE_PACKAGE\}" --access public --provenance/);
    assert.match(content, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  });

  test(`${workflow} stages stable npm versions before changing latest`, () => {
    assert.match(content, /publish_tag:\s*\$\{\{ steps\.npm_publish_state\.outputs\.publish_tag \}\}/);
    assert.match(content, /version\.includes\('-'\) \? 'next' : 'staged'/);
    assert.match(content, /--tag "\$\{NPM_PUBLISH_TAG\}"/);
    assert.match(content, /npm dist-tag add "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" "\$\{NPM_DIST_TAG\}"/);
  });

  test(`${workflow} verifies registry bytes before promoting the final dist-tag`, () => {
    const publishIndex = content.indexOf('name: Publish npm package');
    const verifyIndex = content.indexOf('name: Verify published npm artifact');
    const promoteIndex = content.indexOf('name: Promote verified npm version');
    const releaseIndex = content.indexOf('name: Create GitHub Release');

    assert.ok(publishIndex >= 0, 'missing npm publish step');
    assert.ok(verifyIndex > publishIndex, 'registry verification must follow npm publish');
    assert.ok(promoteIndex > verifyIndex, 'dist-tag promotion must follow registry verification');
    assert.ok(releaseIndex > promoteIndex, 'GitHub Release must follow npm promotion');
    assert.match(content, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" dist\.integrity/);
    assert.match(content, /Published npm artifact does not match tested candidate/);
  });

  test(`${workflow} publishes to npm before creating the GitHub Release`, () => {
    const releaseIndex = content.indexOf('name: Create GitHub Release');
    const publishIndex = content.indexOf('name: Publish npm package');

    assert.ok(releaseIndex >= 0, `${workflow} should create a GitHub Release`);
    assert.ok(publishIndex >= 0, `${workflow} should publish the npm package`);
    assert.ok(
      publishIndex < releaseIndex,
      `${workflow} should publish the verified package before creating the GitHub Release`
    );
  });
}

test('reusable release workflow has no generated-notes input', () => {
  assert.doesNotMatch(load('.github/workflows/reusable-release.yml'), /generate-notes:/);
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
