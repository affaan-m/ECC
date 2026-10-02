/**
 * Tests for scripts/lib/install/hook-consent.js
 */

const assert = require('assert');

const {
  HOOK_CAPABILITY_GROUPS,
  assertHookConsentReady,
  disableOpenCodeHookPluginRegistration,
  formatHookCapabilityDisclosure,
  getRecordedHookConsent,
  isHookRuntimeOperation,
  isOpenCodePluginEntrypoint,
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
  const managedHooks = {
    SessionStart: [{
      id: 'session:start',
      matcher: '.*',
      hooks: [{ type: 'command', command: 'node /target/scripts/hooks/session-start.js' }],
    }],
  };
  return {
    operations: [
      { kind: 'copy-file', moduleId: 'rules-core', sourceRelativePath: 'rules/common.md', destinationPath: '/target/rules/common.md' },
      {
        kind: 'update-claude-settings',
        moduleId: 'hooks-runtime',
        sourceRelativePath: 'hooks/hooks.json',
        destinationPath: '/target/settings.json',
        managedHooks,
      },
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
        {
          kind: 'update-claude-settings',
          moduleId: 'hooks-runtime',
          sourceRelativePath: 'hooks/hooks.json',
          destinationPath: '/target/settings.json',
          managedHooks,
        },
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
    assert.strictEqual(isHookRuntimeOperation({ kind: 'update-claude-settings' }), true);
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: 'hooks/hooks.json' }), true);
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: '.cursor/hooks.json' }), true);
    assert.strictEqual(isHookRuntimeOperation({ destinationPath: '/root/.claude/hooks/hooks.json' }), true);
    assert.strictEqual(
      isHookRuntimeOperation({
        moduleId: 'platform-configs',
        sourceRelativePath: '.opencode/plugins/ecc-hooks.ts',
        destinationPath: '/root/.config/opencode/plugins/ecc-hooks.ts',
      }),
      true
    );
    assert.strictEqual(isHookRuntimeOperation({
      kind: 'copy-file',
      moduleId: 'platform-configs',
      sourceRelativePath: '.opencode/opencode.json',
    }), true);
    assert.strictEqual(isHookRuntimeOperation({
      kind: 'copy-file',
      moduleId: 'platform-configs',
      sourceRelativePath: '.opencode/opencode.json',
      contentTransform: 'opencode-disable-ecc-hooks',
    }), false);
    assert.strictEqual(isHookRuntimeOperation({
      kind: 'merge-json',
      moduleId: 'platform-configs',
      sourceRelativePath: '.opencode/opencode.json',
      contentTransform: 'opencode-disable-ecc-hooks',
    }), true);
    assert.strictEqual(isHookRuntimeOperation({ sourceRelativePath: 'rules/common.md' }), false);
    assert.strictEqual(
      isHookRuntimeOperation({ sourceRelativePath: 'skills/webhooks-guide.md' }),
      false
    );
  })) passed++; else failed++;

  if (test('OpenCode auto-discovered entrypoints require selected runtime and consent', () => {
    const entrypoints = ['.opencode/plugins/ecc-hooks.ts', '.opencode/plugins/index.ts'];
    const operations = entrypoints.map(sourceRelativePath => ({
      kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath,
    }));
    const base = {
      target: 'opencode', operations, selectedModuleIds: ['platform-configs'],
      statePreview: { operations, request: {}, resolution: { selectedModules: ['platform-configs'] } },
    };
    for (const decision of [null, 'enabled', 'declined']) {
      const plan = withHookConsent(base, decision);
      for (const operation of [...plan.operations, ...plan.statePreview.operations]) {
        assert.strictEqual(operation.contentTransform, 'opencode-disable-plugin-entrypoint');
        assert.strictEqual(isHookRuntimeOperation(operation), false);
      }
      assert.doesNotThrow(() => assertHookConsentReady(plan));
    }
    const selected = { ...base, selectedModuleIds: ['platform-configs', 'hooks-runtime'] };
    const pending = withHookConsent(selected, null);
    assert.throws(() => assertHookConsentReady(pending), /automatic hook runtime/);
    const enabled = withHookConsent(selected, 'enabled');
    assert.ok(enabled.operations.every(operation => operation.contentTransform === undefined));
    assert.doesNotThrow(() => assertHookConsentReady(enabled));
    const declined = withHookConsent(selected, 'declined');
    assert.strictEqual(declined.operations.length, 2);
    assert.ok(declined.operations.every(operation => (
      operation.contentTransform === 'opencode-disable-plugin-entrypoint'
    )));
    assert.ok(operations.every(operation => operation.contentTransform === undefined), 'Input plan stays unchanged');
    assert.strictEqual(isHookRuntimeOperation({
      kind: 'copy-file', moduleId: 'platform-configs',
      sourceRelativePath: '.opencode/plugins/helpers/readme.md',
    }), false);
  })) passed++; else failed++;

  if (test('detects hook materialization from plan operations only', () => {
    assert.strictEqual(planMaterializesHookRuntime(buildHookPlan()), true);
    assert.strictEqual(planMaterializesHookRuntime({
      operations: [{ moduleId: 'rules-core', sourceRelativePath: 'rules/common.md' }],
      selectedModuleIds: ['rules-core'],
    }), false);
    assert.strictEqual(planMaterializesHookRuntime({}), false);
  })) passed++; else failed++;

  if (test('removes only ECC hook activation from OpenCode config', () => {
    const transformed = disableOpenCodeHookPluginRegistration(JSON.stringify({
      plugin: ['./plugins', 'example-plugin'],
      instructions: ['AGENTS.md'],
    }), '.opencode/opencode.json');
    assert.deepStrictEqual(JSON.parse(transformed), {
      plugin: ['example-plugin'],
      instructions: ['AGENTS.md'],
    });
    assert.deepStrictEqual(JSON.parse(disableOpenCodeHookPluginRegistration(
      JSON.stringify({ instructions: ['AGENTS.md'] }),
      '.opencode/opencode.json'
    )), {
      instructions: ['AGENTS.md'],
    });
  })) passed++; else failed++;

  if (test('historical OpenCode activation bytes alone do not imply hook consent', () => {
    const state = {
      request: {}, resolution: { selectedModules: ['platform-configs'] },
      operations: [
        { kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath: '.opencode/opencode.json' },
        { kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath: '.opencode/plugins/ecc-hooks.ts' },
      ],
    };
    assert.strictEqual(getRecordedHookConsent(state), null);
    assert.strictEqual(getRecordedHookConsent({ ...state, request: { hookConsent: 'declined' } }), 'declined');
    assert.strictEqual(getRecordedHookConsent({ ...state, request: { hookConsent: 'enabled' } }), 'enabled');
    assert.strictEqual(getRecordedHookConsent({ ...state, resolution: { selectedModules: ['hooks-runtime'] } }), 'enabled');
    assert.strictEqual(getRecordedHookConsent({ operations: [{ kind: 'update-claude-settings' }] }), 'enabled');
  })) passed++; else failed++;

  if (test('source classification covers nested JavaScript but refuses package metadata deactivation', () => {
    for (const extension of ['ts', 'js', 'mjs', 'cjs']) {
      for (const sourceRelativePath of [`.opencode/plugins/custom/index.${extension}`,
        `.OPENCODE\\DIST\\PLUGINS\\CUSTOM\\INDEX.${extension.toUpperCase()}`]) {
        const operation = { kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath };
        assert.strictEqual(isOpenCodePluginEntrypoint(operation), true, sourceRelativePath);
        const plan = withHookConsent({ target: 'opencode', operations: [operation], selectedModuleIds: [] });
        assert.strictEqual(plan.operations[0].contentTransform, 'opencode-disable-plugin-entrypoint');
      }
    }
    const operation = { kind: 'copy-file', sourceRelativePath: '.opencode/plugins/custom/package.json' };
    for (const decision of [null, 'declined']) {
      assert.throws(() => withHookConsent({ target: 'opencode', operations: [operation], selectedModuleIds: [] }, decision),
        /unsupported.*package/i);
    }
    assert.strictEqual(isOpenCodePluginEntrypoint(operation), false);
    assert.strictEqual(isOpenCodePluginEntrypoint({ sourceRelativePath: '.opencode/plugins/lib/utility.js' }), false);
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
