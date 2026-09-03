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

// Sentinel ECC skill that resolveEccRoot() requires (alongside the script tree)
// before accepting a root for skill consumers. Kept in sync with the module's
// DEFAULT_SKILL_PROBE; the #2544 regression test guards the behaviour.
const ECC_SKILL_SENTINEL = path.join('skills', 'continuous-learning-v2');

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
  fs.mkdirSync(path.join(claudeDir, ECC_SKILL_SENTINEL), { recursive: true });
  return claudeDir;
}

function setupLegacyPluginInstall(homeDir, segments) {
  const legacyDir = path.join(homeDir, '.claude', 'plugins', ...segments);
  const scriptDir = path.join(legacyDir, 'scripts', 'lib');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
  fs.mkdirSync(path.join(legacyDir, ECC_SKILL_SENTINEL), { recursive: true });
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
  fs.mkdirSync(path.join(cacheDir, ECC_SKILL_SENTINEL), { recursive: true });
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

  // ─── Partial install (#2544) ───

  if (test('rejects a partial ~/.claude (scripts + non-ECC skills) and prefers a complete root (#2544)', () => {
    const homeDir = createTempDir();
    try {
      // ~/.claude has ECC's scripts and a user's OWN skills/ dir, but not ECC's
      // skills. The old script-only probe accepted it and every skill path 404'd.
      const claudeDir = path.join(homeDir, '.claude');
      const scriptDir = path.join(claudeDir, 'scripts', 'lib');
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
      fs.mkdirSync(path.join(claudeDir, 'skills', 'my-own-skill'), { recursive: true });
      // A COMPLETE ECC root exists in the plugin cache (scripts + ECC skill).
      const expected = setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected,
        'a scripts-only ~/.claude must not shadow a complete plugin-cache root');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('a scripts-only ~/.claude with no complete root falls back to ~/.claude (#2544)', () => {
    const homeDir = createTempDir();
    try {
      // No complete root anywhere: the resolver still returns ~/.claude as a
      // last resort (unchanged fallback), so callers fail loudly at the missing
      // path rather than the resolver inventing one.
      const claudeDir = path.join(homeDir, '.claude');
      const scriptDir = path.join(claudeDir, 'scripts', 'lib');
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(path.join(scriptDir, 'utils.js'), '// stub');
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, claudeDir);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('rejects a partial exact plugin root (scripts, no ECC skill) and prefers a complete root (#2544)', () => {
    const homeDir = createTempDir();
    try {
      // An exact plugin root under ~/.claude/plugins/ecc ships ECC's scripts but
      // not ECC's skills. The stricter predicate must reject it on the
      // exact-plugin branch too, not only for ~/.claude.
      const partialScripts = path.join(homeDir, '.claude', 'plugins', 'ecc', 'scripts', 'lib');
      fs.mkdirSync(partialScripts, { recursive: true });
      fs.writeFileSync(path.join(partialScripts, 'utils.js'), '// stub');
      // A COMPLETE ECC root exists in the plugin cache (scripts + ECC skill).
      const expected = setupPluginCache(homeDir, 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION);
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, expected,
        'a scripts-only exact plugin root must not shadow a complete plugin-cache root');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('rejects a partial plugin-cache root (scripts, no ECC skill) and falls back to ~/.claude (#2544)', () => {
    const homeDir = createTempDir();
    try {
      // A versioned plugin-cache root ships ECC's scripts but not ECC's skills.
      // The stricter predicate must reject it on the cache branch, so the
      // resolver returns the last-resort ~/.claude rather than the partial root.
      const cacheScripts = path.join(
        homeDir, '.claude', 'plugins', 'cache', 'ecc', 'affaan-m', CURRENT_PACKAGE_VERSION,
        'scripts', 'lib'
      );
      fs.mkdirSync(cacheScripts, { recursive: true });
      fs.writeFileSync(path.join(cacheScripts, 'utils.js'), '// stub');
      const result = resolveEccRoot({ envRoot: '', homeDir });
      assert.strictEqual(result, path.join(homeDir, '.claude'),
        'a scripts-only plugin-cache root must not be returned; fall back to ~/.claude');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('custom probe skips a qualifying root that lacks the probed script (auto-update)', () => {
    // The surviving failure shape after #2544/#2577: a partial install can
    // carry full resolver evidence (script tree + sentinel ECC skill) yet
    // still lack the top-level script that auto-update will execute. The
    // default probe rightly accepts such a root; a caller probing for the
    // script it runs must skip it and reach the complete plugin root.
    const homeDir = createTempDir();
    try {
      const claudeDir = setupStandardInstall(homeDir);
      const marketplaceRoot = setupLegacyPluginInstall(homeDir, ['marketplaces', 'ecc']);
      fs.writeFileSync(path.join(marketplaceRoot, 'scripts', 'auto-update.js'), '// stub');

      assert.strictEqual(
        resolveEccRoot({ envRoot: '', homeDir }),
        claudeDir,
        'default probe accepts a root with full resolver evidence'
      );
      assert.strictEqual(
        resolveEccRoot({
          envRoot: '',
          homeDir,
          probe: path.join('scripts', 'auto-update.js'),
        }),
        marketplaceRoot,
        'auto-update probe must skip roots that lack the script it will execute'
      );
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
