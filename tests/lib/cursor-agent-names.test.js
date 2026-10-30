'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { toCursorAgentFileName, toCursorAgentRelativePath } = require('../../scripts/lib/cursor-agent-names');

test('a bare file name gets the ecc- prefix', () => {
  assert.equal(toCursorAgentFileName('planner.md'), 'ecc-planner.md');
  assert.equal(toCursorAgentFileName('code-reviewer.md'), 'ecc-code-reviewer.md');
});

test('an already prefixed name is left alone, so the transform is idempotent', () => {
  assert.equal(toCursorAgentFileName('ecc-planner.md'), 'ecc-planner.md');
  assert.equal(toCursorAgentFileName(toCursorAgentFileName('planner.md')), 'ecc-planner.md');
});

test('empty and missing names pass through unchanged', () => {
  assert.equal(toCursorAgentFileName(''), '');
  assert.equal(toCursorAgentFileName(undefined), undefined);
  assert.equal(toCursorAgentFileName(null), null);
});

test('only a leading, lowercase ecc- counts as the prefix', () => {
  assert.equal(toCursorAgentFileName('my-ecc-agent.md'), 'ecc-my-ecc-agent.md');
  assert.equal(toCursorAgentFileName('ECC-planner.md'), 'ecc-ECC-planner.md');
  assert.equal(toCursorAgentFileName('ecc.md'), 'ecc-ecc.md');
  assert.equal(toCursorAgentFileName('ecc_planner.md'), 'ecc-ecc_planner.md');
});

test('a relative path keeps its directories and renames only the last segment', () => {
  assert.equal(toCursorAgentRelativePath('review/planner.md'), path.join('review', 'ecc-planner.md'));
  assert.equal(toCursorAgentRelativePath('a/b/c.md'), path.join('a', 'b', 'ecc-c.md'));
  assert.equal(toCursorAgentRelativePath('ecc-review/planner.md'), path.join('ecc-review', 'ecc-planner.md'));
});

test('a path without directories behaves like a bare file name', () => {
  assert.equal(toCursorAgentRelativePath('planner.md'), 'ecc-planner.md');
  assert.equal(toCursorAgentRelativePath('ecc-planner.md'), 'ecc-planner.md');
});

test('backslash and repeated separators are normalized to the platform separator', () => {
  assert.equal(toCursorAgentRelativePath('review\\planner.md'), path.join('review', 'ecc-planner.md'));
  assert.equal(toCursorAgentRelativePath('review//planner.md'), path.join('review', 'ecc-planner.md'));
  assert.equal(toCursorAgentRelativePath('review\\\\sub/planner.md'), path.join('review', 'sub', 'ecc-planner.md'));
});

test('a trailing separator is dropped and the last real segment is renamed', () => {
  assert.equal(toCursorAgentRelativePath('review/planner.md/'), path.join('review', 'ecc-planner.md'));
});

test('empty, missing, and separator-only paths come back unchanged', () => {
  assert.equal(toCursorAgentRelativePath(''), '');
  assert.equal(toCursorAgentRelativePath(undefined), undefined);
  assert.equal(toCursorAgentRelativePath(null), null);
  assert.equal(toCursorAgentRelativePath('/'), '/');
  assert.equal(toCursorAgentRelativePath('\\\\'), '\\\\');
});

test('the result is always relative to the destination root', () => {
  // The executor joins the result under the target agents directory, so a
  // leading separator must not be able to re-root the destination.
  const result = toCursorAgentRelativePath('/etc/planner.md');
  assert.equal(result, path.join('etc', 'ecc-planner.md'));
  assert.equal(path.isAbsolute(result), false);
});

test('dot segments are not interpreted; the transform renames, it does not resolve', () => {
  // The executor walks real directory entries, so these never reach the
  // transform in practice. Pin that it does not quietly collapse them either.
  assert.equal(toCursorAgentRelativePath('./planner.md'), path.join('.', 'ecc-planner.md'));
  assert.equal(toCursorAgentRelativePath('../planner.md'), path.join('..', 'ecc-planner.md'));
});

test('the relative path transform composes the file name transform', () => {
  for (const file of ['planner.md', 'ecc-planner.md', 'README']) {
    assert.equal(toCursorAgentRelativePath(`nested/${file}`), path.join('nested', toCursorAgentFileName(file)));
  }
});
