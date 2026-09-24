/**
 * Tests for scripts/lib/install-manifests.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getInstallComponent,
  loadInstallManifests,
  listInstallComponents,
  listLegacyCompatibilityLanguages,
  listInstallModules,
  listInstallProfiles,
  resolveInstallPlan,
  resolveLegacyCompatibilitySelection,
  validateInstallModuleIds,
} = require('../../scripts/lib/install-manifests');

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

function createTestRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-manifests-'));
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  return root;
}

function cleanupTestRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeManifestSet(repoRoot, options = {}) {
  writeJson(path.join(repoRoot, 'manifests', 'install-modules.json'), {
    version: options.modulesVersion || 1,
    modules: options.modules || [],
  });
  writeJson(path.join(repoRoot, 'manifests', 'install-profiles.json'), {
    version: options.profilesVersion || 1,
    profiles: options.profiles || {},
  });

  if (Object.prototype.hasOwnProperty.call(options, 'components')) {
    writeJson(path.join(repoRoot, 'manifests', 'install-components.json'), {
      version: options.componentsVersion || 1,
      components: options.components,
    });
  }
}

function runTests() {
  console.log('\n=== Testing install-manifests.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('loads real project install manifests', () => {
    const manifests = loadInstallManifests();
    assert.ok(manifests.modules.length >= 1, 'Should load modules');
    assert.ok(Object.keys(manifests.profiles).length >= 1, 'Should load profiles');
    assert.ok(manifests.components.length >= 1, 'Should load components');
  })) passed++; else failed++;

  if (test('lists install profiles from the real project', () => {
    const profiles = listInstallProfiles();
    assert.ok(profiles.some(profile => profile.id === 'minimal'), 'Should include minimal profile');
    assert.ok(profiles.some(profile => profile.id === 'core'), 'Should include core profile');
    assert.ok(profiles.some(profile => profile.id === 'full'), 'Should include full profile');
  })) passed++; else failed++;

  if (test('lists install modules from the real project', () => {
    const modules = listInstallModules();
    assert.ok(modules.some(module => module.id === 'rules-core'), 'Should include rules-core');
    assert.ok(modules.some(module => module.id === 'orchestration'), 'Should include orchestration');
  })) passed++; else failed++;

  if (test('lists install components from the real project', () => {
    const components = listInstallComponents();
    assert.ok(components.some(component => component.id === 'lang:typescript'),
      'Should include lang:typescript');
    assert.ok(components.some(component => component.id === 'lang:c'),
      'Should include lang:c');
    assert.ok(components.some(component => component.id === 'capability:security'),
      'Should include capability:security');
    assert.ok(components.some(component => component.id === 'capability:machine-learning'),
      'Should include capability:machine-learning');
    assert.ok(components.some(component => component.id === 'agent:mle-reviewer'),
      'Should include agent:mle-reviewer');
    assert.ok(components.some(component => component.id === 'skill:mle-workflow'),
      'Should include skill:mle-workflow');
  })) passed++; else failed++;

  if (test('gets install component details and validates component IDs', () => {
    const component = getInstallComponent(' lang:typescript ');

    assert.strictEqual(component.id, 'lang:typescript');
    assert.strictEqual(component.family, 'language');
    assert.ok(component.moduleIds.length > 0, 'Should expose component module IDs');
    assert.strictEqual(component.moduleCount, component.moduleIds.length);
    assert.strictEqual(component.modules.length, component.moduleIds.length);
    assert.ok(component.modules.every(module => component.moduleIds.includes(module.id)));
    assert.ok(Array.isArray(component.targets));

    assert.throws(
      () => getInstallComponent(''),
      /An install component ID is required/
    );
    assert.throws(
      () => getInstallComponent('lang:missing'),
      /Unknown install component: lang:missing/
    );
  })) passed++; else failed++;

  if (test('validates install component filters', () => {
    const claudeComponents = listInstallComponents({ family: 'capability', target: 'claude' });
    assert.ok(claudeComponents.length > 0, 'Should list Claude capability components');
    assert.ok(claudeComponents.every(component => component.family === 'capability'));
    assert.ok(claudeComponents.every(component => component.targets.includes('claude')));

    assert.throws(
      () => listInstallComponents({ family: 'unknown' }),
      /Unknown component family: unknown/
    );
    assert.throws(
      () => listInstallComponents({ target: 'unknown-target' }),
      /Unknown install target: unknown-target/
    );
  })) passed++; else failed++;

  if (test('labels continuous-learning as a legacy v1 install surface', () => {
    const components = listInstallComponents({ family: 'skill' });
    const component = components.find(entry => entry.id === 'skill:continuous-learning');
    assert.ok(component, 'Should include skill:continuous-learning');
    assert.match(component.description, /legacy/i, 'Should label continuous-learning as legacy');
    assert.match(component.description, /continuous-learning-v2/, 'Should point new installs to continuous-learning-v2');
  })) passed++; else failed++;

  if (test('exposes continuous-learning-v2 as a single-skill install surface', () => {
    const component = getInstallComponent('skill:continuous-learning-v2');
    assert.strictEqual(component.id, 'skill:continuous-learning-v2');
    assert.deepStrictEqual(component.moduleIds, ['skill-continuous-learning-v2']);
    assert.ok(component.targets.includes('claude'), 'Should support Claude installs');

    const plan = resolveInstallPlan({
      includeComponentIds: ['skill:continuous-learning-v2'],
      target: 'claude',
    });
    assert.deepStrictEqual(plan.selectedModuleIds, ['skill-continuous-learning-v2']);
    assert.ok(
      plan.operations.some(operation => operation.sourceRelativePath === 'skills/continuous-learning-v2'),
      'Should plan only the continuous-learning-v2 skill path'
    );
  })) passed++; else failed++;

  if (test('lists supported legacy compatibility languages', () => {
    const languages = listLegacyCompatibilityLanguages();
    assert.ok(languages.includes('typescript'));
    assert.ok(languages.includes('python'));
    assert.ok(languages.includes('go'));
    assert.ok(languages.includes('golang'));
    assert.ok(languages.includes('kotlin'));
    assert.ok(languages.includes('rust'));
    assert.ok(languages.includes('ruby'));
    assert.ok(languages.includes('rails'));
    assert.ok(languages.includes('cpp'));
    assert.ok(languages.includes('c'));
    assert.ok(languages.includes('csharp'));
    assert.ok(languages.includes('fsharp'));
  })) passed++; else failed++;

  if (test('resolves a real project profile with target-specific skips', () => {
    const projectRoot = '/workspace/app';
    const plan = resolveInstallPlan({ profileId: 'developer', target: 'cursor', projectRoot });
    assert.ok(plan.selectedModuleIds.includes('rules-core'), 'Should keep rules-core');
    assert.ok(plan.selectedModuleIds.includes('commands-core'), 'Should keep commands-core');
    assert.ok(!plan.selectedModuleIds.includes('orchestration'),
      'Should not select unsupported orchestration module for cursor');
    assert.ok(plan.skippedModuleIds.includes('orchestration'),
      'Should report unsupported orchestration module as skipped');
    assert.strictEqual(plan.targetAdapterId, 'cursor-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.cursor'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.cursor', 'ecc-install-state.json'));
    assert.ok(plan.operations.length > 0, 'Should include scaffold operations');
    assert.ok(
      plan.operations.some(operation => (
        operation.sourceRelativePath === '.cursor/hooks.json'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'hooks.json')
        && operation.strategy === 'preserve-relative-path'
      )),
      'Should preserve non-rule Cursor platform files'
    );
    assert.ok(
      plan.operations.some(operation => (
        operation.sourceRelativePath === '.mcp.json'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'mcp.json')
        && operation.kind === 'merge-json'
        && operation.strategy === 'merge-json'
      )),
      'Should materialize Cursor MCP config at the native project path'
    );
    assert.ok(
      plan.operations.some(operation => (
        operation.sourceRelativePath === '.cursor/rules/common-agents.md'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-agents.mdc')
        && operation.strategy === 'flatten-copy'
      )),
      'Should produce Cursor .mdc rules while preferring native Cursor platform copies over duplicate rules-core files'
    );
  })) passed++; else failed++;

  if (test('resolves antigravity profiles while skipping only unsupported modules', () => {
    const projectRoot = '/workspace/app';
    const plan = resolveInstallPlan({ profileId: 'core', target: 'antigravity', projectRoot });

    assert.deepStrictEqual(
      plan.selectedModuleIds,
      ['rules-core', 'agents-core', 'commands-core', 'platform-configs', 'workflow-quality']
    );
    assert.ok(plan.skippedModuleIds.includes('hooks-runtime'));
    assert.ok(!plan.skippedModuleIds.includes('platform-configs'));
    assert.ok(!plan.skippedModuleIds.includes('workflow-quality'));
    assert.strictEqual(plan.targetAdapterId, 'antigravity-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.agent'));
  })) passed++; else failed++;

  if (test('resolves minimal profile without the hook runtime', () => {
    const plan = resolveInstallPlan({
      profileId: 'minimal',
      target: 'claude',
      projectRoot: '/workspace/app',
    });

    assert.deepStrictEqual(
      plan.selectedModuleIds,
      ['rules-core', 'agents-core', 'commands-core', 'platform-configs', 'workflow-quality']
    );
    assert.ok(!plan.selectedModuleIds.includes('hooks-runtime'),
      'minimal profile should not install hooks-runtime');
    assert.ok(plan.operations.length > 0, 'Should include install operations');
  })) passed++; else failed++;

  if (test('resolves Qwen minimal profile while leaving hooks out', () => {
    const homeDir = '/Users/example';
    const plan = resolveInstallPlan({
      profileId: 'minimal',
      target: 'qwen',
      homeDir,
    });

    assert.deepStrictEqual(
      plan.selectedModuleIds,
      ['rules-core', 'agents-core', 'commands-core', 'platform-configs', 'workflow-quality']
    );
    assert.deepStrictEqual(plan.skippedModuleIds, []);
    assert.strictEqual(plan.targetAdapterId, 'qwen-home');
    assert.strictEqual(plan.targetRoot, path.join(homeDir, '.qwen'));
    assert.ok(
      plan.operations.some(operation => operation.sourceRelativePath === '.qwen'),
      'Should install Qwen native config'
    );
    assert.ok(
      !plan.operations.some(operation => operation.destinationPath.includes(`${path.sep}hooks`)),
      'Qwen minimal profile should not install hook runtime files'
    );
  })) passed++; else failed++;

  if (test('resolves Zed minimal profile with project settings and without hooks', () => {
    const projectRoot = '/workspace/zed-app';
    const plan = resolveInstallPlan({
      profileId: 'minimal',
      target: 'zed',
      projectRoot,
    });

    assert.deepStrictEqual(
      plan.selectedModuleIds,
      ['rules-core', 'agents-core', 'commands-core', 'platform-configs', 'workflow-quality']
    );
    assert.deepStrictEqual(plan.skippedModuleIds, []);
    assert.strictEqual(plan.targetAdapterId, 'zed-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.zed'));
    assert.ok(
      plan.operations.some(operation => operation.sourceRelativePath === '.zed'),
      'Should install Zed native project settings'
    );
    assert.ok(
      !plan.selectedModuleIds.includes('hooks-runtime')
      && !plan.operations.some(operation => operation.moduleId === 'hooks-runtime'),
      'Zed minimal profile should not install hook runtime files'
    );
  })) passed++; else failed++;

  if (test('resolves machine-learning component with workflow dependencies', () => {
    const plan = resolveInstallPlan({
      includeComponentIds: ['capability:machine-learning'],
      target: 'claude',
      projectRoot: '/workspace/ml-app',
    });

    assert.ok(plan.selectedModuleIds.includes('machine-learning'),
      'Should include machine-learning module');
    assert.ok(plan.selectedModuleIds.includes('framework-language'),
      'Should include Python and framework-language support');
    assert.ok(plan.selectedModuleIds.includes('workflow-quality'),
      'Should include eval and verification workflows');
    assert.ok(plan.selectedModuleIds.includes('database'),
      'Should include database/data persistence support');
    assert.ok(plan.selectedModuleIds.includes('devops-infra'),
      'Should include deployment and container support');
    assert.ok(plan.selectedModuleIds.includes('security'),
      'Should include security through machine-learning dependencies');
    assert.ok(plan.operations.some(operation => (
      operation.sourceRelativePath === 'skills/mle-workflow'
    )), 'Should install the MLE workflow skill');
  })) passed++; else failed++;

  if (test('resolves machine-learning component on JoyCode and Qwen targets', () => {
    for (const target of ['joycode', 'qwen']) {
      const plan = resolveInstallPlan({
        includeComponentIds: ['capability:machine-learning'],
        target,
        projectRoot: '/workspace/ml-app',
        homeDir: '/Users/example',
      });

      assert.ok(plan.selectedModuleIds.includes('machine-learning'),
        `Should include machine-learning module for ${target}`);
      assert.ok(!plan.skippedModuleIds.includes('machine-learning'),
        `Should not skip machine-learning module for ${target}`);
      assert.ok(plan.operations.some(operation => (
        operation.sourceRelativePath === 'skills/mle-workflow'
      )), `Should install the MLE workflow skill for ${target}`);
    }
  })) passed++; else failed++;

  if (test('minimal machine-learning install includes MLE reviewer agent surface', () => {
    const plan = resolveInstallPlan({
      profileId: 'minimal',
      includeComponentIds: ['capability:machine-learning'],
      target: 'claude',
      projectRoot: '/workspace/ml-app',
    });

    assert.ok(plan.selectedModuleIds.includes('agents-core'),
      'Minimal install should keep the agent surface available');
    assert.ok(plan.operations.some(operation => (
      operation.sourceRelativePath === 'agents'
    )), 'Should install the agent directory that contains mle-reviewer.md');
    assert.ok(plan.operations.some(operation => (
      operation.sourceRelativePath === 'skills/mle-workflow'
    )), 'Should install the MLE workflow skill');
  })) passed++; else failed++;

  if (test('resolves explicit modules with dependency expansion', () => {
    const plan = resolveInstallPlan({ moduleIds: ['security'] });
    assert.ok(plan.selectedModuleIds.includes('security'), 'Should include requested module');
    assert.ok(plan.selectedModuleIds.includes('workflow-quality'),
      'Should include transitive dependency');
    assert.ok(plan.selectedModuleIds.includes('platform-configs'),
      'Should include nested dependency');
  })) passed++; else failed++;

  if (test('validates explicit module IDs against the real manifest catalog', () => {
    const moduleIds = validateInstallModuleIds(['security', 'security', 'platform-configs']);
    assert.deepStrictEqual(moduleIds, ['security', 'platform-configs']);
    assert.throws(
      () => validateInstallModuleIds(['ghost-module']),
      /Unknown install module: ghost-module/
    );
    assert.throws(
      () => validateInstallModuleIds(['ghost-one', 'ghost-two']),
      /Unknown install modules: ghost-one, ghost-two/
    );
  })) passed++; else failed++;

  if (test('resolves legacy compatibility selections into manifest module IDs', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['typescript', 'go', 'golang'],
    });

    assert.deepStrictEqual(selection.legacyLanguages, ['typescript', 'go', 'golang']);
    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('agents-core'));
    assert.ok(selection.moduleIds.includes('commands-core'));
    assert.ok(selection.moduleIds.includes('hooks-runtime'));
    assert.ok(selection.moduleIds.includes('platform-configs'));
    assert.ok(selection.moduleIds.includes('workflow-quality'));
    assert.ok(selection.moduleIds.includes('framework-language'));
  })) passed++; else failed++;

  if (test('resolves rust legacy compatibility into framework-language module', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['rust'],
    });

    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('framework-language'),
      'rust should resolve to framework-language module');
  })) passed++; else failed++;

  if (test('resolves cpp legacy compatibility into framework-language module', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['cpp'],
    });

    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('framework-language'),
      'cpp should resolve to framework-language module');
  })) passed++; else failed++;

  if (test('resolves c legacy compatibility into framework-language module', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['c'],
    });

    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('framework-language'),
      'c should resolve to framework-language module');
  })) passed++; else failed++;

  if (test('resolves csharp legacy compatibility into framework-language module', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['csharp'],
    });

    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('framework-language'),
      'csharp should resolve to framework-language module');
  })) passed++; else failed++;

  if (test('resolves fsharp legacy compatibility into framework-language module', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['fsharp'],
    });

    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.ok(selection.moduleIds.includes('framework-language'),
      'fsharp should resolve to framework-language module');
  })) passed++; else failed++;

  if (test('resolves ruby and rails legacy compatibility into framework-language and security modules', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'cursor',
      legacyLanguages: ['ruby', 'rails'],
    });

    assert.deepStrictEqual(selection.canonicalLegacyLanguages, ['ruby', 'ruby']);
    assert.ok(selection.moduleIds.includes('rules-core'));
    assert.strictEqual(selection.moduleIds.filter(moduleId => moduleId === 'framework-language').length, 1);
    assert.strictEqual(selection.moduleIds.filter(moduleId => moduleId === 'security').length, 1);
    assert.ok(selection.moduleIds.includes('framework-language'),
      'ruby should resolve to framework-language module');
    assert.ok(selection.moduleIds.includes('security'),
      'rails alias should add security guidance for Rails apps');
  })) passed++; else failed++;

  if (test('keeps antigravity legacy compatibility selections target-safe', () => {
    const selection = resolveLegacyCompatibilitySelection({
      target: 'antigravity',
      legacyLanguages: ['typescript'],
    });

    assert.deepStrictEqual(selection.moduleIds, ['rules-core', 'agents-core', 'commands-core']);
  })) passed++; else failed++;

  if (test('rejects unknown legacy compatibility languages', () => {
    assert.throws(
      () => resolveLegacyCompatibilitySelection({
        target: 'cursor',
        legacyLanguages: ['brainfuck'],
      }),
      /Unknown legacy language: brainfuck/
    );
    assert.throws(
      () => resolveLegacyCompatibilitySelection({
        legacyLanguages: [],
      }),
      /No legacy languages were provided/
    );
    assert.throws(
      () => resolveLegacyCompatibilitySelection({
        target: 'not-a-target',
        legacyLanguages: ['typescript'],
      }),
      /Unknown install target: not-a-target/
    );
    assert.throws(
      () => resolveLegacyCompatibilitySelection({
        legacyLanguages: ['brainfuck', 'whitespace'],
      }),
      /Unknown legacy languages: brainfuck, whitespace/
    );
  })) passed++; else failed++;

  if (test('resolves included and excluded user-facing components', () => {
    const plan = resolveInstallPlan({
      profileId: 'core',
      includeComponentIds: ['capability:security'],
      excludeComponentIds: ['capability:orchestration'],
      target: 'claude',
    });

    assert.deepStrictEqual(plan.includedComponentIds, ['capability:security']);
    assert.deepStrictEqual(plan.excludedComponentIds, ['capability:orchestration']);
    assert.ok(plan.selectedModuleIds.includes('security'), 'Should include modules from selected components');
    assert.ok(!plan.selectedModuleIds.includes('orchestration'), 'Should exclude modules from excluded components');
    assert.ok(plan.excludedModuleIds.includes('orchestration'),
      'Should report modules removed by excluded components');
  })) passed++; else failed++;

  if (test('fails when a selected component depends on an excluded component module', () => {
    assert.throws(
      () => resolveInstallPlan({
        includeComponentIds: ['capability:social'],
        excludeComponentIds: ['capability:content'],
      }),
      /depends on excluded module business-content/
    );
  })) passed++; else failed++;

  if (test('throws on unknown install profile', () => {
    assert.throws(
      () => resolveInstallPlan({ profileId: 'ghost-profile' }),
      /Unknown install profile/
    );
  })) passed++; else failed++;

  if (test('throws on unknown install target', () => {
    assert.throws(
      () => resolveInstallPlan({ profileId: 'core', target: 'not-a-target' }),
      /Unknown install target/
    );
  })) passed++; else failed++;

  if (test('rejects empty, unknown, and fully excluded install selections', () => {
    const repoRoot = createTestRepo();
    try {
      writeManifestSet(repoRoot, {
        modules: [
          {
            id: 'core',
            kind: 'rules',
            description: 'Core',
            paths: ['rules/core.md'],
            targets: ['claude'],
            dependencies: [],
            defaultInstall: true,
            cost: 'light',
            stability: 'stable'
          }
        ],
        profiles: {
          core: { description: 'Core', modules: ['core'] }
        },
        components: [
          {
            id: 'capability:core',
            family: 'capability',
            description: 'Core',
            modules: ['core']
          }
        ],
      });

      assert.throws(
        () => resolveInstallPlan({ repoRoot }),
        /No install profile, module IDs, or included component IDs were provided/
      );
      assert.throws(
        () => resolveInstallPlan({ repoRoot, moduleIds: ['missing'] }),
        /Unknown install module: missing/
      );
      assert.throws(
        () => resolveInstallPlan({ repoRoot, includeComponentIds: ['capability:missing'] }),
        /Unknown install component: capability:missing/
      );
      assert.throws(
        () => resolveInstallPlan({
          repoRoot,
          profileId: 'core',
          excludeComponentIds: ['capability:core'],
        }),
        /Selection excludes every requested install module/
      );
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  if (test('validates projectRoot and homeDir option types before adapter planning', () => {
    assert.throws(
      () => resolveInstallPlan({ profileId: 'core', target: 'cursor', projectRoot: 42 }),
      /projectRoot must be a non-empty string when provided/
    );
    assert.throws(
      () => resolveInstallPlan({ profileId: 'core', target: 'claude', homeDir: {} }),
      /homeDir must be a non-empty string when provided/
    );
  })) passed++; else failed++;

  if (test('skips a requested module when its dependency chain does not support the target', () => {
    const repoRoot = createTestRepo();
    try {
      writeJson(path.join(repoRoot, 'manifests', 'install-modules.json'), {
        version: 1,
        modules: [
          {
            id: 'parent',
            kind: 'skills',
            description: 'Parent',
            paths: ['parent'],
            targets: ['claude'],
            dependencies: ['child'],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          },
          {
            id: 'child',
            kind: 'skills',
            description: 'Child',
            paths: ['child'],
            targets: ['cursor'],
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ]
      });
      writeJson(path.join(repoRoot, 'manifests', 'install-profiles.json'), {
        version: 1,
        profiles: {
          core: { description: 'Core', modules: ['parent'] }
        }
      });

      const plan = resolveInstallPlan({ repoRoot, profileId: 'core', target: 'claude' });
      assert.deepStrictEqual(plan.selectedModuleIds, []);
      assert.deepStrictEqual(plan.skippedModuleIds, ['parent']);
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  if (test('rejects missing, malformed, and unsupported manifest fixtures', () => {
    const repoRoot = createTestRepo();
    try {
      assert.throws(
        () => loadInstallManifests({ repoRoot }),
        /Install manifests not found/
      );

      fs.writeFileSync(path.join(repoRoot, 'manifests', 'install-modules.json'), '{ bad json');
      writeJson(path.join(repoRoot, 'manifests', 'install-profiles.json'), {
        version: 1,
        profiles: {},
      });
      assert.throws(
        () => loadInstallManifests({ repoRoot }),
        /Failed to read install-modules\.json/
      );

      writeManifestSet(repoRoot, {
        modules: [
          {
            id: 'empty-target',
            kind: 'rules',
            description: 'Empty target',
            paths: ['rules/core.md'],
            targets: ['claude', ''],
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ],
        profiles: {},
      });
      assert.throws(
        () => loadInstallManifests({ repoRoot }),
        /Install module empty-target has invalid targets/
      );

      writeManifestSet(repoRoot, {
        modules: [
          {
            id: 'unsupported-target',
            kind: 'rules',
            description: 'Unsupported target',
            paths: ['rules/core.md'],
            targets: ['claude', 'moonbase'],
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ],
        profiles: {},
      });
      assert.throws(
        () => loadInstallManifests({ repoRoot }),
        /Install module unsupported-target has unsupported targets: moonbase/
      );

      writeManifestSet(repoRoot, {
        modules: [
          {
            id: 'core',
            kind: 'rules',
            description: 'Core',
            paths: ['rules/core.md'],
            targets: ['claude'],
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ],
        profiles: {
          core: { description: 'Core', modules: ['core'] }
        },
      });
      const manifests = loadInstallManifests({ repoRoot });
      assert.deepStrictEqual(manifests.components, []);
      assert.strictEqual(manifests.componentsVersion, null);
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  if (test('fails fast when install manifest module targets is not an array', () => {
    const repoRoot = createTestRepo();
    try {
      writeJson(path.join(repoRoot, 'manifests', 'install-modules.json'), {
        version: 1,
        modules: [
          {
            id: 'parent',
            kind: 'skills',
            description: 'Parent',
            paths: ['parent'],
            targets: 'claude',
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ]
      });
      writeJson(path.join(repoRoot, 'manifests', 'install-profiles.json'), {
        version: 1,
        profiles: {
          core: { description: 'Core', modules: ['parent'] }
        }
      });

      assert.throws(
        () => resolveInstallPlan({ repoRoot, profileId: 'core', target: 'claude' }),
        /Install module parent has invalid targets; expected an array of supported target ids/
      );
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  if (test('keeps antigravity modules selected while filtering unsupported source paths', () => {
    const repoRoot = createTestRepo();
    try {
      writeJson(path.join(repoRoot, 'manifests', 'install-modules.json'), {
        version: 1,
        modules: [
          {
            id: 'unsupported-antigravity',
            kind: 'skills',
            description: 'Unsupported',
            paths: ['.cursor', 'skills/example'],
            targets: ['antigravity'],
            dependencies: [],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ]
      });
      writeJson(path.join(repoRoot, 'manifests', 'install-profiles.json'), {
        version: 1,
        profiles: {
          core: { description: 'Core', modules: ['unsupported-antigravity'] }
        }
      });

      const plan = resolveInstallPlan({
        repoRoot,
        profileId: 'core',
        target: 'antigravity',
        projectRoot: '/workspace/app',
      });
      assert.deepStrictEqual(plan.selectedModuleIds, ['unsupported-antigravity']);
      assert.deepStrictEqual(plan.skippedModuleIds, []);
      assert.ok(
        plan.operations.every(operation => operation.sourceRelativePath !== '.cursor'),
        'Unsupported antigravity paths should be filtered from planned operations'
      );
      assert.ok(
        plan.operations.some(operation => operation.sourceRelativePath === 'skills/example'),
        'Supported antigravity skill paths should still be planned'
      );
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  if (test('detects circular install dependencies', () => {
    const repoRoot = createTestRepo();
    try {
      writeManifestSet(repoRoot, {
        modules: [
          {
            id: 'alpha',
            kind: 'skills',
            description: 'Alpha',
            paths: ['skills/alpha'],
            targets: ['claude'],
            dependencies: ['beta'],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          },
          {
            id: 'beta',
            kind: 'skills',
            description: 'Beta',
            paths: ['skills/beta'],
            targets: ['claude'],
            dependencies: ['alpha'],
            defaultInstall: false,
            cost: 'light',
            stability: 'stable'
          }
        ],
        profiles: {
          core: { description: 'Core', modules: ['alpha'] }
        },
      });

      assert.throws(
        () => resolveInstallPlan({ repoRoot, profileId: 'core' }),
        /Circular install dependency detected at alpha/
      );
    } finally {
      cleanupTestRepo(repoRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
