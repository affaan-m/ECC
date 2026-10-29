/**
 * End-to-end tests for scripts/install-continue.js against a temporary
 * Continue home directory.
 *
 * Run with: node tests/scripts/install-continue.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-continue.js');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, home) {
  const r = spawnSync(process.execPath, [SCRIPT, '--continue-home', home, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`installer exited ${r.status}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const USER_CONFIG = `name: Mine
version: 1.0.0
schema: v1
models:
  - name: main
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: \${{ secrets.ANTHROPIC_API_KEY }}
`;

console.log('install-continue');

test('global install writes rules, skills, agents, prompts and guardrails', () => {
  const home = tmp('ecc-cn-home-');
  fs.writeFileSync(path.join(home, 'config.yaml'), USER_CONFIG);
  fs.writeFileSync(path.join(home, '.onboarding_complete'), 'x');
  run(['--langs', 'python', '--mcp', 'context7', '--subagents', 'core', '--subagent-model', 'anthropic/claude-sonnet-4-6'], home);

  assert.ok(fs.existsSync(path.join(home, 'rules', 'ecc', '00-continue-compat.md')));
  assert.ok(fs.existsSync(path.join(home, 'rules', 'ecc', 'python-coding-style.md')));
  assert.ok(fs.existsSync(path.join(home, 'skills', 'tdd-workflow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, 'ecc', 'agents', 'code-reviewer.md')));
  assert.ok(fs.existsSync(path.join(home, 'ecc', 'prompts', 'plan.md')));
  assert.ok(fs.statSync(path.join(home, 'ecc', 'bin', 'ecc-agent')).mode & 0o100);

  const doc = yaml.load(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
  assert.strictEqual(doc.models[0].name, 'main');
  assert.strictEqual(doc.models.length, 9);
  assert.ok(doc.prompts.length >= 90);
  assert.strictEqual(doc.mcpServers.length, 1);
  for (const item of [...doc.prompts, ...doc.mcpServers, ...doc.models.slice(1)]) {
    const file = item.uses.replace(/^file:\/\//, '');
    assert.ok(fs.existsSync(file), `missing block ${file}`);
  }
  const perms = yaml.load(fs.readFileSync(path.join(home, 'permissions.yaml'), 'utf8'));
  assert.ok(perms.exclude.includes('Bash(*--no-verify*)'));
  assert.ok(!fs.existsSync(path.join(home, 'settings.json')), 'hooks are opt-in');
  fs.rmSync(home, { recursive: true, force: true });
});

test('reinstall is idempotent and uninstall restores the user config', () => {
  const home = tmp('ecc-cn-home-');
  fs.writeFileSync(path.join(home, 'config.yaml'), USER_CONFIG);
  fs.writeFileSync(path.join(home, '.onboarding_complete'), 'x');
  run(['--hooks'], home);
  const first = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8');
  run(['--hooks'], home);
  assert.strictEqual(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), first);
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  assert.ok(settings.hooks.PreToolUse.length > 0);

  run(['--uninstall'], home);
  assert.deepStrictEqual(yaml.load(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')), yaml.load(USER_CONFIG));
  for (const gone of ['rules', 'skills', 'ecc', 'permissions.yaml', 'settings.json']) {
    assert.ok(!fs.existsSync(path.join(home, gone)), `${gone} should be removed`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('creates a starter config and skips cn onboarding when none exists', () => {
  const home = tmp('ecc-cn-home-');
  const out = run(['--skills', 'none', '--no-guardrails'], home);
  const doc = yaml.load(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
  assert.strictEqual(doc.models[0].provider, 'anthropic');
  assert.ok(fs.existsSync(path.join(home, '.onboarding_complete')));
  assert.ok(out.includes('ANTHROPIC_API_KEY'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('project scope keeps global config untouched and does not overwrite foreign skills', () => {
  const home = tmp('ecc-cn-home-');
  const project = tmp('ecc-cn-proj-');
  fs.writeFileSync(path.join(home, 'config.yaml'), USER_CONFIG);
  fs.writeFileSync(path.join(project, 'go.mod'), 'module x\n');
  fs.mkdirSync(path.join(project, '.continue', 'skills', 'tdd-workflow'), { recursive: true });
  fs.writeFileSync(path.join(project, '.continue', 'skills', 'tdd-workflow', 'SKILL.md'), 'mine');
  const out = run(['--scope', 'project', '--project', project], home);
  assert.strictEqual(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), USER_CONFIG);
  assert.ok(fs.existsSync(path.join(project, '.continue', 'rules', 'ecc', 'golang-coding-style.md')));
  assert.strictEqual(fs.readFileSync(path.join(project, '.continue', 'skills', 'tdd-workflow', 'SKILL.md'), 'utf8'), 'mine');
  assert.ok(out.includes('tdd-workflow'));
  run(['--scope', 'project', '--project', project, '--uninstall'], home);
  assert.strictEqual(fs.readFileSync(path.join(project, '.continue', 'skills', 'tdd-workflow', 'SKILL.md'), 'utf8'), 'mine');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

test('dry run writes nothing', () => {
  const home = tmp('ecc-cn-home-');
  run(['--dry-run', '--hooks'], home);
  assert.deepStrictEqual(fs.readdirSync(home), []);
  fs.rmSync(home, { recursive: true, force: true });
});

test('rejects bad options', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--scope', 'world'], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0);
  const r2 = spawnSync(process.execPath, [SCRIPT, '--subagents', 'core', '--continue-home', tmp('ecc-cn-home-')], { encoding: 'utf8' });
  assert.ok(/--subagent-model/.test(r2.stderr));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
