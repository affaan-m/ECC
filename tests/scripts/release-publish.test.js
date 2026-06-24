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
  });

  test(`${workflow} publishes new tag versions to npm`, () => {
    assert.match(content, /npm publish "\$\{\{ needs\.verify\.outputs\.package_file \}\}" --access public --provenance/);
    assert.match(content, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  });

  test(`${workflow} creates the GitHub Release before publishing to npm`, () => {
    const releaseIndex = content.indexOf('name: Create GitHub Release');
    const publishIndex = content.indexOf('name: Publish npm package');

    assert.ok(releaseIndex >= 0, `${workflow} should create a GitHub Release`);
    assert.ok(publishIndex >= 0, `${workflow} should publish the npm package`);
    assert.ok(
      releaseIndex < publishIndex,
      `${workflow} should not publish to npm until GitHub Release creation has succeeded`
    );
  });
}

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
