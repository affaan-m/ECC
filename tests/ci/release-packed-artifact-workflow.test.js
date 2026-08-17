'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPaths = [
  '.github/workflows/release.yml',
  '.github/workflows/reusable-release.yml',
];
const lifecycleRunnerSource = load('tests/ci/packed-artifact-lifecycle.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function load(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function jobBlock(source, jobName, nextJobName) {
  const startMarker = `\n  ${jobName}:\n`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${jobName} job`);

  if (!nextJobName) {
    return source.slice(start);
  }

  const end = source.indexOf(`\n  ${nextJobName}:\n`, start + startMarker.length);
  assert.ok(end > start, `missing ${nextJobName} job after ${jobName}`);
  return source.slice(start, end);
}

console.log('\n=== Testing packed-artifact release workflows ===\n');

for (const workflowPath of workflowPaths) {
  const source = load(workflowPath);

  test(`${workflowPath} packs once and exports the package name and SHA-256`, () => {
    assert.strictEqual(
      (source.match(/npm pack --json/g) || []).length,
      1,
      'release workflow must pack exactly once'
    );
    assert.match(source, /package_sha256:\s*\$\{\{ steps\.pack\.outputs\.package_sha256 \}\}/);
    assert.match(source, /createHash\(['"]sha256['"]\)/);
    assert.match(source, /package_sha256=['"]? \+ digest/);
  });

  test(`${workflowPath} invokes only test files present in the release source`, () => {
    const referencedTests = [...source.matchAll(/\bnode (tests\/[A-Za-z0-9_./-]+\.js)\b/g)]
      .map(match => match[1]);
    assert.ok(referencedTests.length > 0, 'release workflow should run repository tests');
    for (const testPath of referencedTests) {
      assert.ok(fs.existsSync(path.join(repoRoot, testPath)), `missing workflow test: ${testPath}`);
    }
  });

  test(`${workflowPath} uploads the one packed tgz as the release artifact`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');
    const packIndex = verify.indexOf('name: Pack npm artifact');
    const uploadIndex = verify.indexOf('name: Upload release artifacts');

    assert.ok(packIndex >= 0, 'missing pack step');
    assert.ok(uploadIndex > packIndex, 'artifact upload must happen after pack and hash');
    assert.match(verify, /name:\s*ecc-release-artifacts/);
    assert.match(verify, /\$\{\{ steps\.pack\.outputs\.package_file \}\}/);
    assert.match(verify, /tests\/ci\/packed-artifact-lifecycle\.js/);
  });

  test(`${workflowPath} fails retries when npm already has different bytes`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');
    assert.match(verify, /name:\s*Verify existing npm artifact matches candidate/);
    assert.match(verify, /if:\s*steps\.npm_publish_state\.outputs\.already_published == 'true'/);
    assert.match(verify, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" dist\.integrity/);
    assert.match(verify, /createHash\(['"]sha512['"]\)/);
    assert.match(verify, /Existing npm artifact does not match tested candidate/);
  });

  test(`${workflowPath} verifies the same tgz on Node 20 across three operating systems`, () => {
    const lifecycle = jobBlock(source, 'lifecycle', 'publish');

    assert.match(lifecycle, /needs:\s*verify/);
    assert.match(lifecycle, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
    assert.match(lifecycle, /runs-on:\s*\$\{\{ matrix\.os \}\}/);
    assert.match(lifecycle, /node-version:\s*['"]20\.x['"]/);
    assert.match(lifecycle, /uses:\s*actions\/download-artifact@/);
    assert.match(lifecycle, /name:\s*ecc-release-artifacts/);
    assert.match(lifecycle, /ECC_RELEASE_PACKAGE:\s*release-artifacts\/\$\{\{ needs\.verify\.outputs\.package_file \}\}/);
    assert.match(lifecycle, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.verify\.outputs\.package_sha256 \}\}/);
    assert.match(lifecycle, /node release-artifacts\/tests\/ci\/packed-artifact-lifecycle\.js/);
    assert.doesNotMatch(lifecycle, /actions\/checkout@/);
    assert.doesNotMatch(lifecycle, /\bsecrets\s*:/, 'lifecycle job must not receive secrets');
    assert.doesNotMatch(lifecycle, /\$\{\{\s*secrets\./, 'lifecycle job must not reference secrets');
  });

  test(`${workflowPath} blocks publishing on packed-artifact lifecycle success`, () => {
    const publish = jobBlock(source, 'publish');

    assert.match(publish, /needs:\s*\[verify, lifecycle\]/);
    assert.match(publish, /ECC_RELEASE_PACKAGE:\s*\$\{\{ needs\.verify\.outputs\.package_file \}\}/);
    assert.match(publish, /npm publish "\.\/\$\{ECC_RELEASE_PACKAGE\}"/);
    assert.match(publish, /name:\s*Verify artifact before publish/);
    assert.match(publish, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.verify\.outputs\.package_sha256 \}\}/);
    assert.match(publish, /createHash\(['"]sha256['"]\)/);
    assert.match(publish, /ecc-universal-\[0-9A-Za-z\.\+-\]/);
    assert.ok(
      publish.indexOf('name: Verify artifact before publish')
        < publish.indexOf('name: Create GitHub Release'),
      'publish must verify the independently downloaded archive before creating the release'
    );
  });
}

test('reusable release requires its input to resolve through the tag namespace', () => {
  const source = load('.github/workflows/reusable-release.yml');
  const verify = jobBlock(source, 'verify', 'lifecycle');
  assert.match(verify, /ref:\s*refs\/tags\/\$\{\{ inputs\.tag \}\}/);
});

test('pull-request CI packs once and exports the exact installer artifact identity', () => {
  const source = load('.github/workflows/ci.yml');
  const pack = jobBlock(source, 'pack-installer', 'packed-install-lifecycle');
  assert.strictEqual((pack.match(/npm pack --json/g) || []).length, 1);
  assert.match(pack, /package_file:\s*\$\{\{ steps\.pack\.outputs\.package_file \}\}/);
  assert.match(pack, /package_sha256:\s*\$\{\{ steps\.pack\.outputs\.package_sha256 \}\}/);
  assert.match(pack, /createHash\(['"]sha256['"]\)/);
  assert.match(pack, /name:\s*ecc-ci-installer-artifact/);
});

test('pull-request CI runs the same packed installer on Linux, macOS, and Windows', () => {
  const source = load('.github/workflows/ci.yml');
  const lifecycle = jobBlock(source, 'packed-install-lifecycle', 'validate');
  assert.match(lifecycle, /needs:\s*pack-installer/);
  assert.match(lifecycle, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(lifecycle, /node-version:\s*['"]20\.x['"]/);
  assert.match(lifecycle, /name:\s*ecc-ci-installer-artifact/);
  assert.match(lifecycle, /ECC_RELEASE_PACKAGE:\s*release-artifacts\/\$\{\{ needs\.pack-installer\.outputs\.package_file \}\}/);
  assert.match(lifecycle, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.pack-installer\.outputs\.package_sha256 \}\}/);
  assert.match(lifecycle, /node tests\/ci\/packed-artifact-lifecycle\.js/);
  assert.doesNotMatch(lifecycle, /\$\{\{\s*secrets\./);
});

test('packed lifecycle invokes installed public bins, including setup help', () => {
  assert.match(lifecycleRunnerSource, /getNpmExecInvocation/);
  assert.match(lifecycleRunnerSource, /\['ecc-universal', 'setup', '--help'\]/);
  assert.match(lifecycleRunnerSource, /\['ecc', \.\.\.args\]/);
  assert.doesNotMatch(lifecycleRunnerSource, /node_modules.*scripts.*ecc\.js/);
});

test('packed lifecycle installs and verifies the opt-in Ito distribution surface', () => {
  assert.match(
    lifecycleRunnerSource,
    /'--profile', 'core'[\s\S]*'--with', 'capability:ito-compute'[\s\S]*'--with', 'capability:prediction-markets'/
  );
  for (const moduleId of ['ito-compute', 'prediction-market-skills']) {
    assert.match(lifecycleRunnerSource, new RegExp(`moduleId === '${moduleId}'`));
  }
  for (const installedPath of [
    'skills/ito-baskets/SKILL.md',
    'skills/ito-baskets/agents/openai.yaml',
    'skills/ito-baskets/scripts/ito-baskets.js',
    'skills/ito-compute/SKILL.md',
    'skills/ito-compute/agents/openai.yaml',
    'skills/ito-inference/SKILL.md',
    'skills/ito-training/SKILL.md',
  ]) {
    assert.match(lifecycleRunnerSource, new RegExp(installedPath.replaceAll('.', '\\.')));
  }
  assert.match(lifecycleRunnerSource, /\['ito', 'status'\]/);
  assert.match(lifecycleRunnerSource, /canonical ito-compute-cli is unpublished/i);
  assert.match(lifecycleRunnerSource, /npx\|npm exec\|npm link\|install -g/i);
  assert.match(lifecycleRunnerSource, /installedStat\.isFile\(\)/);
  assert.match(lifecycleRunnerSource, /installedStat\.size > 0/);
  assert.match(lifecycleRunnerSource, /hostileItoSentinel/);
  assert.match(lifecycleRunnerSource, /must-not-reach-hostile-path/);
  assert.match(lifecycleRunnerSource, /packed Itô bridge executed a PATH collision/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
