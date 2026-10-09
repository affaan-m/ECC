'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { withFixture } = require('../lib/helpers/context-fixture');
const store = require('../../scripts/lib/context-profile-store');
const routing = require('../../scripts/lib/context-routing-index');
const hook = require('../../scripts/hooks/context-prompt-suggestions');

const PROMPT = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'help with feature work in shared code' });

function fixture(callback, { mode = 'auto', index = true } = {}) {
  return withFixture(repoRoot => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-prompt-suggest-'));
    const stateRoot = path.join(parent, 'managed');
    try {
      store.applyStore({ repoRoot, stateRoot, target: 'claude', selectionMode: mode });
      if (index) routing.writeRoutingIndex({ repoRoot, stateRoot });
      return callback({ stateRoot, env: { ECC_CONTEXT_STATE_ROOT: stateRoot } });
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
}

const stdout = result => (typeof result === 'string' ? result : result.stdout);

test('the hook is silent unless a managed store is explicitly configured', () => fixture(() => {
  assert.equal(stdout(hook.run(PROMPT, {}, {})), '');
  assert.equal(stdout(hook.run(PROMPT, {}, { ECC_CONTEXT_STATE_ROOT: 'relative/store' })), '');
}));

test('suggestions are advisory IDs with bounded descriptions and the resolve command', () => fixture(({ stateRoot, env }) => {
  const text = stdout(hook.run(PROMPT, {}, env));
  assert.match(text, /advisory; nothing was loaded/);
  assert.match(text, /skill:feature/);
  assert.match(text, /profile resolve --state-root/);
  assert.ok(text.includes(JSON.stringify(stateRoot)));
  assert.doesNotMatch(text, /Instructions remain on demand/);
  assert.ok(text.split('\n').filter(line => line.startsWith('- skill:')).length <= 3);
  assert.ok(text.split('\n').every(line => line.length <= 400));
}));

test('manual mode, short prompts, slash commands and malformed input stay silent', () => {
  fixture(({ env }) => assert.equal(stdout(hook.run(PROMPT, {}, env)), ''), { mode: 'manual' });
  fixture(({ env }) => {
    for (const raw of [JSON.stringify({ prompt: 'fix it' }), JSON.stringify({ prompt: '/plan help with feature work' }),
      '{not json', JSON.stringify({ prompt: 42 }), '']) {
      assert.equal(stdout(hook.run(raw, {}, env)), '');
    }
  });
});

test('a missing index is a diagnostic, never an error or a rebuild', () => fixture(({ env }) => {
  const result = hook.run(PROMPT, {}, env);
  assert.equal(stdout(result), '');
  assert.match(result.stderr, /routing-index/);
}, { index: false }));

test('a tampered index or exhausted budget fails open to no suggestion', () => fixture(({ stateRoot, env }) => {
  assert.equal(stdout(hook.run(PROMPT, {}, { ...env, ECC_CONTEXT_SUGGEST_BUDGET_MS: '0' })), '');
  const directory = path.join(stateRoot, 'routing');
  const file = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json')));
  fs.writeFileSync(file, '{"schemaVersion":"ecc.context-routing-index.v1"}');
  const result = hook.run(PROMPT, {}, env);
  assert.equal(stdout(result), '');
  assert.match(result.stderr, /integrity|index/);
}));

test('the hook runs through run-with-flags and returns its text on stdout', () => fixture(({ env }) => {
  const wrapper = path.join(__dirname, '../../scripts/hooks/run-with-flags.js');
  const result = spawnSync(process.execPath, [wrapper, 'user-prompt:context-suggestions', 'scripts/hooks/context-prompt-suggestions.js'],
    { input: PROMPT, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 30000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skill:feature/);
}));

test('the session-start builder indexes the current generation once and stays silent when disabled', () => {
  const builder = require('../../scripts/hooks/context-routing-index');
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-routing-builder-'));
  const stateRoot = path.join(parent, 'managed');
  try {
    assert.equal(builder.run('{}', {}, {}), '');
    store.applyStore({ stateRoot, target: 'claude' });
    const env = { ECC_CONTEXT_STATE_ROOT: stateRoot };
    assert.match(builder.run('{}', {}, env).stderr, /built/);
    assert.equal(routing.routingIndexStatus(stateRoot).status, 'current');
    assert.equal(builder.run('{}', {}, env), '');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('manual mode is silent before the index is read, even when it is missing or corrupt', () => {
  fixture(({ env }) => assert.deepEqual(hook.run(PROMPT, {}, env), ''), { mode: 'manual', index: false });
  fixture(({ stateRoot, env }) => {
    const directory = path.join(stateRoot, 'routing');
    fs.writeFileSync(path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))), '{');
    assert.deepEqual(hook.run(PROMPT, {}, env), '');
  }, { mode: 'manual' });
});

test('loading advice matches the saved mode', () => {
  fixture(({ env }) => {
    const text = stdout(hook.run(PROMPT, {}, env));
    assert.match(text, /skill:feature/);
    assert.match(text, /--load/);
  });
  fixture(({ stateRoot, env }) => {
    const text = stdout(hook.run(PROMPT, {}, env));
    assert.match(text, /skill:feature/);
    assert.doesNotMatch(text, /--load/);
    assert.match(text, /suggest mode/i);
    assert.ok(text.includes(`ecc profile mode auto --state-root ${JSON.stringify(stateRoot)}`));
  }, { mode: 'suggest' });
});
