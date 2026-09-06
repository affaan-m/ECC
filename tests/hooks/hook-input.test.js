/**
 * Regression tests for bounded hook stdin reads.
 */

'use strict';

const assert = require('assert');
const { PassThrough } = require('stream');
const { readStdinRaw } = require('../../scripts/hooks/hook-input');
const { run: runConfigProtection } = require('../../scripts/hooks/config-protection');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function readFromErroredStream(partialInput) {
  const stream = new PassThrough();
  const resultPromise = readStdinRaw(stream, { maxStdin: 1024 });
  stream.write(partialInput);
  stream.destroy(new Error('simulated stdin read failure'));
  return resultPromise;
}

async function readFromClosedStream(partialInput) {
  const stream = new PassThrough();
  const resultPromise = readStdinRaw(stream, { maxStdin: 1024 });
  stream.write(partialInput);
  stream.destroy();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('readStdinRaw did not settle after stream close')),
      500
    );
    resultPromise.then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function runTests() {
  console.log('\nHook input reader tests:');

  let passed = 0;
  let failed = 0;

  if (
    await test('clean end preserves complete input', async () => {
      const stream = new PassThrough();
      const resultPromise = readStdinRaw(stream, { maxStdin: 1024 });
      stream.end('{"complete":true}');

      assert.deepStrictEqual(await resultPromise, {
        raw: '{"complete":true}',
        truncated: false
      });
    })
  )
    passed++;
  else failed++;

  if (
    await test('stream error marks partial input as truncated', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{';
      const result = await readFromErroredStream(partialInput);

      assert.strictEqual(result.raw, partialInput);
      assert.strictEqual(result.truncated, true);
    })
  )
    passed++;
  else failed++;

  if (
    await test('close without end marks partial input as truncated', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{';
      const result = await readFromClosedStream(partialInput);

      assert.strictEqual(result.raw, partialInput);
      assert.strictEqual(result.truncated, true);
    })
  )
    passed++;
  else failed++;

  if (
    await test('errored partial PreToolUse input remains fail closed', async () => {
      const partialInput = '{"tool_name":"Write","tool_input":{"file_path":".eslintrc.js"';
      const inputResult = await readFromErroredStream(partialInput);
      const hookResult = runConfigProtection(inputResult.raw, {
        truncated: inputResult.truncated,
        maxStdin: 1024
      });

      assert.strictEqual(inputResult.truncated, true);
      assert.strictEqual(hookResult.exitCode, 2);
      assert.match(hookResult.stderr, /Refusing to bypass config-protection/);
    })
  )
    passed++;
  else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
