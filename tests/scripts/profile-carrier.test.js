'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function withReadOnlyCli(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-carrier-cli-'));
  const user = path.join(root, 'user');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(user);
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(user, 'settings.json'), '{"existing":true}\n');
  try {
    fn(args => spawnSync(process.execPath, [path.join(ROOT, 'scripts/ecc.js'), 'profile', ...args], {
      cwd: workspace, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: user, USERPROFILE: user, CODEX_HOME: path.join(user, '.codex'),
        CLAUDE_CONFIG_DIR: path.join(user, '.claude'),
        XDG_CONFIG_HOME: path.join(user, 'config'), XDG_STATE_HOME: path.join(user, 'state'),
        ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
      },
    }));
  } finally {
    try {
      assert.deepEqual(fs.readdirSync(root).sort(), ['user', 'workspace']);
      assert.deepEqual(fs.readdirSync(user), ['settings.json']);
      assert.equal(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'), '{"existing":true}\n');
      assert.deepEqual(fs.readdirSync(workspace), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
}

function payload(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.status, 'warning');
  assert.equal(value.activation, 'unobserved');
  assert.equal(value.carrier.active, false);
  assert.equal(value.carrier.nativeSupport, 'unobserved');
  return value;
}

test('profile help exposes carrier planning without a write command', () => withReadOnlyCli(run => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ecc profile carrier/);
  assert.match(result.stdout, /read-only/i);
}));

test('default carrier preview is a deterministic Lean Codex proposal', () => withReadOnlyCli(run => {
  const first = payload(run(['carrier', '--json']));
  assert.deepEqual(payload(run(['carrier', '--json'])), first);
  assert.equal(first.carrier.target, 'codex');
  assert.equal(first.carrier.profileId, 'lean@1');
  assert.equal(first.carrier.selectionMode, 'auto');
  assert.equal(first.carrier.selectedIds.length, 3);
  assert.equal(first.carrier.status, 'planned');
  assert.equal(first.artifacts[0].digest, first.carrier.carrierDigest);
  assert.ok(!JSON.stringify(first).includes(ROOT));
}));

test('Full carrier keeps explicit exclusions and manual intent', () => withReadOnlyCli(run => {
  const { carrier } = payload(run(['carrier', 'full@1', '--selection', 'manual',
    '--exclude', 'skill:python-patterns', '--json']));
  assert.equal(carrier.selectionMode, 'manual');
  assert.ok(carrier.excludedIds.includes('skill:python-patterns'));
  assert.ok(carrier.files.every(file => file.skillId !== 'skill:python-patterns'));
}));

test('every implemented layout remains explicitly native-unobserved', () => withReadOnlyCli(run => {
  for (const target of ['claude', 'codex', 'cursor', 'opencode', 'pi']) {
    const { carrier } = payload(run(['carrier', '--target', target, '--json']));
    assert.equal(carrier.target, target);
    assert.equal(carrier.status, 'planned');
    assert.ok(carrier.files.length > 0);
  }
}));

test('recognized unsupported target returns inventory without generated files', () => withReadOnlyCli(run => {
  const { carrier } = payload(run(['carrier', '--target', 'kimi', '--json']));
  assert.equal(carrier.status, 'unsupported');
  assert.deepEqual(carrier.files, []);
  assert.equal(carrier.selectedIds.length, 3);
}));

test('carrier text and dry-run output preserve read-only and unobserved boundaries', () => withReadOnlyCli(run => {
  const result = run(['carrier', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /carrier/i);
  assert.match(result.stdout, /unobserved/i);
  assert.match(result.stdout, /planned|proposed/i);
  const expected = payload(run(['carrier', 'lean@1', '--target', 'codex', '--json']));
  for (const args of [
    ['--dry-run', 'carrier', 'lean@1', '--target', 'codex', '--json'],
    ['carrier', 'lean@1', '--target', '--dry-run', 'codex', '--json'],
  ]) assert.deepEqual(payload(run(args)), expected);
}));

test('carrier rejects unknown targets, write destinations, and hook flags', () => withReadOnlyCli(run => {
  for (const args of [['--target', 'unknown'], ['--output', 'user'], ['--hooks', 'strict']]) {
    const result = run(['carrier', ...args, '--json']);
    assert.equal(result.status, 1);
    const error = JSON.parse(result.stdout);
    assert.equal(error.status, 'error');
    assert.doesNotMatch(error.summary, /Cannot find module|Require stack/);
  }
}));
