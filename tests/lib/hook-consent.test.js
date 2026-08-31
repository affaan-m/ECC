/**
 * Tests for scripts/lib/install/hook-consent.js
 */

const assert = require('assert');

const {
  HOOK_CAPABILITY_GROUPS,
  assertHookConsentReady,
  formatHookCapabilityDisclosure,
  isHookRuntimeOperation,
  planMaterializesHookRuntime,
  resolveHookConsentFlags,
  withHookConsent,
} = require('../../scripts/lib/install/hook-consent');

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

function buildHookPlan() {
  return {
    operations: [
      { kind: 'copy-file', moduleId: 'rules-core', sourceRelativePath: 'rules/common.md', destinationPath: '/target/rules/common.md' },
      { kind: 'copy-file', moduleId: 'hooks-runtime', sourceRelativePath: 'hooks/hooks.json', destinationPath: '/target/hooks/hooks.json' },
      { kind: 'copy-file', moduleId: 'hooks-runtime', sourceRelativePath: 'scripts/hooks/session-start.js', destinationPath: '/target/scripts/hooks/session-start.js' },
    ],
    selectedModuleIds: ['rules-core', 'hooks-runtime'],
    excludedModuleIds: [],
    statePreview: {
      request: {
        profile: 'core',
        modules: [],
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      operations: [
        { kind: 'copy-file', moduleId: 'rules-core', sourceRelativePath: 'rules/common.md', destinationPath: '/target/rules/common.md' },
        { kind: 'copy-file', moduleId: 'hooks-runtime', sourceRelativePath: 'hooks/hooks.json', destinationPath: '/target/hooks/hooks.json' },
      ],
      resolution: { selectedModules: ['rules-core', 'hooks-runtime'], skippedModules: [] },
    },
  };
}

function runTests() {
  console.log('\n=== Testing install/hook-consent.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('declares six frozen capability groups with ids and descriptions', () => {
    assert.strictEqual(HOOK_CAPABILITY_GROUPS.length, 6);
    assert.ok(Object.isFrozen(HOOK_CAPABILITY_GROUPS));
    for (const group of HOOK_CAPABILITY_GROUPS) {
      assert.ok(group.id && group.description);
    }
  })) passed++; else failed++;

  if (test('matches hook runtime operations by module id and source path', () => {
    assert.strictEqual(isHookRuntimeOperation({ moduleId: 'hooks-runtime' }), true);
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: 'hooks/hooks.json' }), true);
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: '.cursor/hooks.json' }), true);
    assert.strictEqual(isHookRuntimeOperation({ destinationPath: '/root/.claude/hooks/hooks.json' }), true);
    assert.strictEqual(
      isHookRuntimeOperation({
        moduleId: 'platform-configs',
        sourceRelativePath: '.opencode/plugins/ecc-hooks.ts',
        destinationPath: '/root/.config/opencode/plugins/ecc-hooks.ts',
      }),
      false
    );
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: 'rules/common.md' }), false);
    assert.strictEqual(
      isHookRuntimeOperation({ sourceRelativePath: 'skills/webhooks-guide.md' }),
      false
    );
  })) passed++; else failed++;

  if (test('detects hook materialization from plan operations only', () => {
    assert.strictEqual(planMaterializesHookRuntime(buildHookPlan()), true);
    assert.strictEqual(planMaterializesHookRuntime({
      operations: [{ moduleId: 'rules-core', sourceRelativePath: 'rules/common.md' }],
      selectedModuleIds: ['rules-core'],
    }), false);
    assert.strictEqual(planMaterializesHookRuntime({}), false);
  })) passed++; else failed++;

  if (test('formats one numbered disclosure line per capability group', () => {
    const disclosure = formatHookCapabilityDisclosure();
    const lines = disclosure.split('\n');
    assert.strictEqual(lines.length, HOOK_CAPABILITY_GROUPS.length);
    assert.ok(lines[0].includes('1.'));
    assert.ok(disclosure.includes('format or otherwise modify project source files'));
  })) passed++; else failed++;

  if (test('resolves consent flags and rejects contradictions', () => {
    assert.strictEqual(resolveHookConsentFlags({ enableHooks: true }), 'enabled');
    assert.strictEqual(resolveHookConsentFlags({ noHooks: true }), 'declined');
    assert.strictEqual(resolveHookConsentFlags({}), null);
    assert.throws(
      () => resolveHookConsentFlags({ enableHooks: true, noHooks: true }),
      /mutually exclusive/
    );
  })) passed++; else failed++;

  if (test('withHookConsent attaches the decision without mutating enabled plans', () => {
    const plan = buildHookPlan();
    const enabled = withHookConsent(plan, 'enabled');
    assert.strictEqual(enabled.hookConsent, 'enabled');
    assert.strictEqual(enabled.operations.length, 3);
    assert.strictEqual(enabled.statePreview.request.hookConsent, 'enabled');
    const unset = withHookConsent(plan, null);
    assert.strictEqual(unset.hookConsent, null);
    assert.strictEqual(unset.statePreview.request.hookConsent, null);
    assert.throws(() => withHookConsent(plan, 'maybe'), /Unknown hook consent decision/);
  })) passed++; else failed++;

  if (test('declined consent strips the hook runtime from plan and state preview', () => {
    const declined = withHookConsent(buildHookPlan(), 'declined');
    assert.strictEqual(declined.hookConsent, 'declined');
    assert.strictEqual(declined.operations.length, 1);
    assert.deepStrictEqual(declined.selectedModuleIds, ['rules-core']);
    assert.deepStrictEqual(declined.excludedModuleIds, ['hooks-runtime']);
    assert.strictEqual(declined.statePreview.operations.length, 1);
    assert.strictEqual(declined.statePreview.request.hookConsent, 'declined');
    assert.deepStrictEqual(declined.statePreview.resolution.selectedModules, ['rules-core']);
  })) passed++; else failed++;

  if (test('assertHookConsentReady holds hook materialization without consent', () => {
    assert.throws(() => assertHookConsentReady(buildHookPlan()), /automatic hook runtime/);
    assert.throws(
      () => assertHookConsentReady(buildHookPlan()),
      /--enable-hooks/
    );
    assert.doesNotThrow(() => assertHookConsentReady(withHookConsent(buildHookPlan(), 'enabled')));
    assert.doesNotThrow(() => assertHookConsentReady({
      operations: [{ moduleId: 'rules-core', sourceRelativePath: 'rules/common.md' }],
    }));
    assert.doesNotThrow(() => assertHookConsentReady(withHookConsent(buildHookPlan(), 'declined')));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
