const assert = require('assert');
const { resolveHookSessionId } = require('../../scripts/lib/hook-session');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Hook session ID tests ===\n');

test('payload session_id takes precedence over both environment IDs', () => {
  assert.strictEqual(resolveHookSessionId('{"session_id":"payload-session"}', {
    ECC_SESSION_ID: 'ecc-session', CLAUDE_SESSION_ID: 'claude-session'
  }), 'payload-session');
});

test('ECC_SESSION_ID takes precedence over CLAUDE_SESSION_ID', () => {
  assert.strictEqual(resolveHookSessionId('{}', {
    ECC_SESSION_ID: 'ecc-session', CLAUDE_SESSION_ID: 'claude-session'
  }), 'ecc-session');
});

test('CLAUDE_SESSION_ID remains the legacy fallback', () => {
  assert.strictEqual(resolveHookSessionId('', { CLAUDE_SESSION_ID: 'legacy-session' }), 'legacy-session');
});

test('malformed and empty input safely fall back to the environment', () => {
  for (const input of ['', '  ', '{bad json', undefined, null]) {
    assert.strictEqual(resolveHookSessionId(input, { ECC_SESSION_ID: 'fallback' }), 'fallback');
  }
});

test('nonobject JSON does not supply a session ID', () => {
  for (const input of ['null', '[]', '[{"session_id":"nested"}]', '42', 'true', '"session"']) {
    assert.strictEqual(resolveHookSessionId(input, { CLAUDE_SESSION_ID: 'fallback' }), 'fallback');
  }
});

test('invalid payload ID types and blank IDs fall back safely', () => {
  for (const sessionId of [null, 42, true, {}, [], '', ' \t\n']) {
    assert.strictEqual(resolveHookSessionId(JSON.stringify({ session_id: sessionId }), {
      ECC_SESSION_ID: 'fallback'
    }), 'fallback');
  }
});

test('invalid ECC environment IDs fall back to the Claude environment ID', () => {
  for (const sessionId of [undefined, null, 42, true, {}, [], '', ' \t\n']) {
    assert.strictEqual(resolveHookSessionId('{}', {
      ECC_SESSION_ID: sessionId, CLAUDE_SESSION_ID: 'legacy-session'
    }), 'legacy-session');
  }
});

test('missing or invalid IDs return an empty string', () => {
  assert.strictEqual(resolveHookSessionId('{}', {}), '');
  assert.strictEqual(resolveHookSessionId('{"session_id":false}', {
    ECC_SESSION_ID: ' ', CLAUDE_SESSION_ID: null
  }), '');
});

test('only the top-level session_id field is accepted', () => {
  assert.strictEqual(resolveHookSessionId('{"nested":{"session_id":"nested"},"sessionId":"camel"}', {}), '');
});

test('raw IDs remain intact for each caller to apply its filename sanitizer', () => {
  for (const sessionId of ['../session\\alpha:*?', 'CON', 'session:one', '  session-one  ', 'sesión']) {
    assert.strictEqual(resolveHookSessionId(JSON.stringify({ session_id: sessionId }), {}), sessionId);
    assert.strictEqual(resolveHookSessionId('', { ECC_SESSION_ID: sessionId }), sessionId);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
