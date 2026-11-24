/**
 * Tests for harness detection shown in the canvas presence pill
 * (scripts/lib/plan-canvas/agent-identity.js).
 *
 * Run with: node tests/lib/plan-canvas-agent-identity.test.js
 */

const assert = require('assert');
const path = require('path');

const identity = require('../../scripts/lib/plan-canvas/agent-identity');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}\n    ${error.stack || error.message}`);
  }
}

console.log('plan-canvas agent identity');

test('detectAgentName recognizes each harness marker and falls back to agent', () => {
  assert.strictEqual(identity.detectAgentName({}), 'agent');
  assert.strictEqual(identity.detectAgentName({ CLAUDECODE: '1' }), 'Claude Code');
  assert.strictEqual(identity.detectAgentName({ CODEX_SANDBOX: 'seatbelt' }), 'Codex');
  assert.strictEqual(identity.detectAgentName({ CURSOR_TRACE_ID: 'x' }), 'Cursor');
  assert.strictEqual(identity.detectAgentName({ GEMINI_CLI: '1' }), 'Gemini CLI');
  assert.strictEqual(identity.detectAgentName({ OPENCODE: '1' }), 'OpenCode');
  assert.strictEqual(identity.detectAgentName({ COPILOT_AGENT: '1' }), 'Copilot');
  assert.strictEqual(identity.detectAgentName({ KIMI_CLI: '1' }), 'Kimi');
  assert.strictEqual(identity.detectAgentName({ QWEN_CODE: '1' }), 'Qwen Code');
  assert.strictEqual(identity.detectAgentName({ CLAUDECODE: '' }), 'agent', 'empty markers do not count');
});

test('ECC_CANVAS_AGENT overrides detection and is clamped', () => {
  assert.strictEqual(identity.detectAgentName({ CLAUDECODE: '1', ECC_CANVAS_AGENT: '  Fleet worker 3 ' }), 'Fleet worker 3');
  assert.strictEqual(identity.detectAgentName({ ECC_CANVAS_AGENT: 'x'.repeat(100) }).length, 60);
});

test('agentDescriptor reports the name and the project basename only', () => {
  const descriptor = identity.agentDescriptor({ env: { CODEX_THREAD_ID: 't' }, cwd: path.join('/Users', 'someone', 'repos', 'shop') });
  assert.deepStrictEqual(descriptor, { name: 'Codex', project: 'shop' });
});

test('agentFromParam reads a JSON descriptor or a bare harness name', () => {
  assert.strictEqual(identity.agentFromParam(null), null);
  assert.strictEqual(identity.agentFromParam(''), null);
  assert.deepStrictEqual(identity.agentFromParam('{"name":"Codex","project":"ecc"}'), { name: 'Codex', project: 'ecc' });
  assert.deepStrictEqual(identity.agentFromParam('Claude Code'), { name: 'Claude Code' });
  assert.strictEqual(identity.agentFromParam('{"name":""}'), null);
});

test('sanitizeAgentDescriptor drops junk and clamps lengths', () => {
  assert.strictEqual(identity.sanitizeAgentDescriptor(null), null);
  assert.strictEqual(identity.sanitizeAgentDescriptor({ name: '   ' }), null);
  assert.deepStrictEqual(identity.sanitizeAgentDescriptor({ name: ' Claude Code ', project: 'ecc', extra: 1 }), { name: 'Claude Code', project: 'ecc' });
  const long = identity.sanitizeAgentDescriptor({ name: 'n'.repeat(80), project: 'p'.repeat(200) });
  assert.strictEqual(long.name.length, 60);
  assert.strictEqual(long.project.length, 120);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
