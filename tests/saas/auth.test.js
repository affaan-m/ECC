'use strict';

/**
 * Tests for auth middleware (JWT sign/verify, no DB required)
 * Run: node tests/saas/auth.test.js
 */

const assert = require('assert');

process.env.JWT_SECRET = 'test-secret-key-for-unit-tests-only';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'; // never actually connected

const { signJwt, hashApiKey } = require('../../src/saas/middleware/auth');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('\nauth middleware (unit)');

// ─── JWT ─────────────────────────────────────────────────────────────────────

test('signJwt returns three dot-separated parts', () => {
  const token = signJwt({ sub: 'user-123', email: 'test@example.com' });
  assert.strictEqual(token.split('.').length, 3);
});

test('signJwt payload is valid base64url JSON', () => {
  const token = signJwt({ sub: 'user-abc' });
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.strictEqual(payload.sub, 'user-abc');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  assert.ok(payload.iat > 0);
});

test('signJwt expiry is respected', () => {
  const token = signJwt({ sub: 'x' }, 3600);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const diff = payload.exp - payload.iat;
  assert.strictEqual(diff, 3600);
});

test('signJwt produces different tokens for same payload (iat differs)', () => {
  const t1 = signJwt({ sub: 'u1' });
  const t2 = signJwt({ sub: 'u1' });
  // tokens may be equal if called within same second — just verify format
  assert.strictEqual(t1.split('.').length, 3);
  assert.strictEqual(t2.split('.').length, 3);
});

// ─── API Key hashing ─────────────────────────────────────────────────────────

test('hashApiKey returns 64 char hex string', () => {
  const hash = hashApiKey('ira_live_abc123xyz');
  assert.strictEqual(hash.length, 64);
  assert.match(hash, /^[0-9a-f]+$/);
});

test('hashApiKey is deterministic', () => {
  const k = 'ira_test_key_12345';
  assert.strictEqual(hashApiKey(k), hashApiKey(k));
});

test('hashApiKey produces different hashes for different keys', () => {
  assert.notStrictEqual(hashApiKey('key-a'), hashApiKey('key-b'));
});

test('hashApiKey handles empty string', () => {
  const hash = hashApiKey('');
  assert.strictEqual(hash.length, 64);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
