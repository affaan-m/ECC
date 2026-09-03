'use strict';

/**
 * Tests for the shared hook plugin-root predicate.
 *
 * Run with: node tests/lib/plugin-root.test.js
 *
 * Every hook entry point (plugin-hook-bootstrap.js, run-with-flags.js,
 * posttooluse-dispatcher.js) has to agree on what a usable plugin root is.
 * Before this module they did not: run-with-flags.js honoured only
 * CLAUDE_PLUGIN_ROOT and ignored ECC_PLUGIN_ROOT, while the bootstrap and the
 * dispatcher accepted either but used a bare truthiness check, so a
 * whitespace-only variable won over a perfectly good directory-derived root.
 */

const assert = require('assert');
const { resolvePluginRoot } = require('../../scripts/lib/plugin-root');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    failed += 1;
  }
}

const FALLBACK = '/packaged/plugin/root';

test('CLAUDE_PLUGIN_ROOT wins when it is a non-empty path', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '/from/claude' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, '/from/claude');
});

test('ECC_PLUGIN_ROOT is honoured when CLAUDE_PLUGIN_ROOT is absent', () => {
  const root = resolvePluginRoot({
    env: { ECC_PLUGIN_ROOT: '/from/ecc' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, '/from/ecc');
});

test('CLAUDE_PLUGIN_ROOT takes precedence over ECC_PLUGIN_ROOT', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '/from/claude', ECC_PLUGIN_ROOT: '/from/ecc' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, '/from/claude');
});

test('an empty CLAUDE_PLUGIN_ROOT falls through to the fallback', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, FALLBACK);
});

test('a whitespace-only CLAUDE_PLUGIN_ROOT falls through to the fallback', () => {
  // The bug CodeRabbit flagged on this PR: `env.CLAUDE_PLUGIN_ROOT || ...`
  // treats '   ' as a real root and every hook then resolves against '/'.
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '   ' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, FALLBACK);
});

test('a whitespace-only CLAUDE_PLUGIN_ROOT still lets ECC_PLUGIN_ROOT win', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '  ', ECC_PLUGIN_ROOT: '/from/ecc' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, '/from/ecc');
});

test('a whitespace-only ECC_PLUGIN_ROOT falls through to the fallback', () => {
  const root = resolvePluginRoot({
    env: { ECC_PLUGIN_ROOT: '\t\n ' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, FALLBACK);
});

test('both variables unset resolves to the fallback', () => {
  const root = resolvePluginRoot({ env: {}, fallback: FALLBACK });
  assert.strictEqual(root, FALLBACK);
});

test('a configured root is returned trimmed', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: '  /padded/root  ' },
    fallback: FALLBACK
  });
  assert.strictEqual(root, '/padded/root');
});

test('a non-string variable is ignored rather than coerced', () => {
  const root = resolvePluginRoot({
    env: { CLAUDE_PLUGIN_ROOT: 5, ECC_PLUGIN_ROOT: null },
    fallback: FALLBACK
  });
  assert.strictEqual(root, FALLBACK);
});

test('defaults to process.env when no env is supplied', () => {
  const previousClaude = process.env.CLAUDE_PLUGIN_ROOT;
  const previousEcc = process.env.ECC_PLUGIN_ROOT;
  try {
    process.env.CLAUDE_PLUGIN_ROOT = '/from/process/env';
    delete process.env.ECC_PLUGIN_ROOT;
    assert.strictEqual(resolvePluginRoot({ fallback: FALLBACK }), '/from/process/env');
  } finally {
    if (previousClaude === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = previousClaude;
    if (previousEcc === undefined) delete process.env.ECC_PLUGIN_ROOT;
    else process.env.ECC_PLUGIN_ROOT = previousEcc;
  }
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
