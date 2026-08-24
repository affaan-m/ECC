/**
 * Tests for scripts/apply-skill-profile.js
 *
 * Run with: node tests/scripts/apply-skill-profile.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'apply-skill-profile.js');
const REPO_ROOT = path.join(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: options.cwd || REPO_ROOT,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
}

function seedPluginRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-skill-profile-'));
  const pluginDir = path.join(root, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), `${JSON.stringify({
    name: 'ecc',
    version: '2.2.0',
    mcpServers: {},
    skills: ['./skills/'],
    commands: ['./commands/'],
  }, null, 2)}\n`);
  return root;
}

function runTests() {
  console.log('\n=== Testing apply-skill-profile.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('dry-run reports a standard listing smaller than the full catalog', () => {
    const result = runCli(['--dry-run', '--json', '--profile', 'standard']);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.profile, 'standard');
    assert.ok(payload.enabledCount > 0);
    assert.ok(payload.enabledCount < payload.skillCount);
    assert.ok(payload.skills.every(entry => entry.startsWith('./skills/')));
    assert.ok(!payload.skills.includes('./skills/'));
  })) passed++; else failed++;

  if (test('full profile keeps the wholesale skills directory', () => {
    const result = runCli(['--dry-run', '--json', '--profile', 'full']);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.deepStrictEqual(payload.skills, ['./skills/']);
  })) passed++; else failed++;

  if (test('writes the selected skills array into plugin.json', () => {
    const root = seedPluginRoot();
    try {
      const result = runCli(['--root', root, '--profile', 'minimal', '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
      assert.ok(plugin.skills.includes('./skills/tdd-workflow/'));
      assert.ok(!plugin.skills.includes('./skills/'));
      assert.deepStrictEqual(plugin.commands, ['./commands/']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('rejects an unknown profile flag', () => {
    const result = runCli(['--dry-run', '--profile', 'strict']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown skill profile/);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
