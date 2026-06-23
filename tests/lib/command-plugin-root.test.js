'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { INLINE_RESOLVE } = require('../../scripts/lib/resolve-ecc-root');

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

const sessionsDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'sessions.md'), 'utf8');
const skillHealthDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'skill-health.md'), 'utf8');
const instinctStatusDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'instinct-status.md'), 'utf8');

test('sessions command uses shared inline resolver in all node scripts', () => {
  assert.strictEqual((sessionsDoc.match(/const _r = /g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['marketplaces','ecc'\]/g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['marketplaces','everything-claude-code'\]/g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 6);
});

test('skill-health command uses shared inline resolver in all shell snippets', () => {
  assert.strictEqual((skillHealthDoc.match(/var r=/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['marketplaces','ecc'\]/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['marketplaces','everything-claude-code'\]/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 3);
});

test('instinct-status command uses shared inline resolver (no stale legacy fallback) (#2037)', () => {
  assert.strictEqual((instinctStatusDoc.match(/var r=/g) || []).length, 1);
  assert.strictEqual((instinctStatusDoc.match(/\['marketplaces','ecc'\]/g) || []).length, 1);
  assert.strictEqual((instinctStatusDoc.match(/\['marketplaces','everything-claude-code'\]/g) || []).length, 1);
  assert.strictEqual((instinctStatusDoc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 1);
  // The pre-fix template hard-coded the legacy path as a fallback when
  // CLAUDE_PLUGIN_ROOT was unset. Asserting its absence prevents regression.
  assert.ok(
    !instinctStatusDoc.includes('python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py'),
    'instinct-status should not hard-code the legacy ~/.claude install path as a fallback'
  );
});

test('inline resolver covers current and legacy marketplace plugin roots', () => {
  assert.ok(INLINE_RESOLVE.includes("'marketplaces','ecc'"));
  assert.ok(INLINE_RESOLVE.includes("'marketplaces','everything-claude-code'"));
  assert.ok(!INLINE_RESOLVE.includes('\\"'), 'Inline resolver should not require escaped double quotes');
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
