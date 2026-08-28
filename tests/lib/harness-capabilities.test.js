/**
 * Tests for scripts/lib/harness-capabilities.js
 */

const assert = require('assert');

const { SUPPORTED_INSTALL_TARGETS } = require('../../scripts/lib/install-manifests');
const { listInstallTargetAdapters } = require('../../scripts/lib/install-targets/registry');
const {
  GUIDED_HARNESS_IDS,
  HARNESS_CAPABILITIES,
  getHarnessCapability,
  listGuidedHarnesses,
  listHarnessCapabilities,
  normalizeHarnessSelection,
} = require('../../scripts/lib/harness-capabilities');

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

function runTests() {
  console.log('\n=== Testing harness capability catalog ===\n');

  let passed = 0;
  let failed = 0;

  if (test('represents all 14 registered targets exactly once across 13 harnesses', () => {
    const catalogTargetIds = HARNESS_CAPABILITIES.flatMap(harness => harness.targetIds);
    const adapterTargetIds = listInstallTargetAdapters().map(adapter => adapter.target);

    assert.strictEqual(HARNESS_CAPABILITIES.length, 13);
    assert.strictEqual(new Set(catalogTargetIds).size, 14);
    assert.deepStrictEqual([...catalogTargetIds].sort(), [...SUPPORTED_INSTALL_TARGETS].sort());
    assert.deepStrictEqual([...catalogTargetIds].sort(), [...adapterTargetIds].sort());
  })) passed++; else failed++;

  if (test('only Claude, Codex, and Kimi are guided-ready', () => {
    assert.deepStrictEqual(GUIDED_HARNESS_IDS, ['claude', 'codex', 'kimi']);
    assert.deepStrictEqual(
      listGuidedHarnesses().map(harness => harness.id),
      ['claude', 'codex', 'kimi']
    );
    assert.ok(HARNESS_CAPABILITIES
      .filter(harness => !harness.guidedReady)
      .every(harness => harness.availability === 'advanced'));
  })) passed++; else failed++;

  if (test('models reviewed guided install modes, roots, and scopes', () => {
    const claude = getHarnessCapability('claude');
    assert.deepStrictEqual(claude.targetIds, ['claude', 'claude-project']);
    assert.strictEqual(claude.channel, 'native-plugin');
    assert.strictEqual(claude.installMode, 'native-plugin');
    assert.match(claude.destination, /selected Claude plugin scope/i);
    assert.deepStrictEqual(claude.scopes, [
      { id: 'user', targetId: 'claude', root: '~/.claude' },
      { id: 'project', targetId: 'claude-project', root: './.claude' },
      { id: 'local', targetId: 'claude-project', root: './.claude' },
    ]);

    const codex = getHarnessCapability('codex');
    assert.deepStrictEqual(codex.targetIds, ['codex']);
    assert.strictEqual(codex.channel, 'native-plugin');
    assert.strictEqual(codex.installMode, 'native-plugin');
    assert.match(codex.destination, /~\/\.codex/);
    assert.deepStrictEqual(codex.scopes, [
      { id: 'native', targetId: 'codex', root: '~/.codex' },
    ]);

    const kimi = getHarnessCapability('kimi');
    assert.deepStrictEqual(kimi.targetIds, ['kimi']);
    assert.strictEqual(kimi.channel, 'managed-project');
    assert.strictEqual(kimi.installMode, 'managed-project');
    assert.strictEqual(kimi.destination, './.kimi-code');
    assert.deepStrictEqual(kimi.scopes, [
      { id: 'project', targetId: 'kimi', root: './.kimi-code' },
    ]);

    const opencode = getHarnessCapability('opencode');
    assert.match(opencode.destinationResolution, /OPENCODE_CONFIG_DIR/);
    assert.match(opencode.destinationResolution, /XDG_CONFIG_HOME/);
    assert.match(opencode.destinationResolution, /~\/\.config\/opencode/);
  })) passed++; else failed++;

  if (test('keeps every advanced target attached to its registered root and scope', () => {
    const expected = {
      cursor: ['project', './.cursor'],
      antigravity: ['project', './.agents'],
      gemini: ['project', './.gemini'],
      opencode: ['home', '~/.config/opencode'],
      codebuddy: ['project', './.codebuddy'],
      joycode: ['project', './.joycode'],
      qwen: ['home', '~/.qwen'],
      zed: ['project', './.zed'],
      hermes: ['home', '~/.hermes'],
      openclaw: ['home', '~/.openclaw'],
    };

    for (const [id, [scopeId, root]] of Object.entries(expected)) {
      const harness = getHarnessCapability(id);
      assert.strictEqual(harness.guidedReady, false, id);
      assert.strictEqual(harness.availability, 'advanced', id);
      assert.strictEqual(harness.destination, root, id);
      assert.deepStrictEqual(harness.scopes, [
        { id: scopeId, targetId: id, root },
      ], id);
    }
  })) passed++; else failed++;

  if (test('describes hook capability without claiming Kimi provider support is absent', () => {
    assert.strictEqual(getHarnessCapability('claude').hooks.mode, 'profile-selection');
    assert.strictEqual(getHarnessCapability('codex').hooks.mode, 'native-trust');

    const kimiHooks = getHarnessCapability('kimi').hooks;
    assert.strictEqual(kimiHooks.mode, 'not-configured');
    assert.strictEqual(kimiHooks.eccConfigured, false);
    assert.match(kimiHooks.note, /ECC hooks are not configured/i);
    assert.strictEqual(kimiHooks.summary, kimiHooks.note);
    assert.doesNotMatch(kimiHooks.note, /provider.*unsupported|Kimi.*unsupported/i);
  })) passed++; else failed++;

  if (test('does not advertise unregistered Copilot, Kiro, or Pi harnesses', () => {
    for (const id of ['copilot', 'kiro', 'pi']) {
      assert.strictEqual(getHarnessCapability(id), null);
      assert.throws(
        () => normalizeHarnessSelection(id),
        /Unknown guided harness selection/
      );
    }
  })) passed++; else failed++;

  if (test('normalizes wizard selections into canonical guided order', () => {
    assert.deepStrictEqual(
      normalizeHarnessSelection(' KIMI CODE, Claude Code, kimi '),
      ['claude', 'kimi']
    );
    assert.deepStrictEqual(
      normalizeHarnessSelection(['3', 'claude-project', 'Codex']),
      ['claude', 'codex', 'kimi']
    );
    assert.deepStrictEqual(normalizeHarnessSelection('all'), ['claude', 'codex', 'kimi']);
    assert.deepStrictEqual(normalizeHarnessSelection('*'), ['claude', 'codex', 'kimi']);
  })) passed++; else failed++;

  if (test('rejects empty, ambiguous, advanced, and unknown wizard selections clearly', () => {
    assert.throws(() => normalizeHarnessSelection(''), /At least one guided harness/);
    assert.throws(() => normalizeHarnessSelection([]), /At least one guided harness/);
    assert.throws(() => normalizeHarnessSelection('none'), /At least one guided harness/);
    assert.throws(() => normalizeHarnessSelection('all,codex'), /cannot be combined/i);
    assert.throws(() => normalizeHarnessSelection('cursor'), /advanced.*not guided-ready/i);
    assert.throws(() => normalizeHarnessSelection('grok'), /Unknown guided harness selection/);
  })) passed++; else failed++;

  if (test('exports deeply frozen records while list helpers return safe array copies', () => {
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES));
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES[0]));
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES[0].targetIds));
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES[0].scopes));
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES[0].scopes[0]));
    assert.ok(Object.isFrozen(HARNESS_CAPABILITIES[0].hooks));
    assert.ok(Object.isFrozen(GUIDED_HARNESS_IDS));

    const first = listHarnessCapabilities();
    first.pop();
    assert.strictEqual(listHarnessCapabilities().length, 13);

    const guided = listGuidedHarnesses();
    guided.reverse();
    assert.deepStrictEqual(
      listGuidedHarnesses().map(harness => harness.id),
      ['claude', 'codex', 'kimi']
    );
  })) passed++; else failed++;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

if (require.main === module) {
  process.exit(runTests() ? 0 : 1);
}

module.exports = { runTests };
