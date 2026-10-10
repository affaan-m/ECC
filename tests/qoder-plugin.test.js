/**
 * Qoder native plugin contract tests.
 *
 * These tests intentionally execute the declared hook entry point instead of
 * only inspecting JSON. Qoder launches hooks without a shell when `command`
 * and `args` are separate, which keeps the same contract on Windows, macOS,
 * and Linux.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, '.qoder-plugin', 'plugin.json');
const hooksPath = path.join(repoRoot, 'hooks', 'qoder-hooks.json');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const releaseScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'release.sh'), 'utf8');
const HOOK_TIMEOUT_BUFFER_MS = 5000;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Qoder native plugin ===\n');

test('manifest and hook projection exist', () => {
  assert.ok(fs.existsSync(manifestPath), 'Expected .qoder-plugin/plugin.json');
  assert.ok(fs.existsSync(hooksPath), 'Expected hooks/qoder-hooks.json');
});

if (fs.existsSync(manifestPath) && fs.existsSync(hooksPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

  test('manifest stays versioned with the npm package', () => {
    assert.strictEqual(manifest.name, 'ecc');
    assert.strictEqual(manifest.version, packageJson.version);
  });

  test('release tooling updates and stages the Qoder manifest', () => {
    assert.ok(releaseScript.includes('QODER_PLUGIN_JSON=".qoder-plugin/plugin.json"'));
    assert.ok(releaseScript.includes('update_version "$QODER_PLUGIN_JSON"'));
    const gitAddLine = releaseScript
      .split(/\r?\n/)
      .find(line => /^\s*git add\b/.test(line));
    assert.ok(gitAddLine, 'Expected release tooling to contain a git add command');
    assert.ok(
      gitAddLine.includes('"$QODER_PLUGIN_JSON"'),
      'Expected the git add command to stage the Qoder manifest'
    );
  });

  test('manifest reuses canonical plugin resources', () => {
    assert.strictEqual(manifest.skills, './skills/');
    assert.strictEqual(manifest.commands, './commands/');
    assert.strictEqual(manifest.mcpServers, './.mcp.json');
    assert.strictEqual(manifest.hooks, './hooks/qoder-hooks.json');
  });

  test('agent colors are accepted by Qoder', () => {
    const allowedColors = new Set([
      'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan',
    ]);
    for (const fileName of fs.readdirSync(path.join(repoRoot, 'agents'))) {
      if (!fileName.endsWith('.md')) continue;
      const source = fs.readFileSync(path.join(repoRoot, 'agents', fileName), 'utf8');
      const match = source.match(/^color:\s*(\S+)$/m);
      if (match) {
        assert.ok(allowedColors.has(match[1]), `${fileName} uses unsupported Qoder color ${match[1]}`);
      }
    }
  });

  test('Qoder hook is a minimal SessionStart projection using exec form', () => {
    assert.deepStrictEqual(Object.keys(hooks.hooks), ['SessionStart']);
    const registrations = hooks.hooks.SessionStart;
    assert.strictEqual(registrations.length, 1);
    assert.strictEqual(registrations[0].matcher, 'startup|resume|clear|compact|new');
    assert.strictEqual(registrations[0].hooks.length, 1);
    const hook = registrations[0].hooks[0];
    assert.strictEqual(hook.type, 'command');
    assert.strictEqual(hook.command, 'node');
    assert.ok(Array.isArray(hook.args));
    assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0);
    assert.strictEqual(hook.args[0], '${QODER_PLUGIN_ROOT}/scripts/hooks/plugin-hook-bootstrap.js');
    assert.deepStrictEqual(hook.args.slice(1), [
      'node',
      'scripts/hooks/session-start-bootstrap.js',
    ]);
  });

  test('declared Qoder SessionStart launcher executes from QODER_PLUGIN_ROOT', () => {
    const hook = hooks.hooks.SessionStart[0].hooks[0];
    const args = hook.args.map(value => value.replace('${QODER_PLUGIN_ROOT}', repoRoot));
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-qoder-hook-'));
    const isolatedHome = path.join(isolatedRoot, 'home');
    const isolatedCwd = path.join(isolatedRoot, 'project');
    const agentDataHome = path.join(isolatedRoot, 'agent-data');
    const learnedSkillsDir = path.join(agentDataHome, 'skills', 'learned');
    const contextSentinel = 'QODER_SESSION_START_CONTEXT_SENTINEL';
    fs.mkdirSync(isolatedHome, { recursive: true });
    fs.mkdirSync(isolatedCwd, { recursive: true });
    fs.mkdirSync(learnedSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnedSkillsDir, 'qoder-hook.md'),
      `# Qoder Hook Verification\n\n## When to Use\n\n${contextSentinel}\n`
    );

    const {
      CLAUDE_PLUGIN_ROOT: _claudePluginRoot,
      CLAUDE_CONFIG_DIR: _claudeConfigDir,
      CLAUDE_SESSION_ID: _claudeSessionId,
      ECC_PLUGIN_ROOT: _eccPluginRoot,
      CODEX_PLUGIN_ROOT: _codexPluginRoot,
      PLUGIN_ROOT: _pluginRoot,
      ...baseEnv
    } = process.env;

    try {
      const result = spawnSync(hook.command, args, {
        cwd: isolatedCwd,
        env: {
          ...baseEnv,
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
          ECC_AGENT_DATA_HOME: agentDataHome,
          XDG_DATA_HOME: path.join(isolatedRoot, 'xdg-data'),
          QODER_PLUGIN_ROOT: repoRoot,
          CLAUDE_PROJECT_DIR: isolatedCwd,
          ECC_HOOKS_ENABLED: 'true',
          ECC_HOOK_PROFILE: 'standard',
          ECC_DISABLED_HOOKS: '',
          ECC_DRY_RUN: '0',
          ECC_SESSION_START_CONTEXT: 'on',
          ECC_SESSION_START_MAX_CHARS: '8000',
          ECC_SESSION_RETENTION_DAYS: '0',
        },
        input: JSON.stringify({
          hook_event_name: 'SessionStart',
          source: 'startup',
          cwd: isolatedCwd,
        }),
        encoding: 'utf8',
        timeout: hook.timeout * 1000 + HOOK_TIMEOUT_BUFFER_MS,
        windowsHide: true,
      });

      assert.ifError(result.error);
      assert.strictEqual(result.signal, null);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(result.stdout.trim(), 'Expected SessionStart to emit a payload');
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.hookSpecificOutput?.hookEventName, 'SessionStart');
      assert.ok(
        output.hookSpecificOutput?.additionalContext.includes(contextSentinel),
        'Expected the enabled Qoder hook to inject isolated SessionStart context'
      );
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
