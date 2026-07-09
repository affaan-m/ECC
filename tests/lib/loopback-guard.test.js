/**
 * Tests for scripts/lib/loopback-guard.js
 *
 * Run with: node tests/lib/loopback-guard.test.js
 */

const assert = require('assert');

const {
  LOOPBACK_HOSTNAMES,
  buildAllowedHostnames,
  isAllowedHostHeader,
  isAllowedOrigin,
  parseHostHeader
} = require('../../scripts/lib/loopback-guard');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing loopback-guard.js ===\n');

  let passed = 0;
  let failed = 0;

  console.log('parseHostHeader:');

  if (test('strips port from hostname', () => {
    assert.strictEqual(parseHostHeader('127.0.0.1:4517'), '127.0.0.1');
    assert.strictEqual(parseHostHeader('localhost:80'), 'localhost');
  })) passed++; else failed++;

  if (test('handles bare hostnames', () => {
    assert.strictEqual(parseHostHeader('localhost'), 'localhost');
  })) passed++; else failed++;

  if (test('lowercases hostnames', () => {
    assert.strictEqual(parseHostHeader('LocalHost:3000'), 'localhost');
  })) passed++; else failed++;

  if (test('keeps bracketed IPv6 hosts intact', () => {
    assert.strictEqual(parseHostHeader('[::1]:4517'), '[::1]');
  })) passed++; else failed++;

  if (test('returns null for missing or malformed values', () => {
    assert.strictEqual(parseHostHeader(null), null);
    assert.strictEqual(parseHostHeader(undefined), null);
    assert.strictEqual(parseHostHeader(''), null);
    assert.strictEqual(parseHostHeader('   '), null);
    assert.strictEqual(parseHostHeader(42), null);
    assert.strictEqual(parseHostHeader('bad:host:extra'), null);
  })) passed++; else failed++;

  console.log('\nbuildAllowedHostnames:');

  if (test('always includes loopback names', () => {
    const set = buildAllowedHostnames(null);
    for (const name of LOOPBACK_HOSTNAMES) assert.ok(set.has(name));
  })) passed++; else failed++;

  if (test('adds the configured host lowercased', () => {
    const set = buildAllowedHostnames('MyBox.Local');
    assert.ok(set.has('mybox.local'));
  })) passed++; else failed++;

  console.log('\nisAllowedHostHeader:');

  const allowed = buildAllowedHostnames('127.0.0.1');

  if (test('accepts loopback host headers', () => {
    assert.strictEqual(isAllowedHostHeader('127.0.0.1:4517', allowed), true);
    assert.strictEqual(isAllowedHostHeader('localhost:4517', allowed), true);
    assert.strictEqual(isAllowedHostHeader('[::1]:4517', allowed), true);
  })) passed++; else failed++;

  if (test('rejects DNS-rebinding style hostnames', () => {
    assert.strictEqual(isAllowedHostHeader('evil.example.com', allowed), false);
    assert.strictEqual(isAllowedHostHeader('127.0.0.1.evil.example.com', allowed), false);
  })) passed++; else failed++;

  if (test('rejects missing host header', () => {
    assert.strictEqual(isAllowedHostHeader(undefined, allowed), false);
  })) passed++; else failed++;

  console.log('\nisAllowedOrigin:');

  if (test('absent origin is allowed (same-origin nav, CLI)', () => {
    assert.strictEqual(isAllowedOrigin(undefined, allowed), true);
    assert.strictEqual(isAllowedOrigin(null, allowed), true);
  })) passed++; else failed++;

  if (test('loopback origins are allowed', () => {
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:4517', allowed), true);
    assert.strictEqual(isAllowedOrigin('http://localhost:4517', allowed), true);
  })) passed++; else failed++;

  if (test('cross-site origins are rejected', () => {
    assert.strictEqual(isAllowedOrigin('https://evil.example.com', allowed), false);
  })) passed++; else failed++;

  if (test('malformed origins are rejected', () => {
    assert.strictEqual(isAllowedOrigin('not a url', allowed), false);
  })) passed++; else failed++;

  console.log('\n' + '='.repeat(40));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(40));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
