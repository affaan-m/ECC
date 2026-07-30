/**
 * Tests for scripts/lib/install/config.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findDefaultInstallConfigPath,
  loadInstallConfig,
  resolveInstallConfigPath,
} = require('../../scripts/lib/install/config');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function runTests() {
  console.log('\n=== Testing install/config.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('resolves relative config paths from the provided cwd', () => {
    const cwd = '/workspace/app';
    const resolved = resolveInstallConfigPath('configs/ecc-install.json', { cwd });
    assert.strictEqual(resolved, path.join(cwd, 'configs', 'ecc-install.json'));
  })) passed++; else failed++;

  if (test('finds the default project install config in the provided cwd', () => {
    const cwd = createTempDir('install-config-');

    try {
      const configPath = path.join(cwd, 'ecc-install.json');
      writeJson(configPath, {
        version: 1,
        profile: 'core',
      });

      assert.strictEqual(findDefaultInstallConfigPath({ cwd }), configPath);
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  if (test('returns null when no default project install config exists', () => {
    const cwd = createTempDir('install-config-');

    try {
      assert.strictEqual(findDefaultInstallConfigPath({ cwd }), null);
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  if (test('loads and normalizes a valid install config', () => {
    const cwd = createTempDir('install-config-');

    try {
      const configPath = path.join(cwd, 'ecc-install.json');
      writeJson(configPath, {
        version: 1,
        target: 'cursor',
        profile: 'developer',
        modules: ['platform-configs', 'platform-configs'],
        include: ['lang:typescript', 'framework:nextjs', 'lang:typescript'],
        exclude: ['capability:media'],
        hookAuthorizations: {
          'automatic-source-writes': 'allow',
          'transcript-derived-llm-egress': 'decline',
        },
        options: {
          includeExamples: false,
        },
      });

      const config = loadInstallConfig('ecc-install.json', { cwd });
      assert.strictEqual(config.path, configPath);
      assert.strictEqual(config.target, 'cursor');
      assert.strictEqual(config.profileId, 'developer');
      assert.deepStrictEqual(config.moduleIds, ['platform-configs']);
      assert.deepStrictEqual(config.includeComponentIds, ['lang:typescript', 'framework:nextjs']);
      assert.deepStrictEqual(config.excludeComponentIds, ['capability:media']);
      assert.deepStrictEqual(config.hookAuthorizations, {
        'automatic-source-writes': 'allow',
        'transcript-derived-llm-egress': 'decline',
      });
      assert.deepStrictEqual(config.options, { includeExamples: false });
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  if (test('rejects unknown hook authorization groups and unsupported decisions', () => {
    const cwd = createTempDir('install-config-');

    try {
      writeJson(path.join(cwd, 'ecc-install.json'), {
        version: 1,
        profile: 'full',
        hookAuthorizations: {
          'unknown-hook-group': 'allow',
        },
      });
      assert.throws(
        () => loadInstallConfig('ecc-install.json', { cwd }),
        /Invalid install config/
      );

      writeJson(path.join(cwd, 'ecc-install.json'), {
        version: 1,
        profile: 'full',
        hookAuthorizations: {
          'automatic-source-writes': 'yes',
        },
      });
      assert.throws(
        () => loadInstallConfig('ecc-install.json', { cwd }),
        /Invalid install config/
      );
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  if (test('rejects invalid config schema values', () => {
    const cwd = createTempDir('install-config-');

    try {
      writeJson(path.join(cwd, 'ecc-install.json'), {
        version: 2,
        target: 'ghost-target',
      });

      assert.throws(
        () => loadInstallConfig('ecc-install.json', { cwd }),
        /Invalid install config/
      );
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  if (test('fails when the install config does not exist', () => {
    const cwd = createTempDir('install-config-');

    try {
      assert.throws(
        () => loadInstallConfig('ecc-install.json', { cwd }),
        /Install config not found/
      );
    } finally {
      cleanup(cwd);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
