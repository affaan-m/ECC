'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const quality = require('../../scripts/lib/copilot-quality');
let passed = 0;
let failed = 0;
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc quality è-'));
  const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
  const env = { COPILOT_HOME: path.join(root, 'copilot') };
  const file = path.join(cwd, 'demo.ts'); fs.writeFileSync(file, 'const n: number = 1;\n');
  const edit = (extra = {}) => ({ cwd, sessionId: 's1', toolName: 'edit', toolArgs: { path: file }, toolResult: { success: true }, ...extra });
  try { action({ root, cwd, env, file, edit }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('design checks reuse bounded content without opening the changed file again', ({ cwd, env, edit }) => {
  const target = path.join(cwd, 'view.tsx'); fs.writeFileSync(target, '<button>Get started</button>');
  quality.accumulate(edit({ toolArgs: { path: target } }), env);
  const original = fs.readFileSync;
  let unboundedReads = 0;
  fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string' && path.resolve(file) === target) unboundedReads++;
    return original.call(this, file, ...args);
  };
  try {
    const result = quality.check({ cwd, sessionId: 's1' }, env);
    assert.ok(result.checks.some(check => check.check === 'design' && check.status === 'review-required'));
    assert.equal(unboundedReads, 0);
  } finally { fs.readFileSync = original; }
});
test('only successful edits create state, unknown and failed outcomes do not', ({ env, edit }) => {
  assert.equal(quality.accumulate(edit({ toolResult: undefined }), env).status, 'unobserved');
  assert.equal(quality.accumulate(edit({ toolResult: { success: false } }), env).status, 'unobserved');
  assert.ok(!fs.existsSync(env.COPILOT_HOME));
  assert.equal(quality.accumulate(edit(), env).status, 'recorded');
});
test('missing toolchains are unavailable and repeated stop is idle', ({ cwd, env, edit }) => {
  quality.accumulate(edit(), env);
  const result = quality.check({ cwd, sessionId: 's1' }, env);
  assert.equal(result.status, 'checked');
  assert.ok(result.checks.some(item => item.check === 'format' && item.status === 'unavailable'));
  assert.ok(result.checks.some(item => item.check === 'typecheck' && item.status === 'unavailable'));
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'idle');
});
test('call identity deduplicates deliveries, not identical distinct edit calls', ({ cwd, env, edit }) => {
  const first = edit({ toolCallId: 'edit-call-1' });
  assert.equal(quality.accumulate(first, env).status, 'recorded');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'checked');
  assert.equal(quality.accumulate(first, env).status, 'duplicate');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'idle');
  assert.equal(quality.accumulate(edit({ toolCallId: 'edit-call-2' }), env).status, 'recorded');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'checked');
});
function tool(cwd, name, entry, body) {
  const target = path.join(cwd, 'node_modules', name, entry);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body);
}
test('formatter check default, fix explicit, failures reported, later edits rechecked', ({ cwd, env, edit, file }) => {
  fs.writeFileSync(path.join(cwd, '.prettierrc'), '{}');
  tool(cwd, 'prettier', 'bin/prettier.cjs', "require('fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2))); process.exit(2);");
  quality.accumulate(edit(), env);
  assert.ok(quality.check({ cwd, sessionId: 's1' }, env).checks.some(item => item.check === 'format' && item.status === 'failed'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, 'args.json'))).includes('--check'));
  fs.appendFileSync(file, '\n'); quality.accumulate(edit(), env);
  quality.check({ cwd, sessionId: 's1' }, { ...env, ECC_COPILOT_QUALITY_MODE: 'fix' });
  const args = JSON.parse(fs.readFileSync(path.join(cwd, 'args.json')));
  assert.ok(args.includes('--write')); assert.ok(args.includes(file));
});
test('local tsc failure and timeout remain failures', ({ cwd, env, edit }) => {
  fs.writeFileSync(path.join(cwd, 'tsconfig.json'), '{}');
  tool(cwd, 'typescript', 'lib/tsc.js', 'process.exit(2)');
  quality.accumulate(edit(), env);
  assert.ok(quality.check({ cwd, sessionId: 's1' }, env).checks.some(item => item.check === 'typecheck' && item.status === 'failed'));
  quality.accumulate(edit(), env);
  const result = quality.check({ cwd, sessionId: 's1' }, env, { runner: () => ({ error: { code: 'ETIMEDOUT' }, status: null }) });
  assert.ok(result.checks.some(item => item.check === 'typecheck' && item.status === 'timeout'));
});
test('edit during checker execution remains pending and repeated concurrent stop is busy', ({ cwd, env, edit, file }) => {
  fs.writeFileSync(path.join(cwd, 'tsconfig.json'), '{}');
  tool(cwd, 'typescript', 'lib/tsc.js', 'process.exit(0)');
  quality.accumulate(edit(), env);
  let called = 0;
  quality.check({ cwd, sessionId: 's1' }, env, { runner: () => {
    called++;
    assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'busy');
    fs.appendFileSync(file, '\n'); quality.accumulate(edit(), env);
    return { status: 0 };
  } });
  assert.equal(called, 1);
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'checked');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'idle');
});
test('linked files and redirected stores are rejected', ({ root, cwd, env, edit, file }) => {
  const hardlink = path.join(cwd, 'link.ts'); fs.linkSync(file, hardlink);
  assert.throws(() => quality.accumulate(edit(), env), /Unsafe/);
  fs.unlinkSync(hardlink);
  fs.mkdirSync(env.COPILOT_HOME); fs.mkdirSync(path.join(root, 'redirect'));
  fs.symlinkSync(path.join(root, 'redirect'), path.join(env.COPILOT_HOME, 'ecc'), 'dir');
  assert.throws(() => quality.accumulate(edit(), env), /Unsafe/);
});
test('hook subprocess handles post and stop; disabled profile has no writes', ({ cwd, env, edit }) => {
  const { spawnSync } = require('child_process');
  const entry = path.resolve(__dirname, '../../scripts/hooks/copilot-quality.js');
  const invoke = (event, payload, extra = {}) => spawnSync(process.execPath, [entry, event], {
    cwd, env: { ...process.env, ...env, ECC_HOOK_PROFILE: 'standard', ECC_HOOKS_ENABLED: 'true', ...extra },
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
  });
  assert.equal(invoke('postToolUse', edit(), { ECC_HOOK_PROFILE: 'minimal' }).status, 0);
  assert.ok(!fs.existsSync(env.COPILOT_HOME));
  assert.equal(invoke('postToolUse', edit()).status, 0);
  const stop = invoke('agentStop', { cwd, sessionId: 's1' });
  assert.equal(stop.status, 2, stop.stderr); assert.match(JSON.parse(stop.stdout).additionalContext, /unavailable/);
  assert.match(stop.stderr, /ECC quality.*unavailable/);
  assert.equal(invoke('postToolUse', { cwd, sessionId: 's1' }).status, 1);
});
test('workspace and session isolation; deleted files; paths outside workspace refused', ({ root, cwd, env, edit, file }) => {
  quality.accumulate(edit(), env);
  assert.equal(quality.check({ cwd, sessionId: 's2' }, env).status, 'idle');
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  assert.equal(quality.check({ cwd: other, sessionId: 's1' }, env).status, 'idle');
  assert.throws(() => quality.accumulate(edit({ toolArgs: { path: path.join(root, 'outside.ts') } }), env), /workspace/);
  fs.unlinkSync(file);
  const result = quality.check({ cwd, sessionId: 's1' }, env);
  assert.ok(result.checks.some(item => item.status === 'deleted'));
});
test('disabled mode produces no store; invalid mode rejects', ({ cwd, env, edit }) => {
  assert.equal(quality.accumulate(edit(), { ...env, ECC_COPILOT_QUALITY_MODE: 'off' }).status, 'disabled');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, { ...env, ECC_COPILOT_QUALITY_MODE: 'off' }).status, 'disabled');
  assert.ok(!fs.existsSync(env.COPILOT_HOME));
  assert.throws(() => quality.check({ cwd, sessionId: 's1' }, { ...env, ECC_COPILOT_QUALITY_MODE: 'arbitrary' }), /mode/);
});
test('stop rejects ambiguous session aliases before reading another session state', ({ cwd, env, edit }) => {
  quality.accumulate(edit(), env);
  assert.throws(() => quality.check({ cwd, sessionId: 's1', session_id: 's2' }, env), /Conflicting/);
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'checked');
});
test('unknown store fields are refused without retaining or rewriting unreviewed data', ({ cwd, env, edit }) => {
  const hash = value => require('crypto').createHash('sha256').update(value).digest('hex');
  quality.accumulate(edit(), env);
  const stateFile = path.join(env.COPILOT_HOME, 'ecc', 'quality', hash(fs.realpathSync(cwd)), hash('s1'), 'state.json');
  const previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const value of [{ ...previous, arbitrary: 'synthetic-sensitive-data' },
    { ...previous, files: previous.files.map(file => ({ ...file, arbitrary: 'synthetic-sensitive-data' })) }]) {
    const raw = JSON.stringify(value);
    fs.writeFileSync(stateFile, raw);
    assert.throws(() => quality.check({ cwd, sessionId: 's1' }, env), /unsupported quality/);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), raw);
  }
});
test('terminated checker owner is recovered while live and legacy locks remain busy', ({ cwd, env, edit }) => {
  const { spawnSync } = require('child_process');
  const hash = value => require('crypto').createHash('sha256').update(value).digest('hex');
  quality.accumulate(edit(), env);
  fs.writeFileSync(path.join(cwd, 'tsconfig.json'), '{}');
  tool(cwd, 'typescript', 'lib/tsc.js', 'process.exit(0)');
  const entry = path.resolve(__dirname, '../../scripts/lib/copilot-quality.js');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)}).check(JSON.parse(process.argv[1]), JSON.parse(process.argv[2]), {runner(){process.exit(0)}})`,
    JSON.stringify({ cwd, sessionId: 's1' }), JSON.stringify(env)], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  const directory = path.join(env.COPILOT_HOME, 'ecc', 'quality', hash(fs.realpathSync(cwd)), hash('s1'));
  const lock = path.join(directory, 'run.lock');
  const deadOwner = fs.readFileSync(path.join(lock, 'owner.json'));
  const stateLock = path.join(directory, 'state.lock');
  fs.mkdirSync(stateLock); fs.writeFileSync(path.join(stateLock, 'owner.json'), deadOwner);
  assert.equal(quality.accumulate(edit(), env).status, 'recorded');
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'checked');
  fs.mkdirSync(lock);
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'busy');
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ schema: 'ecc.copilot.quality-lock.v1', pid: process.pid,
    token: require('crypto').randomUUID() }));
  assert.equal(quality.check({ cwd, sessionId: 's1' }, env).status, 'busy');
});
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
