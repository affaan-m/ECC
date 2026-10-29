'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const tracker = require('../../scripts/lib/skill-evolution/tracker');

const execution = {
  skill_id: 'demo',
  skill_version: 'v1',
  task_description: 'Run a temporary task',
  outcome: 'success',
};
const timestamp = '2026-03-15T12:32:00.000Z';
const invalidTimestamps = [2026, [timestamp], new Date(timestamp), {}];

function withRunsFile(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-tracker-timestamps-'));
  const runsFilePath = path.join(root, 'runs.jsonl');
  try {
    fn({ runsFilePath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('rejects non-string execution timestamps before creating storage', () => {
  withRunsFile(options => {
    for (const recorded_at of invalidTimestamps) {
      assert.throws(
        () => tracker.recordSkillExecution({ ...execution, recorded_at }, options),
        /recorded_at must be an ISO timestamp/
      );
      assert.equal(fs.existsSync(options.runsFilePath), false);
    }
  });
});

test('rejects invalid clock overrides without changing existing records', () => {
  withRunsFile(options => {
    tracker.recordSkillExecution({ ...execution, recorded_at: timestamp }, options);
    const previousBytes = fs.readFileSync(options.runsFilePath, 'utf8');
    for (const now of invalidTimestamps) {
      assert.throws(
        () => tracker.recordSkillExecution(execution, { ...options, now }),
        /recorded_at must be an ISO timestamp/
      );
      assert.equal(fs.readFileSync(options.runsFilePath, 'utf8'), previousBytes);
    }
    assert.equal(tracker.readSkillExecutionRecords(options).length, 1);
  });
});

test('retains explicit and clock-supplied string timestamps on readback', () => {
  withRunsFile(options => {
    const offsetTimestamp = '2026-03-15T14:32:00+02:00';
    tracker.recordSkillExecution({ ...execution, recorded_at: offsetTimestamp }, { ...options, now: 2026 });
    tracker.recordSkillExecution(execution, { ...options, now: timestamp });
    assert.deepEqual(
      tracker.readSkillExecutionRecords(options).map(record => record.recorded_at),
      [offsetTimestamp, timestamp]
    );
    tracker.recordSkillExecution(execution, options);
    const records = tracker.readSkillExecutionRecords(options);
    assert.equal(records.length, 3);
    assert.equal(typeof records[2].recorded_at, 'string');
    assert.ok(Number.isFinite(Date.parse(records[2].recorded_at)));
  });
});

test('rejects invalid timestamps before submitting to a state store', () => {
  withRunsFile(options => {
    let writes = 0;
    const stateStore = {
      recordSkillExecution() {
        writes += 1;
        return {};
      },
    };
    for (const recorded_at of invalidTimestamps) {
      assert.throws(
        () => tracker.recordSkillExecution({ ...execution, recorded_at }, { ...options, stateStore }),
        /recorded_at must be an ISO timestamp/
      );
      assert.equal(writes, 0);
      assert.equal(fs.existsSync(options.runsFilePath), false);
    }
  });
});
