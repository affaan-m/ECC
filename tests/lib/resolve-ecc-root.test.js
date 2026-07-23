/**
 * Tests for scripts/lib/resolve-ecc-root.js
 *
 * Covers the ECC root resolution fallback chain:
 *   1. CLAUDE_PLUGIN_ROOT env var
 *   2. Standard install (~/.claude/)
 *   3. Exact legacy plugin roots under ~/.claude/plugins/
 *   4. Plugin cache auto-detection
 *   5. Fallback to ~/.claude/
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
).version;

const { resolveEccRoot, INLINE_RESOLVE } = require('../../scripts/lib/resolve-ecc-root');

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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-root-test-'));
}

function setupStandardInstall(homeDir) {
  const claudeDir = path.join(homeDir, '.claude');
  const scriptDir = path.join(claudeDir, 'scripts', 'lib');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
  return claudeDir;
}

function setupLegacyPluginInstall(homeDir, segments) {
  const legacyDir = path.join(homeDir, '.claude', 'plugins', ...segments);
  const scriptDir = path.join(legacyDir, 'scripts', 'lib');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
  return legacyDir;
}
function setupPluginCache(homeDir, pluginSlug, orgName, version) {
  const cacheDir = path.join(
    homeDir, '.claude', 'plugins', 'cache',
    pluginSlug, orgName, version
  );
  const scriptDir = path.join(cacheDir, 'scripts', 'lib');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
  return cacheDir;
}

function runTests() {
  console.log('\n=== Testing resolve-ecc-root.js ===\n');

  let passed = 0;
  let failed = 0;

  // ─── Env Var Priority ───

  if (test('returns CLAUDE_PLUGIN_ROOT when set', () => {
    const result = resolveEccRoot({ envRoot: '/custom/plugin/root' });
    assert.strictEqual(result, '/custom/plugin/root');
  })) passed++; else failed++;

  if (test('trims whitespace from CLAUDE_PLUGIN_ROOT', () => {
    const result = resolveEccRoot({ envRoot: '  /trimmed/root  ' });
    assert.strictEqual(result, '/trimmed/root');
  })) passed++; else failed++;

  if (test('skips empty CLAUDE_PLUGIN_ROOT', () => {
    const homeDir = createTempDir();
    try {
      setupStandardInstall(homeDir);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('skips whitespace-only CLAUDE_PLUGIN_ROOT', () => {
    const homeDir = createTempDir();
    try {
      setupStandardInstall(homeDir);
      const result = resolveEccRoot({ envRoot: '   ', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ─── Standard Install ───

  if (test('finds standard install at ~/.claude/', () => {
    const homeDir = createTempDir();
    try {
      setupStandardInstall(homeDir);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds current plugin install at ~/.claude/plugins/ecc', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['ecc']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds current plugin install at ~/.claude/plugins/ecc@ecc', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['ecc@ecc']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds exact legacy plugin install at ~/.claude/plugins/everything-claude-code', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['everything-claude-code']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds exact legacy plugin install at ~/.claude/plugins/everything-claude-code@everything-claude-code', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['everything-claude-code@everything-claude-code']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds marketplace current plugin install at ~/.claude/plugins/marketplaces/ecc', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['marketplaces', 'ecc']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('finds marketplace legacy plugin install at ~/.claude/plugins/marketplaces/everything-claude-code', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['marketplaces', 'everything-claude-code']);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('prefers exact legacy plugin install over plugin cache', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupLegacyPluginInstall(homeDir, ['marketplaces', 'ecc']);
      setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;
  // ─── Plugin Cache Auto-Detection ───

  if (test('discovers plugin root from cache directory', () => {
    const homeDir = createTempDir();
    try {
      const expected = setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('prefers standard install over plugin cache', () => {
    const homeDir = createTempDir();
    try {
      const claudeDir = setupStandardInstall(homeDir);
      setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, claudeDir,
        'Standard install should take precedence over plugin cache');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('handles multiple versions in plugin cache', () => {
    const homeDir = createTempDir();
    try {
      setupPluginCache(homeDir, 'everything-claude-code', 'legacy-org', '1.7.0');
      const expected = setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      // Should find one of them (either is valid)
      assert.ok(
        result === expected ||
        result === path.join(homeDir, '.claude', 'plugins', 'cache', 'everything-claude-code', 'legacy-org', '1.7.0'),
        'Should resolve to a valid plugin cache directory'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ─── Fallback ───

  if (test('falls back to ~/.claude/ when nothing is found', () => {
    const homeDir = createTempDir();
    try {
      // Create ~/.claude but don't put scripts there
      fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('falls back gracefully when ~/.claude/ does not exist', () => {
    const homeDir = createTempDir();
    try {
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ─── Custom Probe ───

  if (test('supports custom probe path', () => {
    const homeDir = createTempDir();
    try {
      const claudeDir = path.join(homeDir, '.claude');
      fs.mkdirSync(path.join(claudeDir, 'custom'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'custom', 'marker.js'), '// probe');
      const result = resolveEccRoot({
        envRoot: '',
        homeDir,
        probe: path.join('custom', 'marker.js'),
      });
      assert.strictEqual(result, claudeDir);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ─── INLINE_RESOLVE ───

  if (test('INLINE_RESOLVE is a non-empty string', () => {
    assert.ok(typeof INLINE_RESOLVE === 'string');
    assert.ok(INLINE_RESOLVE.length > 50, 'Should be a substantial inline expression');
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE does not contain spread, nested arrays, or escaped quotes', () => {
    assert.ok(!INLINE_RESOLVE.includes('...'));
    assert.ok(!INLINE_RESOLVE.includes('[['));
    assert.ok(!INLINE_RESOLVE.includes('\\"'));
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE returns CLAUDE_PLUGIN_ROOT when set', () => {
    const { execFileSync } = require('child_process');
    const result = execFileSync('node', [
      '-e', `console.log(${INLINE_RESOLVE})`,
    ], {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '/inline/test/root' },
      encoding: 'utf8',
    }).trim();
    assert.strictEqual(result, '/inline/test/root');
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE delegates to committed resolver when env var is unset', () => {
    const homeDir = createTempDir();
    try {
      const resolverDir = path.join(homeDir, '.claude', 'scripts', 'lib');
      fs.mkdirSync(resolverDir, { recursive: true });
      fs.writeFileSync(path.join(resolverDir, 'resolve-ecc-root.js'), `module.exports = { resolveEccRoot() { return 'delegated:' + process.env.INLINE_RESOLVE_MARKER; } };`);
      const { execFileSync } = require('child_process');
      const result = execFileSync('node', [
        '-e', `console.log(${INLINE_RESOLVE})`,
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: homeDir,
          USERPROFILE: homeDir,
          INLINE_RESOLVE_MARKER: 'ok',
        },
        encoding: 'utf8',
      }).trim();
      assert.strictEqual(result, 'delegated:ok');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE loads the committed resolver module from home base', () => {
    const homeDir = createTempDir();
    try {
      const resolverDir = path.join(homeDir, '.claude', 'scripts', 'lib');
      fs.mkdirSync(resolverDir, { recursive: true });
      fs.writeFileSync(path.join(resolverDir, 'resolve-ecc-root.js'), `const assert = require('assert');
module.exports = { resolveEccRoot() { assert.strictEqual(process.env.HOME, ${JSON.stringify(homeDir)}); return 'module-loaded'; } };`);
      const { execFileSync } = require('child_process');
      const result = execFileSync('node', [
        '-e', `console.log(${INLINE_RESOLVE})`,
      ], {
        env: { PATH: process.env.PATH, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8',
      }).trim();
      assert.strictEqual(result, 'module-loaded');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE bootstraps module from an exact plugin root when env unset', () => {
    const homeDir = createTempDir();
    try {
      const resolverDir = path.join(homeDir, '.claude', 'plugins', 'ecc', 'scripts', 'lib');
      fs.mkdirSync(resolverDir, { recursive: true });
      fs.writeFileSync(path.join(resolverDir, 'resolve-ecc-root.js'), `module.exports = { resolveEccRoot() { return 'plugin-root'; } };`);
      const { execFileSync } = require('child_process');
      const result = execFileSync('node', [
        '-e', `console.log(${INLINE_RESOLVE})`,
      ], {
        env: { PATH: process.env.PATH, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8',
      }).trim();
      assert.strictEqual(result, 'plugin-root');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE bootstraps module from the versioned plugin cache when env unset', () => {
    const homeDir = createTempDir();
    try {
      const resolverDir = path.join(
        homeDir, '.claude', 'plugins', 'cache', 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION,
        'scripts', 'lib'
      );
      fs.mkdirSync(resolverDir, { recursive: true });
      fs.writeFileSync(path.join(resolverDir, 'resolve-ecc-root.js'), `module.exports = { resolveEccRoot() { return 'cache-root'; } };`);
      const { execFileSync } = require('child_process');
      const result = execFileSync('node', [
        '-e', `console.log(${INLINE_RESOLVE})`,
      ], {
        env: { PATH: process.env.PATH, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8',
      }).trim();
      assert.strictEqual(result, 'cache-root');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('INLINE_RESOLVE falls back to ~/.claude/ when nothing found', () => {
    const homeDir = createTempDir();
    try {
      const { execFileSync } = require('child_process');
      const result = execFileSync('node', [
        '-e', `console.log(${INLINE_RESOLVE})`,
      ], {
        env: { PATH: process.env.PATH, HOME: homeDir, USERPROFILE: homeDir },
        encoding: 'utf8',
      }).trim();
      assert.strictEqual(result, path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
