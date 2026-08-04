/**
 * Tests for validate-hooks.js — hooks.json schema and format validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { test, createTestDir, cleanupTestDir, runValidatorWithDir, runValidator, finish } = require('./validator-test-utils');

console.log('\nvalidate-hooks.js:');

test('passes on real project hooks.json', () => {
  const result = runValidator('validate-hooks');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('exits 0 when hooks.json does not exist', () => {
  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', '/nonexistent/hooks.json');
  assert.strictEqual(result.code, 0, 'Should skip when no hooks.json');
});

test('fails on invalid event type', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        InvalidEventType: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid event type');
  assert.ok(result.stderr.includes('Invalid event type'), 'Should report invalid event type');
  cleanupTestDir(testDir);
});

test('fails on hook entry missing type field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ command: 'echo hi' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing type');
  assert.ok(result.stderr.includes('type'), 'Should report missing type');
  cleanupTestDir(testDir);
});

test('fails on hook entry missing command field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing command');
  assert.ok(result.stderr.includes('command'), 'Should report missing command');
  cleanupTestDir(testDir);
});

test('fails on invalid inline JS syntax', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "function {"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid inline JS');
  assert.ok(result.stderr.includes('invalid inline JS'), 'Should report JS syntax error');
  cleanupTestDir(testDir);
});

test('passes valid inline JS commands', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "console.log(1+2)"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should pass valid inline JS');
  cleanupTestDir(testDir);
});

test('validates array command format', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', '-e', 'console.log(1)'] }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept array command format');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (whitespace edge cases):');

test('rejects whitespace-only command string', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: '   \t  ' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only command');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('rejects null command value', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: null }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject null command');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('rejects numeric command value', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 42 }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject numeric command');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (schema edge cases):');

test('rejects event type value that is not an array', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: { PreToolUse: 'not-an-array' }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on non-array event type value');
  assert.ok(result.stderr.includes('must be an array'), 'Should report must be an array');
  cleanupTestDir(testDir);
});

test('rejects matcher entry that is null', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: { PreToolUse: [null] }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on null matcher entry');
  assert.ok(result.stderr.includes('is not an object'), 'Should report not an object');
  cleanupTestDir(testDir);
});

test('rejects matcher entry that is a string', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: { PreToolUse: ['just-a-string'] }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on string matcher entry');
  assert.ok(result.stderr.includes('is not an object'), 'Should report not an object');
  cleanupTestDir(testDir);
});

test('rejects top-level data that is a string', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, '"just a string"');

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on string data');
  assert.ok(result.stderr.includes('must be an object or array'), 'Should report must be object or array');
  cleanupTestDir(testDir);
});

test('rejects top-level data that is a number', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, '42');

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on numeric data');
  assert.ok(result.stderr.includes('must be an object or array'), 'Should report must be object or array');
  cleanupTestDir(testDir);
});

test('rejects empty string command', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: '' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject empty string command');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('rejects empty array command', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: [] }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject empty array command');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('rejects array command with non-string elements', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', 123, null] }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject non-string array elements');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('rejects non-string type field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 42, command: 'echo hi' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject non-string type');
  assert.ok(result.stderr.includes('type'), 'Should report type field error');
  cleanupTestDir(testDir);
});

test('rejects non-number timeout type', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: 'fast' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject string timeout');
  assert.ok(result.stderr.includes('timeout'), 'Should report timeout type error');
  cleanupTestDir(testDir);
});

test('accepts timeout of exactly 0', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: 0 }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept timeout of 0');
  cleanupTestDir(testDir);
});

test('validates object format without wrapping hooks key', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  // data.hooks is undefined, so fallback to data itself
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo ok' }] }]
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept object format without hooks wrapper');
  cleanupTestDir(testDir);
});

// --- validate-hooks.js: legacy format error paths ---
console.log('\nvalidate-hooks.js (legacy format errors):');

test('legacy format: rejects matcher missing matcher field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, JSON.stringify([{ hooks: [{ type: 'command', command: 'echo ok' }] }]));

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing matcher in legacy format');
  assert.ok(result.stderr.includes('matcher'), 'Should report missing matcher');
  cleanupTestDir(testDir);
});

test('legacy format: rejects matcher missing hooks array', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, JSON.stringify([{ matcher: 'test' }]));

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing hooks array in legacy format');
  assert.ok(result.stderr.includes('hooks'), 'Should report missing hooks');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (command arrays and error indexing):');

test('rejects array command with empty string element', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', '', 'script.js'] }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject array with empty string element');
  assert.ok(result.stderr.includes('command'), 'Should report command field error');
  cleanupTestDir(testDir);
});

test('reports correct index for error in deeply nested hook', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  const manyHooks = [];
  for (let i = 0; i < 5; i++) {
    manyHooks.push({ type: 'command', command: 'echo ok' });
  }
  // Add an invalid hook at index 5
  manyHooks.push({ type: 'command', command: '' });
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: manyHooks }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid hook at high index');
  assert.ok(result.stderr.includes('hooks[5]'), 'Should report correct hook index 5');
  cleanupTestDir(testDir);
});

test('validates node -e with escaped quotes in inline JS', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "const x = 1 + 2; process.exit(0)"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should pass valid multi-statement inline JS');
  cleanupTestDir(testDir);
});

test('accepts multiple valid event types in single hooks file', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo pre' }] }],
        PostToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo post' }] }],
        Stop: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo stop' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept multiple valid event types');
  assert.ok(result.stdout.includes('3'), 'Should report 3 matchers validated');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (empty matchers array):');

test('accepts event type with empty matchers array', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: []
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept empty matchers array');
  assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 matchers');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (inline JS escape sequences):');

test('validates inline JS with mixed escape sequences (newline + escaped quote)', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  // Command value after JSON parse: node -e "var a = \"ok\"\nconsole.log(a)"
  // Regex captures: var a = \"ok\"\nconsole.log(a)
  // After unescape chain: var a = "ok"\nconsole.log(a) (real newline) — valid JS
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "var a = \\"ok\\"\\nconsole.log(a)"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should handle escaped quotes and newline separators');
  cleanupTestDir(testDir);
});

test('rejects inline JS with syntax error after unescaping', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  // After unescape this becomes: var x = { — missing closing brace
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "var x = {"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject JS syntax error after unescaping');
  assert.ok(result.stderr.includes('invalid inline JS'), 'Should report inline JS error');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (command is a plain object — not string or array):');

test('rejects hook entry where command is a plain object', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: { run: 'echo hi' } }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should reject object command (not string or array)');
  assert.ok(result.stderr.includes('command'), 'Should report invalid command field');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (object-format matcher missing matcher field):');

test('rejects object-format matcher entry missing matcher field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  // Object format: matcher entry has hooks array but NO matcher field
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing matcher field in object format');
  assert.ok(result.stderr.includes("missing 'matcher' field"), 'Should report missing matcher field');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (async and timeout type validation):');

test('rejects hook with non-boolean async field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      PreToolUse: [
        {
          matcher: 'Write',
          hooks: [
            {
              type: 'command',
              command: 'echo test',
              async: 'yes' // Should be boolean, not string
            }
          ]
        }
      ]
    })
  );
  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on non-boolean async');
  assert.ok(result.stderr.includes('async'), 'Should mention async in error');
  assert.ok(result.stderr.includes('boolean'), 'Should mention boolean type');
  cleanupTestDir(testDir);
});

test('rejects hook with negative timeout value', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      PostToolUse: [
        {
          matcher: 'Edit',
          hooks: [
            {
              type: 'command',
              command: 'echo test',
              timeout: -5 // Must be non-negative
            }
          ]
        }
      ]
    })
  );
  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on negative timeout');
  assert.ok(result.stderr.includes('timeout'), 'Should mention timeout in error');
  assert.ok(result.stderr.includes('non-negative'), 'Should mention non-negative');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (invalid JSON in hooks.json):');

test('reports error for invalid JSON in hooks.json', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, '{not valid json!!!');

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, `Expected exit 1 for invalid JSON, got ${result.code}`);
  assert.ok(result.stderr.includes('Invalid JSON'), `stderr should mention Invalid JSON, got: ${result.stderr}`);
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (wrapped hooks format):');

test('validates wrapped format { hooks: { PreToolUse: [...] } }', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  // The production hooks.json uses this wrapped format — { hooks: { ... } }
  // data.hooks is the object with event types, not data itself
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      hooks: {
        PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo ok' }] }],
        PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo done' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, `Should pass wrapped hooks format, got exit ${result.code}. stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated 2'), `Should validate 2 matchers, got: ${result.stdout}`);
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (legacy array format):');

test('validates hooks in legacy array format (hooks is an array, not object)', () => {
  const testDir = createTestDir();
  // The legacy array format wraps hooks as { hooks: [...] } where the array
  // contains matcher objects directly. This exercises lines 115-135 of
  // validate-hooks.js which use "Hook ${i}" error labels instead of "${eventType}[${i}]".
  const hooksJson = JSON.stringify({
    hooks: [
      {
        matcher: 'Edit',
        hooks: [{ type: 'command', command: 'echo legacy test' }]
      }
    ]
  });
  fs.writeFileSync(path.join(testDir, 'hooks.json'), hooksJson);

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', path.join(testDir, 'hooks.json'));
  assert.strictEqual(result.code, 0, 'Should pass on valid legacy array format');
  assert.ok(result.stdout.includes('Validated 1 hook'), `Should report 1 validated matcher, got: ${result.stdout}`);
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (Notification and SubagentStop event types):');

test('accepts Notification and SubagentStop as valid event types', () => {
  const testDir = createTestDir();
  const hooksJson = JSON.stringify({
    hooks: [
      {
        matcher: { type: 'Notification' },
        hooks: [{ type: 'command', command: 'echo notification' }]
      },
      {
        matcher: { type: 'SubagentStop' },
        hooks: [{ type: 'command', command: 'echo subagent stopped' }]
      }
    ]
  });
  fs.writeFileSync(path.join(testDir, 'hooks.json'), hooksJson);

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', path.join(testDir, 'hooks.json'));
  assert.strictEqual(result.code, 0, 'Should pass with Notification and SubagentStop events');
  assert.ok(result.stdout.includes('Validated 2 hook'), `Should report 2 validated matchers, got: ${result.stdout}`);
  cleanupTestDir(testDir);
});

console.log('\nvalidate-hooks.js (current official events and hook types):');

test('accepts UserPromptSubmit with omitted matcher and prompt/http/agent hooks', () => {
  const testDir = createTestDir();
  const hooksJson = JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            { type: 'prompt', prompt: 'Summarize the request.' },
            { type: 'agent', prompt: 'Review for security issues.', model: 'gpt-5.4' },
            { type: 'http', url: 'https://example.com/hooks', headers: { 'X-Test-Header': 'hook-fixture-value' } }
          ]
        }
      ]
    }
  });
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, hooksJson);

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept current official hook event/type combinations');
  cleanupTestDir(testDir);
});

finish();
