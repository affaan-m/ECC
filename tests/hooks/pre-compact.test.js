'use strict';
/**
 * Tests for scripts/hooks/pre-compact.js — worktree-aware active-session
 * selection. The sessions dir is shared across projects/worktrees, so the
 * hook must annotate the CURRENT worktree's session, not whichever file is
 * newest by mtime. selectActiveSessionPath takes an injectable reader so the
 * selection logic is tested without touching the filesystem.
 */

const assert = require('assert');
const { selectActiveSessionPath } = require('../../scripts/hooks/pre-compact');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

// Reader built from a path -> content map (returns null for unknown/unreadable).
function reader(map) {
  return (p) => (Object.prototype.hasOwnProperty.call(map, p) ? map[p] : null);
}

const A = '/ecc-pre-compact-test/work/projA';
const B = '/ecc-pre-compact-test/work/projB';

if (test('selects the session matching the current worktree, not the newest', () => {
  const sessions = [
    { path: '/sessions/newest-session.tmp' }, // newest, different worktree
    { path: '/sessions/older-session.tmp' },  // older, our worktree
  ];
  const map = {
    '/sessions/newest-session.tmp': `**Project:** projB\n**Worktree:** ${B}\n`,
    '/sessions/older-session.tmp': `**Project:** projA\n**Worktree:** ${A}\n`,
  };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), '/sessions/older-session.tmp');
})) passed++; else failed++;

if (test('returns null when no session matches the current worktree (no foreign write)', () => {
  const sessions = [{ path: '/sessions/b-session.tmp' }];
  const map = { '/sessions/b-session.tmp': `**Project:** projB\n**Worktree:** ${B}\n` };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), null);
})) passed++; else failed++;

if (test('falls back to a legacy session (no Worktree header) with matching project name', () => {
  const sessions = [{ path: '/sessions/legacy-session.tmp' }];
  const map = { '/sessions/legacy-session.tmp': '**Project:** projA\n' };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), '/sessions/legacy-session.tmp');
})) passed++; else failed++;

if (test('does not project-match a session that has an explicit non-matching Worktree', () => {
  const sessions = [{ path: '/sessions/x-session.tmp' }];
  const map = { '/sessions/x-session.tmp': `**Project:** projA\n**Worktree:** ${B}\n` };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), null);
})) passed++; else failed++;

if (test('worktree match wins over a newer session AND over a legacy project match', () => {
  const sessions = [
    { path: '/sessions/legacy-session.tmp' }, // newest, legacy, same project
    { path: '/sessions/wt-session.tmp' },     // older, exact worktree
  ];
  const map = {
    '/sessions/legacy-session.tmp': '**Project:** projA\n',
    '/sessions/wt-session.tmp': `**Worktree:** ${A}\n`,
  };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), '/sessions/wt-session.tmp');
})) passed++; else failed++;

if (test('skips unreadable session files', () => {
  const sessions = [{ path: '/sessions/bad-session.tmp' }, { path: '/sessions/good-session.tmp' }];
  const map = { '/sessions/good-session.tmp': `**Worktree:** ${A}\n` };
  assert.strictEqual(selectActiveSessionPath(sessions, A, 'projA', reader(map)), '/sessions/good-session.tmp');
})) passed++; else failed++;

if (test('returns null for an empty session list', () => {
  assert.strictEqual(selectActiveSessionPath([], A, 'projA', reader({})), null);
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
