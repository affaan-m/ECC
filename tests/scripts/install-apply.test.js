/**
 * Tests for scripts/install-apply.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
const DEFAULT_INSTALL_APPLY_TIMEOUT_MS = process.platform === 'win32' ? 30000 : 10000;

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readMarkdownFrontmatter(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `Expected YAML frontmatter in ${filePath}`);
  return yaml.load(match[1]);
}

function run(args = [], options = {}) {
  const homeDir = options.homeDir || process.env.HOME;
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    ...(options.env || {}),
  };

  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeout || DEFAULT_INSTALL_APPLY_TIMEOUT_MS,
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}

function runWithGuidedDispatcherFailure(failureMode) {
  const root = createTempDir('install-apply-guided-failure-');
  const preloadPath = path.join(root, 'preload.js');
  const failureMessage = 'guided dispatcher failed\u001b[31m';
  const replacement = failureMode === 'load'
    ? `throw new Error(${JSON.stringify(failureMessage)});`
    : `return { main: () => Promise.reject(new Error(${JSON.stringify(failureMessage)})) };`;
  fs.writeFileSync(preloadPath, `
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === './install-guided' && /install-apply\\.js$/.test(parent?.filename || '')) {
        ${replacement}
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  `);
  try {
    return spawnSync(process.execPath, ['--require', preloadPath, SCRIPT, '--guided'], {
      cwd: path.dirname(SCRIPT),
      encoding: 'utf8',
    });
  } finally {
    cleanup(root);
  }
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
  console.log('\n=== Testing install-apply.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with --help', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Usage:'));
    assert.ok(result.stdout.includes('--dry-run'));
    assert.ok(result.stdout.includes('--profile <name>'));
    assert.ok(result.stdout.includes('--modules <id,id,...>'));
  })) passed++; else failed++;

  if (test('Claude hook dry-run validates settings without mutating malformed input', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');
    const claudeRoot = path.join(homeDir, '.claude');
    const settingsPath = path.join(claudeRoot, 'settings.json');

    try {
      fs.mkdirSync(claudeRoot, { recursive: true });
      fs.writeFileSync(settingsPath, '{ malformed\n');

      const result = run(
        ['--profile', 'core', '--enable-hooks', '--dry-run', '--json'],
        { cwd: projectDir, homeDir }
      );

      assert.notStrictEqual(result.code, 0);
      assert.match(result.stderr, /Failed to parse Claude settings/);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), '{ malformed\n');
      assert.deepStrictEqual(fs.readdirSync(claudeRoot), ['settings.json']);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('guided dispatcher reports sanitized load and rejection failures', () => {
    for (const failureMode of ['load', 'reject']) {
      const result = runWithGuidedDispatcherFailure(failureMode);
      assert.strictEqual(result.status, 1);
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.stderr, 'Error: guided dispatcher failed\n');
    }
  })) passed++; else failed++;

  if (test('rejects mixing legacy languages with manifest profile flags', () => {
    const result = run(['--profile', 'core', 'typescript']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('cannot be combined'));
  })) passed++; else failed++;

  if (test('installs Claude rules and writes install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['typescript', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'typescript', 'testing.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'hooks', 'session-end.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'lib', 'utils.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'coding-standards', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'plugin.json')));

      const statePath = path.join(homeDir, '.claude', 'ecc', 'install-state.json');
      const state = readJson(statePath);
      assert.strictEqual(state.target.id, 'claude-home');
      assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);
      assert.strictEqual(state.request.legacyMode, true);
      assert.deepStrictEqual(state.request.modules, []);
      assert.ok(state.resolution.selectedModules.includes('rules-core'));
      assert.ok(state.resolution.selectedModules.includes('framework-language'));
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath === path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')
        )),
        'Should record common rule file operation'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('rewrites namespaced skill links to the ecc/ rules path (#2340)', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['typescript', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      const skillPath = path.join(claudeRoot, 'skills', 'react-patterns', 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), 'react-patterns SKILL.md should be installed');

      const content = fs.readFileSync(skillPath, 'utf8');
      assert.ok(
        content.includes('../../rules/ecc/react/'),
        'source-relative rules link should be rewritten for the ecc/ namespace'
      );
      assert.ok(
        !content.includes('](../../rules/react/'),
        'no un-namespaced ](../../rules/react/ links should remain'
      );

      // The rewritten link must resolve to a file that actually exists on disk.
      const linkTarget = path.join(
        path.dirname(skillPath),
        '../../rules/ecc/react/hooks.md'
      );
      assert.ok(fs.existsSync(linkTarget), 'rewritten link target should exist');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs Cursor configs and writes install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'cursor', 'typescript', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'common-coding-style.mdc')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'typescript-testing.mdc')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'common-agents.mdc')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'common-agents.md')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'README.mdc')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'agents', 'ecc-architect.md')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'mcp.json')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'hooks', 'session-start.js')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'scripts', 'lib', 'utils.js')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'coding-standards', 'SKILL.md')));

      const hooksConfig = readJson(path.join(projectDir, '.cursor', 'hooks.json'));
      const mcpConfig = readJson(path.join(projectDir, '.cursor', 'mcp.json'));
      assert.strictEqual(hooksConfig.version, 1);
      assert.ok(hooksConfig.hooks.sessionStart, 'Should keep Cursor sessionStart hooks');
      assert.ok(mcpConfig.mcpServers['chrome-devtools'], 'Should install shared MCP servers into Cursor');

      const statePath = path.join(projectDir, '.cursor', 'ecc-install-state.json');
      const state = readJson(statePath);
      const normalizedProjectDir = fs.realpathSync(projectDir);
      assert.strictEqual(state.target.id, 'cursor-project');
      assert.strictEqual(state.target.root, path.join(normalizedProjectDir, '.cursor'));
      assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);
      assert.strictEqual(state.request.legacyMode, true);
      assert.ok(state.resolution.selectedModules.includes('framework-language'));
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath === path.join(normalizedProjectDir, '.cursor', 'commands', 'plan.md')
        )),
        'Should record manifest command file copy operation'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs Cursor MCP config by merging bundled servers into an existing mcp.json', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const cursorRoot = path.join(projectDir, '.cursor');
      fs.mkdirSync(cursorRoot, { recursive: true });
      fs.writeFileSync(path.join(cursorRoot, 'mcp.json'), JSON.stringify({
        mcpServers: {
          custom: {
            command: 'node',
            args: ['custom-mcp.js'],
          },
        },
      }, null, 2));

      const result = run(['--target', 'cursor', 'typescript', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const mcpConfig = readJson(path.join(projectDir, '.cursor', 'mcp.json'));
      assert.ok(mcpConfig.mcpServers.custom, 'Should preserve existing custom Cursor MCP servers');
      assert.ok(mcpConfig.mcpServers['chrome-devtools'], 'Should merge the bundled chrome-devtools MCP server');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs Antigravity configs and writes install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'antigravity', 'typescript'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'rules', 'common-coding-style.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'rules', 'typescript-testing.md')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.agents', 'rules', 'python-testing.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'workflows', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'agents', 'architect.md')));
      const tddGuide = readMarkdownFrontmatter(
        path.join(projectDir, '.agents', 'agents', 'tdd-guide.md')
      );
      assert.deepStrictEqual(
        tddGuide.tools,
        ['view_file', 'write_to_file', 'replace_file_content', 'run_command', 'grep_search']
      );
      assert.strictEqual(tddGuide.model, 'pro');
      const docsLookup = readMarkdownFrontmatter(
        path.join(projectDir, '.agents', 'agents', 'docs-lookup.md')
      );
      assert.deepStrictEqual(docsLookup.tools, ['view_file', 'grep_search']);
      const harnessOptimizer = readMarkdownFrontmatter(
        path.join(projectDir, '.agents', 'agents', 'harness-optimizer.md')
      );
      assert.ok(!Object.hasOwn(harnessOptimizer, 'color'), 'Should omit Claude-only color metadata');

      const statePath = path.join(projectDir, '.agents', 'ecc-install-state.json');
      const state = readJson(statePath);
      assert.strictEqual(state.target.id, 'antigravity-project');
      assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);
      assert.strictEqual(state.request.legacyMode, true);
      assert.deepStrictEqual(
        state.resolution.selectedModules,
        [
          'rules-core',
          'agents-core',
          'commands-core',
          'platform-configs',
          'skill-unified-memory',
          'workflow-quality',
        ]
      );
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath.endsWith(path.join('.agents', 'workflows', 'plan.md'))
        )),
        'Should record manifest command file copy operation'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('maps legacy language aliases to Antigravity rule namespaces', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(
        ['--target', 'antigravity', 'c', 'go', 'kotlin', 'javascript', 'rails', 'harmonyos'],
        { cwd: projectDir, homeDir }
      );
      assert.strictEqual(result.code, 0, result.stderr);

      const rulesDir = path.join(projectDir, '.agents', 'rules');
      for (const fileName of [
        'golang-testing.md',
        'kotlin-testing.md',
        'typescript-testing.md',
        'ruby-testing.md',
        'arkts-testing.md',
        'cpp-testing.md',
      ]) {
        assert.ok(fs.existsSync(path.join(rulesDir, fileName)), `Expected ${fileName}`);
      }
      assert.ok(!fs.existsSync(path.join(rulesDir, 'python-testing.md')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs JoyCode profile through managed install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'joycode', '--profile', 'minimal'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(projectDir, '.joycode', 'rules', 'common-coding-style.md')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.joycode', 'rules', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.joycode', 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.joycode', 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.joycode', 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.joycode', 'mcp-configs', 'mcp-servers.json')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.joycode', 'hooks')));

      const statePath = path.join(projectDir, '.joycode', 'ecc-install-state.json');
      const state = readJson(statePath);
      assert.strictEqual(state.target.id, 'joycode-project');
      assert.deepStrictEqual(state.request.modules, []);
      assert.strictEqual(state.request.profile, 'minimal');
      assert.ok(state.resolution.selectedModules.includes('workflow-quality'));
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath.endsWith(path.join('.joycode', 'skills', 'tdd-workflow', 'SKILL.md'))
        )),
        'Should record JoyCode skill file operation'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs Qwen profile through managed home install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'qwen', '--profile', 'minimal'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'QWEN.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'rules', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.qwen', 'mcp-configs', 'mcp-servers.json')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.qwen', 'hooks')));

      const statePath = path.join(homeDir, '.qwen', 'ecc-install-state.json');
      const state = readJson(statePath);
      assert.strictEqual(state.target.id, 'qwen-home');
      assert.deepStrictEqual(state.request.modules, []);
      assert.strictEqual(state.request.profile, 'minimal');
      assert.ok(state.resolution.selectedModules.includes('workflow-quality'));
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath.endsWith(path.join('.qwen', 'skills', 'tdd-workflow', 'SKILL.md'))
        )),
        'Should record Qwen skill file operation'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('supports dry-run without mutating the target project', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'cursor', '--dry-run', 'typescript'], {
        cwd: projectDir,
        homeDir,
      });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Dry-run install plan'));
      assert.ok(result.stdout.includes('Mode: legacy-compat'));
      assert.ok(result.stdout.includes('Legacy languages: typescript'));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'ecc-install-state.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('supports manifest profile dry-runs through the installer', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'core', '--dry-run'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Mode: manifest'));
      assert.ok(result.stdout.includes('Profile: core'));
      assert.ok(result.stdout.includes('Included components: (none)'));
      assert.ok(result.stdout.includes(
        'Selected modules: rules-core, agents-core, commands-core, hooks-runtime, '
        + 'platform-configs, skill-unified-memory, workflow-quality'
      ));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('full profile dry-runs include delivery-gate in the install plan', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'full', '--dry-run', '--json'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.dryRun, true);
      assert.ok(parsed.plan.selectedModuleIds.includes('workflow-quality'));
      const settingsOperations = parsed.plan.operations.filter(operation => (
        operation.kind === 'update-claude-settings'
      ));
      assert.strictEqual(settingsOperations.length, 1);
      assert.strictEqual(
        settingsOperations[0].destinationPath,
        path.join(homeDir, '.claude', 'settings.json')
      );
      assert.ok(settingsOperations[0].managedHooks.SessionStart);
      assert.ok(!parsed.plan.operations.some(operation => (
        operation.kind === 'copy-file'
        && String(operation.sourceRelativePath || '').replace(/\\/g, '/') === 'hooks/hooks.json'
      )));
      assert.ok(
        parsed.plan.operations.some(operation => (
          String(operation.sourceRelativePath || '').replace(/\\/g, '/').startsWith('skills/delivery-gate/')
        )),
        'Full profile dry-run should include the delivery-gate skill'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('supports minimal profile dry-runs without hooks through the installer', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'minimal', '--dry-run'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Mode: manifest'));
      assert.ok(result.stdout.includes('Profile: minimal'));
      assert.ok(result.stdout.includes(
        'Selected modules: rules-core, agents-core, commands-core, platform-configs, '
        + 'skill-unified-memory, workflow-quality'
      ));
      assert.ok(!result.stdout.includes('hooks-runtime'));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs manifest profiles and writes non-legacy install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'commands', 'plan.md')));
      assert.ok(!fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')));
      assert.ok(readJson(path.join(claudeRoot, 'settings.json')).hooks.SessionStart);
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'hooks', 'session-end.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'lib', 'session-manager.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'plugin.json')));

      const state = readJson(path.join(claudeRoot, 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.profile, 'core');
      assert.strictEqual(state.request.legacyMode, false);
      assert.deepStrictEqual(state.request.legacyLanguages, []);
      assert.ok(state.resolution.selectedModules.includes('platform-configs'));
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath === path.join(claudeRoot, 'commands', 'plan.md')
        )),
        'Should record manifest-driven command file copy'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('preserves existing top-level Claude rules and skills during managed install', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      const userRulePath = path.join(claudeRoot, 'rules', 'common', 'coding-style.md');
      const userSkillPath = path.join(claudeRoot, 'skills', 'tdd-workflow', 'SKILL.md');
      fs.mkdirSync(path.dirname(userRulePath), { recursive: true });
      fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
      fs.writeFileSync(userRulePath, '# User custom rule\n');
      fs.writeFileSync(userSkillPath, '# User custom skill\n');

      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('user-owned'), result.stdout);
      assert.ok(result.stdout.includes('Skipped operations:'), result.stdout);

      assert.strictEqual(fs.readFileSync(userRulePath, 'utf8'), '# User custom rule\n');
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User custom skill\n');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'verification-loop', 'SKILL.md')));
      const state = readJson(path.join(claudeRoot, 'ecc', 'install-state.json'));
      assert.ok(!state.operations.some(operation => (
        operation.destinationPath.startsWith(path.join(claudeRoot, 'skills', 'tdd-workflow'))
      )));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('reports applied and skipped user-owned Claude skill operations in JSON', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const userSkillPath = path.join(
        homeDir,
        '.claude',
        'skills',
        'tdd-workflow',
        'SKILL.md'
      );
      fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
      fs.writeFileSync(userSkillPath, '# User custom skill\n');

      const result = run(['--skills', 'tdd-workflow', '--json'], {
        cwd: projectDir,
        homeDir,
      });
      assert.strictEqual(result.code, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.dryRun, false);
      assert.ok(payload.result.plannedOperations.length > 0);
      assert.ok(payload.result.operations.length > 0);
      assert.ok(payload.result.skippedOperations.length > 0);
      assert.strictEqual(
        payload.result.operations.length + payload.result.skippedOperations.length,
        payload.result.plannedOperations.length
      );
      assert.ok(payload.result.skippedOperations.every(operation => (
        operation.destinationPath.startsWith(path.dirname(userSkillPath))
      )));
      assert.ok(!payload.result.operations.some(operation => (
        operation.destinationPath.startsWith(path.dirname(userSkillPath))
      )));
      assert.ok(payload.result.warnings.some(warning => warning.includes('user-owned')));
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User custom skill\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('dry-run reports the same user-owned Claude skill conflicts as apply', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const userSkillRoot = path.join(
        homeDir,
        '.claude',
        'skills',
        'tdd-workflow'
      );
      const userSkillPath = path.join(userSkillRoot, 'SKILL.md');
      fs.mkdirSync(userSkillRoot, { recursive: true });
      fs.writeFileSync(userSkillPath, '# User custom skill\n');

      const result = run(
        ['--skills', 'tdd-workflow', '--dry-run', '--json'],
        { cwd: projectDir, homeDir }
      );
      assert.strictEqual(result.code, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.dryRun, true);
      assert.ok(payload.plan.plannedOperations.length > 0);
      assert.ok(payload.plan.skippedOperations.length > 0);
      assert.ok(payload.plan.warnings.some(warning => warning.includes('user-owned')));
      assert.ok(payload.plan.skippedOperations.every(operation => (
        operation.destinationPath.startsWith(userSkillRoot)
      )));
      assert.ok(!payload.plan.operations.some(operation => (
        operation.destinationPath.startsWith(userSkillRoot)
      )));
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User custom skill\n');
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs antigravity manifest profiles while skipping only unsupported modules', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'antigravity', '--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'rules', 'common-coding-style.md')));
      assert.ok(
        fs.existsSync(path.join(projectDir, '.agents', 'rules', 'python-testing.md')),
        'Manifest profiles should retain broad rule coverage'
      );
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'workflows', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'tdd-workflow', 'SKILL.md')));

      const state = readJson(path.join(projectDir, '.agents', 'ecc-install-state.json'));
      assert.strictEqual(state.request.profile, 'core');
      assert.strictEqual(state.request.legacyMode, false);
      assert.deepStrictEqual(
        state.resolution.selectedModules,
        [
          'rules-core',
          'agents-core',
          'commands-core',
          'platform-configs',
          'skill-unified-memory',
          'workflow-quality'
        ]
      );
      assert.ok(state.resolution.skippedModules.includes('hooks-runtime'));
      assert.ok(!state.resolution.skippedModules.includes('workflow-quality'));
      assert.ok(!state.resolution.skippedModules.includes('platform-configs'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs explicit modules for cursor using manifest operations', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--target', 'cursor', '--modules', 'platform-configs', '--enable-hooks'], {
        cwd: projectDir,
        homeDir,
      });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'hooks.json')));
      assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'common-agents.mdc')));
      assert.ok(!fs.existsSync(path.join(projectDir, '.cursor', 'rules', 'common-agents.md')));

      const state = readJson(path.join(projectDir, '.cursor', 'ecc-install-state.json'));
      assert.strictEqual(state.request.profile, null);
      assert.deepStrictEqual(state.request.modules, ['platform-configs']);
      assert.deepStrictEqual(state.request.includeComponents, []);
      assert.deepStrictEqual(state.request.excludeComponents, []);
      assert.strictEqual(state.request.legacyMode, false);
      assert.ok(state.resolution.selectedModules.includes('platform-configs'));
      assert.ok(
        !state.operations.some(operation => operation.destinationPath.endsWith('ecc-install-state.json')),
        'Manifest copy operations should not include generated install-state files'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('rejects unknown explicit manifest modules before resolution', () => {
    const result = run(['--modules', 'ghost-module']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown install module: ghost-module'));
  })) passed++; else failed++;

  if (test('registers Claude hooks in settings and defaults commit attribution off', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.strictEqual(
        fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')),
        false,
        'hooks.json should not be copied for Claude targets'
      );
      const settings = readJson(path.join(claudeRoot, 'settings.json'));
      assert.strictEqual(settings.includeCoAuthoredBy, false);
      assert.ok(settings.hooks.SessionStart.some(entry => entry.id === 'session:start'));

      const state = readJson(path.join(claudeRoot, 'ecc', 'install-state.json'));
      const settingsOperation = state.operations.find(operation => (
        operation.kind === 'update-claude-settings'
      ));
      assert.ok(settingsOperation, 'state should record the settings update operation');
      assert.deepStrictEqual(settingsOperation.managedHooks, settings.hooks);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('resolves Claude home and project hook commands to their installed roots', () => {
    for (const target of ['claude', 'claude-project']) {
      const homeDir = createTempDir(`install-apply-${target}-home-`);
      const projectDir = createTempDir(`install-apply-${target}-project-`);

      try {
        const result = run(
          ['--target', target, '--profile', 'core', '--enable-hooks'],
          { cwd: projectDir, homeDir }
        );
        assert.strictEqual(result.code, 0, result.stderr);

        const claudeRoot = target === 'claude'
          ? path.join(homeDir, '.claude')
          : path.join(projectDir, '.claude');
        const settings = readJson(path.join(claudeRoot, 'settings.json'));
        const state = readJson(path.join(claudeRoot, 'ecc', 'install-state.json'));
        const installedRoot = state.target.root;
        assert.strictEqual(fs.realpathSync(installedRoot), fs.realpathSync(claudeRoot));
        const installedBashDispatcherEntry = settings.hooks.PreToolUse.find(
          entry => entry.id === 'pre:bash:dispatcher'
        );
        assert.ok(installedBashDispatcherEntry);
        const command = installedBashDispatcherEntry.hooks[0].command;
        assert.ok(command.startsWith('node -e '));
        assert.ok(command.includes('plugin-hook-bootstrap.js'));
        assert.ok(command.includes('pre-bash-dispatcher.js'));
        assert.ok(
          command.includes(Buffer.from(installedRoot, 'utf8').toString('base64')),
          `${target} command should encode its absolute root without shell interpolation`
        );
        assert.ok(!command.includes(claudeRoot));
        assert.ok(!command.includes('var e=process.env.CLAUDE_PLUGIN_ROOT;'));
        assert.ok(!command.includes('${CLAUDE_PLUGIN_ROOT}'));

        const smokeEntry = settings.hooks.PreToolUse.find(
          entry => entry.id === 'pre:write:doc-file-warning'
        );
        const smokeResult = spawnSync(smokeEntry.hooks[0].command, {
          input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'Write',
            tool_input: { file_path: 'README.md' },
          }),
          encoding: 'utf8',
          cwd: projectDir,
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            ECC_DISABLED_HOOKS: 'pre:write:doc-file-warning',
          },
          shell: true,
          timeout: DEFAULT_INSTALL_APPLY_TIMEOUT_MS,
        });
        assert.strictEqual(smokeResult.status, 0, smokeResult.stderr);
      } finally {
        cleanup(homeDir);
        cleanup(projectDir);
      }
    }
  })) passed++; else failed++;

  if (test('preserves existing settings.json while disabling Claude co-author attribution', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      fs.writeFileSync(
        path.join(claudeRoot, 'settings.json'),
        JSON.stringify({
          effortLevel: 'high',
          env: { MY_VAR: '1' },
          hooks: {
            PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo custom-pretool' }] }],
            UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo custom-submit' }] }],
          },
        }, null, 2)
      );

      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const settings = readJson(path.join(claudeRoot, 'settings.json'));
      assert.strictEqual(settings.effortLevel, 'high', 'existing effortLevel should be preserved');
      assert.strictEqual(settings.includeCoAuthoredBy, false, 'Claude co-author attribution should be disabled by default');
      assert.deepStrictEqual(settings.env, { MY_VAR: '1' }, 'existing env should be preserved');
      assert.deepStrictEqual(
        settings.hooks.UserPromptSubmit,
        [{ matcher: '*', hooks: [{ type: 'command', command: 'echo custom-submit' }] }],
        'unrelated existing hooks should be preserved'
      );
      assert.deepStrictEqual(
        settings.hooks.PreToolUse[0],
        { matcher: 'Write', hooks: [{ type: 'command', command: 'echo custom-pretool' }] },
        'existing event entries should retain their order and content'
      );
      assert.ok(
        settings.hooks.PreToolUse.some(entry => entry.id === 'pre:bash:dispatcher'),
        'managed Claude hooks should be registered alongside user hooks'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('filters copied mcp config files when ECC_DISABLED_MCPS is set', () => {
    const tempDir = createTempDir('install-apply-mcp-');
    const sourcePath = path.join(tempDir, '.mcp.json');
    const destinationPath = path.join(tempDir, 'installed', '.mcp.json');
    const installStatePath = path.join(tempDir, 'installed', 'ecc-install-state.json');
    const previousValue = process.env.ECC_DISABLED_MCPS;

    try {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, JSON.stringify({
        mcpServers: {
          github: { command: 'npx' },
          exa: { url: 'https://mcp.exa.ai/mcp' },
          memory: { command: 'npx' },
        },
      }, null, 2));

      process.env.ECC_DISABLED_MCPS = 'github,memory';

      applyInstallPlan({
        targetRoot: path.join(tempDir, 'installed'),
        installStatePath,
        statePreview: {
          schemaVersion: 'ecc.install.v1',
          installedAt: new Date().toISOString(),
          target: {
            id: 'test-install',
            kind: 'project',
            root: path.join(tempDir, 'installed'),
            installStatePath,
          },
          request: {
            profile: null,
            modules: ['test-mcp'],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: {
            selectedModules: ['test-mcp'],
            skippedModules: [],
          },
          source: {
            repoVersion: null,
            repoCommit: null,
            manifestVersion: 1,
          },
          operations: [],
        },
        operations: [{
          kind: 'copy-file',
          moduleId: 'test-mcp',
          sourcePath,
          sourceRelativePath: '.mcp.json',
          destinationPath,
          strategy: 'preserve-relative-path',
          ownership: 'managed',
          scaffoldOnly: false,
        }],
      });

      const installed = readJson(destinationPath);
      assert.deepStrictEqual(Object.keys(installed.mcpServers), ['exa']);
    } finally {
      if (previousValue === undefined) {
        delete process.env.ECC_DISABLED_MCPS;
      } else {
        process.env.ECC_DISABLED_MCPS = previousValue;
      }
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('reinstall is idempotent for managed hooks and keeps commit attribution disabled', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const firstInstall = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(firstInstall.code, 0, firstInstall.stderr);

      const secondInstall = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(secondInstall.code, 0, secondInstall.stderr);

      const settings = readJson(path.join(homeDir, '.claude', 'settings.json'));
      assert.strictEqual(settings.includeCoAuthoredBy, false);
      const ids = Object.values(settings.hooks).flat().map(entry => entry.id);
      assert.strictEqual(ids.length, new Set(ids).size, 'managed hook IDs should not duplicate');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('reinstall preserves pre-existing hook entries while registering managed hooks', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      const legacySettings = {
        hooks: {
          PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo legacy-pretool' }] }],
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(legacySettings, null, 2));

      const secondInstall = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(secondInstall.code, 0, secondInstall.stderr);

      const afterSecondInstall = readJson(settingsPath);
      assert.strictEqual(afterSecondInstall.includeCoAuthoredBy, false);
      assert.deepStrictEqual(afterSecondInstall.hooks.PreToolUse[0], legacySettings.hooks.PreToolUse[0]);
      assert.ok(afterSecondInstall.hooks.PreToolUse.some(entry => entry.id === 'pre:bash:dispatcher'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('reinstall preserves an explicit includeCoAuthoredBy opt-in', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      const customSettings = {
        includeCoAuthoredBy: true,
        theme: 'dark',
      };
      fs.writeFileSync(settingsPath, JSON.stringify(customSettings, null, 2));

      const install = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(install.code, 0, install.stderr);

      const afterInstall = readJson(settingsPath);
      assert.strictEqual(afterInstall.includeCoAuthoredBy, true);
      assert.strictEqual(afterInstall.theme, 'dark');
      assert.ok(afterInstall.hooks.SessionStart.some(entry => entry.id === 'session:start'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('reinstall preserves an explicit attribution opt-in', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      // `attribution` supersedes `includeCoAuthoredBy` in Claude Code, so writing
      // the deprecated key here would be dead config that loses to the user's choice.
      const customSettings = {
        attribution: { commit: 'Signed-off-by: Someone <someone@example.com>' },
        theme: 'dark',
      };
      fs.writeFileSync(settingsPath, JSON.stringify(customSettings, null, 2));

      const install = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(install.code, 0, install.stderr);

      const afterInstall = readJson(settingsPath);
      assert.deepStrictEqual(afterInstall.attribution, customSettings.attribution);
      assert.strictEqual(afterInstall.theme, 'dark');
      assert.ok(!Object.hasOwn(afterInstall, 'includeCoAuthoredBy'));
      assert.ok(afterInstall.hooks.SessionStart.some(entry => entry.id === 'session:start'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('malformed Claude settings aborts before any install mutation', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      fs.writeFileSync(settingsPath, '{ invalid json\n');

      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.notStrictEqual(result.code, 0);
      assert.match(result.stderr, /Failed to parse Claude settings/);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), '{ invalid json\n');
      assert.deepStrictEqual(fs.readdirSync(claudeRoot), ['settings.json']);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('non-object Claude settings aborts before any install mutation', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      fs.writeFileSync(settingsPath, '[]\n');

      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.notStrictEqual(result.code, 0);
      assert.match(result.stderr, /expected a JSON object/);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), '[]\n');
      assert.deepStrictEqual(fs.readdirSync(claudeRoot), ['settings.json']);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('same-id Claude hook conflict aborts before any install mutation', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      const existing = {
        theme: 'dark',
        hooks: {
          PreToolUse: [{
            id: 'pre:bash:dispatcher',
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo user-owned' }],
          }],
        },
      };
      fs.writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);

      const result = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.notStrictEqual(result.code, 0);
      assert.match(result.stderr, /Refusing to overwrite.*pre:bash:dispatcher/);
      assert.deepStrictEqual(readJson(settingsPath), existing);
      assert.deepStrictEqual(fs.readdirSync(claudeRoot), ['settings.json']);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs from ecc-install.json and persists component selections', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');
    const configPath = path.join(projectDir, 'ecc-install.json');

    try {
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        target: 'claude',
        profile: 'developer',
        include: ['capability:security'],
        exclude: ['capability:orchestration'],
      }, null, 2));

      const result = run(['--config', configPath, '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'security-review', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'skills', 'dmux-workflows', 'SKILL.md')));

      const state = readJson(path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.profile, 'developer');
      assert.deepStrictEqual(state.request.includeComponents, ['capability:security']);
      assert.deepStrictEqual(state.request.excludeComponents, ['capability:orchestration']);
      assert.ok(state.resolution.selectedModules.includes('security'));
      assert.ok(!state.resolution.selectedModules.includes('orchestration'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('auto-detects ecc-install.json from the project root', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');
    const configPath = path.join(projectDir, 'ecc-install.json');

    try {
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        target: 'claude',
        profile: 'developer',
        include: ['capability:security'],
        exclude: ['capability:orchestration'],
      }, null, 2));

      const result = run(['--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'security-review', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'skills', 'dmux-workflows', 'SKILL.md')));

      const state = readJson(path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.profile, 'developer');
      assert.deepStrictEqual(state.request.includeComponents, ['capability:security']);
      assert.deepStrictEqual(state.request.excludeComponents, ['capability:orchestration']);
      assert.ok(state.resolution.selectedModules.includes('security'));
      assert.ok(!state.resolution.selectedModules.includes('orchestration'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('preserves legacy language installs when a project config is present', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');
    const configPath = path.join(projectDir, 'ecc-install.json');

    try {
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        target: 'claude',
        profile: 'developer',
        include: ['capability:security'],
      }, null, 2));

      const result = run(['typescript', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const state = readJson(path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.legacyMode, true);
      assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);
      assert.strictEqual(state.request.profile, null);
      assert.deepStrictEqual(state.request.includeComponents, []);
      assert.ok(state.resolution.selectedModules.includes('framework-language'));
      assert.ok(!state.resolution.selectedModules.includes('security'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('holds hook materialization without an explicit hook decision', () => {
    const projectDir = createTempDir('install-apply-consent-held-');
    const homeDir = createTempDir('install-apply-consent-held-home-');
    try {
      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.notStrictEqual(result.code, 0);
      assert.ok(result.stderr.includes('automatic hook runtime'));
      assert.ok(result.stderr.includes('--enable-hooks'));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'hooks', 'hooks.json')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('--no-hooks installs the profile without the hook runtime', () => {
    const projectDir = createTempDir('install-apply-no-hooks-');
    const homeDir = createTempDir('install-apply-no-hooks-home-');
    try {
      const result = run(['--profile', 'core', '--no-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'hooks', 'hooks.json')));
      const state = readJson(path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.hookConsent, 'declined');
      assert.ok(!state.resolution.selectedModules.includes('hooks-runtime'));
      assert.ok(state.resolution.selectedModules.includes('rules-core'));
      assert.ok(!state.operations.some(operation => (
        operation.kind === 'update-claude-settings'
      )));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('--no-hooks removes hooks registered by a previous enabled install', () => {
    const projectDir = createTempDir('install-apply-disable-hooks-');
    const homeDir = createTempDir('install-apply-disable-hooks-home-');
    try {
      const enabled = run(['--profile', 'core', '--enable-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(enabled.code, 0, enabled.stderr);

      const settingsPath = path.join(homeDir, '.claude', 'settings.json');
      const settings = readJson(settingsPath);
      settings.theme = 'dark';
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

      const disabled = run(['--profile', 'core', '--no-hooks'], { cwd: projectDir, homeDir });
      assert.strictEqual(disabled.code, 0, disabled.stderr);
      assert.deepStrictEqual(readJson(settingsPath), {
        includeCoAuthoredBy: false,
        theme: 'dark',
      });

      const state = readJson(path.join(homeDir, '.claude', 'ecc', 'install-state.json'));
      assert.strictEqual(state.request.hookConsent, 'declined');
      assert.ok(!state.operations.some(operation => (
        operation.kind === 'update-claude-settings'
      )));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('rejects --enable-hooks combined with --no-hooks', () => {
    const result = run(['--profile', 'core', '--enable-hooks', '--no-hooks']);
    assert.notStrictEqual(result.code, 0);
    assert.ok(result.stderr.includes('mutually exclusive'));
  })) passed++; else failed++;

  if (test('dry-run surfaces the pending hook decision as a warning', () => {
    const projectDir = createTempDir('install-apply-consent-dry-');
    const homeDir = createTempDir('install-apply-consent-dry-home-');
    try {
      const result = run(['--profile', 'core', '--dry-run'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('explicit hook decision'));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
