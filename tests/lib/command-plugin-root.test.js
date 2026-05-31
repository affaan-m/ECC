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
const instinctImportDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'instinct-import.md'), 'utf8');
const promoteDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'promote.md'), 'utf8');
const pruneDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'prune.md'), 'utf8');
const evolveDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'evolve.md'), 'utf8');
const projectsDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'projects.md'), 'utf8');
const opencodeEvolveDoc = fs.readFileSync(path.join(__dirname, '..', '..', '.opencode', 'commands', 'evolve.md'), 'utf8');
const opencodeProjectsDoc = fs.readFileSync(path.join(__dirname, '..', '..', '.opencode', 'commands', 'projects.md'), 'utf8');
const opencodePromoteDoc = fs.readFileSync(path.join(__dirname, '..', '..', '.opencode', 'commands', 'promote.md'), 'utf8');

test('sessions command uses shared inline resolver in all node scripts', () => {
  assert.strictEqual((sessionsDoc.match(/const _r = /g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['marketplace','ecc'\]/g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['marketplace','everything-claude-code'\]/g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 6);
});

test('skill-health command uses shared inline resolver in all shell snippets', () => {
  assert.strictEqual((skillHealthDoc.match(/var r=/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['marketplace','ecc'\]/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['marketplace','everything-claude-code'\]/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 3);
});

test('continuous-learning command docs use shared inline resolver without stale manual fallback', () => {
  const docs = [
    ['instinct-status', instinctStatusDoc],
    ['instinct-import', instinctImportDoc],
    ['evolve', evolveDoc],
    ['projects', projectsDoc],
    ['promote', promoteDoc],
    ['prune', pruneDoc],
    ['opencode:evolve', opencodeEvolveDoc],
    ['opencode:projects', opencodeProjectsDoc],
    ['opencode:promote', opencodePromoteDoc],
  ];

  for (const [name, doc] of docs) {
    assert.strictEqual((doc.match(/var r=/g) || []).length, 1, `${name} should embed one inline resolver`);
    assert.strictEqual((doc.match(/\['marketplace','ecc'\]/g) || []).length, 1, `${name} should include current marketplace root`);
    assert.strictEqual((doc.match(/\['marketplace','everything-claude-code'\]/g) || []).length, 1, `${name} should include legacy marketplace root`);
    assert.strictEqual((doc.match(/\['ecc','everything-claude-code'\]/g) || []).length, 1, `${name} should include current plugin handle root`);
    assert.ok(!doc.includes('python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py'),
      `${name} should not silently fall back to stale manual install paths`);
  }
});

test('inline resolver covers current and legacy marketplace plugin roots', () => {
  assert.ok(INLINE_RESOLVE.includes('"marketplace","ecc"'));
  assert.ok(INLINE_RESOLVE.includes('"marketplace","everything-claude-code"'));
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
