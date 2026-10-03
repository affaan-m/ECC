'use strict';
/**
 * Tests for scripts/lib/context-gate-state.js
 *
 * Covers gate threshold resolution, the enabled/active checks the advisory
 * hooks (suggest-compact, ecc-context-monitor) use to defer to the
 * context-gate, and the transcript-confirmed gateOwnsTranscript helper.
 *
 * Run with: node tests/lib/context-gate-state.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolvePct,
  resolveGatePct,
  resolveEmergencyPct,
  isGateEnabled,
  isGateActive,
  gateOwnsTranscript,
  DEFAULT_GATE_PCT,
  DEFAULT_EMERGENCY_PCT,
  GATE_HOOK_ID
} = require('../../scripts/lib/context-gate-state');

console.log('=== Testing context-gate-state.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function writeTranscript(tokens, model = 'claude-unknown-x') {
  const file = path.join(os.tmpdir(), `ecc-gate-state-test-${process.pid}-${Math.random().toString(16).slice(2)}.jsonl`);
  const record = JSON.stringify({
    type: 'assistant',
    message: {
      model,
      usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 50 }
    }
  });
  fs.writeFileSync(file, record + '\n', 'utf8');
  return file;
}

// ── resolveGatePct / resolveEmergencyPct ──

test('defaults: gate 90, emergency 96', () => {
  assert.strictEqual(resolveGatePct({}), DEFAULT_GATE_PCT);
  assert.strictEqual(resolveEmergencyPct({}), DEFAULT_EMERGENCY_PCT);
});

test('env overrides are honored and 0 disables', () => {
  assert.strictEqual(resolveGatePct({ ECC_CONTEXT_GATE_PCT: '70' }), 70);
  assert.strictEqual(resolveGatePct({ ECC_CONTEXT_GATE_PCT: '0' }), 0);
  assert.strictEqual(resolveEmergencyPct({ ECC_CONTEXT_GATE_EMERGENCY_PCT: '99' }), 99);
});

test('resolvePct rejects partial and non-decimal values', () => {
  assert.strictEqual(resolvePct({ X: '90abc' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
  assert.strictEqual(resolvePct({ X: '0x1' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
  assert.strictEqual(resolvePct({ X: '150' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
});

// ── isGateEnabled ──

test('enabled by default profile, disabled by threshold 0', () => {
  assert.strictEqual(isGateEnabled({}), true);
  assert.strictEqual(isGateEnabled({ ECC_CONTEXT_GATE_PCT: '0' }), false);
});

test('disabled via ECC_DISABLED_HOOKS', () => {
  assert.strictEqual(isGateEnabled({ ECC_DISABLED_HOOKS: GATE_HOOK_ID }), false);
});

// ── isGateActive ──

test('active at/above the threshold, inactive below', () => {
  assert.strictEqual(isGateActive({ tokens: 180000, windowTokens: 200000, env: {} }), true);
  assert.strictEqual(isGateActive({ tokens: 179999, windowTokens: 200000, env: {} }), false);
});

test('inactive on invalid inputs or disabled gate', () => {
  assert.strictEqual(isGateActive({ tokens: NaN, windowTokens: 200000, env: {} }), false);
  assert.strictEqual(isGateActive({ tokens: 190000, windowTokens: 0, env: {} }), false);
  assert.strictEqual(isGateActive({ tokens: 190000, windowTokens: 200000, env: { ECC_CONTEXT_GATE_PCT: '0' } }), false);
});

// ── gateOwnsTranscript ──

test('true for a readable transcript in the gate band', () => {
  const t = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, {}), true);
  } finally {
    fs.unlinkSync(t);
  }
});

test('false below the band and with the gate disabled', () => {
  const t = writeTranscript(100000);
  const t2 = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, {}), false);
    assert.strictEqual(gateOwnsTranscript(t2, { ECC_CONTEXT_GATE_PCT: '0' }), false);
  } finally {
    fs.unlinkSync(t);
    fs.unlinkSync(t2);
  }
});

test('false when the gate cannot evaluate usage (missing/unreadable transcript)', () => {
  // The advisory hooks use false to KEEP their own warnings — a gate that
  // cannot fire must never silence its fallbacks.
  assert.strictEqual(gateOwnsTranscript(path.join(os.tmpdir(), `ecc-gate-state-nope-${process.pid}.jsonl`), {}), false);
  assert.strictEqual(gateOwnsTranscript('', {}), false);
  const broken = path.join(os.tmpdir(), `ecc-gate-state-broken-${process.pid}.jsonl`);
  fs.writeFileSync(broken, 'not json\n{broken', 'utf8');
  try {
    assert.strictEqual(gateOwnsTranscript(broken, {}), false);
  } finally {
    fs.unlinkSync(broken);
  }
});

test('honors an injected env window override', () => {
  // 190k reads as 95% of an inferred 200k window, but an injected 1M
  // override puts it at 19% — not in the gate band.
  const t = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, { ECC_CONTEXT_WINDOW_TOKENS: '1000000' }), false);
  } finally {
    fs.unlinkSync(t);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
