/** Read-only context profile journeys, exercised through the shipped CLI. */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'scripts/ecc.js');
const PROFILE = path.join(ROOT, 'scripts/profile.js');

function snapshot(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return [`${entry.name}:link:${fs.readlinkSync(file)}`];
      return entry.isDirectory()
        ? snapshot(file).map(item => `${entry.name}/${item}`)
        : [`${entry.name}:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`];
    });
}

function withFixture(fn) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-cli-'));
  let before;
  try {
    const userDirectory = path.join(fixture, 'user');
    const workspace = path.join(fixture, 'workspace');
    fs.mkdirSync(userDirectory);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(userDirectory, 'settings.json'), '{"keep":"user preference"}\n');
    fs.writeFileSync(path.join(workspace, 'owned.txt'), 'existing user work\n');
    before = snapshot(fixture);
    const run = (args, direct = false) => spawnSync(process.execPath,
      [direct ? PROFILE : CLI, ...(direct ? [] : ['profile']), ...args], {
        cwd: workspace, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          HOME: userDirectory, USERPROFILE: userDirectory,
          XDG_CONFIG_HOME: path.join(userDirectory, 'config'),
          XDG_STATE_HOME: path.join(userDirectory, 'state'),
          CLAUDE_CONFIG_DIR: path.join(userDirectory, '.claude'),
          CODEX_HOME: path.join(userDirectory, '.codex'),
          ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
        },
      });
    fn(run);
  } finally {
    try {
      if (before) assert.deepStrictEqual(snapshot(fixture), before,
        'inspection must preserve user and workspace files, including failure paths');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
}

function success(result) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.ok(['success', 'warning'].includes(payload.status));
  assert.strictEqual(typeof payload.summary, 'string');
  assert.ok(Array.isArray(payload.next_actions));
  assert.ok(Array.isArray(payload.artifacts));
  return payload;
}

const tests = [
  ['the dispatcher exposes read-only profile help', () => withFixture(run => {
    const result = run(['--help']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /read-only/i);
    for (const command of ['show', 'preview', 'explain']) assert.ok(result.stdout.includes(command));
  })],
  ['show lists versioned definitions without claiming an active installation', () => withFixture(run => {
    const result = success(run(['show', '--json']));
    assert.deepStrictEqual(result.profiles.map(profile => profile.id).sort(), ['full@1', 'lean@1']);
    assert.strictEqual(result.activation, 'unobserved');
  })],
  ['show reads one profile definition through the direct packaged entrypoint', () => withFixture(run => {
    const result = success(run(['show', 'lean@1', '--json'], true));
    assert.strictEqual(result.profile.id, 'lean@1');
  })],
  ['Lean preview is deterministic and reports no observed activation', () => withFixture(run => {
    const args = ['preview', 'lean@1', '--target', 'codex', '--selection', 'auto', '--json'];
    const first = run(args);
    const payload = success(first);
    assert.deepStrictEqual(JSON.parse(run(args).stdout), payload);
    assert.strictEqual(payload.activation, 'unobserved');
    assert.ok(payload.plan);
    assert.ok(!first.stdout.includes(ROOT), 'portable output must omit local checkout path');
  })],
  ['Full remains inspectable with explicit manual selection', () => withFixture(run => {
    assert.ok(success(run(['preview', 'full@1', '--target', 'claude', '--selection', 'manual', '--json'])).plan);
  })],
  ['explicit includes and exclusions remain inspection only', () => withFixture(run => {
    success(run(['preview', '--target', 'codex', '--include', 'skill:security-review',
      '--exclude', 'skill:python-patterns', '--json']));
  })],
  ['exact-ID explanation includes an entry and never invokes the skill', () => withFixture(run => {
    const payload = success(run(['explain', 'skill:security-review', '--target', 'codex', '--json']));
    assert.strictEqual(payload.entry.id, 'skill:security-review');
    assert.strictEqual(payload.activation, 'unobserved');
  })],
  ['text output identifies estimates and unobserved runtime state', () => withFixture(run => {
    const result = run(['preview', '--target', 'codex']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /estimate/i);
    assert.match(result.stdout, /unobserved/i);
  })],
  ['text error output renders terminal controls inert', () => withFixture(run => {
    const control = String.fromCharCode(27);
    const result = run(['explain', `skill:unknown${control}]52;c;example${String.fromCharCode(7)}`]);
    assert.strictEqual(result.status, 1);
    assert.ok(!result.stderr.includes(control), 'terminal escape must not reach the text output');
    assert.match(result.stderr, /\\u001b/);
  })],
  ['global dry-run remains compatible with profile inspection', () => withFixture(run => {
    success(run(['preview', '--target', 'codex', '--dry-run', '--json']));
  })],
  ['package includes the direct profile entrypoint and public schemas', () => {
    const { files } = require('../../package.json');
    assert.ok(files.includes('scripts/profile.js'));
    assert.ok(files.includes('schemas/'));
    assert.ok(files.includes('manifests/'));
  }],
];

for (const args of [
  ['use', 'lean@1'],
  ['show', 'unknown@1'],
  ['preview', '--target', 'unknown-host'],
  ['preview', '--selection', 'eager'],
  ['preview', '--target'],
  ['preview', '--target', '--json'],
  ['preview', '--target', 'codex', '--target', 'claude'],
  ['preview', '--include', 'skill:missing-workflow'],
  ['preview', '--include', '../../outside'],
  ['preview', '--hooks', 'strict'],
  ['show', '--include', 'skill:security-review'],
  ['explain'],
  ['explain', 'skill:missing-workflow'],
  ['explain', 'skill:ecc-guide', 'extra'],
]) {
  tests.push([`rejects unsupported or malformed input: ${args.join(' ')}`, () => withFixture(run => {
    const result = run([...args, '--json']);
    assert.notStrictEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'error');
    assert.doesNotMatch(payload.summary, /Cannot find module|Require stack/,
      'validation must fail for the request, not a missing implementation');
    assert.ok(payload.next_actions.length > 0);
    assert.strictEqual(payload.activation, 'unobserved');
  })]);
}

function main() {
  let passed = 0;
  for (const [name, test] of tests) {
    try { test(); passed++; console.log(`  PASS ${name}`); }
    catch (error) { console.error(`  FAIL ${name}: ${error.message}`); }
  }
  console.log(`\nPassed: ${passed}\nFailed: ${tests.length - passed}`);
  process.exitCode = passed === tests.length ? 0 : 1;
}

if (require.main === module) main();
module.exports = { main };
