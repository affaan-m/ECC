'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EXCLUSIVE_FIXTURE_PATHS,
  SHARED_FIXTURE_MARKERS,
  classifyGrokFixtureUpgrade,
  probeGrokSupport,
  snapshotFixtureFiles,
  restoreFixtureSnapshot,
  readFixturePolicy,
  writeFixturePolicy,
  detectDestFixture,
  isFixtureNecessary,
} = require('../../scripts/lib/grok-fixture-upgrade');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

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

function runTests() {
  console.log('\n=== Testing grok-fixture-upgrade ===\n');
  let passed = 0;
  let failed = 0;

  if (test('probe detects copied-sync, mcp harness, and install-target independently', () => {
    const tree = tempDir('grok-probe-');
    write(path.join(tree, 'scripts', 'sync-ecc-to-grok.sh'), '#!/bin/bash\n');
    write(
      path.join(tree, 'scripts', 'codex', 'merge-mcp-config.js'),
      "Usage: merge-mcp-config.js [--harness grok]\n"
    );
    write(
      path.join(tree, 'scripts', 'lib', 'install-manifests.js'),
      "const SUPPORTED_INSTALL_TARGETS = ['claude', 'codex'];\n"
    );
    const withoutTarget = probeGrokSupport(tree);
    assert.strictEqual(withoutTarget.copiedSync, true);
    assert.strictEqual(withoutTarget.mcpHarness, true);
    assert.strictEqual(withoutTarget.installTarget, false);
    assert.strictEqual(withoutTarget.plugin, false);

    write(
      path.join(tree, 'scripts', 'lib', 'install-manifests.js'),
      "const SUPPORTED_INSTALL_TARGETS = ['claude', 'codex', 'grok'];\n"
    );
    write(path.join(tree, '.grok-plugin', 'plugin.json'), '{"name":"ecc"}\n');
    const withNative = probeGrokSupport(tree);
    assert.strictEqual(withNative.installTarget, true);
    assert.strictEqual(withNative.plugin, true);
    fs.rmSync(tree, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('fixture is necessary only while dest exists and incoming has not solved Grok', () => {
    assert.strictEqual(isFixtureNecessary({
      destPresent: true,
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
    }), true);
    assert.strictEqual(isFixtureNecessary({
      destPresent: true,
      incoming: { installTarget: true, plugin: false, copiedSync: false, mcpHarness: false },
    }), false);
    assert.strictEqual(isFixtureNecessary({
      destPresent: true,
      incoming: { installTarget: false, plugin: true, copiedSync: false, mcpHarness: false },
    }), false);
    assert.strictEqual(isFixtureNecessary({
      destPresent: false,
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
    }), false);
  })) passed += 1; else failed += 1;

  if (test('classify: dest fixture + incoming lacks Grok + overlapping files is perforated', () => {
    const decision = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'active',
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
      changedPaths: ['scripts/codex/merge-mcp-config.js', 'README.md'],
    });
    assert.strictEqual(decision.flow, 'perforated');
    assert.strictEqual(decision.reason, 'incoming-touches-unsolved-fixture');
  })) passed += 1; else failed += 1;

  if (test('classify: dest fixture + incoming lacks Grok + no overlap is passthrough', () => {
    const decision = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'active',
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
      changedPaths: ['skills/tdd-workflow/SKILL.md'],
    });
    assert.strictEqual(decision.flow, 'passthrough');
    assert.strictEqual(decision.reason, 'incoming-misses-fixture-paths');
  })) passed += 1; else failed += 1;

  if (test('classify: native grok install or plugin solves the fixture', () => {
    const native = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'active',
      incoming: { installTarget: true, plugin: false, copiedSync: false, mcpHarness: false },
      changedPaths: ['scripts/lib/install-manifests.js'],
    });
    assert.strictEqual(native.flow, 'solved');
    assert.strictEqual(native.cleanup, 'native');

    const plugin = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'active',
      incoming: { installTarget: false, plugin: true, copiedSync: false, mcpHarness: false },
      changedPaths: [],
    });
    assert.strictEqual(plugin.flow, 'solved');
    assert.strictEqual(plugin.cleanup, 'native');
  })) passed += 1; else failed += 1;

  if (test('classify: upstream copied-sync plus mcp harness absorbs the overlay', () => {
    const decision = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'active',
      incoming: { installTarget: false, plugin: false, copiedSync: true, mcpHarness: true },
      changedPaths: ['scripts/sync-ecc-to-grok.sh'],
    });
    assert.strictEqual(decision.flow, 'solved');
    assert.strictEqual(decision.cleanup, 'absorbed');
  })) passed += 1; else failed += 1;

  if (test('classify: detached policy skips the gate', () => {
    const decision = classifyGrokFixtureUpgrade({
      destPresent: true,
      policyStatus: 'detached',
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
      changedPaths: ['scripts/codex/merge-mcp-config.js'],
    });
    assert.strictEqual(decision.flow, 'none');
    assert.strictEqual(decision.reason, 'detached');
  })) passed += 1; else failed += 1;

  if (test('classify: no dest and no active policy is none', () => {
    const decision = classifyGrokFixtureUpgrade({
      destPresent: false,
      policyStatus: null,
      incoming: { installTarget: false, plugin: false, copiedSync: false, mcpHarness: false },
      changedPaths: ['README.md'],
    });
    assert.strictEqual(decision.flow, 'none');
  })) passed += 1; else failed += 1;

  if (test('detectDestFixture reads policy, ownership state, and AGENTS supplement', () => {
    const grokHome = tempDir('grok-dest-');
    assert.strictEqual(detectDestFixture(grokHome), false);
    write(path.join(grokHome, 'AGENTS.md'), '# User\n\n# Grok Supplement (From ECC .grok/AGENTS.md)\n');
    assert.strictEqual(detectDestFixture(grokHome), true);
    fs.rmSync(grokHome, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('snapshot plus restore puts exclusive files back after they disappear', () => {
    const repo = tempDir('grok-snap-');
    const exclusive = EXCLUSIVE_FIXTURE_PATHS[0];
    write(path.join(repo, exclusive), '# keep\n');
    write(path.join(repo, SHARED_FIXTURE_MARKERS[0].file), `${SHARED_FIXTURE_MARKERS[0].pattern.source}\n`);
    const snapshot = snapshotFixtureFiles(repo);
    fs.rmSync(path.join(repo, exclusive));
    fs.writeFileSync(path.join(repo, SHARED_FIXTURE_MARKERS[0].file), 'upstream removed the marker\n');
    const restored = restoreFixtureSnapshot(repo, snapshot);
    assert.strictEqual(fs.readFileSync(path.join(repo, exclusive), 'utf8'), '# keep\n');
    assert.match(fs.readFileSync(path.join(repo, SHARED_FIXTURE_MARKERS[0].file), 'utf8'), SHARED_FIXTURE_MARKERS[0].pattern);
    assert.ok(restored.exclusive.includes(exclusive));
    assert.ok(restored.shared.includes(SHARED_FIXTURE_MARKERS[0].file));
    fs.rmSync(repo, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('restore leaves a shared file alone when the fixture marker survived', () => {
    const repo = tempDir('grok-keep-');
    const marker = SHARED_FIXTURE_MARKERS[0];
    write(path.join(repo, marker.file), `upstream plus ${marker.pattern.source}\n`);
    const snapshot = snapshotFixtureFiles(repo);
    fs.writeFileSync(path.join(repo, marker.file), `newer upstream plus ${marker.pattern.source}\n`);
    const restored = restoreFixtureSnapshot(repo, snapshot);
    assert.strictEqual(
      fs.readFileSync(path.join(repo, marker.file), 'utf8'),
      `newer upstream plus ${marker.pattern.source}\n`
    );
    assert.deepStrictEqual(restored.shared, []);
    fs.rmSync(repo, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  if (test('policy round-trips active and detached status', () => {
    const grokHome = tempDir('grok-policy-');
    assert.strictEqual(readFixturePolicy(grokHome), null);
    writeFixturePolicy(grokHome, { status: 'active', lastFlow: 'passthrough' });
    assert.strictEqual(readFixturePolicy(grokHome).status, 'active');
    writeFixturePolicy(grokHome, { status: 'detached', lastFlow: 'solved' });
    assert.strictEqual(readFixturePolicy(grokHome).status, 'detached');
    fs.rmSync(grokHome, { recursive: true, force: true });
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
