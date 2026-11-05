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

function inputFor(transcriptPath, extra = {}) {
  return JSON.stringify({ session_id: 'test', transcript_path: transcriptPath, prompt: 'continue', ...extra });
}

function runTests() {
  console.log('\n=== Testing context-gate.js ===\n');

  let passed = 0;
  let failed = 0;
  const cleanup = [];
  // Enforcement is opt-in: the gate only fires in enforce mode. These tests
  // exercise the firing path, so they run with enforce set. The default
  // (advisory) posture is covered separately below. Isolated env object: no
  // ECC_* leakage from the host.
  const env = { ECC_CONTEXT_GATE_MODE: 'enforce' };

  console.log('opt-in / default posture:');

  if (
    test('default install (no mode set) stays silent even deep in the band', () => {
      // 97% occupancy, but with no ECC_CONTEXT_GATE_MODE the gate is inert and
      // does no per-prompt checkpoint work.
      const t = writeTranscript(970000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { env: {} }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('ECC_CONTEXT_GATE_MODE=off stays silent in the band', () => {
      const t = writeTranscript(970000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { env: { ECC_CONTEXT_GATE_MODE: 'off' } }), '');
    })
  )
    passed++;
  else failed++;

  console.log('\nrun() — gate behavior (enforce mode):');

  if (
    test('below threshold (50% of 1M) stays completely silent', () => {
      const t = writeTranscript(500000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { env }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('at 90% of 1M fires the order with UserPromptSubmit additionalContext', () => {
      const t = writeTranscript(905000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), { env }));
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.ok(ctx.includes('CONTEXT GATE TRIPPED'));
      // Checkpoint targets the session-scoped handoff path, not project-root RESUME.md.
      assert.ok(/[/\\]resume[/\\].*-test\.md/.test(ctx), `expected handoff path with session id. Got: ${ctx}`);
      assert.ok(ctx.includes('Do NOT overwrite or modify an existing RESUME.md'));
      assert.ok(out.systemMessage.includes('90%'));
      assert.ok(!ctx.includes('EMERGENCY'));
    })
  )
    passed++;
  else failed++;

  if (
    test('at 97% of 1M escalates to EMERGENCY', () => {
      const t = writeTranscript(970000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), { env }));
      assert.ok(out.hookSpecificOutput.additionalContext.includes('EMERGENCY'));
      assert.ok(out.systemMessage.includes('EMERGENCY'));
    })
  )
    passed++;
  else failed++;

  if (
    test('order forbids asking to stop and demands a resume command', () => {
      const cp = '/home/me/.claude/session-data/resume/myproj-abc123.md';
      const text = buildOrderText({ pct: 91, tokens: 910000, windowTokens: 1000000, inferred: false, emergency: false, checkpointPath: cp });
      assert.ok(text.includes('Do NOT ask whether to stop'));
      assert.ok(text.includes(`claude "Read ${cp} and continue`));
      assert.ok(text.includes(cp));
      assert.ok(text.includes('VERIFIED facts strictly separated from hypotheses'));
      // Observed usage is distinguished from permission to stop.
      assert.ok(text.includes('not by itself permission to abandon the task'));
    })
  )
    passed++;
  else failed++;

  if (
    test('inferred window softens the order to a strong recommendation', () => {
      // Unknown model at 185k → 200k window assumed (92%), but the true
      // window could be larger, so the mandatory wording must drop.
      const t = writeTranscript(185000, 'claude-unknown-experimental');
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), { env }));
      const text = out.hookSpecificOutput.additionalContext;
      assert.ok(text.includes('CONTEXT GATE TRIPPED'));
      assert.ok(!text.includes('an order, not a suggestion'));
      assert.ok(text.includes('INFERRED'));
      assert.ok(text.includes('strong recommendation'));
      assert.ok(/[/\\]resume[/\\].*-test\.md/.test(text));
      assert.ok(out.systemMessage.includes('strongly advised'));
      assert.ok(!out.systemMessage.includes('ordered'));
    })
  )
    passed++;
  else failed++;

  console.log('\nrun() — safety:');

  if (
    test('malformed stdin fails open to empty output', () => {
      assert.strictEqual(run('not json', { env }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('missing transcript path fails open to empty output', () => {
      assert.strictEqual(run(JSON.stringify({ transcript_path: path.join(os.tmpdir(), 'ecc-context-gate-nope.jsonl') }), { env }), '');
      assert.strictEqual(run(JSON.stringify({}), { env }), '');
      assert.strictEqual(run('', { env }), '');
    })
  )
    passed++;
  else failed++;

  console.log('\nenvironment controls:');

  if (
    test('ECC_CONTEXT_GATE_PCT=0 disables the gate (even in enforce mode)', () => {
      const t = writeTranscript(990000);
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { env: { ...env, ECC_CONTEXT_GATE_PCT: '0' } }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('ECC_CONTEXT_GATE_PCT=70 lowers the trigger', () => {
      const t = writeTranscript(750000);
      cleanup.push(t);
      const out = JSON.parse(run(inputFor(t), { env: { ...env, ECC_CONTEXT_GATE_PCT: '70' } }));
      assert.ok(out.hookSpecificOutput.additionalContext.includes('CONTEXT GATE TRIPPED'));
    })
  )
    passed++;
  else failed++;

  if (
    test('gate >= emergency default clamps emergency above the gate (two-tier preserved)', () => {
      // ECC_CONTEXT_GATE_PCT=98 with the 96 emergency default: without the
      // clamp every fire (pct >= 98) would also be >= 96 and skip step 1.
      // Clamp makes emergency 99, so 98% fires as a full order (step 1 kept)
      // and only 99%+ escalates.
      const gateEnv = { ...env, ECC_CONTEXT_GATE_PCT: '98' };
      const at98 = writeTranscript(980000);
      cleanup.push(at98);
      const out98 = JSON.parse(run(inputFor(at98), { env: gateEnv }));
      assert.ok(out98.hookSpecificOutput.additionalContext.includes('CONTEXT GATE TRIPPED'));
      assert.ok(!out98.hookSpecificOutput.additionalContext.includes('EMERGENCY'));
      assert.ok(out98.hookSpecificOutput.additionalContext.includes('Do NOT start any new work stream'));
      assert.ok(!out98.systemMessage.includes('EMERGENCY'));

      const at99 = writeTranscript(990000);
      cleanup.push(at99);
      const out99 = JSON.parse(run(inputFor(at99), { env: gateEnv }));
      assert.ok(out99.hookSpecificOutput.additionalContext.includes('EMERGENCY'));
      assert.ok(out99.systemMessage.includes('EMERGENCY'));
    })
  )
    passed++;
  else failed++;

  if (
    test('injected env window override reaches resolveContextWindow', () => {
      // 185k on an unknown model would infer a 200k window (92%, gate
      // fires); an injected 1M override must make it 18% and stay silent.
      const t = writeTranscript(185000, 'claude-unknown-experimental');
      cleanup.push(t);
      assert.strictEqual(run(inputFor(t), { env: { ...env, ECC_CONTEXT_WINDOW_TOKENS: '1000000' } }), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('window override is honored (200k forced onto a fable transcript)', () => {
      const t = writeTranscript(185000);
      cleanup.push(t);
      // 185k of 1M would be 18%; forced 200k window makes it 92%.
      // Injected form: options.env governs window resolution too.
      const out = JSON.parse(run(inputFor(t), { env: { ...env, ECC_CONTEXT_WINDOW_TOKENS: '200000' } }));
      assert.ok(out.systemMessage.includes('92%'));
      // Registered-path form: metadata second arg falls back to process.env
      // (including the opt-in mode).
      const original = process.env.ECC_CONTEXT_WINDOW_TOKENS;
      const originalMode = process.env.ECC_CONTEXT_GATE_MODE;
      try {
        process.env.ECC_CONTEXT_WINDOW_TOKENS = '200000';
        process.env.ECC_CONTEXT_GATE_MODE = 'enforce';
        const viaProcess = JSON.parse(run(inputFor(t), { hookId: 'user-prompt:context-gate' }));
        assert.ok(viaProcess.systemMessage.includes('92%'));
      } finally {
        if (original === undefined) delete process.env.ECC_CONTEXT_WINDOW_TOKENS;
        else process.env.ECC_CONTEXT_WINDOW_TOKENS = original;
        if (originalMode === undefined) delete process.env.ECC_CONTEXT_GATE_MODE;
        else process.env.ECC_CONTEXT_GATE_MODE = originalMode;
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

  if (
    test('resolvePct rejects partially numeric and non-decimal values', () => {
      // parseInt would accept these ('90abc' → 90, '0x1' → 0, the latter
      // silently disabling the gate); a whole decimal integer is required.
      assert.strictEqual(resolvePct({ X: '90abc' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({ X: '0x1' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({ X: '9.5' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({ X: '-1' }, 'X', DEFAULT_GATE_PCT), DEFAULT_GATE_PCT);
      assert.strictEqual(resolvePct({ X: '0' }, 'X', DEFAULT_GATE_PCT), 0);
    })
  )
    passed++;
  else failed++;

  if (
    test('registered runner path (metadata second arg) reads process.env overrides', () => {
      // run-with-flags.js calls run(raw, { hookId, pluginRoot, ... }) — the
      // second argument is runner metadata, not the environment. Overrides
      // must still take effect from process.env in that path.
      const t = writeTranscript(990000);
      cleanup.push(t);
      const original = process.env.ECC_CONTEXT_GATE_PCT;
      const originalMode = process.env.ECC_CONTEXT_GATE_MODE;
      try {
        // Enforce mode on, but PCT=0 — read from process.env on the metadata
        // path — must still disable, proving the override is honored there.
        process.env.ECC_CONTEXT_GATE_MODE = 'enforce';
        process.env.ECC_CONTEXT_GATE_PCT = '0';
        const meta = { hookId: 'user-prompt:context-gate', pluginRoot: '/nonexistent', truncated: false };
        assert.strictEqual(run(inputFor(t), meta), '');
      } finally {
        if (original === undefined) delete process.env.ECC_CONTEXT_GATE_PCT;
        else process.env.ECC_CONTEXT_GATE_PCT = original;
        if (originalMode === undefined) delete process.env.ECC_CONTEXT_GATE_MODE;
        else process.env.ECC_CONTEXT_GATE_MODE = originalMode;
      }
    })
  )
    passed++;
  else failed++;

  console.log('\nhandoff checkpoint ownership (enforce mode):');

  if (
    test('a pre-existing project RESUME.md is never targeted and is left untouched', () => {
      const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gate-proj-'));
      const existing = path.join(projDir, 'RESUME.md');
      fs.writeFileSync(existing, 'OPERATOR CONTENT — must survive\n', 'utf8');
      const t = writeTranscript(950000);
      cleanup.push(t);
      try {
        const out = JSON.parse(run(inputFor(t, { cwd: projDir }), { env }));
        const ctx = out.hookSpecificOutput.additionalContext;
        // Checkpoint goes to the session-handoff dir, not the project root.
        assert.ok(/[/\\]resume[/\\]/.test(ctx), 'checkpoint must live under the handoff resume dir');
        assert.ok(!ctx.includes(existing), 'order must not target the operator RESUME.md');
        assert.ok(ctx.includes('preserves whatever the operator already has'));
        // The hook injects an order; it writes nothing itself — the file stands.
        assert.strictEqual(fs.readFileSync(existing, 'utf8'), 'OPERATOR CONTENT — must survive\n');
      } finally {
        fs.rmSync(projDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('repeated fires in one session resolve to the same stable checkpoint path', () => {
      const t = writeTranscript(950000);
      cleanup.push(t);
      const extract = (raw) => {
        const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext;
        return ctx.match(/\S*[/\\]resume[/\\]\S*-test\.md/)[0];
      };
      const first = extract(run(inputFor(t, { cwd: '/tmp/ecc-demo-proj' }), { env }));
      const second = extract(run(inputFor(t, { cwd: '/tmp/ecc-demo-proj' }), { env }));
      assert.strictEqual(first, second, 'same session must reuse one checkpoint path (idempotent)');
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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

runTests();
