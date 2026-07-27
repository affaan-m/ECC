/**
 * Tests for scripts/hooks/skill-run-tracker.js and the JSONL sink bounds in
 * scripts/lib/skill-evolution/tracker.js (#2463).
 *
 * Focus: the tracker records real runs, and it never persists prompt text,
 * unbounded strings, an unbounded file, or a world-readable sink.
 *
 * Run with: node tests/run-all.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildRecord, deriveOutcome, extractSkillId, run } = require('../../scripts/hooks/skill-run-tracker');
const {
  MAX_RUN_RECORDS,
  RUNS_FILE_MODE,
  getRunsFilePath,
  recordSkillExecution,
  readSkillExecutionRecords,
} = require('../../scripts/lib/skill-evolution/tracker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function withTempHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-runs-'));
  try {
    return fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function payload(overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill_id: 'code-review', skill_version: '1.2.0' },
    tool_response: {},
    ...overrides,
  };
}

// ── skill id extraction and bounds ────────────────────────────────────────────

test('extractSkillId probes the field names Claude Code has used', () => {
  assert.strictEqual(extractSkillId({ skill_id: 'a' }), 'a');
  assert.strictEqual(extractSkillId({ skillId: 'b' }), 'b');
  assert.strictEqual(extractSkillId({ skill: 'c' }), 'c');
  assert.strictEqual(extractSkillId({ name: 'd' }), 'd');
  assert.strictEqual(extractSkillId({ command: 'e' }), 'e');
  assert.strictEqual(extractSkillId('bare-string'), 'bare-string');
});

test('extractSkillId returns null when no skill id is present', () => {
  assert.strictEqual(extractSkillId({}), null);
  assert.strictEqual(extractSkillId(null), null);
  assert.strictEqual(extractSkillId(42), null);
});

test('extractSkillId rejects an over-long identifier rather than truncating it', () => {
  assert.strictEqual(extractSkillId({ skill_id: 'x'.repeat(129) }), null);
  assert.strictEqual(extractSkillId({ skill_id: 'x'.repeat(128) }), 'x'.repeat(128));
});

test('extractSkillId rejects free text that is not identifier-shaped', () => {
  // A prompt smuggled into the skill field must not become a persisted id.
  assert.strictEqual(extractSkillId({ skill_id: 'summarize this: my api key is sk-abc' }), null);
  assert.strictEqual(extractSkillId({ skill_id: 'line\nbreak' }), null);
  assert.strictEqual(extractSkillId({ skill_id: '   ' }), null);
});

// ── privacy: no prompt text is persisted ─────────────────────────────────────

test('buildRecord synthesizes task_description and never copies prompt fields', () => {
  const secret = 'PROMPT-SECRET-do-not-persist';
  const record = buildRecord(payload({
    tool_input: {
      skill_id: 'code-review',
      skill_version: '1.2.0',
      task_description: secret,
      description: secret,
      prompt: secret,
      taskDescription: secret,
    },
  }));

  assert.strictEqual(record.task_description, 'Skill invocation: code-review');
  assert.ok(!JSON.stringify(record).includes(secret), 'record must not contain any prompt text');
});

test('buildRecord persists only the four dashboard fields', () => {
  const record = buildRecord(payload());
  assert.deepStrictEqual(
    Object.keys(record).sort(),
    ['outcome', 'skill_id', 'skill_version', 'task_description']
  );
});

test('buildRecord drops a non-identifier skill_version instead of persisting it', () => {
  const record = buildRecord(payload({
    tool_input: { skill_id: 'code-review', skill_version: 'v1 (as requested by the user in chat)' },
  }));
  assert.strictEqual(record.skill_version, 'unknown');
});

test('buildRecord returns null when the skill id is unusable', () => {
  assert.strictEqual(buildRecord(payload({ tool_input: {} })), null);
});

// ── outcome derivation ───────────────────────────────────────────────────────

test('deriveOutcome reports failure for PostToolUseFailure routing', () => {
  assert.strictEqual(deriveOutcome(payload({ hook_event_name: 'PostToolUseFailure' })), 'failure');
});

test('deriveOutcome reports failure for error-bearing tool responses', () => {
  assert.strictEqual(deriveOutcome(payload({ tool_response: { is_error: true } })), 'failure');
  assert.strictEqual(deriveOutcome(payload({ tool_response: { isError: true } })), 'failure');
  assert.strictEqual(deriveOutcome(payload({ tool_response: { status: 'ERROR' } })), 'failure');
  assert.strictEqual(deriveOutcome(payload({ tool_response: { error: 'boom' } })), 'failure');
});

test('deriveOutcome reports success otherwise', () => {
  assert.strictEqual(deriveOutcome(payload()), 'success');
  assert.strictEqual(deriveOutcome(payload({ tool_response: { status: 'ok' } })), 'success');
});

// ── hook behaviour ───────────────────────────────────────────────────────────

test('run ignores non-Skill tools and malformed input without throwing', () => {
  assert.doesNotThrow(() => run(JSON.stringify(payload({ tool_name: 'Bash' }))));
  assert.doesNotThrow(() => run('not json'));
  assert.doesNotThrow(() => run(''));
});

// ── JSONL sink bounds ────────────────────────────────────────────────────────

test('recordSkillExecution writes the sink owner-only', function () {
  if (process.platform === 'win32') {
    return; // POSIX modes are not meaningful on Windows
  }
  withTempHome(homeDir => {
    recordSkillExecution(
      { skill_id: 'code-review', skill_version: '1.0.0', task_description: 'Skill invocation: code-review', outcome: 'success' },
      { homeDir }
    );
    const runsFilePath = getRunsFilePath({ homeDir });
    const mode = fs.statSync(runsFilePath).mode & 0o777;
    assert.strictEqual(mode, RUNS_FILE_MODE, `expected mode ${RUNS_FILE_MODE.toString(8)}, got ${mode.toString(8)}`);
  });
});

test('recordSkillExecution re-tightens an already world-readable sink', function () {
  if (process.platform === 'win32') {
    return;
  }
  withTempHome(homeDir => {
    const runsFilePath = getRunsFilePath({ homeDir });
    fs.mkdirSync(path.dirname(runsFilePath), { recursive: true });
    fs.writeFileSync(runsFilePath, '', { mode: 0o644 });

    recordSkillExecution(
      { skill_id: 'code-review', skill_version: '1.0.0', task_description: 'Skill invocation: code-review', outcome: 'success' },
      { homeDir }
    );

    assert.strictEqual(fs.statSync(runsFilePath).mode & 0o777, RUNS_FILE_MODE);
  });
});

test('the JSONL sink is bounded by a retention cap', () => {
  withTempHome(homeDir => {
    const maxRecords = 5;
    for (let i = 0; i < maxRecords + 4; i++) {
      recordSkillExecution(
        { skill_id: `skill-${i}`, skill_version: '1.0.0', task_description: `Skill invocation: skill-${i}`, outcome: 'success' },
        { homeDir, maxRecords }
      );
    }

    const records = readSkillExecutionRecords({ homeDir });
    assert.strictEqual(records.length, maxRecords, 'sink must be trimmed to the cap');
    // Trimming keeps the newest runs, so the dashboard still reflects recent activity.
    assert.strictEqual(records[records.length - 1].skill_id, `skill-${maxRecords + 3}`);
    assert.strictEqual(records[0].skill_id, `skill-${4}`);
  });
});

test('the default retention cap is a finite bound', () => {
  assert.ok(Number.isInteger(MAX_RUN_RECORDS) && MAX_RUN_RECORDS > 0, 'MAX_RUN_RECORDS must be a positive integer');
});

test('an end-to-end Skill hook run lands exactly one non-sensitive record', () => {
  withTempHome(homeDir => {
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    try {
      run(JSON.stringify(payload({
        tool_input: { skill_id: 'code-review', skill_version: '1.2.0', prompt: 'PROMPT-SECRET' },
      })));

      const records = readSkillExecutionRecords({ homeDir });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].skill_id, 'code-review');
      assert.strictEqual(records[0].skill_version, '1.2.0');
      assert.strictEqual(records[0].outcome, 'success');
      assert.ok(!JSON.stringify(records[0]).includes('PROMPT-SECRET'));
    } finally {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    }
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}
