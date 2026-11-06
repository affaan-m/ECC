'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateGrokPin } = require('../../scripts/ci/validate-grok-pin');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function writeMarketplace(root, sha) {
  const directory = path.join(root, '.grok-plugin');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'marketplace.json'), JSON.stringify({
    plugins: [{ name: 'ecc', source: { sha } }],
  }));
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-pin-'));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'ECC test');
  git(root, 'config', 'user.email', 'ecc-test@example.invalid');
  const validatorPath = path.join(root, 'scripts/ci/validate-grok-pin.js');
  fs.mkdirSync(path.dirname(validatorPath), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../../scripts/ci/validate-grok-pin.js'), validatorPath);
  fs.writeFileSync(path.join(root, 'payload.txt'), 'verified source\n');
  writeMarketplace(root, '0'.repeat(40));
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'source snapshot');
  const sha = git(root, 'rev-parse', 'HEAD');
  writeMarketplace(root, sha);
  git(root, 'add', '.grok-plugin/marketplace.json');
  git(root, 'commit', '--quiet', '-m', 'pin source snapshot');
  return { root, sha };
}

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

console.log('\n=== Grok marketplace pin validation ===\n');

test('accepts a pin commit that differs only by the pin update', () => {
  const fixture = createFixture();
  try {
    assert.strictEqual(validateGrokPin(fixture.root).sha, fixture.sha);
    assert.strictEqual(validateGrokPin(fixture.root, { release: true }).sha, fixture.sha);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('ordinary source commits keep a valid historical pin but cannot be released', () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, 'payload.txt'), 'changed source\n');
    git(fixture.root, 'add', 'payload.txt');
    git(fixture.root, 'commit', '--quiet', '-m', 'change source without repinning');
    assert.strictEqual(validateGrokPin(fixture.root).sha, fixture.sha);
    assert.throws(() => validateGrokPin(fixture.root, { release: true }), /pin .* is stale/);

    const validator = path.join(fixture.root, 'scripts/ci/validate-grok-pin.js');
    const normal = spawnSync(process.execPath, [validator], { encoding: 'utf8' });
    assert.strictEqual(normal.status, 0, normal.stderr);
    assert.doesNotMatch(normal.stdout, /matches source/);
    const release = spawnSync(process.execPath, [validator, '--release'], { encoding: 'utf8' });
    assert.strictEqual(release.status, 1);
    assert.match(release.stderr, /pin .* is stale/);

    const sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
    const releaseScript = fs.readFileSync(path.resolve(__dirname, '../../scripts/release.sh'), 'utf8');
    const updater = releaseScript.slice(releaseScript.indexOf('GROK_SOURCE_SHA='))
      .match(/node -e '([\s\S]*?)' "\$GROK_MARKETPLACE_JSON" "\$GROK_SOURCE_SHA"/);
    assert.ok(updater, 'exercise the pin updater shipped in release.sh');
    const updated = spawnSync(process.execPath, ['-e', updater[1],
      path.join(fixture.root, '.grok-plugin/marketplace.json'), sourceSha,
    ], { encoding: 'utf8' });
    assert.strictEqual(updated.status, 0, updated.stderr);
    git(fixture.root, 'add', '.');
    git(fixture.root, 'commit', '--quiet', '-m', 'pin updated source');
    assert.strictEqual(git(fixture.root, 'diff', '--name-only', 'HEAD^', 'HEAD'),
      '.grok-plugin/marketplace.json');
    assert.strictEqual(validateGrokPin(fixture.root, { release: true }).sha, sourceSha);
    const repinned = spawnSync(process.execPath, [validator, '--release'], { encoding: 'utf8' });
    assert.strictEqual(repinned.status, 0, repinned.stderr);
    assert.match(repinned.stdout, /matches source/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('both modes reject malformed, missing, and non-ancestor pins', () => {
  const fixture = createFixture();
  try {
    for (const marketplace of [{}, { plugins: [] }, { plugins: [{}] }]) {
      fs.writeFileSync(path.join(fixture.root, '.grok-plugin/marketplace.json'), JSON.stringify(marketplace));
      for (const release of [false, true]) {
        assert.throws(() => validateGrokPin(fixture.root, { release }), /must pin a 40-character/);
      }
    }
    for (const sha of ['main', '0'.repeat(40)]) {
      writeMarketplace(fixture.root, sha);
      for (const release of [false, true]) {
        assert.throws(() => validateGrokPin(fixture.root, { release }));
      }
    }
    // Create a real commit that is not reachable from HEAD, without moving any refs.
    const tree = git(fixture.root, 'rev-parse', 'HEAD^{tree}');
    const unrelated = git(fixture.root, 'commit-tree', tree, '-m', 'unrelated history');
    writeMarketplace(fixture.root, unrelated);
    for (const release of [false, true]) {
      assert.throws(() => validateGrokPin(fixture.root, { release }), /not an ancestor/);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI rejects unknown options instead of silently disabling release validation', () => {
  for (const args of [['--relase'], ['--release', 'unexpected']]) {
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../../scripts/ci/validate-grok-pin.js'), ...args,
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});

// release.sh is a POSIX entrypoint; the validator and updater tests above run on all platforms.
if (process.platform !== 'win32') {
  for (const scenario of ['valid', 'contaminated', 'signing-failure']) {
    const name = scenario === 'valid' ? 'release signs and verifies the annotated pin-only tag'
      : scenario === 'contaminated' ? 'release blocks tagging when a commit hook changes source'
        : 'release stops without a tag when signing fails';
    test(name, () => {
      const fixture = createFixture();
      try {
        const signingKey = path.join(fixture.root, '.git', 'release-signing-key');
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKey]);
        const allowedSigners = path.join(fixture.root, '.git', 'allowed-signers');
        fs.writeFileSync(allowedSigners,
          `ecc-test@example.invalid ${fs.readFileSync(`${signingKey}.pub`, 'utf8')}`);
        git(fixture.root, 'config', 'gpg.format', 'ssh');
        git(fixture.root, 'config', 'user.signingkey', signingKey);
        git(fixture.root, 'config', 'gpg.ssh.allowedSignersFile', allowedSigners);
        git(fixture.root, 'config', 'tag.gpgSign', 'false');
        git(fixture.root, 'config', 'commit.gpgSign', 'false');
        if (scenario === 'signing-failure') {
          fs.rmSync(signingKey);
          fs.rmSync(`${signingKey}.pub`);
        }
        fs.writeFileSync(path.join(fixture.root, 'payload.txt'), 'new release source\n');
        git(fixture.root, 'add', '.');
        git(fixture.root, 'commit', '--quiet', '-m', 'release source');
        const sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
        if (scenario === 'contaminated') {
          fs.writeFileSync(path.join(fixture.root, '.git/hooks/pre-commit'),
            '#!/bin/sh\nprintf "unexpected source change\\n" > payload.txt\ngit add payload.txt\n',
            { mode: 0o755 });
        }
        const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/release.sh'), 'utf8');
        const start = source.indexOf('GROK_SOURCE_SHA=$(git rev-parse HEAD)');
        const end = source.indexOf('git push origin main', start);
        assert.ok(start >= 0 && end > start);
        const result = spawnSync('bash', ['-euo', 'pipefail'], {
          cwd: fixture.root,
          input: source.slice(start, end),
          encoding: 'utf8',
          env: { ...process.env, GROK_MARKETPLACE_JSON: '.grok-plugin/marketplace.json', VERSION: '9.9.9' },
        });
        if (scenario !== 'valid') {
          assert.notStrictEqual(result.status, 0, result.stderr);
          if (scenario === 'contaminated') {
            assert.strictEqual(result.status, 1, result.stderr);
            assert.match(result.stderr, /pin .* is stale/);
          } else {
            assert.match(result.stderr, /sign|key/i);
            assert.strictEqual(validateGrokPin(fixture.root, { release: true }).sha, sourceSha);
          }
          assert.strictEqual(git(fixture.root, 'tag', '--list'), '');
        } else {
          assert.strictEqual(result.status, 0, result.stderr);
          assert.strictEqual(validateGrokPin(fixture.root, { release: true }).sha, sourceSha);
          assert.strictEqual(git(fixture.root, 'cat-file', '-t', 'v9.9.9'), 'tag');
          assert.strictEqual(git(fixture.root, 'rev-parse', 'v9.9.9^{commit}'), git(fixture.root, 'rev-parse', 'HEAD'));
          assert.match(git(fixture.root, 'cat-file', '-p', 'v9.9.9'), /\nRelease v9\.9\.9\n/);
          git(fixture.root, 'verify-tag', '--raw', 'v9.9.9');
          assert.strictEqual(git(fixture.root, 'diff', '--name-only', sourceSha, 'HEAD'),
            '.grok-plugin/marketplace.json');
        }
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    });
  }
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
