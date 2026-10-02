'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { functionSelector } = require('../src/selector');

test('name() selector matches the published ERC-20 value', () => {
  assert.equal(functionSelector('name()'), '0x06fdde03');
});

test('output format', () => {
  assert.match(functionSelector('totalSupply()'), /^0x[0-9a-f]{8}$/);
});
