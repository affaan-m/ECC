/**
 * Tests for scripts/lib/github-coordination/gh-api.js — normalizeIssueNumber
 *
 * Guards against silent truncation of malformed issue numbers
 * (https://github.com/affaan-m/ECC/issues/3514): parseInt-style prefix
 * parsing accepted "42oops" as 42, "42.9" as 42, and "4e2" as 4, while
 * integers beyond 2^53 lost precision (9007199254740993 became ...992).
 * The same helper also parses --limit, so malformed values there must be
 * rejected too. Whitespace, leading plus, and leading zero tolerance is
 * preserved.
 *
 * Run with: node tests/lib/github-coordination-gh-api.test.js
 */

'use strict';

const assert = require('assert');

const {
  normalizeIssueNumber,
} = require('../../scripts/lib/github-coordination/gh-api');
const { test, banner, section, summary } = require('./helpers/mini-test-runner');

let passed = 0;
let failed = 0;

banner('normalizeIssueNumber — accepted forms:');

if (test('accepts a plain positive integer', () => {
  assert.strictEqual(normalizeIssueNumber('42'), 42);
})) passed++; else failed++;

if (test('preserves surrounding whitespace tolerance', () => {
  assert.strictEqual(normalizeIssueNumber(' 7 '), 7);
})) passed++; else failed++;

if (test('preserves leading plus tolerance', () => {
  assert.strictEqual(normalizeIssueNumber('+7'), 7);
})) passed++; else failed++;

if (test('preserves leading zero tolerance', () => {
  assert.strictEqual(normalizeIssueNumber('007'), 7);
})) passed++; else failed++;

if (test('accepts MAX_SAFE_INTEGER exactly', () => {
  assert.strictEqual(normalizeIssueNumber('9007199254740991'), 9007199254740991);
})) passed++; else failed++;

if (test('accepts numeric (non-string) input', () => {
  assert.strictEqual(normalizeIssueNumber(42), 42);
})) passed++; else failed++;

section('normalizeIssueNumber — malformed tokens are rejected, not truncated:');

for (const [value, label] of [
  ['42oops', 'trailing garbage after digits'],
  ['42.9', 'decimal fraction'],
  ['4e2', 'exponent notation'],
  ['0x10', 'hex notation'],
  ['1e999', 'exponent beyond Number range'],
  ['12 34', 'internal whitespace'],
  ['-.', 'punctuation only'],
]) {
  if (test(`rejects ${JSON.stringify(value)} (${label})`, () => {
    assert.throws(() => normalizeIssueNumber(value), /Invalid issue number/);
  })) passed++; else failed++;
}

section('normalizeIssueNumber — unsafe integers are rejected:');

for (const value of [
  '9007199254740992', // 2^53
  '9007199254740993', // 2^53 + 1 (rounds to 2^53 as a Number)
  '999999999999999999999999',
]) {
  if (test(`rejects ${value}`, () => {
    assert.throws(() => normalizeIssueNumber(value), /Invalid issue number/);
  })) passed++; else failed++;
}

section('normalizeIssueNumber — non-positive and empty inputs:');

for (const value of ['0', '-3', '', '   ', 'abc']) {
  if (test(`rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => normalizeIssueNumber(value), /Invalid issue number/);
  })) passed++; else failed++;
}

if (test('error message preserves the original input', () => {
  assert.throws(
    () => normalizeIssueNumber('42oops'),
    (error) => error.message === 'Invalid issue number: 42oops'
  );
})) passed++; else failed++;

summary(passed, failed);
