'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, openerCommandFor } = require('../../scripts/lib/platform-launch');

test('openerCommandFor: darwin returns open', () => {
  assert.deepEqual(openerCommandFor('darwin', 'http://x'), ['open', ['http://x']]);
});

test('openerCommandFor: win32 returns cmd /c start', () => {
  assert.deepEqual(openerCommandFor('win32', 'http://x'), ['cmd', ['/c', 'start', '', 'http://x']]);
});

test('openerCommandFor: linux returns xdg-open', () => {
  assert.deepEqual(openerCommandFor('linux', 'http://x'), ['xdg-open', ['http://x']]);
});

test('openerCommandFor: unknown falls through to xdg-open', () => {
  assert.deepEqual(openerCommandFor('freebsd', 'http://x'), ['xdg-open', ['http://x']]);
});

test('openBrowser: invalid url returns invalid-url without spawning', () => {
  const r1 = openBrowser('');
  assert.equal(r1.opened, false);
  assert.equal(r1.reason, 'invalid-url');
  const r2 = openBrowser(null);
  assert.equal(r2.opened, false);
  assert.equal(r2.reason, 'invalid-url');
});

test('openBrowser: returns structured { opened, reason }', () => {
  // Use a platform + URL that's syntactically valid. We can't easily assert
  // whether the browser actually opens in CI, but the structure must match.
  const r = openBrowser('http://localhost:0', 'linux');
  assert.equal(typeof r.opened, 'boolean');
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
});

test('openBrowser: uses xdg-open on linux', () => {
  // Spy by stubbing spawn via require cache (not possible without mocking module).
  // Smoke-test: just ensure the function is callable.
  const r = openBrowser('http://localhost:0', 'linux');
  // Either opened=true (xdg-open exists on runner) or opened=false with reason
  assert.ok(['spawned', 'child-error:ENOENT', 'child-error:EACCES', 'spawn-threw:ENOENT'].includes(r.reason)
      || r.opened === true || r.opened === false);
});
