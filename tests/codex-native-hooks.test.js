/**
 * Integration checks for the native Codex plugin hook boundary.
 *
 * Run with: node tests/codex-native-hooks.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const hookConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
const sessionStart = hookConfig.hooks.SessionStart[0].hooks[0];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function runSessionStart({ pluginRoot }) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-hook-'));
  const userHome = path.join(fixtureRoot, 'user-home');
  const projectDir = path.join(fixtureRoot, 'project');
  const pluginData = path.join(fixtureRoot, 'plugin-data');
  fs.mkdirSync(userHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(pluginData, { recursive: true });

  const env = {
    ...process.env,
    HOME: userHome,
    USERPROFILE: userHome,
    PLUGIN_DATA: pluginData
  };
  delete env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    env.PLUGIN_ROOT = pluginRoot;
  } else {
    delete env.PLUGIN_ROOT;
  }

  const input = JSON.stringify({
    session_id: 'codex-native-hook-test',
    transcript_path: path.join(fixtureRoot, 'transcript.jsonl'),
    cwd: projectDir,
    hook_event_name: 'SessionStart',
    source: 'startup'
  });

  try {
    return spawnSync(sessionStart.command, {
      cwd: projectDir,
      env,
      input,
      encoding: 'utf8',
      shell: true,
      timeout: 15_000
    });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('installed Codex SessionStart hook resolves from PLUGIN_ROOT and emits Codex output', () => {
  const result = runSessionStart({ pluginRoot: repoRoot });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.strictEqual(typeof output.hookSpecificOutput.additionalContext, 'string');
});

test('Codex SessionStart hook fails closed when PLUGIN_ROOT is absent', () => {
  const result = runSessionStart({ pluginRoot: null });
  assert.notStrictEqual(result.status, 0, 'Hook must not fall through to a stale ~/.claude plugin');
  assert.match(result.stderr, /Missing Codex PLUGIN_ROOT/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
