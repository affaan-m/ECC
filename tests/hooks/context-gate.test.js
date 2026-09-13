/**
 * Tests for scripts/hooks/context-gate.js
 *
 * Run with: node tests/hooks/context-gate.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, buildOrderText, resolvePct, DEFAULT_GATE_PCT, DEFAULT_EMERGENCY_PCT } = require('../../scripts/hooks/context-gate');

// Test helper
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

/**
 * Write a minimal transcript JSONL whose latest assistant record reports the
 * given context token total against a claude-fable-5 (1M window) model.
 */
function writeTranscript(tokens, model = 'claude-fable-5') {
  const file = path.join(os.tmpdir(), `ecc-context-gate-test-${process.pid}-${Math.random().toString(16).slice(2)}.jsonl`);
  const records = [
    { type: 'user', message: { role: 'user', content: 'hello' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model,
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: tokens - 100,
          cache_creation_input_tokens: 0,
          output_tokens: 50
        }
      }
    }
  ];
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

function inputFor(transcriptPath) {
  return JSON.stringify({ session_id: 'test', transcript_path: transcriptPath, prompt: 'continue' });
}

function runTests() {
  console.log('\n=== Testing context-gate.js ===\n');

  let passed = 0;
  let failed = 0;
  const cleanup = [];
  const env = {}; // isolated env: no ECC_* leakage from the host

  console.log('run() — gate behavior:');

  if (
    test('below threshold (50% of 1M) stays completely silent', () => {
      const t = writeTranscript(500000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), env), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('at 90% of 1M fires the order with UserPromptSubmit additionalContext', () => {
      const t = writeTranscript(905000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), env));
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.ok(out.hookSpecificOutput.additionalContext.includes('CONTEXT GATE TRIPPED'));
      assert.ok(out.hookSpecificOutput.additionalContext.includes('RESUME.md'));
      assert.ok(out.systemMessage.includes('90%'));
      assert.ok(!out.hookSpecificOutput.additionalContext.includes('EMERGENCY'));
    })
  )
    passed++;
  else failed++;

  if (
    test('at 97% of 1M escalates to EMERGENCY', () => {
      const t = writeTranscript(970000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), env));
      assert.ok(out.hookSpecificOutput.additionalContext.includes('EMERGENCY'));
      assert.ok(out.systemMessage.includes('EMERGENCY'));
    })
  )
    passed++;
  else failed++;

  if (
    test('order forbids asking to stop and demands a resume command', () => {
      const text = buildOrderText({ pct: 91, tokens: 910000, windowTokens: 1000000, inferred: false, emergency: false });
      assert.ok(text.includes('Do NOT ask whether to stop'));
      assert.ok(text.includes('claude "Read <absolute checkpoint path>'));
      assert.ok(text.includes('VERIFIED facts strictly separated from hypotheses'));
    })
  )
    passed++;
  else failed++;

  console.log('\nrun() — safety:');

  if (
    test('malformed stdin fails open to empty output', () => {
      assert.strictEqual(run('not json', env), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('missing transcript path fails open to empty output', () => {
      assert.strictEqual(run(JSON.stringify({ transcript_path: path.join(os.tmpdir(), 'ecc-context-gate-nope.jsonl') }), env), '');
      assert.strictEqual(run(JSON.stringify({}), env), '');
      assert.strictEqual(run('', env), '');
    })
  )
    passed++;
  else failed++;

  console.log('\nenvironment controls:');

  if (
    test('ECC_CONTEXT_GATE_PCT=0 disables the gate', () => {
      const t = writeTranscript(990000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { ECC_CONTEXT_GATE_PCT: '0' }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('ECC_CONTEXT_GATE_PCT=70 lowers the trigger', () => {
      const t = writeTranscript(750000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), { ECC_CONTEXT_GATE_PCT: '70' }));
      assert.ok(out.hookSpecificOutput.additionalContext.includes('CONTEXT GATE TRIPPED'));
    })
  )
    passed++;
  else failed++;

  if (
    test('window override is honored (200k forced onto a fable transcript)', () => {
      const t = writeTranscript(185000);
      cleanup.push(t);
      // 185k of 1M would be 18%; forced 200k window makes it 92%. The
      // override is read from process.env by transcript-context.js.
      const original = process.env.ECC_CONTEXT_WINDOW_TOKENS;
      try {
        process.env.ECC_CONTEXT_WINDOW_TOKENS = '200000';
        const out = JSON.parse(run(inputFor(t), env));
        assert.ok(out.systemMessage.includes('92%'));
      } finally {
        if (original === undefined) delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
        else process.env.ECC_CONTEXT_WINDOW_TOKENS = original;
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('resolvePct falls back on invalid values and honors defaults', () => {
      assert.strictEqual(resolvePct({ X: 'abc' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({ X: '150' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({}, 'X', DEFAULT_EMERGENCY_PCT), DEFAULT_EMERGENCY_PCT);
      assert.strictEqual(resolvePct({ X: '85' }, 'X', DEFAULT_GATE_PCT), 85);
    })
  )
    passed++;
  else failed++;

  for (const file of cleanup) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests();
