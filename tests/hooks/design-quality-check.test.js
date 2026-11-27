/**
 * Tests for scripts/hooks/design-quality-check.js
 *
 * Run with: node tests/hooks/design-quality-check.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../../scripts/hooks/design-quality-check');

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

let passed = 0;
let failed = 0;

console.log('\nDesign Quality Hook Tests');
console.log('=========================\n');

if (test('passes through non-frontend files silently', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/tmp/file.py' } });
  const result = hook.run(input);
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout, input);
  assert.ok(!result.stderr);
})) passed++; else failed++;

if (test('warns for frontend file path', () => {
  const tmpFile = path.join(os.tmpdir(), `design-quality-${Date.now()}.tsx`);
  fs.writeFileSync(tmpFile, 'export function Hero(){ return <div className="text-center">Get Started</div>; }\n');
  try {
    const input = JSON.stringify({ tool_input: { file_path: tmpFile } });
    const result = hook.run(input);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, input);
    assert.match(result.stderr, /DESIGN CHECK/);
    assert.match(result.stderr, /Get Started/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
})) passed++; else failed++;

if (test('handles MultiEdit edits[] payloads', () => {
  const tmpFile = path.join(os.tmpdir(), `design-quality-${Date.now()}.css`);
  fs.writeFileSync(tmpFile, '.hero{background:linear-gradient(to right,#000,#333)}\n');
  try {
    const input = JSON.stringify({
      tool_input: {
        edits: [{ file_path: tmpFile }, { file_path: '/tmp/notes.md' }]
      }
    });
    const result = hook.run(input);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, input);
    assert.match(result.stderr, /frontend file\(s\) modified/);
    assert.match(result.stderr, /\.css/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
})) passed++; else failed++;

if (test('returns original stdout on invalid JSON', () => {
  const input = '{not valid json';
  const result = hook.run(input);
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout, input);
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
