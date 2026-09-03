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
const {
  applySkillProfile,
  parseArgs,
} = require('../../scripts/apply-skill-profile');

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

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedIsolatedCatalog(root, options = {}) {
  const skills = options.skills || [
    { id: 'alpha' },
    { id: 'beta' },
  ];
  for (const skill of skills) {
    const skillDir = path.join(root, 'skills', skill.id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skill.id}\n`);
  }
  writeJson(root, path.join('manifests', 'skill-profiles.json'), {
    version: 1,
    defaultProfile: 'standard',
    profiles: ['minimal', 'standard', 'full'],
    minimalSkills: options.minimalSkills || ['alpha'],
    groups: options.groups || {},
  });
  writeJson(root, path.join('manifests', 'install-modules.json'), {
    version: 1,
    modules: [],
  });
}

function seedPluginRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-skill-profile-'));
  writeJson(root, path.join('.claude-plugin', 'plugin.json'), {
    name: 'ecc',
    version: '2.2.0',
    mcpServers: {},
    skills: ['./skills/'],
    commands: ['./commands/'],
  });
  if (options.catalog !== false) {
    seedIsolatedCatalog(root, options.catalog);
  }
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

  if (test('writes only skills that exist in the --root catalog', () => {
    const root = seedPluginRoot();
    try {
      const result = runCli(['--root', root, '--profile', 'minimal', '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
      assert.deepStrictEqual(plugin.skills, ['./skills/alpha/']);
      assert.ok(fs.existsSync(path.join(root, 'skills', 'alpha', 'SKILL.md')));
      assert.ok(!plugin.skills.includes('./skills/tdd-workflow/'));
      assert.ok(!plugin.skills.includes('./skills/'));
      assert.deepStrictEqual(plugin.commands, ['./commands/']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('rejects missing --profile and --root values', () => {
    assert.throws(
      () => parseArgs(['node', SCRIPT, '--profile']),
      /Missing value for --profile/
    );
    assert.throws(
      () => parseArgs(['node', SCRIPT, '--profile', '--json']),
      /Missing value for --profile/
    );
    assert.throws(
      () => parseArgs(['node', SCRIPT, '--root']),
      /Missing value for --root/
    );
    assert.throws(
      () => parseArgs(['node', SCRIPT, '--root', '--dry-run']),
      /Missing value for --root/
    );
  })) passed++; else failed++;

  if (test('honors ECC_DRY_RUN without writing plugin.json', () => {
    const root = seedPluginRoot();
    try {
      const result = applySkillProfile({
        root,
        profile: 'minimal',
      }, { ECC_DRY_RUN: '1' });
      const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.changed, true);
      assert.deepStrictEqual(plugin.skills, ['./skills/']);
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
