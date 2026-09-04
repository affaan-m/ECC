/**
 * Read-only Grok harness boundary tests.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapter = require('../../scripts/lib/grok-harness-adapter');
const {
  SHA_PATTERN,
  readPinnedMarketplaceSource,
} = require('../../scripts/lib/grok-source-identity');
const {
  INLINE_RESOLVE,
  resolveEccRoot,
} = require('../../scripts/lib/resolve-ecc-root');

const repoRoot = path.resolve(__dirname, '..', '..');
let passed = 0;
let failed = 0;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-adapter-'));
}

function writeCompleteRoot(root, sha = null) {
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'utils.js'), '// stub\n');
  fs.mkdirSync(path.join(root, 'skills', 'continuous-learning-v2'), { recursive: true });
  if (sha) fs.writeFileSync(path.join(root, '.ecc-source.json'), JSON.stringify({ sha }));
}

function runTests() {
  console.log('\n=== Grok harness adapter boundary ===\n');

  if (test('shared root resolution has no Grok aliases or layout policy', () => {
    assert.ok(!INLINE_RESOLVE.includes('GROK_PLUGIN_ROOT'));
    const homeDir = createTempDir();
    try {
      const root = path.join(homeDir, '.grok', 'installed-plugins', 'ecc-deadbeef');
      writeCompleteRoot(root);
      assert.strictEqual(resolveEccRoot({ homeDir, envRoot: '' }), path.join(homeDir, '.claude'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('GROK_PLUGIN_ROOT is translated only at the adapter boundary', () => {
    const mapped = adapter.toSharedPluginEnv({
      GROK_PLUGIN_ROOT: '/grok/root',
      PATH: '/bin',
    });
    assert.strictEqual(mapped.PLUGIN_ROOT, '/grok/root');
    assert.strictEqual(mapped.GROK_PLUGIN_ROOT, undefined);
    const existing = adapter.toSharedPluginEnv({
      GROK_PLUGIN_ROOT: '/grok/root',
      CLAUDE_PLUGIN_ROOT: '/claude/root',
    });
    assert.strictEqual(existing.PLUGIN_ROOT, undefined);
    assert.strictEqual(resolveEccRoot({ envRoot: existing.CLAUDE_PLUGIN_ROOT }), '/claude/root');
  })) passed++; else failed++;

  if (test('shared hook and resolver files contain no Grok provider policy', () => {
    const files = [
      'scripts/lib/hook-flags.js',
      'scripts/lib/resolve-ecc-root.js',
      'scripts/hooks/plugin-hook-bootstrap.js',
      'scripts/hooks/run-with-flags.js',
      'scripts/hooks/observe-runner.js',
      'scripts/hooks/posttooluse-dispatcher.js',
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      assert.ok(!source.includes('GROK_PLUGIN_ROOT'), relative);
      assert.ok(!source.includes('grok-harness-adapter'), relative);
    }
  })) passed++; else failed++;

  if (test('native trusted manifest defaults deny hooks and root MCP', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, '.grok-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.hooks, '');
    assert.strictEqual(manifest.mcpServers, '');
    const rootMcp = JSON.parse(fs.readFileSync(path.join(repoRoot, '.mcp.json'), 'utf8'));
    assert.ok(rootMcp.mcpServers['chrome-devtools']);
  })) passed++; else failed++;

  if (test('marketplace source is the pinned whole repository', () => {
    const source = readPinnedMarketplaceSource(repoRoot);
    assert.strictEqual(source.url, 'https://github.com/affaan-m/ECC.git');
    assert.match(source.sha, SHA_PATTERN);
  })) passed++; else failed++;

  if (test('missing, disabled, native, cached, and pinned roots resolve deterministically', () => {
    const homeDir = createTempDir();
    const sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const otherSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir, env: {} }), null);
      const nativeRoot = path.join(homeDir, '.grok', 'plugins', 'ecc');
      writeCompleteRoot(nativeRoot);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir, env: {} }), nativeRoot);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir, enabled: false }), null);

      const otherCachedRoot = path.join(homeDir, '.grok', 'plugins', 'cache', 'ecc', 'affaan-m', '9.9.9');
      writeCompleteRoot(otherCachedRoot, otherSha);
      const cachedRoot = path.join(homeDir, '.grok', 'plugins', 'cache', 'ecc', 'affaan-m', '2.2.1');
      writeCompleteRoot(cachedRoot, sha);
      assert.strictEqual(adapter.listCachedGrokVersions(homeDir).length, 2);
      assert.strictEqual(adapter.selectPinnedCachedVersion(adapter.listCachedGrokVersions(homeDir), sha).installedRoot, cachedRoot);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir, pinnedSha: sha }), cachedRoot);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('Windows Grok roots stay adapter-owned', () => {
    assert.strictEqual(
      adapter.grokInstallStatePath('C:\\Users\\ecc', path.win32),
      path.win32.join('C:\\Users\\ecc', '.grok', 'ecc', 'install-state.json')
    );
    assert.strictEqual(adapter.resolveHomeDir({ ECC_GROK_HOME: 'D:\\Users\\ecc' }), 'D:\\Users\\ecc');
  })) passed++; else failed++;

  if (test('the adapter exports no private install lifecycle', () => {
    for (const name of ['previewInstall', 'applyInstall', 'uninstall', 'rollback', 'runGrokInstall']) {
      assert.strictEqual(adapter[name], undefined, name);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
