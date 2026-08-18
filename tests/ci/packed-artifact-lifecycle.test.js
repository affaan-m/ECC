'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lifecycle = require('./packed-artifact-lifecycle');

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

console.log('\n=== Testing packed-artifact lifecycle runner ===\n');

test('resolves package and hash from explicit environment variables', () => {
  const options = lifecycle.parseEnvironment({
    ECC_RELEASE_PACKAGE: 'release-artifacts/ecc-universal-2.2.0.tgz',
    ECC_RELEASE_SHA256: 'a'.repeat(64),
  }, '/workspace');

  assert.strictEqual(
    options.packagePath,
    path.resolve('/workspace', 'release-artifacts/ecc-universal-2.2.0.tgz')
  );
  assert.strictEqual(options.expectedSha256, 'a'.repeat(64));
});

test('rejects missing, malformed, and non-tgz release inputs', () => {
  assert.throws(() => lifecycle.parseEnvironment({}, '/workspace'), /ECC_RELEASE_PACKAGE/);
  assert.throws(() => lifecycle.parseEnvironment({
    ECC_RELEASE_PACKAGE: 'package.zip',
    ECC_RELEASE_SHA256: 'a'.repeat(64),
  }, '/workspace'), /\.tgz/);
  assert.throws(() => lifecycle.parseEnvironment({
    ECC_RELEASE_PACKAGE: 'release-artifacts/ecc-universal-2.2.0.tgz',
    ECC_RELEASE_SHA256: 'not-a-hash',
  }, '/workspace'), /SHA-256/);
  assert.throws(() => lifecycle.parseEnvironment({
    ECC_RELEASE_PACKAGE: '../release-artifacts/ecc-universal-2.2.0.tgz',
    ECC_RELEASE_SHA256: 'a'.repeat(64),
  }, '/workspace'), /release-artifacts/);
  assert.throws(() => lifecycle.parseEnvironment({
    ECC_RELEASE_PACKAGE: '/tmp/ecc-universal-2.2.0.tgz',
    ECC_RELEASE_SHA256: 'a'.repeat(64),
  }, '/workspace'), /release-artifacts/);
});

test('hashFile computes a lowercase SHA-256 digest', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-packed-hash-'));
  const filePath = path.join(tempDir, 'package.tgz');

  try {
    fs.writeFileSync(filePath, 'exact packed bytes');
    const expected = crypto.createHash('sha256').update('exact packed bytes').digest('hex');
    assert.strictEqual(lifecycle.hashFile(filePath), expected);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('assertHash rejects an artifact whose bytes do not match', () => {
  assert.throws(
    () => lifecycle.assertHash('a'.repeat(64), 'b'.repeat(64)),
    /does not match/
  );
});

test('lifecycle child processes receive no inherited credentials', () => {
  const environment = lifecycle.createLifecycleEnvironment({
    PATH: '/tools',
    GITHUB_TOKEN: 'github-secret',
    NODE_AUTH_TOKEN: 'npm-secret',
    ACTIONS_RUNTIME_TOKEN: 'actions-secret',
    AWS_SECRET_ACCESS_KEY: 'cloud-secret',
  }, '/isolated-home');

  assert.strictEqual(environment.PATH, '/tools');
  assert.strictEqual(environment.HOME, '/isolated-home');
  assert.strictEqual(environment.USERPROFILE, '/isolated-home');
  assert.strictEqual(environment.GITHUB_TOKEN, undefined);
  assert.strictEqual(environment.NODE_AUTH_TOKEN, undefined);
  assert.strictEqual(environment.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.strictEqual(environment.AWS_SECRET_ACCESS_KEY, undefined);
});

test('public CLI invocations use npm exec instead of internal package paths', () => {
  const invocation = lifecycle.getNpmExecInvocation(
    ['ecc-universal', 'setup', '--help'],
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    'win32'
  );

  assert.strictEqual(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepStrictEqual(invocation.args, [
    '/d',
    '/s',
    '/c',
    'npm exec --offline --yes=false -- ecc-universal setup --help',
  ]);

  const unixInvocation = lifecycle.getNpmExecInvocation(
    ['ecc', 'doctor', '--target', 'cursor', '--json'],
    {},
    'linux'
  );
  assert.strictEqual(unixInvocation.command, 'npm');
  assert.deepStrictEqual(
    unixInvocation.args.slice(0, 4),
    ['exec', '--offline', '--yes=false', '--']
  );
  assert.strictEqual(unixInvocation.args[4], 'ecc');
  assert.ok(!unixInvocation.args.some(argument => argument.includes('node_modules')));
});

test('Windows public CLI invocation accepts the exact Itô capability selection', () => {
  const invocation = lifecycle.getNpmExecInvocation(
    [
      'ecc', 'install', '--profile', 'core',
      '--with', 'capability:ito-compute',
      '--with', 'capability:prediction-markets',
      '--target', 'cursor', '--json',
    ],
    { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    'win32'
  );

  assert.strictEqual(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.strictEqual(
    invocation.args[3],
    'npm exec --offline --yes=false -- ecc install --profile core --with capability:ito-compute --with capability:prediction-markets --target cursor --json'
  );
});

test('lifecycle cleanup retries Windows file locks without masking results', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'packed-artifact-lifecycle.js'),
    'utf8'
  );
  assert.match(source, /maxRetries:\s*10/);
  assert.match(source, /retryDelay:\s*100/);
  assert.match(source, /Could not remove lifecycle temp root/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
