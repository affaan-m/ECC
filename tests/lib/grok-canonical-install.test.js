/**
 * Canonical Grok install contract tests.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install-executor');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const { createInstallPlanFromRequest } = require('../../scripts/lib/install/runtime');
const { copyGitArchive, fetchPinnedGitSource } = require('../../scripts/lib/grok-source-identity');

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
    console.log(`    Error: ${error.stack || error.message}`);
    return false;
  }
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function commit(root, message) {
  git(root, ['add', '.']);
  git(root, ['-c', 'user.email=grok-canonical@test', '-c', 'user.name=GrokCanonical', 'commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createPinnedFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-canonical-'));
  const sourceRoot = path.join(parent, 'source');
  const homeDir = path.join(parent, 'home');
  git(parent, ['clone', '--quiet', '--no-local', repoRoot, sourceRoot]);
  git(sourceRoot, ['remote', 'add', 'pinned-source', sourceRoot]);
  fs.mkdirSync(homeDir, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, 'commands', 'plan.md'), 'pinned payload\n');
  writeJson(path.join(sourceRoot, '.mcp.json'), {
    mcpServers: {
      'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      'other-mcp': { command: 'node', args: ['mcp.js'] },
    },
  });
  const pluginManifestPath = path.join(sourceRoot, '.grok-plugin', 'plugin.json');
  const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
  writeJson(pluginManifestPath, { ...pluginManifest, version: '2.1.0' });
  const payloadSha = commit(sourceRoot, 'fixture payload');

  const marketplacePath = path.join(sourceRoot, '.grok-plugin', 'marketplace.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  marketplace.plugins[0] = {
    ...marketplace.plugins[0],
    version: '2.1.0',
    source: {
      source: 'url',
      url: sourceRoot,
      sha: payloadSha,
    },
  };
  writeJson(marketplacePath, marketplace);
  commit(sourceRoot, 'fixture catalog');

  return { parent, sourceRoot, homeDir, payloadSha };
}

function request({ trust = true, hooks = true, mcp = ['other-mcp'] } = {}) {
  return {
    mode: 'manifest',
    target: 'grok',
    profileId: null,
    moduleIds: ['commands-core', 'hooks-runtime'],
    includeComponentIds: [],
    excludeComponentIds: [],
    legacyLanguages: [],
    hookConsent: hooks ? 'enabled' : 'declined',
    trust,
    consentMcp: mcp,
  };
}

function createPlan(fixture, requestOptions = {}, extra = {}) {
  return createInstallPlanFromRequest(request(requestOptions), {
    sourceRoot: fixture.sourceRoot,
    projectRoot: fixture.sourceRoot,
    homeDir: fixture.homeDir,
    env: {},
    ...extra,
  });
}

function installedRoot(fixture) {
  return path.join(fixture.homeDir, '.grok', 'plugins', 'ecc');
}

function inspectWithGrok(fixture) {
  const projectRoot = path.join(fixture.parent, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const result = spawnSync('grok', ['inspect', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      GROK_HOME: path.join(fixture.homeDir, '.grok'),
    },
    timeout: 30000,
  });
  if (result.error && result.error.code === 'ENOENT') return null;
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runTests() {
  console.log('\n=== Canonical Grok install contract ===\n');

  if (test('preview and apply use one canonical operation set with explicit capability consent', () => {
    const fixture = createPinnedFixture();
    try {
      const rawPlan = createPlan(fixture);
      const preview = previewInstallPlan(rawPlan);
      const applied = applyInstallPlan(rawPlan);
      const state = JSON.parse(fs.readFileSync(rawPlan.installStatePath, 'utf8'));

      assert.deepStrictEqual(applied.plannedOperations, preview.plannedOperations);
      assert.deepStrictEqual(
        state.operations.map(operation => operation.destinationPath),
        preview.plannedOperations.map(operation => operation.destinationPath)
      );
      assert.strictEqual(state.request.trust, true);
      assert.deepStrictEqual(state.request.consentMcp, ['other-mcp']);
      assert.strictEqual(state.source.repoCommit, fixture.payloadSha);
      assert.strictEqual(state.source.repoUrl, fixture.sourceRoot);

      const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot(fixture), '.grok-plugin', 'plugin.json'), 'utf8'));
      const mcp = JSON.parse(fs.readFileSync(path.join(installedRoot(fixture), '.mcp.json'), 'utf8'));
      assert.strictEqual(manifest.hooks, 'hooks/hooks.json');
      assert.strictEqual(manifest.mcpServers, '.mcp.json');
      assert.deepStrictEqual(Object.keys(mcp.mcpServers), ['other-mcp']);
      assert.ok(!JSON.stringify(mcp).includes('chrome-devtools'));
      const installedHooks = fs.readFileSync(path.join(installedRoot(fixture), 'hooks', 'hooks.json'), 'utf8');
      assert.ok(installedHooks.includes('GROK_PLUGIN_ROOT'));
      assert.ok(!fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8').includes('GROK_PLUGIN_ROOT'));
      const inspection = inspectWithGrok(fixture);
      if (inspection) {
        const plugin = inspection.plugins.find((item) => item.name === 'ecc');
        assert.ok(plugin && plugin.enabled);
        assert.strictEqual(plugin.provides.hooks, true);
        assert.strictEqual(plugin.provides.mcpServers, 1);
      }
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('untrusted and denied plans omit hooks and every MCP capability', () => {
    const fixture = createPinnedFixture();
    try {
      for (const options of [
        { trust: false, hooks: true, mcp: ['chrome-devtools', 'other-mcp'] },
        { trust: true, hooks: false, mcp: [] },
      ]) {
        fs.rmSync(path.join(fixture.homeDir, '.grok'), { recursive: true, force: true });
        const plan = createPlan(fixture, options);
        applyInstallPlan(plan);
        const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot(fixture), '.grok-plugin', 'plugin.json'), 'utf8'));
        assert.strictEqual(manifest.hooks, '');
        assert.strictEqual(manifest.mcpServers, '');
        assert.ok(!fs.existsSync(path.join(installedRoot(fixture), '.mcp.json')));
        assert.ok(!fs.existsSync(path.join(installedRoot(fixture), 'hooks', 'hooks.json')));
        const inspection = inspectWithGrok(fixture);
        if (inspection) {
          const plugin = inspection.plugins.find((item) => item.name === 'ecc');
          assert.ok(plugin && plugin.enabled);
          assert.strictEqual(plugin.provides.hooks, false);
          assert.strictEqual(plugin.provides.mcpServers, 0);
        }
      }
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('canonical source preparation installs the pinned commit, not HEAD or dirty files', () => {
    const fixture = createPinnedFixture();
    try {
      fs.writeFileSync(path.join(fixture.sourceRoot, 'commands', 'plan.md'), 'dirty payload\n');
      fs.writeFileSync(path.join(fixture.sourceRoot, 'untracked.txt'), 'do not install\n');
      const plan = createPlan(fixture, { hooks: false, mcp: [] });
      applyInstallPlan(plan);
      assert.strictEqual(
        fs.readFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'utf8'),
        'pinned payload\n'
      );
      assert.ok(!fs.existsSync(path.join(installedRoot(fixture), 'untracked.txt')));
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('canonical source extraction fails closed when tar is unavailable', () => {
    const fixture = createPinnedFixture();
    try {
      const destination = path.join(fixture.parent, 'snapshot');
      const tarUnavailable = (command) => {
        if (command === 'git') return Buffer.alloc(0);
        const error = new Error('tar executable not found');
        error.code = 'ENOENT';
        error.path = 'tar';
        throw error;
      };
      assert.throws(() => copyGitArchive(fixture.sourceRoot, fixture.payloadSha, destination, tarUnavailable), (error) => {
        assert.strictEqual(error.code, 'ENOENT');
        assert.strictEqual(error.path, 'tar');
        return true;
      });
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('canonical source extraction forces tar to read the piped archive', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-tar-'));
    const destination = path.join(parent, 'snapshot');
    const calls = [];
    try {
      copyGitArchive('/source', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', destination, (...args) => {
        calls.push(args);
        return Buffer.alloc(0);
      });
      assert.deepStrictEqual(calls[1][1], ['-x', '-f', '-', '-C', destination]);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('pinned source fetch is bounded and reports the fetch failure', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-fetch-'));
    const calls = [];
    try {
      assert.throws(() => fetchPinnedGitSource(
        'https://example.invalid/ECC.git',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        parent,
        (command, args, options) => {
          calls.push({ command, args, options });
          if (args.includes('fetch')) {
            const error = new Error('fetch timed out');
            error.stderr = Buffer.from('network stalled');
            throw error;
          }
          return '';
        }
      ), /Failed to fetch pinned Grok source.*network stalled/);
      assert.ok(Number.isInteger(calls[1].options.timeout));
      assert.ok(calls[1].options.timeout > 0);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('source identity preserves case-sensitive remote paths', () => {
    const fixture = createPinnedFixture();
    try {
      const marketplacePath = path.join(fixture.sourceRoot, '.grok-plugin', 'marketplace.json');
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
      marketplace.plugins[0].source.url = 'https://example.com/Owner/ECC.git';
      writeJson(marketplacePath, marketplace);
      assert.throws(
        () => createPlan(
          fixture,
          { hooks: false, mcp: [] },
          { sourceUrl: 'https://example.com/owner/ECC.git' }
        ),
        /source URL does not match/
      );
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('source identity rejects a marketplace version that does not match the pinned plugin', () => {
    const fixture = createPinnedFixture();
    try {
      const marketplacePath = path.join(fixture.sourceRoot, '.grok-plugin', 'marketplace.json');
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
      marketplace.plugins[0].version = '9.9.9';
      writeJson(marketplacePath, marketplace);
      assert.throws(
        () => createPlan(fixture, { hooks: false, mcp: [] }),
        /Pinned Grok plugin version 2\.1\.0 does not match marketplace version 9\.9\.9/
      );
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('marketplace-extracted trees require matching Grok registry evidence and refetch the pin', () => {
    const fixture = createPinnedFixture();
    const extractedRoot = path.join(fixture.parent, 'extracted');
    try {
      fs.mkdirSync(path.join(extractedRoot, '.grok-plugin'), { recursive: true });
      fs.copyFileSync(
        path.join(fixture.sourceRoot, '.grok-plugin', 'marketplace.json'),
        path.join(extractedRoot, '.grok-plugin', 'marketplace.json')
      );
      assert.throws(
        () => createInstallPlanFromRequest(request(), {
          sourceRoot: extractedRoot,
          projectRoot: extractedRoot,
          homeDir: fixture.homeDir,
          env: {},
        }),
        /registry|verified source|unverifiable/i
      );

      writeJson(path.join(fixture.homeDir, '.grok', 'installed-plugins', 'registry.json'), {
        version: 1,
        repos: {
          ecc: {
            path: extractedRoot,
            kind: { type: 'Git', url: fixture.sourceRoot, commit: fixture.payloadSha },
            plugins: { ecc: { version: '2.2.1' } },
          },
        },
      });
      const plan = createInstallPlanFromRequest(request({ hooks: false, mcp: [] }), {
        sourceRoot: extractedRoot,
        projectRoot: extractedRoot,
        homeDir: fixture.homeDir,
        env: {},
      });
      applyInstallPlan(plan);
      assert.strictEqual(
        fs.readFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'utf8'),
        'pinned payload\n'
      );
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('repair, uninstall, upgrade, and rollback stay on canonical install state', () => {
    const fixture = createPinnedFixture();
    try {
      const firstPlan = createPlan(fixture, { hooks: false, mcp: [] });
      applyInstallPlan(firstPlan);
      const firstState = JSON.parse(fs.readFileSync(firstPlan.installStatePath, 'utf8'));

      fs.writeFileSync(path.join(fixture.sourceRoot, 'commands', 'plan.md'), 'upgraded payload\n');
      writeJson(path.join(fixture.sourceRoot, '.grok-plugin', 'plugin.json'), {
        ...JSON.parse(fs.readFileSync(path.join(fixture.sourceRoot, '.grok-plugin', 'plugin.json'), 'utf8')),
        version: '2.2.1',
      });
      const upgradedSha = commit(fixture.sourceRoot, 'upgraded payload');
      const marketplacePath = path.join(fixture.sourceRoot, '.grok-plugin', 'marketplace.json');
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
      marketplace.plugins[0].version = '2.2.1';
      marketplace.plugins[0].source.sha = upgradedSha;
      writeJson(marketplacePath, marketplace);
      commit(fixture.sourceRoot, 'upgraded catalog');
      const upgradePlan = createPlan(fixture, { hooks: false, mcp: [] });
      applyInstallPlan(upgradePlan);
      assert.strictEqual(
        fs.readFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'utf8'),
        'upgraded payload\n'
      );

      fs.writeFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'broken\n');
      const repair = repairInstalledStates({
        repoRoot: fixture.sourceRoot,
        projectRoot: fixture.sourceRoot,
        homeDir: fixture.homeDir,
        targets: ['grok'],
        env: {},
      });
      assert.strictEqual(repair.results[0].status, 'repaired', JSON.stringify(repair.results[0]));
      assert.strictEqual(
        fs.readFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'utf8'),
        'upgraded payload\n'
      );

      const rollbackPlan = createPlan(
        fixture,
        { hooks: false, mcp: [] },
        { sourceSha: firstState.source.repoCommit }
      );
      applyInstallPlan(rollbackPlan);
      const rolledBackState = JSON.parse(fs.readFileSync(rollbackPlan.installStatePath, 'utf8'));
      assert.strictEqual(rolledBackState.source.repoCommit, firstState.source.repoCommit);
      assert.strictEqual(
        fs.readFileSync(path.join(installedRoot(fixture), 'commands', 'plan.md'), 'utf8'),
        'pinned payload\n'
      );
      assert.strictEqual(rolledBackState.source.repoVersion, '2.1.0');

      const uninstall = uninstallInstalledStates({
        repoRoot: fixture.sourceRoot,
        projectRoot: fixture.sourceRoot,
        homeDir: fixture.homeDir,
        targets: ['grok'],
        env: {},
      });
      assert.strictEqual(uninstall.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(firstPlan.installStatePath));
      assert.ok(!fs.existsSync(installedRoot(fixture)));
    } finally {
      fs.rmSync(fixture.parent, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
