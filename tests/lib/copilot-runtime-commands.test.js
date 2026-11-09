'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
const modulePath = path.join(REPO, 'scripts/lib/install/copilot-runtime-commands');
const entry = path.join(REPO, 'scripts/copilot-runtime.js');
let passed = 0;
let failed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runtime è-'));
  try { fn(root); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function invoke(root, action, args = [], input = '', env = {}) {
  const result = spawnSync(process.execPath, [entry, action, ...args], {
    cwd: root, env: { ...process.env, COPILOT_HOME: path.join(root, 'home'), ...env },
    input, encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}
function prettier(root, body) {
  const dir = path.join(root, 'node_modules', 'prettier');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'prettier', bin: './bin.cjs' }));
  fs.writeFileSync(path.join(dir, 'bin.cjs'), body);
  fs.writeFileSync(path.join(root, 'package.json'), '{"prettier":{}}');
}

test('all seven workflows reference concrete managed commands and prerequisite boundaries', () => {
  const { getNativeBody, RUNTIME_PATHS } = require(modulePath);
  for (const name of ['astra-review', 'auto-update', 'harness-audit', 'quality-gate', 'project-init', 'skill-health', 'pm2']) {
    const body = getNativeBody(name);
    assert.ok(body && !body.includes('not yet ported'), name);
    assert.ok(!body.includes('CLAUDE_PLUGIN_ROOT'));
  }
  assert.ok(RUNTIME_PATHS.includes('scripts/copilot-runtime.js'));
  assert.ok(RUNTIME_PATHS.includes('scripts/lib/astra-review/codex.js'));
});
test('native harness audit is read-only and scopes evidence to Copilot project files', root => {
  fs.mkdirSync(path.join(root, '.github', 'skills', 'example'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'skills', 'example', 'SKILL.md'), '# skill');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# guidance');
  const result = invoke(root, 'harness-audit', ['--format', 'json']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.json.categories.length, 12);
  assert.ok(result.json.categories.some(category => category.name === 'Tool Coverage' && category.pass));
  assert.ok(!fs.existsSync(path.join(root, '.claude')));
});
test('single-file quality gate executes installed formatter with literal argv and truthful status', root => {
  prettier(root, 'const fs=require("fs");fs.writeFileSync("argv.json",JSON.stringify(process.argv.slice(2))); process.exit(process.argv.includes("--write")?0:1);');
  const file = 'src è; $(touch injected).js'; fs.writeFileSync(path.join(root, file), 'const x= 1;');
  const checked = invoke(root, 'quality-gate', ['--file', file]);
  assert.strictEqual(checked.status, 1, checked.stderr);
  assert.strictEqual(checked.json.status, 'failed');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'argv.json'))), ['--check', path.join(root, file)]);
  assert.strictEqual(invoke(root, 'quality-gate', ['--file', file, '--fix']).status, 0);
  assert.ok(!fs.existsSync(path.join(root, 'injected')));
});
test('formatter missing, unsafe target and malformed arguments fail explicitly', root => {
  fs.writeFileSync(path.join(root, 'a.js'), 'x');
  assert.strictEqual(invoke(root, 'quality-gate', ['--file', 'a.js']).status, 2);
  assert.strictEqual(invoke(root, 'quality-gate', ['--file', '../outside.js']).status, 2);
  assert.strictEqual(invoke(root, 'quality-gate', ['--unknown']).status, 2);
  const outside = path.join(os.tmpdir(), 'ecc-outside-runtime-' + Date.now());
  fs.writeFileSync(outside, 'x');
  try {
    fs.symlinkSync(outside, path.join(root, 'linked.js'));
    assert.strictEqual(invoke(root, 'quality-gate', ['--file', 'linked.js']).status, 2);
  } finally { fs.rmSync(outside, { force: true }); }
});
test('PM2 dry-run detects local frontend without writing config or starting processes', root => {
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"test","devDependencies":{"vite":"1"}}');
  const result = invoke(root, 'pm2');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.json.dryRun, true);
  assert.strictEqual(result.json.services[0].name, 'web');
  assert.ok(!fs.existsSync(path.join(root, '.github')));
});
test('PM2 reviewed spec creates Copilot skills and config only; preserves unowned files', root => {
  const spec = JSON.stringify({ services: [{ name: 'api', cwd: '.', command: 'python', args: ['-m', 'uvicorn', 'app:app', '--port', '8000'] }] });
  const result = invoke(root, 'pm2', ['--stdin', '--apply'], spec);
  assert.strictEqual(result.status, 0, result.stderr);
  const config = path.join(root, '.github/ecc/pm2/ecosystem.config.cjs');
  const apps = require(config).apps;
  assert.strictEqual(apps[0].interpreter, 'none');
  assert.strictEqual(apps[0].script, 'python');
  assert.ok(fs.existsSync(path.join(root, '.github/skills/pm2-api-start/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(root, '.claude')));
  assert.strictEqual(invoke(root, 'pm2', ['--stdin', '--apply'], spec).status, 2, 'create-only generation preserves existing files');
});
test('PM2 spec rejects traversal, reserved names, shell commands and oversized inputs', root => {
  for (const service of [
    { name: '../bad', command: 'node' }, { name: 'nul', command: 'node' },
    { name: 'api', cwd: '../escape', command: 'node' }, { name: 'api', command: 'node && touch nope' },
  ]) assert.strictEqual(invoke(root, 'pm2', ['--stdin', '--apply'], JSON.stringify({ services: [service] })).status, 2);
  assert.strictEqual(invoke(root, 'pm2', ['--stdin'], 'x'.repeat(1024 * 1024 + 1)).status, 2);
  assert.ok(!fs.existsSync(path.join(root, '.github')));
});
test('checkout-dependent commands fail preflight before reading another harness or mutating project', root => {
  for (const name of ['auto-update', 'project-init', 'skill-health']) {
    const result = invoke(root, name, [], '', { ECC_COPILOT_CHECKOUT_ROOT: '', ECC_COPILOT_CHECKOUT_COMMIT: '' });
    assert.strictEqual(result.status, 2);
    assert.ok(!fs.existsSync(path.join(root, '.claude')));
  }
});
test('Astra runtime closure executes dry-run from installed project without a Codex call', root => {
  const { RUNTIME_PATHS } = require(modulePath);
  const installed = path.join(root, '.github/ecc');
  for (const relative of RUNTIME_PATHS.filter(file => fs.existsSync(path.join(REPO, file)))) {
    const destination = path.join(installed, relative); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(REPO, relative), destination);
  }
  for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test']]) assert.strictEqual(spawnSync('git', args, { cwd: root }).status, 0);
  fs.writeFileSync(path.join(root, 'a.js'), 'const x=1;');
  const result = spawnSync(process.execPath, [path.join(installed, 'scripts/astra-review.js'), '--dry-run', '--files', 'a.js'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /const x=1/);
});
test('pinned-checkout bridges preview, preserve selection and require explicit hook consent on update', root => {
  const checkout = path.join(root, 'reviewed-checkout'); fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'package.json'), '{"name":"ecc-universal"}');
  const backend = 'process.stdout.write(JSON.stringify({argv:process.argv.slice(2)}));';
  for (const file of ['install-apply.js', 'skills-health.js']) fs.writeFileSync(path.join(checkout, 'scripts', file), backend);
  const git = args => { const r = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(['init', '-q']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test']); git(['add', '.']); git(['commit', '-qm', 'fixture']);
  const env = { ECC_COPILOT_CHECKOUT_ROOT: checkout, ECC_COPILOT_CHECKOUT_COMMIT: git(['rev-parse', 'HEAD']) };
  const preview = invoke(root, 'project-init', ['--profile', 'developer'], '', env);
  assert.strictEqual(preview.status, 0, preview.stderr); assert.ok(preview.json.argv.includes('--dry-run')); assert.ok(preview.json.argv.includes('copilot'));
  assert.strictEqual(invoke(root, 'skill-health', ['--json'], '', env).status, 0);
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  const state = { request: { modules: ['commands-core'], includeComponents: ['capability:security'], excludeComponents: ['capability:orchestration'], hookConsent: 'enabled' } };
  fs.writeFileSync(path.join(root, '.github/ecc-install-state.json'), JSON.stringify(state));
  assert.strictEqual(invoke(root, 'auto-update', ['--apply'], '', env).status, 2);
  const updated = invoke(root, 'auto-update', ['--apply', '--enable-hooks'], '', env);
  assert.strictEqual(updated.status, 0, updated.stderr); assert.ok(updated.json.argv.includes('--enable-hooks')); assert.ok(!updated.json.argv.includes('--no-hooks'));
  assert.ok(updated.json.argv.includes('commands-core')); assert.ok(updated.json.argv.includes('capability:security')); assert.ok(updated.json.argv.includes('capability:orchestration'));
  state.request.includeComponents = ['../outside']; fs.writeFileSync(path.join(root, '.github/ecc-install-state.json'), JSON.stringify(state));
  assert.strictEqual(invoke(root, 'auto-update', [], '', env).status, 2);
});
console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
