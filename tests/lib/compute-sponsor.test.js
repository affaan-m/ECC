'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const computeSponsor = require('../../scripts/lib/compute-sponsor');

const { ITO_COMPUTE_URL, getComputeSponsorCopy } = computeSponsor;
const URL_TOKEN_PATTERN = /https?:\/\/[^\s<>"'`(){}\\]+/g;

function urlsIn(text) {
  return (text.match(URL_TOKEN_PATTERN) || []).map(token => token.replace(/[.,;:!?]+$/, ''));
}

test('the compute URL is the exact Ito route with no path, query, hash, or credentials', () => {
  const parsed = new URL(ITO_COMPUTE_URL);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'compute.itomarkets.com');
  assert.equal(parsed.port, '');
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  assert.equal(ITO_COMPUTE_URL, 'https://compute.itomarkets.com');
});

test('the copy links the compute URL exactly once and links nowhere else', () => {
  assert.deepEqual(urlsIn(getComputeSponsorCopy()), [ITO_COMPUTE_URL]);
});

test('the copy names Ito as the preferred sponsor and keeps other providers open', () => {
  const copy = getComputeSponsorCopy();
  assert.match(copy, /^Run or self-host any open-source model\./);
  assert.match(copy, /Itô is ECC's preferred compute sponsor/);
  assert.match(copy, /Any GPU provider works\./);
});

test('the copy keeps the sponsorship link passive', () => {
  const copy = getComputeSponsorCopy();
  assert.match(copy, /This sponsorship link is passive/);
  assert.match(copy, /does not invoke an RFQ, reserve capacity, provision compute, or configure serving/);
});

test('the copy keeps the ecc ito find bridge separate, opt-in, and non-reserving', () => {
  const copy = getComputeSponsorCopy();
  assert.match(copy, /Separately, the opt-in "ecc ito find" bridge/);
  assert.match(copy, /explicitly configured canonical Itô CLI/);
  assert.match(copy, /submits a live authenticated RFQ; it does not reserve capacity\./);
});

test('the copy does not claim managed inference is live', () => {
  assert.match(getComputeSponsorCopy(), /Managed inference through Itô is not live yet\.$/);
});

test('the copy is a single trimmed line of printable text', () => {
  const copy = getComputeSponsorCopy();
  assert.equal(typeof copy, 'string');
  assert.ok(copy.length > 0);
  assert.equal(copy, copy.trim());
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(copy, /[\x00-\x1f\x7f]/);
  assert.doesNotMatch(copy, / {2}/);
});

test('the copy is deterministic across calls', () => {
  assert.equal(getComputeSponsorCopy(), getComputeSponsorCopy());
});

test('the module surface is frozen and exports only the URL and the copy builder', () => {
  assert.ok(Object.isFrozen(computeSponsor));
  assert.deepEqual(Object.keys(computeSponsor).sort(), ['ITO_COMPUTE_URL', 'getComputeSponsorCopy']);
  assert.throws(() => {
    computeSponsor.ITO_COMPUTE_URL = 'https://example.invalid/';
  }, TypeError);
  assert.equal(computeSponsor.ITO_COMPUTE_URL, 'https://compute.itomarkets.com');
});
