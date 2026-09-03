/**
 * Tests for scripts/lib/setup-prompts.js
 *
 * Run with: node tests/lib/setup-prompts.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PROMPTS,
  answersPath,
  loadAnswers,
  recordAnswer,
  pendingPrompts,
} = require('../../scripts/lib/setup-prompts');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed += 1;
  }
}

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-setup-prompts-'));
  try {
    fn({ CLAUDE_CONFIG_DIR: dir }, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n=== Testing setup-prompts.js ===\n');

test('every prompt has the fields both callers rely on', () => {
  for (const prompt of PROMPTS) {
    assert.ok(prompt.id, 'id');
    assert.ok(prompt.question, `question for ${prompt.id}`);
    assert.ok(Array.isArray(prompt.choices) && prompt.choices.length > 1, `choices for ${prompt.id}`);
    assert.ok(prompt.choices.includes(prompt.defaultChoice), `default is a choice for ${prompt.id}`);
    assert.strictEqual(typeof prompt.applies, 'function', `applies for ${prompt.id}`);
    assert.strictEqual(typeof prompt.apply, 'function', `apply for ${prompt.id}`);
  }
});

test('answers round-trip through the state file', () => {
  withConfigDir((env, dir) => {
    assert.deepStrictEqual(loadAnswers(env), {});
    assert.strictEqual(recordAnswer('codex-utf8', 'yes', env), true);
    assert.deepStrictEqual(loadAnswers(env), { 'codex-utf8': 'yes' });
    assert.ok(answersPath(env).startsWith(dir), 'stored under the config dir');
  });
});

test('a corrupt state file degrades to no recorded answers', () => {
  withConfigDir((env, dir) => {
    fs.mkdirSync(path.join(dir, 'ecc'), { recursive: true });
    fs.writeFileSync(answersPath(env), '{not json');
    assert.deepStrictEqual(loadAnswers(env), {});
  });
});

test('an answered prompt is never asked again', () => {
  withConfigDir(env => {
    const context = { env: { ...env, LANG: 'C' }, codexSelected: true };
    const before = pendingPrompts(context).map(p => p.id);
    recordAnswer('codex-utf8', 'no', env);
    const after = pendingPrompts(context).map(p => p.id);
    assert.ok(!after.includes('codex-utf8'), 'suppressed once answered');
    assert.strictEqual(before.length - after.length, before.includes('codex-utf8') ? 1 : 0);
  });
});

test('the UTF-8 prompt is skipped when the locale is already UTF-8', () => {
  withConfigDir(env => {
    const pending = pendingPrompts({
      env: { ...env, LANG: 'en_US.UTF-8' },
      codexSelected: true,
    });
    assert.ok(!pending.some(p => p.id === 'codex-utf8'), 'no prompt for UTF-8 shells');
  });
});

test('the UTF-8 prompt is skipped when Codex is not in use', () => {
  withConfigDir(env => {
    const pending = pendingPrompts({
      env: { ...env, LANG: 'C', HOME: env.CLAUDE_CONFIG_DIR },
      codexSelected: false,
    });
    assert.ok(!pending.some(p => p.id === 'codex-utf8'), 'no prompt without Codex');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
