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
  resolveGateMode,
  resolveGatePct,
  resolveEmergencyPct,
  isGateEnabled,
  isGateActive,
  gateOwnsTranscript,
  DEFAULT_GATE_PCT,
  DEFAULT_EMERGENCY_PCT,
  DEFAULT_GATE_MODE,
  GATE_HOOK_ID
} = require('../../scripts/lib/context-gate-state');

// Enforcement is opt-in; the active/suppression checks only hold in this mode.
const ENFORCE = { ECC_CONTEXT_GATE_MODE: 'enforce' };

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

/** Capture stderr writes while running fn(), restoring the original after. */
function captureStderr(fn) {
  const writes = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join('');
}

test('resolvePct warns once (to stderr) on a present-but-rejected value', () => {
  // Unique name so the module-level one-time guard is fresh for this assertion.
  const out = captureStderr(() => {
    assert.strictEqual(resolvePct({ WARN_ONCE_A: '50.5' }, 'WARN_ONCE_A', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
    assert.strictEqual(resolvePct({ WARN_ONCE_A: '50.5' }, 'WARN_ONCE_A', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
    assert.strictEqual(resolvePct({ WARN_ONCE_A: 'abc' }, 'WARN_ONCE_A', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
  });
  const hits = out.split('\n').filter((l) => l.includes('WARN_ONCE_A'));
  assert.strictEqual(hits.length, 1, 'misconfiguration must be surfaced exactly once');
  assert.ok(hits[0].includes('[context-gate]'));
  assert.ok(hits[0].includes('50.5'));
});

test('resolvePct stays silent for valid, zero-disable, and unset values', () => {
  const out = captureStderr(() => {
    assert.strictEqual(resolvePct({ QUIET_OK: '85' }, 'QUIET_OK', DEFAULT_GATE_PCT), 85);
    assert.strictEqual(resolvePct({ QUIET_ZERO: '0' }, 'QUIET_ZERO', DEFAULT_GATE_PCT), 0);
    assert.strictEqual(resolvePct({}, 'QUIET_UNSET', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
    assert.strictEqual(resolvePct({ QUIET_BLANK: '   ' }, 'QUIET_BLANK', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
  });
  assert.strictEqual(out.split('\n').filter((l) => l.includes('QUIET_')).length, 0);
});

// ── resolveGateMode ──

test('mode defaults to advisory (enforcement is opt-in)', () => {
  assert.strictEqual(resolveGateMode({}), DEFAULT_GATE_MODE);
  assert.strictEqual(DEFAULT_GATE_MODE, 'advisory');
  assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: '' }), 'advisory');
  assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: '   ' }), 'advisory');
});

test('mode accepts enforce/off (case- and whitespace-insensitive)', () => {
  assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: 'enforce' }), 'enforce');
  assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: '  ENFORCE ' }), 'enforce');
  assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: 'off' }), 'off');
});

test('mode falls back to advisory on a garbage value, with a one-time note', () => {
  const out = captureStderr(() => {
    // A mistyped mode must never silently enable enforcement.
    assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: 'enforced' }), 'advisory');
    assert.strictEqual(resolveGateMode({ ECC_CONTEXT_GATE_MODE: 'enforced' }), 'advisory');
  });
  const hits = out.split('\n').filter((l) => l.includes('ECC_CONTEXT_GATE_MODE'));
  assert.strictEqual(hits.length, 1, 'rejected mode must be surfaced exactly once');
  assert.ok(hits[0].includes('[context-gate]'));
  assert.ok(hits[0].includes('enforced'));
});

// ── isGateEnabled ──

test('disabled by default (advisory); enabled only in enforce mode', () => {
  // The default install must not enforce or suppress the advisory hooks.
  assert.strictEqual(isGateEnabled({}), false);
  assert.strictEqual(isGateEnabled(ENFORCE), true);
});

test('enforce mode still disabled by threshold 0, off mode, and ECC_DISABLED_HOOKS', () => {
  assert.strictEqual(isGateEnabled({ ...ENFORCE, ECC_CONTEXT_GATE_PCT: '0' }), false);
  assert.strictEqual(isGateEnabled({ ECC_CONTEXT_GATE_MODE: 'off' }), false);
  assert.strictEqual(isGateEnabled({ ...ENFORCE, ECC_DISABLED_HOOKS: GATE_HOOK_ID }), false);
});

// ── isGateActive ──

test('advisory default never active even deep in the band (no suppression)', () => {
  assert.strictEqual(isGateActive({ tokens: 195000, windowTokens: 200000, env: {} }), false);
});

test('active at/above the threshold, inactive below (enforce mode)', () => {
  assert.strictEqual(isGateActive({ tokens: 180000, windowTokens: 200000, env: ENFORCE }), true);
  assert.strictEqual(isGateActive({ tokens: 179999, windowTokens: 200000, env: ENFORCE }), false);
});

test('inactive on invalid inputs or disabled gate', () => {
  assert.strictEqual(isGateActive({ tokens: NaN, windowTokens: 200000, env: ENFORCE }), false);
  assert.strictEqual(isGateActive({ tokens: 190000, windowTokens: 0, env: ENFORCE }), false);
  assert.strictEqual(isGateActive({ tokens: 190000, windowTokens: 200000, env: { ...ENFORCE, ECC_CONTEXT_GATE_PCT: '0' } }), false);
});

// ── gateOwnsTranscript ──

test('advisory default: false even for a readable transcript in the band', () => {
  // Proves a default install adds no advisory suppression.
  const t = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, {}), false);
  } finally {
    fs.unlinkSync(t);
  }
});

test('true for a readable transcript in the gate band (enforce mode)', () => {
  const t = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, ENFORCE), true);
  } finally {
    fs.unlinkSync(t);
  }
});

test('false below the band and with the gate disabled', () => {
  const t = writeTranscript(100000);
  const t2 = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, ENFORCE), false);
    assert.strictEqual(gateOwnsTranscript(t2, { ...ENFORCE, ECC_CONTEXT_GATE_PCT: '0' }), false);
  } finally {
    fs.unlinkSync(t);
    fs.unlinkSync(t2);
  }
});

test('false when the gate cannot evaluate usage (missing/unreadable transcript)', () => {
  // The advisory hooks use false to KEEP their own warnings — a gate that
  // cannot fire must never silence its fallbacks.
  assert.strictEqual(gateOwnsTranscript(path.join(os.tmpdir(), `ecc-gate-state-nope-${process.pid}.jsonl`), ENFORCE), false);
  assert.strictEqual(gateOwnsTranscript('', ENFORCE), false);
  const broken = path.join(os.tmpdir(), `ecc-gate-state-broken-${process.pid}.jsonl`);
  fs.writeFileSync(broken, 'not json\n{broken', 'utf8');
  try {
    assert.strictEqual(gateOwnsTranscript(broken, ENFORCE), false);
  } finally {
    fs.unlinkSync(broken);
  }
});

test('honors an injected env window override', () => {
  // 190k reads as 95% of an inferred 200k window, but an injected 1M
  // override puts it at 19% — not in the gate band.
  const t = writeTranscript(190000);
  try {
    assert.strictEqual(gateOwnsTranscript(t, { ...ENFORCE, ECC_CONTEXT_WINDOW_TOKENS: '1000000' }), false);
  } finally {
    fs.unlinkSync(t);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
