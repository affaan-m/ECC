/**
 * Conformance tests for the Grok harness adapter.
 *
 * These tests require the shipped adapter (`scripts/lib/grok-harness-adapter.js`)
 * and the shared resolver. They do not reimplement adapter logic.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const adapter = require('../../scripts/lib/grok-harness-adapter');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const {
  resolveEccRoot,
  pluginRootFromEnv,
  PLUGIN_ROOT_ENV_KEYS,
  INLINE_RESOLVE,
} = require('../../scripts/lib/resolve-ecc-root');

const repoRoot = path.resolve(__dirname, '..', '..');
const marketplacePath = path.join(repoRoot, '.grok-plugin', 'marketplace.json');
const mcpPath = path.join(repoRoot, '.mcp.json');
const ECC_SKILL_SENTINEL = path.join('skills', 'continuous-learning-v2');

const FIXTURE_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TASTEFORGE_SHA = 'd8409a4b0813771235555e32e3d8046a73988bfa';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-adapter-'));
}

function writeCompleteRoot(root) {
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'utils.js'), '// stub\n');
  fs.mkdirSync(path.join(root, ECC_SKILL_SENTINEL), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{
          command: 'node -e "var e=process.env.PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT||process.env.ECC_PLUGIN_ROOT"',
        }],
      },
    })
  );
  return root;
}

function sourceFixture(root, sha = FIXTURE_SHA) {
  writeCompleteRoot(root);
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      'other-mcp': { command: 'echo' },
    },
  }));
  return {
    sourceRoot: root,
    source: {
      source: 'url',
      url: 'https://github.com/affaan-m/ECC.git',
      sha,
    },
    mcpConfig: JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')),
    version: '2.2.0',
  };
}

function gitCommit(sourceRoot, message) {
  const { execFileSync } = require('child_process');
  execFileSync('git', ['add', '.'], { cwd: sourceRoot, stdio: 'ignore' });
  execFileSync('git', [
    '-c', 'user.email=grok-adapter@test',
    '-c', 'user.name=GrokAdapter',
    'commit', '-m', message,
  ], { cwd: sourceRoot, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
}

function gitSourceFixture(sourceRoot) {
  const { execFileSync } = require('child_process');
  const fixture = sourceFixture(sourceRoot, FIXTURE_SHA);
  fs.mkdirSync(path.join(sourceRoot, '.grok-plugin'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, '.grok-plugin', 'marketplace.json'), JSON.stringify({
    name: 'ecc',
    plugins: [{
      name: 'ecc',
      version: '2.2.0',
      source: {
        source: 'url',
        url: 'https://github.com/affaan-m/ECC.git',
        sha: OTHER_SHA,
      },
    }],
  }));
  execFileSync('git', ['init'], { cwd: sourceRoot, stdio: 'ignore' });
  fixture.source.sha = gitCommit(sourceRoot, 'fixture');
  return fixture;
}

function runTests() {
  console.log('\n=== Grok harness adapter ===\n');

  if (test('shared PLUGIN_ROOT_ENV_KEYS does not include GROK_PLUGIN_ROOT', () => {
    assert.ok(Array.isArray(PLUGIN_ROOT_ENV_KEYS));
    assert.ok(!PLUGIN_ROOT_ENV_KEYS.includes('GROK_PLUGIN_ROOT'));
    assert.ok(!INLINE_RESOLVE.includes('GROK_PLUGIN_ROOT'));
  })) passed++; else failed++;

  if (test('shared pluginRootFromEnv ignores GROK_PLUGIN_ROOT', () => {
    assert.strictEqual(pluginRootFromEnv({
      GROK_PLUGIN_ROOT: '/grok/root',
      ECC_PLUGIN_ROOT: '/ecc/root',
    }), '/ecc/root');
    assert.strictEqual(pluginRootFromEnv({ GROK_PLUGIN_ROOT: '/grok/root' }), '');
  })) passed++; else failed++;

  if (test('shared resolveEccRoot ignores GROK_PLUGIN_ROOT and ~/.grok layout', () => {
    const homeDir = createTempDir();
    try {
      const grokRoot = path.join(homeDir, '.grok', 'installed-plugins', 'ecc-deadbeef');
      writeCompleteRoot(grokRoot);
      const previous = process.env.GROK_PLUGIN_ROOT;
      const previousClaude = process.env.CLAUDE_PLUGIN_ROOT;
      const previousPlugin = process.env.PLUGIN_ROOT;
      const previousEcc = process.env.ECC_PLUGIN_ROOT;
      try {
        process.env.GROK_PLUGIN_ROOT = grokRoot;
        delete process.env.CLAUDE_PLUGIN_ROOT;
        delete process.env.PLUGIN_ROOT;
        delete process.env.ECC_PLUGIN_ROOT;
        const result = resolveEccRoot({ homeDir, envRoot: '' });
        assert.strictEqual(result, path.join(homeDir, '.claude'));
        assert.notStrictEqual(result, grokRoot);
      } finally {
        if (previous === undefined) delete process.env.GROK_PLUGIN_ROOT;
        else process.env.GROK_PLUGIN_ROOT = previous;
        if (previousClaude === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
        else process.env.CLAUDE_PLUGIN_ROOT = previousClaude;
        if (previousPlugin === undefined) delete process.env.PLUGIN_ROOT;
        else process.env.PLUGIN_ROOT = previousPlugin;
        if (previousEcc === undefined) delete process.env.ECC_PLUGIN_ROOT;
        else process.env.ECC_PLUGIN_ROOT = previousEcc;
      }
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('shared hook runners do not require the Grok adapter', () => {
    const files = [
      'scripts/lib/hook-flags.js',
      'scripts/hooks/plugin-hook-bootstrap.js',
      'scripts/hooks/run-with-flags.js',
      'scripts/hooks/observe-runner.js',
      'scripts/hooks/posttooluse-dispatcher.js',
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      assert.ok(!source.includes('grok-harness-adapter'), `${relative} must not require the Grok adapter`);
      assert.ok(!source.includes('GROK_PLUGIN_ROOT'), `${relative} must not select GROK_PLUGIN_ROOT`);
    }
    const resolveSource = fs.readFileSync(path.join(repoRoot, 'scripts/lib/resolve-ecc-root.js'), 'utf8');
    assert.ok(!resolveSource.includes('GROK_PLUGIN_ROOT'));
  })) passed++; else failed++;

  if (test('toSharedPluginEnv maps GROK_PLUGIN_ROOT onto PLUGIN_ROOT and drops the Grok alias', () => {
    const mapped = adapter.toSharedPluginEnv({
      GROK_PLUGIN_ROOT: '/grok/root',
      PATH: '/bin',
    });
    assert.strictEqual(mapped.PLUGIN_ROOT, '/grok/root');
    assert.strictEqual(mapped.GROK_PLUGIN_ROOT, undefined);
    assert.strictEqual(pluginRootFromEnv(mapped), '/grok/root');
  })) passed++; else failed++;

  if (test('toSharedPluginEnv does not let GROK override an existing Claude/Codex root', () => {
    const mapped = adapter.toSharedPluginEnv({
      CLAUDE_PLUGIN_ROOT: '/claude/root',
      GROK_PLUGIN_ROOT: '/grok/root',
    });
    assert.strictEqual(mapped.GROK_PLUGIN_ROOT, undefined);
    assert.strictEqual(pluginRootFromEnv(mapped), '/claude/root');
  })) passed++; else failed++;

  if (test('adapter resolves GROK_PLUGIN_ROOT and ~/.grok installed-plugins', () => {
    const homeDir = createTempDir();
    try {
      assert.strictEqual(
        adapter.resolveGrokPluginRoot({ env: { GROK_PLUGIN_ROOT: '  /from/grok  ' }, homeDir }),
        '/from/grok'
      );
      const installed = path.join(homeDir, '.grok', 'installed-plugins', 'ecc-ab12cd34');
      writeCompleteRoot(installed);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ env: {}, homeDir }), installed);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('runGrokInstall dry-run is the ECC consent path and denies Chrome DevTools by default', () => {
    const homeDir = createTempDir();
    try {
      const result = adapter.runGrokInstall({ dryRun: true, homeDir, repoRoot });
      assert.strictEqual(result.kind, 'grok-install-result');
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.plan.attachChromeDevtools, false);
      assert.strictEqual(result.plan.hooksEnabled, false);
      assert.strictEqual(result.nativeMcpOptedOut, true);
      assert.strictEqual(result.nativeHooksOptedOut, true);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('preview exposes canonical operations and their concrete destinations', () => {
    const homeDir = createTempDir();
    try {
      const plan = adapter.previewInstall({
        homeDir,
        source: { source: 'url', url: 'https://github.com/affaan-m/ECC.git', sha: FIXTURE_SHA },
        trust: true,
        consent: { hooks: true, mcp: { 'other-mcp': true } },
        mcpConfig: { mcpServers: { 'other-mcp': { command: 'echo' } } },
      });
      assert.ok(Array.isArray(plan.operations) && plan.operations.length > 0);
      assert.ok(plan.operations.every((operation) => (
        ['copy-file', 'render-template', 'merge-json', 'remove'].includes(operation.kind)
      )));
      assert.ok(plan.operations.every((operation) => path.isAbsolute(operation.destinationPath)));
      assert.ok(plan.operations.some((operation) => operation.destinationPath.includes(path.join('.grok', 'plugins'))));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall copies the pinned git archive, not HEAD or untracked files', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      const pinnedSha = fixture.source.sha;
      fs.writeFileSync(path.join(sourceRoot, 'untracked-extra.txt'), 'should-not-copy\n');
      fs.writeFileSync(path.join(sourceRoot, 'later-commit.txt'), 'later\n');
      gitCommit(sourceRoot, 'later');
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      assert.ok(!fs.existsSync(path.join(receipt.installedRoot, 'untracked-extra.txt')));
      assert.ok(!fs.existsSync(path.join(receipt.installedRoot, 'later-commit.txt')));
      assert.ok(fs.existsSync(path.join(receipt.installedRoot, 'scripts', 'lib', 'utils.js')));
      const identity = JSON.parse(fs.readFileSync(
        path.join(receipt.installedRoot, adapter.SOURCE_IDENTITY_FILE),
        'utf8'
      ));
      assert.strictEqual(identity.sha, pinnedSha);
      const installedCatalog = JSON.parse(fs.readFileSync(
        path.join(receipt.installedRoot, '.grok-plugin', 'marketplace.json'),
        'utf8'
      ));
      assert.strictEqual(installedCatalog.plugins[0].source.sha, pinnedSha);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall rejects a git pin that is not in the source repository', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      fixture.source.sha = OTHER_SHA;
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      assert.throws(
        () => adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig }),
        /not in source git/
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall rejects a non-Git source tree with only self-asserted identity', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      fs.mkdirSync(path.join(sourceRoot, '.grok-plugin'), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, '.grok-plugin', 'marketplace.json'), JSON.stringify({
        plugins: [{ name: 'ecc', version: fixture.version, source: fixture.source }],
      }));
      const plan = adapter.previewInstall({ ...fixture, homeDir, trust: true });
      assert.throws(
        () => adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig }),
        /unverifiable|verified source|source identity/i
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('runGrokInstall rejects malformed .mcp.json instead of silently disabling capabilities', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      fs.mkdirSync(path.join(sourceRoot, '.grok-plugin'), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, '.grok-plugin', 'marketplace.json'), JSON.stringify({
        plugins: [{
          name: 'ecc',
          version: '2.2.0',
          source: { source: 'url', url: 'https://github.com/affaan-m/ECC.git', sha: FIXTURE_SHA },
        }],
      }));
      fs.writeFileSync(path.join(sourceRoot, '.grok-plugin', 'plugin.json'), JSON.stringify({
        name: 'ecc',
        hooks: '',
        mcpServers: '',
      }));
      fs.writeFileSync(path.join(sourceRoot, '.mcp.json'), '{not-json');
      assert.throws(
        () => adapter.runGrokInstall({ dryRun: true, homeDir, repoRoot: sourceRoot }),
        /\.mcp\.json|JSON/i
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('missing Grok root returns null', () => {
    const homeDir = createTempDir();
    try {
      assert.strictEqual(adapter.resolveGrokPluginRoot({ env: {}, homeDir }), null);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('in-repo marketplace source is a pinned Git URL', () => {
    const { execFileSync } = require('child_process');
    const plugin = adapter.readMarketplaceSource(marketplacePath);
    assert.strictEqual(plugin.source.url, 'https://github.com/affaan-m/ECC.git');
    assert.match(plugin.source.sha, adapter.SHA_PATTERN);
    assert.notStrictEqual(plugin.source.sha, TASTEFORGE_SHA);
    const tracked = execFileSync('git', ['ls-files', 'scripts/lib/grok-harness-adapter.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (tracked) {
      execFileSync('git', ['show', `${plugin.source.sha}:scripts/lib/grok-harness-adapter.js`], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    }
    assert.ok(adapter.sourceIdentity(plugin.source).includes(plugin.source.sha));
  })) passed++; else failed++;

  if (test('native Grok plugin manifest opts trusted installs out of chrome-devtools', () => {
    const pluginJsonPath = path.join(repoRoot, '.grok-plugin', 'plugin.json');
    const manifest = adapter.readGrokPluginManifest(pluginJsonPath);
    assert.strictEqual(manifest.mcpServers, '');
    assert.strictEqual(manifest.hooks, '');
    assert.strictEqual(adapter.nativePluginMcpOptedOut(manifest), true);
    assert.deepStrictEqual(adapter.nativeTrustedMcpServerNames(manifest), []);
    assert.strictEqual(adapter.nativeTrustedInstallAttachesChromeDevtools(manifest), false);
    const rootMcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(rootMcp.mcpServers['chrome-devtools'], 'Claude/Codex root .mcp.json may still list chrome-devtools');
  })) passed++; else failed++;

  if (test('unpinned marketplace source is rejected', () => {
    assert.throws(
      () => adapter.assertPinnedSource({ source: 'url', url: 'https://github.com/affaan-m/ECC.git' }),
      /40-character lowercase commit SHA/
    );
  })) passed++; else failed++;

  if (test('preview names hooks and each MCP capability; trusted default denies Chrome DevTools', () => {
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    const plan = adapter.previewInstall({
      source: { source: 'url', url: 'https://github.com/affaan-m/ECC.git', sha: FIXTURE_SHA },
      trust: true,
      mcpConfig,
    });
    const ids = plan.capabilities.map((item) => item.id);
    assert.ok(ids.includes('hooks'));
    assert.ok(ids.includes('chrome-devtools'));
    assert.strictEqual(plan.hooksEnabled, false);
    assert.strictEqual(plan.attachChromeDevtools, false);
    assert.ok(!plan.mcpAttached.includes('chrome-devtools'));
    assert.ok(plan.capabilities.every((item) => item.consented === false));
  })) passed++; else failed++;

  if (test('untrusted install cannot enable hooks or MCP even with consent', () => {
    const plan = adapter.previewInstall({
      source: { source: 'url', url: 'https://github.com/affaan-m/ECC.git', sha: FIXTURE_SHA },
      trust: false,
      consent: { hooks: true, mcp: { 'chrome-devtools': true } },
      mcpConfig: { mcpServers: { 'chrome-devtools': { command: 'npx' } } },
    });
    assert.strictEqual(plan.trust, false);
    assert.strictEqual(plan.hooksEnabled, false);
    assert.strictEqual(plan.attachChromeDevtools, false);
  })) passed++; else failed++;

  if (test('capability denial keeps Chrome DevTools out of a trusted receipt', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true, mcp: { 'chrome-devtools': false, 'other-mcp': true } },
      });
      assert.strictEqual(plan.hooksEnabled, true);
      assert.strictEqual(plan.attachChromeDevtools, false);
      assert.deepStrictEqual(plan.mcpAttached, ['other-mcp']);
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      const installedMcp = JSON.parse(fs.readFileSync(path.join(receipt.installedRoot, '.mcp.json'), 'utf8'));
      assert.ok(!installedMcp.mcpServers['chrome-devtools']);
      assert.ok(installedMcp.mcpServers['other-mcp']);
      assert.ok(receipt.hooksEnabled);
      assert.ok(!receipt.mcpAttached.includes('chrome-devtools'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('trusted install without MCP consent does not attach root chrome-devtools', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      const installedMcp = JSON.parse(fs.readFileSync(path.join(receipt.installedRoot, '.mcp.json'), 'utf8'));
      assert.deepStrictEqual(installedMcp.mcpServers, {});
      assert.strictEqual(receipt.attachChromeDevtools, undefined);
      assert.deepStrictEqual(receipt.mcpAttached, []);
      const statePath = adapter.grokInstallStatePath(homeDir);
      assert.ok(fs.existsSync(statePath));
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.strictEqual(state.schemaVersion, 'ecc.install.v1');
      assert.strictEqual(state.target.id, 'grok-home');
      assert.strictEqual(state.target.target, 'grok');
      assert.strictEqual(state.source.repoCommit, fixture.source.sha);
      assert.ok(!fs.existsSync(path.join(homeDir, '.grok', 'ecc-adapter')));
      const mapped = adapter.toSharedPluginEnv({ GROK_PLUGIN_ROOT: receipt.installedRoot });
      assert.strictEqual(mapped.PLUGIN_ROOT, receipt.installedRoot);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall maps GROK_PLUGIN_ROOT at the installed hook boundary when hooks are consented', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      assert.strictEqual(receipt.trust, true);
      const destHooks = fs.readFileSync(path.join(receipt.installedRoot, 'hooks', 'hooks.json'), 'utf8');
      assert.ok(destHooks.includes('GROK_PLUGIN_ROOT'));
      const sharedEnv = adapter.readInstalledSharedEnv(receipt.installedRoot);
      assert.strictEqual(sharedEnv.PLUGIN_ROOT, receipt.installedRoot);
      const repoHooks = fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8');
      assert.ok(!repoHooks.includes('GROK_PLUGIN_ROOT'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall rejects a source tree whose marketplace pin does not match the plan', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      fs.mkdirSync(path.join(sourceRoot, '.grok-plugin'), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, '.grok-plugin', 'marketplace.json'), JSON.stringify({
        name: 'ecc',
        plugins: [{
          name: 'ecc',
          version: '2.2.0',
          source: {
            source: 'url',
            url: 'https://github.com/affaan-m/ECC.git',
            sha: OTHER_SHA,
          },
        }],
      }));
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      assert.throws(
        () => adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig }),
        /marketplace sha does not match/
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('install is root-contained; Windows-style escape is rejected', () => {
    const grokRoot = 'C:\\Users\\ecc\\.grok';
    assert.ok(adapter.isContained('C:\\Users\\ecc\\.grok\\installed-plugins\\ecc-aaa', grokRoot, path.win32));
    assert.ok(!adapter.isContained('C:\\Windows\\System32', grokRoot, path.win32));
    assert.ok(!adapter.isContained('C:\\Users\\ecc\\.grok\\..\\..\\Windows', grokRoot, path.win32));
    assert.throws(
      () => adapter.assertRootContainment('C:\\Windows\\System32', grokRoot, path.win32),
      /escapes Grok root/
    );
  })) passed++; else failed++;

  if (test('applyInstall rejects a symlinked plugin-directory ancestor without writing outside Grok home', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    const outsideRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      const grokRoot = path.join(homeDir, '.grok');
      fs.mkdirSync(grokRoot, { recursive: true });
      try {
        fs.symlinkSync(outsideRoot, path.join(grokRoot, 'plugins'), 'dir');
      } catch {
        console.log('    (directory symlink unsupported on this platform; skipping)');
        return;
      }
      const plan = adapter.previewInstall({ ...fixture, homeDir, trust: true });
      assert.throws(() => adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig }), /outside|symlink|root/i);
      assert.deepStrictEqual(fs.readdirSync(outsideRoot), []);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('applyInstall rejects a final destination symlink without modifying its target', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    const outsideRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      const plan = adapter.previewInstall({ ...fixture, homeDir, trust: true });
      const destination = adapter.installDestination(homeDir, plan);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(path.join(outsideRoot, 'sentinel.txt'), 'unchanged\n');
      try {
        fs.symlinkSync(outsideRoot, destination, 'dir');
      } catch {
        console.log('    (directory symlink unsupported on this platform; skipping)');
        return;
      }
      assert.throws(() => adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig }), /outside|symlink|root/i);
      assert.deepStrictEqual(fs.readdirSync(outsideRoot), ['sentinel.txt']);
      assert.strictEqual(fs.readFileSync(path.join(outsideRoot, 'sentinel.txt'), 'utf8'), 'unchanged\n');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('canonical lifecycle uninstalls a Grok receipt with only supported operation kinds', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    const projectRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      const plan = adapter.previewInstall({ ...fixture, homeDir, trust: true, consent: { hooks: true } });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      const state = JSON.parse(fs.readFileSync(adapter.grokInstallStatePath(homeDir), 'utf8'));
      assert.ok(state.operations.every((operation) => (
        ['copy-file', 'render-template', 'merge-json', 'remove'].includes(operation.kind)
      )));
      const result = uninstallInstalledStates({
        repoRoot,
        homeDir,
        projectRoot,
        targets: ['grok'],
      });
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(receipt.installedRoot));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('consented capabilities are installed in Grok native discovery and denied capabilities are absent', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = gitSourceFixture(sourceRoot);
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true, mcp: { 'other-mcp': true, 'chrome-devtools': false } },
      });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      assert.ok(receipt.installedRoot.startsWith(path.join(homeDir, '.grok', 'plugins') + path.sep));
      assert.ok(fs.existsSync(path.join(receipt.installedRoot, 'hooks', 'hooks.json')));
      const installedManifest = JSON.parse(fs.readFileSync(
        path.join(receipt.installedRoot, '.grok-plugin', 'plugin.json'),
        'utf8'
      ));
      assert.notStrictEqual(installedManifest.hooks, '');
      assert.notStrictEqual(installedManifest.mcpServers, '');
      const installedMcp = JSON.parse(fs.readFileSync(path.join(receipt.installedRoot, '.mcp.json'), 'utf8'));
      assert.deepStrictEqual(Object.keys(installedMcp.mcpServers), ['other-mcp']);
      assert.ok(!JSON.stringify(installedMcp).includes('chrome-devtools'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('upgrade, uninstall, and rollback are receipt-backed on fixture trees', () => {
    const homeDir = createTempDir();
    const firstRoot = createTempDir();
    const secondRoot = createTempDir();
    try {
      const first = sourceFixture(firstRoot, FIXTURE_SHA);
      const second = sourceFixture(secondRoot, OTHER_SHA);
      const firstPlan = adapter.previewInstall({
        ...first,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      const firstReceipt = adapter.applyInstall(firstPlan, { mcpConfig: first.mcpConfig, now: '2026-09-03T00:00:00.000Z' });
      assert.strictEqual(firstReceipt.operation, 'install');
      assert.ok(fs.existsSync(firstReceipt.installedRoot));

      const secondPlan = adapter.previewInstall({
        ...second,
        homeDir,
        trust: true,
        consent: { hooks: true, mcp: { 'chrome-devtools': true } },
      });
      const upgraded = adapter.applyInstall(secondPlan, { mcpConfig: second.mcpConfig, now: '2026-09-03T01:00:00.000Z' });
      assert.strictEqual(upgraded.operation, 'upgrade');
      assert.strictEqual(upgraded.previousReceiptId, firstReceipt.id);
      assert.notStrictEqual(upgraded.installedRoot, firstReceipt.installedRoot);
      assert.ok(upgraded.mcpAttached.includes('chrome-devtools'));
      assert.ok(fs.existsSync(firstReceipt.installedRoot));
      assert.ok(fs.existsSync(upgraded.installedRoot));
      assert.strictEqual(adapter.listManagedInstallRoots(homeDir).length, 2);

      const rolled = adapter.rollback(homeDir);
      assert.strictEqual(rolled.operation, 'rollback');
      assert.strictEqual(rolled.id, firstReceipt.id);
      assert.strictEqual(adapter.loadCurrentReceipt(homeDir).id, firstReceipt.id);
      assert.deepStrictEqual(adapter.loadCurrentReceipt(homeDir).mcpAttached, []);
      assert.ok(fs.existsSync(firstReceipt.installedRoot));
      assert.ok(!fs.existsSync(upgraded.installedRoot));

      const removed = adapter.uninstall(homeDir);
      assert.strictEqual(removed.operation, 'uninstall');
      assert.ok(!fs.existsSync(firstReceipt.installedRoot));
      assert.ok(!fs.existsSync(upgraded.installedRoot));
      assert.deepStrictEqual(adapter.listManagedInstallRoots(homeDir), []);
      assert.strictEqual(adapter.loadCurrentReceipt(homeDir), null);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(firstRoot, { recursive: true, force: true });
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('disabled plugin is not resolved as the active Grok root', () => {
    const homeDir = createTempDir();
    const sourceRoot = createTempDir();
    try {
      const fixture = sourceFixture(sourceRoot);
      const plan = adapter.previewInstall({
        ...fixture,
        homeDir,
        trust: true,
        consent: { hooks: true },
      });
      const receipt = adapter.applyInstall(plan, { mcpConfig: fixture.mcpConfig });
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir }), receipt.installedRoot);
      adapter.setPluginEnabled(homeDir, false);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir }), null);
      assert.strictEqual(adapter.resolveGrokPluginRoot({ homeDir, requireEnabled: false }), receipt.installedRoot);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('multiple cached versions select only the pinned SHA', () => {
    const homeDir = createTempDir();
    try {
      const cacheBase = path.join(homeDir, '.grok', 'plugins', 'cache', 'ecc', 'affaan-m');
      const oldRoot = path.join(cacheBase, '2.1.0');
      const newRoot = path.join(cacheBase, '2.2.0');
      writeCompleteRoot(oldRoot);
      writeCompleteRoot(newRoot);
      fs.writeFileSync(path.join(oldRoot, adapter.SOURCE_IDENTITY_FILE), JSON.stringify({
        source: 'url',
        url: 'https://github.com/affaan-m/ECC.git',
        sha: OTHER_SHA,
      }));
      fs.writeFileSync(path.join(newRoot, adapter.SOURCE_IDENTITY_FILE), JSON.stringify({
        source: 'url',
        url: 'https://github.com/affaan-m/ECC.git',
        sha: FIXTURE_SHA,
      }));
      const versions = adapter.listCachedGrokVersions(homeDir);
      assert.strictEqual(versions.length, 2);
      const selected = adapter.selectPinnedCachedVersion(versions, FIXTURE_SHA);
      assert.strictEqual(selected.installedRoot, newRoot);
      assert.strictEqual(
        adapter.resolveGrokPluginRoot({ homeDir, env: {}, pinnedSha: FIXTURE_SHA }),
        newRoot
      );
      assert.strictEqual(adapter.selectPinnedCachedVersion(versions, 'cccccccccccccccccccccccccccccccccccccccc'), null);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('Windows install destination stays under .grok\\installed-plugins', () => {
    const dest = adapter.installDestination(
      'C:\\Users\\ecc',
      { pluginId: 'ecc', source: { sha: FIXTURE_SHA } },
      path.win32
    );
    assert.strictEqual(
      dest,
      path.win32.join('C:\\Users\\ecc', '.grok', 'installed-plugins', `ecc-${FIXTURE_SHA.slice(0, 12)}`)
    );
    assert.ok(adapter.isContained(dest, 'C:\\Users\\ecc\\.grok', path.win32));
    assert.strictEqual(adapter.resolveHomeDir({ ECC_GROK_HOME: 'D:\\Users\\ecc' }), 'D:\\Users\\ecc');
  })) passed++; else failed++;

  if (test('previewInstall and grok-home.planOperations use the same hook/MCP consent gate', () => {
    const grokHome = require('../../scripts/lib/install-targets/grok-home');
    const mcpConfig = {
      mcpServers: {
        'chrome-devtools': { command: 'npx' },
        'other-mcp': { command: 'echo' },
      },
    };
    const source = {
      source: 'url',
      url: 'https://github.com/affaan-m/ECC.git',
      sha: FIXTURE_SHA,
    };
    const modules = [
      { id: 'hooks-runtime', paths: ['hooks', 'hooks/hooks.json'] },
      { id: 'mcp', paths: ['.mcp.json', 'mcp-configs'] },
      { id: 'skills', paths: ['skills'] },
    ];
    const consent = { hooks: true, mcp: { 'other-mcp': true, 'chrome-devtools': false } };
    const plan = adapter.previewInstall({
      source,
      trust: true,
      consent,
      mcpConfig,
    });
    const operations = grokHome.planOperations({
      homeDir: '/Users/example',
      modules,
      trust: true,
      consent,
    });
    const opPaths = operations.map((operation) => String(operation.sourceRelativePath).replace(/\\/g, '/'));
    assert.strictEqual(plan.hooksEnabled, true);
    assert.deepStrictEqual(plan.mcpAttached, ['other-mcp']);
    assert.ok(opPaths.includes('hooks') || opPaths.includes('hooks/hooks.json'));
    assert.ok(!opPaths.some((item) => item === '.mcp.json' || item.startsWith('mcp-configs')));
    assert.ok(opPaths.includes('skills'));
  })) passed++; else failed++;

  if (test('native plugin.json opt-out is the grok plugin --trust contract', () => {
    const { spawnSync } = require('child_process');
    const pluginJsonPath = path.join(repoRoot, '.grok-plugin', 'plugin.json');
    const manifest = adapter.readGrokPluginManifest(pluginJsonPath);
    assert.strictEqual(adapter.nativeTrustedInstallAttachesChromeDevtools(manifest), false);
    assert.deepStrictEqual(adapter.nativeTrustedMcpServerNames(manifest), []);
    const validated = spawnSync('grok', ['plugin', 'validate', '.'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (!validated.error) {
      assert.strictEqual(validated.status, 0, validated.stderr || validated.stdout);
      assert.ok(!/chrome-devtools/i.test(validated.stdout || ''));
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
