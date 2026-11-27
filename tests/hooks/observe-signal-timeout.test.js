/**
 * Tests for observe.sh SIGALRM timeout visibility (#2300).
 *
 * observe.sh arms a signal.SIGALRM alarm (8s) inside its inline-Python blocks so
 * the observation writer self-terminates before the async hook's 10s timeout can
 * orphan it (#2278). Before #2300 the handler `_clv2_bail` called sys.exit(0) with
 * no logging, so a timeout silently dropped the in-flight observation: nothing was
 * logged and the shell saw a clean exit. The fix adds a stderr visibility line to
 * each handler while keeping exit 0 (changing to a non-zero exit would make the
 * Claude hook report a block, per the repo's "always exit 0; log to stderr" rule).
 *
 * Two checks:
 *   1. Static regression guard — every `_clv2_bail` handler in observe.sh writes to
 *      sys.stderr before sys.exit(0).
 *   2. Behavioral check — the REAL handler text extracted from observe.sh, when its
 *      alarm fires, exits 0 and emits the `[observe]` visibility token on stderr
 *      (and never on stdout, which is the observations-file stream).
 */

if (process.platform === 'win32') {
  console.log('Skipping bash/SIGALRM-dependent observe tests on Windows');
  process.exit(0);
}

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    failed += 1;
  }
}

function findPython() {
  const candidates = [
    { command: process.env.PYTHON, args: [] },
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
    { command: 'py', args: ['-3'] },
  ].filter(candidate => candidate.command);

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result && result.status === 0) {
      return candidate;
    }
  }
  return null;
}

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'hooks',
  'observe.sh'
);

const observeSrc = fs.readFileSync(observeShPath, 'utf8');

// Extract each `_clv2_bail` handler body: the `def` line plus the indented lines
// that follow it, up to (and including) the first dedented `sys.exit(0)` line at
// the same indentation as the def's body.
function extractHandlers(src) {
  const lines = src.split('\n');
  const handlers = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^def _clv2_bail\(\*_\):\s*$/.test(lines[i])) {
      const body = [lines[i]];
      for (let j = i + 1; j < lines.length; j += 1) {
        // Stop when we hit a line that is not indented (next top-level stmt).
        if (lines[j].length > 0 && !/^\s/.test(lines[j])) {
          break;
        }
        body.push(lines[j]);
        if (/^\s+sys\.exit\(0\)\s*$/.test(lines[j])) {
          break;
        }
      }
      handlers.push(body.join('\n'));
    }
  }
  return handlers;
}

const handlers = extractHandlers(observeSrc);

// The #2300 timeout handlers are the ones that log the `[observe] SIGALRM
// timeout` marker. Selecting by marker (rather than by array index) keeps the
// behavioral check pinned to the timeout handlers even if an unrelated
// `_clv2_bail` is ever added elsewhere in observe.sh.
const timeoutHandlers = handlers.filter(body =>
  body.includes('[observe] SIGALRM timeout')
);

test('observe.sh defines at least two _clv2_bail timeout handlers', () => {
  assert.ok(
    handlers.length >= 2,
    `expected >= 2 _clv2_bail handlers, found ${handlers.length}`
  );
  assert.ok(
    timeoutHandlers.length >= 2,
    `expected >= 2 handlers carrying the [observe] SIGALRM timeout marker, found ${timeoutHandlers.length}`
  );
});

test('every _clv2_bail handler logs to stderr before exiting (regression guard)', () => {
  handlers.forEach((body, idx) => {
    const stderrIdx = body.indexOf('file=sys.stderr');
    const exitIdx = body.indexOf('sys.exit(0)');
    assert.ok(
      stderrIdx !== -1,
      `handler #${idx + 1} does not write to sys.stderr (silent drop regression):\n${body}`
    );
    assert.ok(
      exitIdx !== -1,
      `handler #${idx + 1} is missing sys.exit(0):\n${body}`
    );
    assert.ok(
      stderrIdx < exitIdx,
      `handler #${idx + 1} must log to stderr BEFORE sys.exit(0):\n${body}`
    );
    assert.ok(
      body.includes('[observe]'),
      `handler #${idx + 1} stderr log should use the [observe] prefix:\n${body}`
    );
  });
});

test('_clv2_bail handlers keep exit code 0 (no exit 2 / block regression)', () => {
  handlers.forEach((body, idx) => {
    assert.ok(
      /sys\.exit\(0\)/.test(body),
      `handler #${idx + 1} must exit 0 to preserve the async-hook timeout contract (#2278):\n${body}`
    );
    assert.ok(
      !/sys\.exit\([1-9]/.test(body),
      `handler #${idx + 1} must not exit non-zero (would surface as a hook block):\n${body}`
    );
  });
});

function runHandlerTimeout(python, handler) {
  // Run the ACTUAL handler text extracted from observe.sh, forcing the alarm.
  const program = [
    'import sys, signal, time',
    handler,
    'signal.signal(signal.SIGALRM, _clv2_bail)',
    'signal.alarm(1)',
    'time.sleep(3)',
    'print("REACHED_END_SHOULD_NOT_HAPPEN")',
  ].join('\n');

  return spawnSync(python.command, [...python.args, '-c', program], {
    encoding: 'utf8',
    timeout: 15000,
  });
}

// Exercise EVERY timeout handler end-to-end, not just the first. The main
// observation-write path is the higher-value one to verify: it carries valid,
// parseable data that would succeed given more time, so a silent drop there is
// the worst case. A behavioral check on only one handler would not catch a
// regression that silenced another.
timeoutHandlers.forEach((handler, idx) => {
  test(`real _clv2_bail timeout handler #${idx + 1}: SIGALRM fire emits stderr token and exits 0`, () => {
    const python = findPython();
    if (!python) {
      // Fail fast rather than returning (which the harness would record as a
      // PASS): a missing interpreter means the SIGALRM contract went
      // unverified, which must not look like a green regression test.
      throw new Error('python3 interpreter not available; the SIGALRM regression cannot be verified');
    }

    const result = runHandlerTimeout(python, handler);

    assert.strictEqual(result.signal, null, `python killed by signal ${result.signal}`);
    assert.strictEqual(result.status, 0, `expected exit 0 on timeout, got ${result.status}`);
    assert.ok(
      /\[observe\] SIGALRM timeout/.test(result.stderr),
      `expected the [observe] SIGALRM timeout warning on stderr, got: ${JSON.stringify(result.stderr)}`
    );
    assert.ok(
      !/REACHED_END_SHOULD_NOT_HAPPEN/.test(result.stdout),
      'handler should have terminated before the post-sleep stdout write'
    );
    assert.ok(
      !/\[observe\] SIGALRM timeout/.test(result.stdout),
      'the warning must go to stderr, never stdout (stdout is the observations stream)'
    );
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
