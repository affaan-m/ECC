'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli');

test('add then get round-trips a snippet', () => {
  const state = {};
  const added = run(['add', 'hello', 'hello', 'world'], state);
  assert.equal(added.code, 0);
  assert.equal(added.stdout, 'created hello\n');
  const got = run(['get', 'hello'], state);
  assert.equal(got.code, 0);
  assert.equal(got.stdout, 'hello world\n');
});

test('list on empty state', () => {
  const result = run(['list'], {});
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'no snippets\n');
});
