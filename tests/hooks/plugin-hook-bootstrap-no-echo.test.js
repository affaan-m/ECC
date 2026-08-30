/**
 * Regression tests for plugin-hook-bootstrap.js raw-echo bloat.
 *
 * Before the fix, every fallthrough path in plugin-hook-bootstrap.js
 * (the actual entry point used by ECC plugin hooks, NOT run-with-flags.js)
 * echoed the full raw hook input JSON to stdout. For a typical
 * PostToolUse:Edit payload this is 10-130 KB of tool_input + tool_response
 * per tool call. The harness then wrote that stdout into the session
 * transcript as a hook_success attachment, ballooning 51 transcripts
 * to a combined 1.06 GB (89% of which was raw-echo bloat).
 *
 * The fix removes the 4 echo-raw sites in plugin-hook-bootstrap.js:
 *   - line 137: missing mode/relPath/rootDir
 *   - line 149: unknown mode
 *   - line 154: catch on spawn failure
 *   - line 31: passthrough() default when hook outputs nothing
 *
 * For each, we emit empty stdout and a stderr explanation. The harness
 * then falls back to the tool_use's original result, mirroring the
 * pattern already shipped in #2240 (bash-hook-dispatcher.js) and #2227
 * (run-with-flags.js truncation path).
 *
 * Related:
 *   - #2222 / #2227 — fixed the *truncated* path of run-with-flags.js
 *   - #2239 / #2240 — fixed the same bug in bash-hook-dispatcher.js
 *   - #1575 — "token limit so fast" (symptom caused in part by this)
 *
 * Fixtures live under a unique os.tmpdir() directory (per reviewer feedback
 * on #2380 — keep temp fixture files out of the live scripts/hooks/ tree and
 * avoid collisions across parallel/cross-platform test runs).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const bootstrap = path.join(repoRoot, 'scripts', 'hooks', 'plugin-hook-bootstrap.js');
const { isRawPassthrough } = require(bootstrap);
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pr2380-fixtures-'));

function cleanupFixtureDir() {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

process.once('exit', cleanupFixtureDir);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runBootstrap(args, input, env) {
  return spawnSync('node', [bootstrap, ...args], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...(env || {}) },
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runHookEntry(args, input, env) {
  const loader = `const s=${JSON.stringify(bootstrap)};process.argv.splice(1,0,s);require(s)`;
  return spawnSync(process.execPath, ['-e', loader, ...args], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...(env || {}) },
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function realisticPostToolUseEditPayload() {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: '/tmp/test.jsonl',
    cwd: '/tmp',
    permission_mode: 'auto',
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/tmp/example.ts',
      old_string: 'a'.repeat(200),
      new_string: 'b'.repeat(200)
    },
    tool_response: { filePath: '/tmp/example.ts', diff: 'c'.repeat(100 * 1024) },
    tool_use_id: 'call_test_1'
  });
}

console.log('\nplugin-hook-bootstrap raw-echo (no bloat) tests:');

let passed = 0;
let failed = 0;

// --- Bug site #1: line 137 (missing args) ---
if (
  test('fallthrough 1: missing mode emits empty stdout (no raw echo)', () => {
    const payload = realisticPostToolUseEditPayload();
    const result = runBootstrap([], payload, {
      CLAUDE_PLUGIN_ROOT: repoRoot
    });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '', 'missing-args path must NOT echo raw input (was ' + result.stdout.length + ' bytes)');
  })
)
  passed++;
else failed++;

// --- Bug site #2: line 149 (unknown mode) ---
if (
  test('fallthrough 2: unknown mode emits empty stdout (no raw echo)', () => {
    const payload = realisticPostToolUseEditPayload();
    const result = runBootstrap(['bogus-mode', path.join(FIXTURE_DIR, 'noop-hook-fixture.js')], payload, {
      CLAUDE_PLUGIN_ROOT: repoRoot
    });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '', 'unknown-mode path must NOT echo raw input (was ' + result.stdout.length + ' bytes)');
    assert.match(result.stderr, /unknown bootstrap mode/);
  })
)
  passed++;
else failed++;

// --- Bug site #3: line 31 (passthrough default) — THE CORE BUG ---
// This is what fires on EVERY successful hook call where the hook script
// itself didn't write to stdout. The default `passthrough` behavior is
// to echo raw input — which is the bulk of the bloat.
if (
  test('fallthrough 3: silent hook does NOT echo raw input (the core bug)', () => {
    const payload = realisticPostToolUseEditPayload();
    // A no-op node hook that reads stdin and exits silently. It lives in the
    // unique temporary fixture root, not in the live scripts/hooks/ tree.
    const noopHookPath = path.join(FIXTURE_DIR, 'noop-hook-fixture.js');
    fs.writeFileSync(noopHookPath, "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));");
    try {
      const result = runBootstrap(['node', path.basename(noopHookPath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, '', 'silent hook must NOT echo raw input (was ' + result.stdout.length + ' bytes)');
    } finally {
      fs.unlinkSync(noopHookPath);
    }
  })
)
  passed++;
else failed++;

// --- Bug site #4: tool_response leak guard (the user-visible symptom) ---
if (
  test('fallthrough 4: tool_response contents never leak into stdout', () => {
    const marker = 'PAYLOAD_MARKER_DO_NOT_LEAK_X9Z42';
    const payload = JSON.stringify({
      session_id: 'test',
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/x', old_string: 'A', new_string: 'B' },
      tool_response: { filePath: '/tmp/x', leaked: marker, diff: 'x'.repeat(50 * 1024) }
    });
    const result = runBootstrap([], payload, {
      CLAUDE_PLUGIN_ROOT: repoRoot
    });
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stdout.includes(marker), 'tool_response contents must not appear in stdout');
  })
)
  passed++;
else failed++;

// --- GREEN-side: behavior we want preserved ---
if (
  test('GREEN: hook that outputs JSON is passed through unchanged', () => {
    // When the hook legitimately produces output (e.g., PreToolUse
    // additionalContext), we must preserve that output verbatim.
    const fixturePath = path.join(FIXTURE_DIR, 'echo-fixture.js');
    const expectedOutput = '{"hookSpecificOutput":{"permissionDecision":"allow"}}\n';
    fs.writeFileSync(
      fixturePath,
      "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('" + expectedOutput.replace(/\n/g, '\\n') + "'); process.exit(0); });"
    );
    try {
      const payload = realisticPostToolUseEditPayload();
      const result = runBootstrap(['node', path.basename(fixturePath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.length > 0, 'hook that produced output should have non-empty stdout');
      // Must not contain the raw input — only the hook's own output
      assert.ok(!result.stdout.includes('tool_response'), 'when hook outputs its own stdout, raw input must not also be echoed');
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

// --- THE CORE ECC PATTERN: most ECC hooks do `process.stdout.write(run(data))`
//     where run(data) returns the raw input unchanged. Bootstrap must detect
//     this and emit empty stdout instead of writing raw back. ---
if (
  test('CORE ECC PATTERN: hook returning raw input as stdout is suppressed', () => {
    // Simulate the post-edit-accumulator pattern: read stdin, return it
    // unchanged via process.stdout.write. This is THE dominant source of
    // transcript bloat — 12+ ECC hook scripts use this exact pattern.
    const fixturePath = path.join(FIXTURE_DIR, 'passthrough-fixture.js');
    fs.writeFileSync(
      fixturePath,
      "let d=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => d += c); process.stdin.on('end', () => { process.stdout.write(d); process.exit(0); });"
    );
    try {
      const payload = realisticPostToolUseEditPayload();
      const result = runBootstrap(['node', path.basename(fixturePath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, '', 'hook that returned raw input as stdout must be suppressed (was ' + result.stdout.length + ' bytes)');
      assert.match(result.stderr, /returned raw input as stdout/, 'stderr should explain the suppression');
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

if (
  test('truncated UTF-8 prefix is classified by bytes', () => {
    const fixturePath = path.join(FIXTURE_DIR, 'multibyte-prefix-fixture.js');
    fs.writeFileSync(
      fixturePath,
      "let d=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => d += c); process.stdin.on('end', () => process.stdout.write(d.slice(0, 32768)));"
    );
    try {
      const payload = `${'é'.repeat(32768)}tail`;
      const result = runBootstrap(['node', path.basename(fixturePath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(Buffer.byteLength(payload.slice(0, 32768), 'utf8'), 64 * 1024);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'a UTF-8 byte prefix of raw input must be suppressed');
      assert.match(result.stderr, /returned raw input as stdout/);
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

if (
  test('classifies platform-dependent pipe prefixes without accepting mismatches', () => {
    const raw = Buffer.from(`${'a'.repeat(64 * 1024)}tail`, 'utf8');

    for (const prefixLength of [8 * 1024, 16 * 1024, 64 * 1024]) {
      assert.strictEqual(
        isRawPassthrough(raw, raw.subarray(0, prefixLength)),
        true,
        `${prefixLength}-byte raw prefix must be classified as passthrough`
      );
    }

    const mismatchLength = 8 * 1024;
    const mismatchedPrefix = Buffer.concat([
      raw.subarray(0, mismatchLength - 1),
      Buffer.from([raw[mismatchLength - 1] ^ 1])
    ]);
    assert.strictEqual(isRawPassthrough(raw, mismatchedPrefix), false);
  })
)
  passed++;
else failed++;

if (
  test('64 KiB byte prefix split inside UTF-8 remains a raw passthrough', () => {
    const raw = Buffer.from(`${'a'.repeat(65535)}étail`, 'utf8');
    const cappedStdout = raw.subarray(0, 64 * 1024);

    assert.strictEqual(cappedStdout.length, 64 * 1024);
    assert.strictEqual(cappedStdout.at(-1), Buffer.from('é', 'utf8')[0]);
    assert.strictEqual(
      isRawPassthrough(raw, cappedStdout),
      true,
      'classification must compare bytes before UTF-8 decoding can insert U+FFFD'
    );
  })
)
  passed++;
else failed++;

if (
  test('spawn classification suppresses a 64 KiB prefix split inside UTF-8', () => {
    const fixturePath = path.join(FIXTURE_DIR, 'split-byte-prefix-fixture.js');
    fs.writeFileSync(
      fixturePath,
      "const chunks=[]; process.stdin.on('data', chunk => chunks.push(chunk)); process.stdin.on('end', () => process.stdout.write(Buffer.concat(chunks).subarray(0, 64 * 1024)));"
    );
    try {
      const payload = `${'a'.repeat(65535)}étail`;
      const result = runBootstrap(['node', path.basename(fixturePath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'classification must occur before UTF-8 decoding');
      assert.match(result.stderr, /returned raw input as stdout/);
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

if (process.platform !== 'win32') {
  if (
    test('shell branch suppresses raw stdin echoed by the child', () => {
      const fixturePath = path.join(FIXTURE_DIR, 'passthrough-fixture.sh');
      fs.writeFileSync(fixturePath, 'cat\n');
      try {
        const payload = realisticPostToolUseEditPayload();
        const result = runBootstrap(['shell', path.basename(fixturePath)], payload, {
          CLAUDE_PLUGIN_ROOT: FIXTURE_DIR,
          BASH: fs.existsSync('/bin/sh') ? '/bin/sh' : 'sh'
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, '', 'shell raw-input passthrough must be suppressed');
        assert.match(result.stderr, /returned raw input as stdout/);
      } finally {
        fs.unlinkSync(fixturePath);
      }
    })
  )
    passed++;
  else failed++;
}

if (
  test('eval hook-entry preserves the original tool result when bootstrap stdout is empty', () => {
    const fixturePath = path.join(FIXTURE_DIR, 'entry-silent-fixture.js');
    fs.writeFileSync(fixturePath, "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));");
    try {
      const payload = JSON.parse(realisticPostToolUseEditPayload());
      const originalToolResult = structuredClone(payload.tool_response);
      const result = runHookEntry(['node', path.basename(fixturePath)], JSON.stringify(payload), {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'no-op hook entry must express no replacement result');

      // Claude's hook-entry contract treats empty stdout as no hook override;
      // the tool result already present in the event remains authoritative.
      const effectiveToolResult = result.stdout === ''
        ? payload.tool_response
        : JSON.parse(result.stdout).tool_response;
      assert.deepStrictEqual(effectiveToolResult, originalToolResult);
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

// --- Regression guard: hook with its OWN non-raw output (not equal to raw)
//     must still pass through unchanged. ---
if (
  test('hook with its own non-raw output passes through unchanged', () => {
    const fixturePath = path.join(FIXTURE_DIR, 'own-output-fixture.js');
    const ownOutput = '{"hookSpecificOutput":{"additionalContext":"hello"}}\n';
    fs.writeFileSync(
      fixturePath,
      "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('" + ownOutput.replace(/\n/g, '\\n').replace(/"/g, '\\"') + "'); process.exit(0); });"
    );
    try {
      const payload = realisticPostToolUseEditPayload();
      const result = runBootstrap(['node', path.basename(fixturePath)], payload, {
        CLAUDE_PLUGIN_ROOT: FIXTURE_DIR
      });
      assert.strictEqual(result.status, 0);
      // Should contain the hook's own output, not the raw input
      assert.ok(result.stdout.includes('additionalContext'), 'hook own output must be preserved');
      assert.ok(!result.stdout.includes('tool_response'), 'raw input must NOT be echoed when hook has its own output');
    } finally {
      fs.unlinkSync(fixturePath);
    }
  })
)
  passed++;
else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
