/**
 * Tests for scripts/lib/install-targets/registry.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getInstallTargetAdapter,
  listInstallTargetAdapters,
  planInstallTargetScaffold,
} = require('../../scripts/lib/install-targets/registry');

function normalizedRelativePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

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
  console.log('\n=== Testing install-target adapters ===\n');

  let passed = 0;
  let failed = 0;

  if (test('lists supported target adapters', () => {
    const adapters = listInstallTargetAdapters();
    const targets = adapters.map(adapter => adapter.target);
    assert.ok(targets.includes('claude'), 'Should include claude target');
    assert.ok(targets.includes('claude-project'), 'Should include claude-project target');
    assert.ok(targets.includes('cursor'), 'Should include cursor target');
    assert.ok(targets.includes('antigravity'), 'Should include antigravity target');
    assert.ok(targets.includes('codex'), 'Should include codex target');
    assert.ok(targets.includes('gemini'), 'Should include gemini target');
    assert.ok(targets.includes('opencode'), 'Should include opencode target');
    assert.ok(targets.includes('codebuddy'), 'Should include codebuddy target');
    assert.ok(targets.includes('joycode'), 'Should include joycode target');
    assert.ok(targets.includes('qwen'), 'Should include qwen target');
    assert.ok(targets.includes('zed'), 'Should include zed target');
  })) passed++; else failed++;

  if (test('resolves cursor adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('cursor');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(root, path.join(projectRoot, '.cursor'));
    assert.strictEqual(statePath, path.join(projectRoot, '.cursor', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('resolves claude adapter root and install-state path from home dir', () => {
    const adapter = getInstallTargetAdapter('claude');
    const homeDir = '/Users/example';
    const root = adapter.resolveRoot({ homeDir, repoRoot: '/repo/ecc' });
    const statePath = adapter.getInstallStatePath({ homeDir, repoRoot: '/repo/ecc' });

    assert.strictEqual(root, path.join(homeDir, '.claude'));
    assert.strictEqual(statePath, path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
  })) passed++; else failed++;

  if (test('plans claude rules and skills under ECC-managed subdirectories', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const homeDir = '/Users/example';

    const plan = planInstallTargetScaffold({
      target: 'claude',
      repoRoot,
      homeDir,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'workflow-quality',
          paths: ['skills/tdd-workflow'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules'
        && operation.destinationPath === path.join(homeDir, '.claude', 'rules', 'ecc')
      )),
      'Should install bundled Claude rules under rules/ecc'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'skills/tdd-workflow'
        && operation.destinationPath === path.join(homeDir, '.claude', 'skills', 'ecc', 'tdd-workflow')
      )),
      'Should install bundled Claude skills under skills/ecc'
    );
  })) passed++; else failed++;

  if (test('plans scaffold operations and flattens native target roots', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';
    const modules = [
      {
        id: 'platform-configs',
        paths: ['.cursor', 'mcp-configs'],
      },
      {
        id: 'rules-core',
        paths: ['rules'],
      },
    ];

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules,
    });

    assert.strictEqual(plan.adapter.id, 'cursor-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.cursor'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.cursor', 'ecc-install-state.json'));

    const hooksJson = plan.operations.find(operation => (
      normalizedRelativePath(operation.sourceRelativePath) === '.cursor/hooks.json'
    ));
    const mcpJson = plan.operations.find(operation => (
      normalizedRelativePath(operation.sourceRelativePath) === '.mcp.json'
    ));
    const preserved = plan.operations.find(operation => (
      normalizedRelativePath(operation.sourceRelativePath) === '.cursor/rules/common-coding-style.md'
    ));

    assert.ok(hooksJson, 'Should preserve non-rule Cursor platform config files');
    assert.strictEqual(hooksJson.strategy, 'preserve-relative-path');
    assert.strictEqual(hooksJson.destinationPath, path.join(projectRoot, '.cursor', 'hooks.json'));
    assert.ok(mcpJson, 'Should materialize a Cursor MCP config from the shared root MCP config');
    assert.strictEqual(mcpJson.kind, 'merge-json');
    assert.strictEqual(mcpJson.strategy, 'merge-json');
    assert.strictEqual(mcpJson.destinationPath, path.join(projectRoot, '.cursor', 'mcp.json'));

    assert.ok(preserved, 'Should include flattened Cursor rule scaffold operations');
    assert.strictEqual(preserved.strategy, 'flatten-copy');
    assert.strictEqual(
      preserved.destinationPath,
      path.join(projectRoot, '.cursor', 'rules', 'common-coding-style.mdc')
    );
  })) passed++; else failed++;

  if (test('plans cursor rules with flat namespaced filenames to avoid rule collisions', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/common/coding-style.md'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-coding-style.mdc')
      )),
      'Should flatten common rules into namespaced .mdc files'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/typescript/testing.md'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'typescript-testing.mdc')
      )),
      'Should flatten language rules into namespaced .mdc files'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common', 'coding-style.md')
      )),
      'Should not preserve nested rule directories for cursor installs'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-coding-style.md')
      )),
      'Should not emit .md Cursor rule files'
    );
    assert.ok(
      !plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/README.md'
      )),
      'Should not install Cursor README docs as runtime rule files'
    );
  })) passed++; else failed++;

  if (test('does not install root AGENTS.md into Cursor nested context', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'agents-core',
          paths: ['.agents', 'agents', 'AGENTS.md'],
        },
      ],
    });

    assert.ok(
      !plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'AGENTS.md'
      )),
      'Cursor installs should not copy ECC root AGENTS.md into host project context'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'AGENTS.md')
      )),
      'Cursor installs should not create .cursor/AGENTS.md'
    );
  })) passed++; else failed++;

  if (test('plans cursor agents with ecc-prefixed filenames to avoid agent collisions', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'agents-core',
          paths: ['agents'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'agents/architect.md'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'agents', 'ecc-architect.md')
      )),
      'Should prefix Cursor agent files with ecc-'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'agents', 'architect.md')
      )),
      'Should not write bare Cursor agent filenames'
    );
    assert.ok(
      !plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'agents'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'agents')
      )),
      'Should not plan a whole-directory Cursor agent copy'
    );
  })) passed++; else failed++;

  if (test('plans cursor platform rule files as .mdc and excludes rule README docs', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'platform-configs',
          paths: ['.cursor'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.cursor/rules/common-agents.md'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-agents.mdc')
      )),
      'Should rename Cursor platform rule files to .mdc'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-agents.md')
      )),
      'Should not preserve .md Cursor platform rule files'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.cursor/hooks.json'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'hooks.json')
      )),
      'Should preserve non-rule Cursor platform config files'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.mcp.json'
        && operation.kind === 'merge-json'
        && operation.destinationPath === path.join(projectRoot, '.cursor', 'mcp.json')
      )),
      'Should materialize a project-level Cursor MCP config'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'README.mdc')
      )),
      'Should not emit Cursor rule README docs as .mdc files'
    );
  })) passed++; else failed++;

  if (test('deduplicates cursor rule destinations when rules-core and platform-configs overlap', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'platform-configs',
          paths: ['.cursor'],
        },
      ],
    });

    const commonAgentsDestinations = plan.operations.filter(operation => (
      operation.destinationPath === path.join(projectRoot, '.cursor', 'rules', 'common-agents.mdc')
    ));

    assert.strictEqual(commonAgentsDestinations.length, 1, 'Should keep only one common-agents.mdc operation');
    assert.strictEqual(
      normalizedRelativePath(commonAgentsDestinations[0].sourceRelativePath),
      '.cursor/rules/common-agents.md',
      'Should prefer native .cursor/rules content when cursor platform rules would collide'
    );
  })) passed++; else failed++;

  if (test('prefers native cursor hooks when hooks-runtime and platform-configs overlap', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'cursor',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'hooks-runtime',
          paths: ['hooks', 'scripts/hooks', 'scripts/lib'],
        },
        {
          id: 'platform-configs',
          paths: ['.cursor'],
        },
      ],
    });

    const hooksDestinations = plan.operations.filter(operation => (
      operation.destinationPath === path.join(projectRoot, '.cursor', 'hooks')
    ));

    assert.strictEqual(hooksDestinations.length, 1, 'Should keep only one .cursor/hooks scaffold operation');
    assert.strictEqual(
      normalizedRelativePath(hooksDestinations[0].sourceRelativePath),
      '.cursor/hooks',
      'Should prefer native Cursor hooks over generic hooks-runtime hooks'
    );
  })) passed++; else failed++;

  if (test('plans antigravity remaps for workflows, skills, and flat rules', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'antigravity',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'commands-core',
          paths: ['commands'],
        },
        {
          id: 'agents-core',
          paths: ['agents'],
        },
        {
          id: 'rules-core',
          paths: ['rules'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        operation.sourceRelativePath === 'commands'
        && operation.destinationPath === path.join(projectRoot, '.agent', 'workflows')
      )),
      'Should remap commands into workflows'
    );
    assert.ok(
      plan.operations.some(operation => (
        operation.sourceRelativePath === 'agents'
        && operation.destinationPath === path.join(projectRoot, '.agent', 'skills')
      )),
      'Should remap agents into skills'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/common/coding-style.md'
        && operation.destinationPath === path.join(projectRoot, '.agent', 'rules', 'common-coding-style.md')
      )),
      'Should flatten common rules for antigravity'
    );
  })) passed++; else failed++;

  if (test('exposes validate and planOperations on adapters', () => {
    const claudeAdapter = getInstallTargetAdapter('claude');
    const cursorAdapter = getInstallTargetAdapter('cursor');

    assert.strictEqual(typeof claudeAdapter.planOperations, 'function');
    assert.strictEqual(typeof claudeAdapter.validate, 'function');
    assert.deepStrictEqual(
      claudeAdapter.validate({ homeDir: '/Users/example', repoRoot: '/repo/ecc' }),
      []
    );

    assert.strictEqual(typeof cursorAdapter.planOperations, 'function');
    assert.strictEqual(typeof cursorAdapter.validate, 'function');
    assert.deepStrictEqual(
      cursorAdapter.validate({ projectRoot: '/workspace/app', repoRoot: '/repo/ecc' }),
      []
    );
  })) passed++; else failed++;

  if (test('throws on unknown target adapter', () => {
    assert.throws(
      () => getInstallTargetAdapter('ghost-target'),
      /Unknown install target adapter/
    );
  })) passed++; else failed++;

  if (test('resolves codebuddy adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('codebuddy');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(adapter.id, 'codebuddy-project');
    assert.strictEqual(adapter.target, 'codebuddy');
    assert.strictEqual(adapter.kind, 'project');
    assert.strictEqual(root, path.join(projectRoot, '.codebuddy'));
    assert.strictEqual(statePath, path.join(projectRoot, '.codebuddy', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('resolves gemini adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('gemini');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(adapter.id, 'gemini-project');
    assert.strictEqual(adapter.target, 'gemini');
    assert.strictEqual(adapter.kind, 'project');
    assert.strictEqual(root, path.join(projectRoot, '.gemini'));
    assert.strictEqual(statePath, path.join(projectRoot, '.gemini', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('codebuddy adapter supports lookup by target and adapter id', () => {
    const byTarget = getInstallTargetAdapter('codebuddy');
    const byId = getInstallTargetAdapter('codebuddy-project');

    assert.strictEqual(byTarget.id, 'codebuddy-project');
    assert.strictEqual(byId.id, 'codebuddy-project');
    assert.ok(byTarget.supports('codebuddy'));
    assert.ok(byTarget.supports('codebuddy-project'));
  })) passed++; else failed++;

  if (test('resolves joycode adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('joycode');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(adapter.id, 'joycode-project');
    assert.strictEqual(adapter.target, 'joycode');
    assert.strictEqual(adapter.kind, 'project');
    assert.strictEqual(root, path.join(projectRoot, '.joycode'));
    assert.strictEqual(statePath, path.join(projectRoot, '.joycode', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('joycode adapter supports lookup by target and adapter id', () => {
    const byTarget = getInstallTargetAdapter('joycode');
    const byId = getInstallTargetAdapter('joycode-project');

    assert.strictEqual(byTarget.id, 'joycode-project');
    assert.strictEqual(byId.id, 'joycode-project');
    assert.ok(byTarget.supports('joycode'));
    assert.ok(byTarget.supports('joycode-project'));
  })) passed++; else failed++;

  if (test('resolves qwen adapter root and install-state path from home dir', () => {
    const adapter = getInstallTargetAdapter('qwen');
    const homeDir = '/Users/example';
    const root = adapter.resolveRoot({ homeDir });
    const statePath = adapter.getInstallStatePath({ homeDir });

    assert.strictEqual(adapter.id, 'qwen-home');
    assert.strictEqual(adapter.target, 'qwen');
    assert.strictEqual(adapter.kind, 'home');
    assert.strictEqual(root, path.join(homeDir, '.qwen'));
    assert.strictEqual(statePath, path.join(homeDir, '.qwen', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('qwen adapter supports lookup by target and adapter id', () => {
    const byTarget = getInstallTargetAdapter('qwen');
    const byId = getInstallTargetAdapter('qwen-home');

    assert.strictEqual(byTarget.id, 'qwen-home');
    assert.strictEqual(byId.id, 'qwen-home');
    assert.ok(byTarget.supports('qwen'));
    assert.ok(byTarget.supports('qwen-home'));
  })) passed++; else failed++;

  if (test('resolves zed adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('zed');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(adapter.id, 'zed-project');
    assert.strictEqual(adapter.target, 'zed');
    assert.strictEqual(adapter.kind, 'project');
    assert.strictEqual(root, path.join(projectRoot, '.zed'));
    assert.strictEqual(statePath, path.join(projectRoot, '.zed', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('zed adapter supports lookup by target and adapter id', () => {
    const byTarget = getInstallTargetAdapter('zed');
    const byId = getInstallTargetAdapter('zed-project');

    assert.strictEqual(byTarget.id, 'zed-project');
    assert.strictEqual(byId.id, 'zed-project');
    assert.ok(byTarget.supports('zed'));
    assert.ok(byTarget.supports('zed-project'));
  })) passed++; else failed++;

  if (test('plans codebuddy rules with flat namespaced filenames', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'codebuddy',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
      ],
    });

    assert.strictEqual(plan.adapter.id, 'codebuddy-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.codebuddy'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.codebuddy', 'ecc-install-state.json'));

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/common/coding-style.md'
        && operation.destinationPath === path.join(projectRoot, '.codebuddy', 'rules', 'common-coding-style.md')
      )),
      'Should flatten common rules into namespaced files for codebuddy'
    );
    assert.ok(
      !plan.operations.some(operation => (
        operation.destinationPath === path.join(projectRoot, '.codebuddy', 'rules', 'common', 'coding-style.md')
      )),
      'Should not preserve nested rule directories for codebuddy installs'
    );
  })) passed++; else failed++;

  if (test('plans joycode commands, agents, skills, and flattened rules', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'joycode',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'agents-core',
          paths: ['agents'],
        },
        {
          id: 'commands-core',
          paths: ['commands'],
        },
        {
          id: 'workflow-quality',
          paths: ['skills/tdd-workflow'],
        },
      ],
    });

    assert.strictEqual(plan.adapter.id, 'joycode-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.joycode'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.joycode', 'ecc-install-state.json'));

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/common/coding-style.md'
        && operation.destinationPath === path.join(projectRoot, '.joycode', 'rules', 'common-coding-style.md')
      )),
      'Should flatten common rules into namespaced files for joycode'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'agents'
        && operation.destinationPath === path.join(projectRoot, '.joycode', 'agents')
      )),
      'Should install agents under .joycode/agents'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'commands'
        && operation.destinationPath === path.join(projectRoot, '.joycode', 'commands')
      )),
      'Should install commands under .joycode/commands'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'skills/tdd-workflow'
        && operation.destinationPath === path.join(projectRoot, '.joycode', 'skills', 'tdd-workflow')
      )),
      'Should install skills under .joycode/skills'
    );
  })) passed++; else failed++;

  if (test('plans qwen commands, agents, skills, and native config under home root', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const homeDir = '/Users/example';

    const plan = planInstallTargetScaffold({
      target: 'qwen',
      repoRoot,
      homeDir,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'agents-core',
          paths: ['agents'],
        },
        {
          id: 'commands-core',
          paths: ['commands'],
        },
        {
          id: 'platform-configs',
          paths: ['.qwen', '.gemini', 'mcp-configs'],
        },
        {
          id: 'workflow-quality',
          paths: ['skills/tdd-workflow'],
        },
      ],
    });

    assert.strictEqual(plan.adapter.id, 'qwen-home');
    assert.strictEqual(plan.targetRoot, path.join(homeDir, '.qwen'));
    assert.strictEqual(plan.installStatePath, path.join(homeDir, '.qwen', 'ecc-install-state.json'));
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules'
        && operation.destinationPath === path.join(homeDir, '.qwen', 'rules')
      )),
      'Should preserve rules under ~/.qwen/rules'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.qwen'
        && operation.destinationPath === path.join(homeDir, '.qwen')
        && operation.strategy === 'sync-root-children'
      )),
      'Should sync Qwen native config into ~/.qwen'
    );
    assert.ok(
      !plan.operations.some(operation => normalizedRelativePath(operation.sourceRelativePath) === '.gemini'),
      'Should skip foreign platform config paths'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'skills/tdd-workflow'
        && operation.destinationPath === path.join(homeDir, '.qwen', 'skills', 'tdd-workflow')
      )),
      'Should install skills under ~/.qwen/skills'
    );
  })) passed++; else failed++;

  if (test('plans zed project settings, commands, agents, skills, and flattened rules', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'zed',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'agents-core',
          paths: ['agents'],
        },
        {
          id: 'commands-core',
          paths: ['commands'],
        },
        {
          id: 'platform-configs',
          paths: ['.zed', '.cursor', 'mcp-configs'],
        },
        {
          id: 'workflow-quality',
          paths: ['skills/tdd-workflow'],
        },
      ],
    });

    assert.strictEqual(plan.adapter.id, 'zed-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.zed'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.zed', 'ecc-install-state.json'));
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.zed'
        && operation.destinationPath === path.join(projectRoot, '.zed')
        && operation.strategy === 'sync-root-children'
      )),
      'Should sync Zed native project settings into .zed'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules/common/coding-style.md'
        && operation.destinationPath === path.join(projectRoot, '.zed', 'rules', 'common-coding-style.md')
      )),
      'Should flatten common rules into namespaced files for zed'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'agents'
        && operation.destinationPath === path.join(projectRoot, '.zed', 'agents')
      )),
      'Should install agents under .zed/agents'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'commands'
        && operation.destinationPath === path.join(projectRoot, '.zed', 'commands')
      )),
      'Should install commands under .zed/commands'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'skills/tdd-workflow'
        && operation.destinationPath === path.join(projectRoot, '.zed', 'skills', 'tdd-workflow')
      )),
      'Should install skills under .zed/skills'
    );
    assert.ok(
      !plan.operations.some(operation => normalizedRelativePath(operation.sourceRelativePath) === '.cursor'),
      'Should skip foreign Cursor platform config paths'
    );
  })) passed++; else failed++;

  if (test('exposes validate and planOperations on codebuddy adapter', () => {
    const codebuddyAdapter = getInstallTargetAdapter('codebuddy');

    assert.strictEqual(typeof codebuddyAdapter.planOperations, 'function');
    assert.strictEqual(typeof codebuddyAdapter.validate, 'function');
    assert.deepStrictEqual(
      codebuddyAdapter.validate({ projectRoot: '/workspace/app', repoRoot: '/repo/ecc' }),
      []
    );
  })) passed++; else failed++;

  if (test('every schema target enum value has a matching adapter (regression guard)', () => {
    const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'ecc-install-config.schema.json');
    const schema = JSON.parse(require('fs').readFileSync(schemaPath, 'utf8'));
    const schemaTargets = schema.properties.target.enum;
    const adapters = listInstallTargetAdapters();
    const adapterTargets = adapters.map(a => a.target);

    for (const target of schemaTargets) {
      assert.ok(
        adapterTargets.includes(target),
        `Schema target "${target}" has no matching adapter. ` +
        `Available adapter targets: ${adapterTargets.join(', ')}`
      );
    }
  })) passed++; else failed++;

  if (test('every adapter target is listed in the schema enum (regression guard)', () => {
    const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'ecc-install-config.schema.json');
    const schema = JSON.parse(require('fs').readFileSync(schemaPath, 'utf8'));
    const schemaTargets = schema.properties.target.enum;
    const adapters = listInstallTargetAdapters();

    for (const adapter of adapters) {
      assert.ok(
        schemaTargets.includes(adapter.target),
        `Adapter target "${adapter.target}" is not in schema enum. ` +
        `Schema targets: ${schemaTargets.join(', ')}`
      );
    }
  })) passed++; else failed++;

  if (test('every adapter target is in SUPPORTED_INSTALL_TARGETS (regression guard)', () => {
    const { SUPPORTED_INSTALL_TARGETS } = require('../../scripts/lib/install-manifests');
    const adapters = listInstallTargetAdapters();

    for (const adapter of adapters) {
      assert.ok(
        SUPPORTED_INSTALL_TARGETS.includes(adapter.target),
        `Adapter target "${adapter.target}" is not in SUPPORTED_INSTALL_TARGETS. ` +
        `Supported: ${SUPPORTED_INSTALL_TARGETS.join(', ')}`
      );
    }
  })) passed++; else failed++;

  if (test('resolves claude-project adapter root and install-state path from project root', () => {
    const adapter = getInstallTargetAdapter('claude-project');
    const projectRoot = '/workspace/app';
    const root = adapter.resolveRoot({ projectRoot });
    const statePath = adapter.getInstallStatePath({ projectRoot });

    assert.strictEqual(adapter.id, 'claude-project');
    assert.strictEqual(adapter.target, 'claude-project');
    assert.strictEqual(adapter.kind, 'project');
    assert.strictEqual(root, path.join(projectRoot, '.claude'));
    assert.strictEqual(statePath, path.join(projectRoot, '.claude', 'ecc', 'install-state.json'));
  })) passed++; else failed++;

  if (test('claude-project adapter supports lookup by target and adapter id', () => {
    const byTarget = getInstallTargetAdapter('claude-project');
    const byId = getInstallTargetAdapter('claude-project');

    assert.strictEqual(byTarget.id, 'claude-project');
    assert.strictEqual(byId.id, 'claude-project');
    assert.ok(byTarget.supports('claude-project'));
  })) passed++; else failed++;

  if (test('plans claude-project rules and skills under project-scope ECC-managed subdirectories', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'claude-project',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'rules-core',
          paths: ['rules'],
        },
        {
          id: 'workflow-quality',
          paths: ['skills/tdd-workflow'],
        },
      ],
    });

    assert.strictEqual(plan.adapter.id, 'claude-project');
    assert.strictEqual(plan.targetRoot, path.join(projectRoot, '.claude'));
    assert.strictEqual(plan.installStatePath, path.join(projectRoot, '.claude', 'ecc', 'install-state.json'));
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules'
        && operation.destinationPath === path.join(projectRoot, '.claude', 'rules', 'ecc')
      )),
      'Should install bundled rules under project-scope rules/ecc'
    );
    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'skills/tdd-workflow'
        && operation.destinationPath === path.join(projectRoot, '.claude', 'skills', 'ecc', 'tdd-workflow')
      )),
      'Should install bundled skills under project-scope skills/ecc'
    );
  })) passed++; else failed++;

  if (test('claude-project skips foreign platform source paths', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const projectRoot = '/workspace/app';

    const plan = planInstallTargetScaffold({
      target: 'claude-project',
      repoRoot,
      projectRoot,
      modules: [
        {
          id: 'platform-configs',
          paths: ['.cursor', '.zed', 'rules'],
        },
      ],
    });

    assert.ok(
      plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === 'rules'
        && operation.destinationPath === path.join(projectRoot, '.claude', 'rules', 'ecc')
      )),
      'Should still include non-foreign rules path (guards against empty-plan regression)'
    );
    assert.ok(
      !plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.cursor'
        || normalizedRelativePath(operation.sourceRelativePath).startsWith('.cursor/')
      )),
      'Should skip foreign Cursor platform paths'
    );
    assert.ok(
      !plan.operations.some(operation => (
        normalizedRelativePath(operation.sourceRelativePath) === '.zed'
        || normalizedRelativePath(operation.sourceRelativePath).startsWith('.zed/')
      )),
      'Should skip foreign Zed platform paths'
    );
  })) passed++; else failed++;

  if (test('resolves opencode adapter root and install-state path from home dir', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const homeDir = '/Users/example';
    const root = adapter.resolveRoot({ homeDir });
    const statePath = adapter.getInstallStatePath({ homeDir });

    assert.strictEqual(adapter.id, 'opencode-home');
    assert.strictEqual(adapter.target, 'opencode');
    assert.strictEqual(adapter.kind, 'home');
    assert.strictEqual(root, path.join(homeDir, '.opencode'));
    assert.strictEqual(statePath, path.join(homeDir, '.opencode', 'ecc-install-state.json'));
  })) passed++; else failed++;

  if (test('opencode adapter validate reports an error when compiled plugin is missing', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-targets-opencode-missing-'));
    try {
      const issues = adapter.validate({ homeDir: '/Users/example', repoRoot });
      assert.strictEqual(issues.length, 1, 'Should surface exactly one validation issue');
      assert.strictEqual(issues[0].severity, 'error');
      assert.strictEqual(issues[0].code, 'opencode-plugin-not-built');
      assert.ok(
        issues[0].message.includes('.opencode/dist') || issues[0].message.includes('.opencode\\dist'),
        'Validation message should reference the .opencode/dist payload location'
      );
      assert.ok(
        issues[0].message.includes('build-opencode.js') || issues[0].message.includes('build:opencode'),
        'Validation message should hint at the build command'
      );
      assert.ok(Array.isArray(issues[0].missingRelativePaths) && issues[0].missingRelativePaths.length >= 1,
        'Validation issue should expose the list of missing artefacts as metadata');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('opencode adapter validate reports a partial build (entry present, runtime dirs absent)', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-targets-opencode-partial-'));
    try {
      const distDir = path.join(repoRoot, '.opencode', 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'index.js'), '// stub\n');
      // Intentionally omit dist/plugins and dist/tools.

      const issues = adapter.validate({ homeDir: '/Users/example', repoRoot });
      assert.strictEqual(issues.length, 1, 'Should surface a single validation issue for partial builds');
      assert.strictEqual(issues[0].code, 'opencode-plugin-not-built');
      const missing = issues[0].missingRelativePaths.map(p => p.replace(/\\/g, '/'));
      assert.ok(missing.includes('.opencode/dist/plugins'), 'Missing list should include dist/plugins');
      assert.ok(missing.includes('.opencode/dist/tools'), 'Missing list should include dist/tools');
      assert.ok(!missing.includes('.opencode/dist/index.js'), 'Missing list should not include the present entry');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('opencode adapter validate rejects wrong artefact type (file where directory expected)', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-targets-opencode-wrongtype-'));
    try {
      const distDir = path.join(repoRoot, '.opencode', 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'index.js'), '// stub\n');
      // Materialize plugins/tools as files instead of directories.
      fs.writeFileSync(path.join(distDir, 'plugins'), 'not-a-dir');
      fs.writeFileSync(path.join(distDir, 'tools'), 'not-a-dir');

      const issues = adapter.validate({ homeDir: '/Users/example', repoRoot });
      assert.strictEqual(issues.length, 1, 'Wrong-type artefacts should still surface a validation issue');
      assert.strictEqual(issues[0].code, 'opencode-plugin-not-built');
      const missing = issues[0].missingRelativePaths.map(p => p.replace(/\\/g, '/'));
      assert.ok(missing.includes('.opencode/dist/plugins'), 'Should flag plugins file as wrong type');
      assert.ok(missing.includes('.opencode/dist/tools'), 'Should flag tools file as wrong type');
      assert.ok(!missing.includes('.opencode/dist/index.js'), 'Should not flag index.js when it is correctly a file');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('opencode adapter validate handles ENOTDIR (intermediate path is a file) without throwing', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-targets-opencode-enotdir-'));
    try {
      // Create `.opencode/dist` as a regular file. Stat'ing
      // `.opencode/dist/index.js` then throws ENOTDIR (intermediate component
      // is a file, not a directory). The validate gate must treat this as a
      // missing artefact and surface the structured opencode-plugin-not-built
      // issue, not propagate the raw fs error.
      const opencodeDir = path.join(repoRoot, '.opencode');
      fs.mkdirSync(opencodeDir, { recursive: true });
      fs.writeFileSync(path.join(opencodeDir, 'dist'), 'not-a-dir');

      let issues;
      assert.doesNotThrow(
        () => { issues = adapter.validate({ homeDir: '/Users/example', repoRoot }); },
        'validate should swallow ENOTDIR and surface a structured issue'
      );
      assert.strictEqual(issues.length, 1, 'ENOTDIR case should produce exactly one validation issue');
      assert.strictEqual(issues[0].severity, 'error');
      assert.strictEqual(issues[0].code, 'opencode-plugin-not-built');
      const missing = issues[0].missingRelativePaths.map(p => p.replace(/\\/g, '/'));
      assert.ok(missing.includes('.opencode/dist/index.js'), 'ENOTDIR target should be reported as missing');
      assert.ok(missing.includes('.opencode/dist/plugins'), 'Sibling artefacts under the bad path should be reported');
      assert.ok(missing.includes('.opencode/dist/tools'), 'Sibling artefacts under the bad path should be reported');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('opencode adapter validate passes once compiled plugin payload exists', () => {
    const adapter = getInstallTargetAdapter('opencode');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-targets-opencode-built-'));
    try {
      const distDir = path.join(repoRoot, '.opencode', 'dist');
      fs.mkdirSync(path.join(distDir, 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(distDir, 'tools'), { recursive: true });
      fs.writeFileSync(path.join(distDir, 'index.js'), '// stub\n');

      const issues = adapter.validate({ homeDir: '/Users/example', repoRoot });
      assert.deepStrictEqual(issues, [], 'Should not surface validation issues when plugin is built');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('planInstallTargetScaffold only exempts explicitly allowed validation codes', () => {
    const registryPath = require.resolve('../../scripts/lib/install-targets/registry');
    const opencodeHomePath = require.resolve('../../scripts/lib/install-targets/opencode-home');
    const originalRegistryEntry = require.cache[registryPath];
    const originalOpencodeHomeEntry = require.cache[opencodeHomePath];
    const repoRoot = path.join(__dirname, '..', '..');
    const homeDir = '/Users/example';

    try {
      delete require.cache[registryPath];
      require.cache[opencodeHomePath] = {
        id: opencodeHomePath,
        filename: opencodeHomePath,
        loaded: true,
        exports: {
          id: 'opencode-home',
          target: 'opencode',
          kind: 'home',
          supports: target => target === 'opencode',
          resolveRoot: input => path.join((input.homeDir || '/Users/example'), '.opencode'),
          getInstallStatePath: input => path.join((input.homeDir || '/Users/example'), '.opencode', 'ecc-install-state.json'),
          validate: () => ([
            { severity: 'error', code: 'opencode-plugin-not-built', message: 'missing payload' },
            { severity: 'error', code: 'opencode-other-blocker', message: 'still blocked' },
          ]),
          planOperations: () => [],
        },
      };

      const { planInstallTargetScaffold: sandboxedPlanInstallTargetScaffold } = require('../../scripts/lib/install-targets/registry');

      assert.throws(
        () => sandboxedPlanInstallTargetScaffold({
          target: 'opencode',
          repoRoot,
          homeDir,
          exemptValidationCodes: ['opencode-plugin-not-built'],
        }),
        /still blocked/
      );

      require.cache[opencodeHomePath].exports.validate = () => ([
        { severity: 'error', code: 'opencode-plugin-not-built', message: 'missing payload' },
      ]);

      const plan = sandboxedPlanInstallTargetScaffold({
        target: 'opencode',
        repoRoot,
        homeDir,
        exemptValidationCodes: ['opencode-plugin-not-built'],
      });

      assert.strictEqual(plan.adapter.id, 'opencode-home');
      assert.deepStrictEqual(plan.operations, []);
    } finally {
      if (originalOpencodeHomeEntry) {
        require.cache[opencodeHomePath] = originalOpencodeHomeEntry;
      } else {
        delete require.cache[opencodeHomePath];
      }

      if (originalRegistryEntry) {
        require.cache[registryPath] = originalRegistryEntry;
      } else {
        delete require.cache[registryPath];
      }
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
