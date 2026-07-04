/**
 * Tests for scripts/install-apply.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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

  if (test('rejects mixing legacy languages with manifest profile flags', () => {
    const result = run(['--profile', 'core', 'typescript']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('cannot be combined'));
  })) passed++; else failed++;

  if (test('installs Claude rules and writes install-state', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['typescript'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'typescript', 'testing.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'hooks', 'session-end.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'scripts', 'lib', 'utils.js')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'ecc', 'tdd-workflow', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'ecc', 'coding-standards', 'SKILL.md')));
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
      const result = run(['typescript'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      const skillPath = path.join(claudeRoot, 'skills', 'ecc', 'react-patterns', 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), 'react-patterns SKILL.md should be installed');

      const content = fs.readFileSync(skillPath, 'utf8');
      assert.ok(
        content.includes('../../../rules/ecc/react/'),
        'source-relative rules link should be rewritten for the ecc/ namespace'
      );
      assert.ok(
        !content.includes('](../../rules/'),
        'no un-namespaced ](../../rules/ links should remain'
      );

      // The rewritten link must resolve to a file that actually exists on disk.
      const linkTarget = path.join(
        path.dirname(skillPath),
        '../../../rules/ecc/react/hooks.md'
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
      const result = run(['--target', 'cursor', 'typescript'], { cwd: projectDir, homeDir });
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

      const result = run(['--target', 'cursor', 'typescript'], { cwd: projectDir, homeDir });
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

      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'rules', 'common-coding-style.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'rules', 'typescript-testing.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'workflows', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'skills', 'architect.md')));

      const statePath = path.join(projectDir, '.agent', 'ecc-install-state.json');
      const state = readJson(statePath);
      assert.strictEqual(state.target.id, 'antigravity-project');
      assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);
      assert.strictEqual(state.request.legacyMode, true);
      assert.deepStrictEqual(state.resolution.selectedModules, ['rules-core', 'agents-core', 'commands-core']);
      assert.ok(
        state.operations.some(operation => (
          operation.destinationPath.endsWith(path.join('.agent', 'workflows', 'plan.md'))
        )),
        'Should record manifest command file copy operation'
      );
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
      assert.ok(result.stdout.includes('Selected modules: rules-core, agents-core, commands-core, hooks-runtime, platform-configs, workflow-quality'));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json')));
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
      assert.ok(result.stdout.includes('Selected modules: rules-core, agents-core, commands-core, platform-configs, workflow-quality'));
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
      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'agents', 'architect.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'commands', 'plan.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')));
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

      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.strictEqual(fs.readFileSync(userRulePath, 'utf8'), '# User custom rule\n');
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User custom skill\n');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(claudeRoot, 'skills', 'ecc', 'tdd-workflow', 'SKILL.md')));
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

      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'rules', 'common-coding-style.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'skills', 'architect.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'workflows', 'plan.md')));
      assert.ok(fs.existsSync(path.join(projectDir, '.agent', 'skills', 'tdd-workflow', 'SKILL.md')));

      const state = readJson(path.join(projectDir, '.agent', 'ecc-install-state.json'));
      assert.strictEqual(state.request.profile, 'core');
      assert.strictEqual(state.request.legacyMode, false);
      assert.deepStrictEqual(
        state.resolution.selectedModules,
        ['rules-core', 'agents-core', 'commands-core', 'platform-configs', 'workflow-quality']
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
      const result = run(['--target', 'cursor', '--modules', 'platform-configs'], {
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

  if (test('installs claude hooks without generating settings.json', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')), 'hooks.json should be copied');
      assert.ok(!fs.existsSync(path.join(claudeRoot, 'settings.json')), 'settings.json should not be created just to install managed hooks');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('installs claude hooks with the safe plugin bootstrap contract', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const claudeRoot = path.join(homeDir, '.claude');
      const installedHooks = readJson(path.join(claudeRoot, 'hooks', 'hooks.json'));

      const installedBashDispatcherEntry = installedHooks.hooks.PreToolUse.find(entry => entry.id === 'pre:bash:dispatcher');
      assert.ok(installedBashDispatcherEntry, 'hooks/hooks.json should include the consolidated Bash dispatcher hook');
      assert.strictEqual(typeof installedBashDispatcherEntry.hooks[0].command, 'string', 'hooks/hooks.json should install string-form commands for Claude Code schema compatibility');
      assert.ok(
        installedBashDispatcherEntry.hooks[0].command.startsWith('node -e '),
        'hooks/hooks.json should use the inline node bootstrap contract'
      );
      assert.ok(
        installedBashDispatcherEntry.hooks[0].command.includes('plugin-hook-bootstrap.js'),
        'hooks/hooks.json should route plugin-managed hooks through the shared bootstrap'
      );
      assert.ok(
        installedBashDispatcherEntry.hooks[0].command.includes('CLAUDE_PLUGIN_ROOT'),
        'hooks/hooks.json should still consult CLAUDE_PLUGIN_ROOT for runtime resolution'
      );
      assert.ok(
        installedBashDispatcherEntry.hooks[0].command.includes('pre-bash-dispatcher.js'),
        'hooks/hooks.json should point the Bash preflight contract at the consolidated dispatcher'
      );
      assert.ok(
        !installedBashDispatcherEntry.hooks[0].command.includes('\\"'),
        'hooks/hooks.json should avoid escaped double quotes that break Windows Git Bash parsing'
      );
      assert.ok(
        !installedBashDispatcherEntry.hooks[0].command.includes('${CLAUDE_PLUGIN_ROOT}'),
        'hooks/hooks.json should not retain raw CLAUDE_PLUGIN_ROOT shell placeholders after install'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('preserves existing settings.json without mutating it during claude install', () => {
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

      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const settings = readJson(path.join(claudeRoot, 'settings.json'));
      assert.strictEqual(settings.effortLevel, 'high', 'existing effortLevel should be preserved');
      assert.deepStrictEqual(settings.env, { MY_VAR: '1' }, 'existing env should be preserved');
      assert.deepStrictEqual(
        settings.hooks.UserPromptSubmit,
        [{ matcher: '*', hooks: [{ type: 'command', command: 'echo custom-submit' }] }],
        'existing hooks should be left untouched'
      );
      assert.deepStrictEqual(
        settings.hooks.PreToolUse,
        [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo custom-pretool' }] }],
        'managed Claude hooks should not be injected into settings.json'
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

  if (test('reinstall does not create settings.json when only managed hooks are installed', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const firstInstall = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(firstInstall.code, 0, firstInstall.stderr);

      const secondInstall = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(secondInstall.code, 0, secondInstall.stderr);

      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'settings.json')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('reinstall leaves pre-existing hook-based settings.json untouched', () => {
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

      const secondInstall = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(secondInstall.code, 0, secondInstall.stderr);

      const afterSecondInstall = readJson(settingsPath);
      assert.deepStrictEqual(afterSecondInstall, legacySettings);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('ignores malformed existing settings.json during claude install', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      fs.writeFileSync(settingsPath, '{ invalid json\n');

      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), '{ invalid json\n');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')), 'hooks.json should still be copied');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'ecc', 'install-state.json')), 'install state should still be written');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('ignores non-object existing settings.json during claude install', () => {
    const homeDir = createTempDir('install-apply-home-');
    const projectDir = createTempDir('install-apply-project-');

    try {
      const claudeRoot = path.join(homeDir, '.claude');
      fs.mkdirSync(claudeRoot, { recursive: true });
      const settingsPath = path.join(claudeRoot, 'settings.json');
      fs.writeFileSync(settingsPath, '[]\n');

      const result = run(['--profile', 'core'], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), '[]\n');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'hooks', 'hooks.json')), 'hooks.json should still be copied');
      assert.ok(fs.existsSync(path.join(claudeRoot, 'ecc', 'install-state.json')), 'install state should still be written');
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (test('fails when source hooks.json root is not an object before copying files', () => {
    const tempDir = createTempDir('install-apply-invalid-hooks-');
    const targetRoot = path.join(tempDir, '.claude');
    const installStatePath = path.join(targetRoot, 'ecc', 'install-state.json');
    const sourceHooksPath = path.join(tempDir, 'hooks.json');

    try {
      fs.writeFileSync(sourceHooksPath, '[]\n');

      assert.throws(() => {
        applyInstallPlan({
          targetRoot,
          installStatePath,
          statePreview: {
            schemaVersion: 'ecc.install.v1',
            installedAt: new Date().toISOString(),
            target: {
              id: 'claude-home',
              kind: 'home',
              root: targetRoot,
              installStatePath,
            },
            request: {
              profile: 'core',
              modules: [],
              includeComponents: [],
              excludeComponents: [],
              legacyLanguages: [],
              legacyMode: false,
            },
            resolution: {
              selectedModules: ['hooks-runtime'],
              skippedModules: [],
            },
            source: {
              repoVersion: null,
              repoCommit: null,
              manifestVersion: 1,
            },
            operations: [],
          },
          adapter: { target: 'claude' },
          operations: [{
            kind: 'copy-file',
            moduleId: 'hooks-runtime',
            sourcePath: sourceHooksPath,
            sourceRelativePath: 'hooks/hooks.json',
            destinationPath: path.join(targetRoot, 'hooks', 'hooks.json'),
            strategy: 'preserve-relative-path',
            ownership: 'managed',
            scaffoldOnly: false,
          }],
        });
      }, /Invalid hooks config at .*expected a JSON object/);

      assert.ok(!fs.existsSync(path.join(targetRoot, 'hooks', 'hooks.json')), 'hooks.json should not be copied when source hooks are invalid');
      assert.ok(!fs.existsSync(installStatePath), 'install state should not be written when source hooks are invalid');
    } finally {
      cleanup(tempDir);
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

      const result = run(['--config', configPath], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'ecc', 'security-review', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'skills', 'ecc', 'dmux-workflows', 'SKILL.md')));

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

      const result = run([], { cwd: projectDir, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);

      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'ecc', 'security-review', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'skills', 'ecc', 'dmux-workflows', 'SKILL.md')));

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

      const result = run(['typescript'], { cwd: projectDir, homeDir });
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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
