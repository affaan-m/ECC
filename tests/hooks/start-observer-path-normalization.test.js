/**
 * Verify observer storage uses a physical path when its configured root is
 * reached through symlink and lexical aliases.
 */

'use strict';

const bashBinary = process.env.ECC_TEST_BASH || 'bash';

if (process.platform === 'win32' && !process.env.ECC_TEST_BASH) {
  console.log('Skipping bash-dependent observer path test on Windows');
  process.exit(0);
}

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const launcher = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'agents',
  'start-observer.sh'
);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-path-test-'));

/** Convert a native Windows path to the form accepted by Git Bash. */
function shellPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
}

/** Return the launcher-reported storage directory for one configured root. */
function storageFor(configuredRoot) {
  const result = spawnSync(bashBinary, [launcher, 'status'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.join(testRoot, 'home'),
      CLV2_HOMUNCULUS_DIR: shellPath(configuredRoot),
    },
  });

  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const match = result.stdout.match(/^Storage: (.+)$/m);
  assert.ok(match, `launcher did not report its storage directory:\n${result.stdout}`);
  return match[1];
}

try {
  const actualRoot = path.join(testRoot, 'homunculus');
  const aliasRoot = path.join(testRoot, 'homunculus-alias');
  fs.mkdirSync(actualRoot, { recursive: true });
  fs.mkdirSync(path.join(actualRoot, 'child'), { recursive: true });
  fs.mkdirSync(path.join(testRoot, 'unused'), { recursive: true });

  const canonicalStorage = storageFor(actualRoot);
  const lexicalStorage = storageFor(
    `${testRoot}${path.sep}unused${path.sep}..${path.sep}homunculus`
  );
  const trailingSlashStorage = storageFor(`${actualRoot}${path.sep}`);

  assert.strictEqual(lexicalStorage, canonicalStorage, '.. route must reuse the physical observer key');
  assert.strictEqual(trailingSlashStorage, canonicalStorage, 'trailing slash must reuse the physical observer key');

  const spacedRoot = path.join(testRoot, 'homunculus with spaces');
  fs.mkdirSync(spacedRoot, { recursive: true });
  const spacedStorage = storageFor(spacedRoot);
  assert.ok(
    spacedStorage.includes('/homunculus with spaces/projects/'),
    `paths containing spaces must stay intact when canonicalized: ${spacedStorage}`
  );

  try {
    fs.symlinkSync(actualRoot, aliasRoot, 'dir');
    const symlinkStorage = storageFor(aliasRoot);
    assert.strictEqual(symlinkStorage, canonicalStorage, 'symlink route must reuse the physical observer key');

    const childAlias = path.join(testRoot, 'homunculus-child-alias');
    fs.symlinkSync(path.join(actualRoot, 'child'), childAlias, 'dir');
    const symlinkDotDotStorage = storageFor(`${childAlias}${path.sep}..`);
    assert.strictEqual(
      symlinkDotDotStorage,
      canonicalStorage,
      'symlink followed by .. must reuse the physical observer key'
    );
    console.log('PASS: observer storage key is stable across symlink and .. aliases');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    console.log('PASS: observer storage key is stable across .. aliases (symlink unavailable)');
  }
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
