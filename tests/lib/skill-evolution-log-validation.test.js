const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tracker = require('../../scripts/lib/skill-evolution/tracker');
const versioning = require('../../scripts/lib/skill-evolution/versioning');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-log-validation-'));
const skillsRoot = path.join(root, 'skills');
const skillDir = path.join(skillsRoot, 'alpha');
const runsFile = path.join(root, 'runs.jsonl');
const now = '2026-03-15T12:00:00.000Z';
const validRun = { skill_id: 'alpha', outcome: 'success', recorded_at: now, extra: { keep: true } };
const proposal = { event: 'proposal', status: 'pending', created_at: now, extra: 'keep' };
fs.mkdirSync(path.join(skillDir, '.evolution'), { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Alpha\n');
const amendmentsFile = path.join(skillDir, '.evolution', 'amendments.jsonl');
const runsSource = [null, [], 3, 'text', {}, { ...validRun, skill_id: 3 },
  { ...validRun, outcome: 'unknown' }, { ...validRun, recorded_at: {} },
  { ...validRun, failure_reason: {} }, validRun].map(row => JSON.stringify(row)).join('\n') + '\n{bad-json}\n';
const amendmentsSource = [null, [], 3, 'text',
  { ...proposal, event: {} }, { ...proposal, status: [] },
  { ...proposal, created_at: 42 }, proposal].map(row => JSON.stringify(row)).join('\n') + '\n{bad-json}\n';
fs.writeFileSync(runsFile, runsSource);
fs.writeFileSync(amendmentsFile, amendmentsSource);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

try {
  test('written structured failure reasons remain visible on read', () => {
    const file = path.join(root, 'written-runs.jsonl');
    tracker.recordSkillExecution({ skill_id: 'alpha', skill_version: 'v1',
      task_description: 'fixture failure', outcome: 'failure',
      failure_reason: { code: 'timeout' }, recorded_at: now,
    }, { runsFilePath: file });
    const records = tracker.readSkillExecutionRecords({ runsFilePath: file });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].failure_reason, '{"code":"timeout"}');
    assert.strictEqual(records[0].outcome, 'failure');
  });
  test('execution reads ignore invalid shapes and preserve valid metadata and source bytes', () => {
    assert.deepStrictEqual(tracker.readSkillExecutionRecords({ runsFilePath: runsFile }), [
      { ...validRun, failure_reason: '{}' }, validRun,
    ]);
    assert.strictEqual(fs.readFileSync(runsFile, 'utf8'), runsSource);
  });
  test('evolution reads ignore non-object rows without rewriting the append-only log', () => {
    assert.deepStrictEqual(versioning.getEvolutionLog(skillDir, 'amendments'), [proposal]);
    assert.strictEqual(fs.readFileSync(amendmentsFile, 'utf8'), amendmentsSource);
  });
  test('actual health and dashboard CLIs keep valid metrics despite malformed rows in both logs', () => {
    for (const args of [[], ['--dashboard']]) {
      const result = spawnSync(process.execPath, [
        path.join(__dirname, '../../scripts/skills-health.js'), ...args, '--json',
        '--skills-root', skillsRoot, '--learned-root', path.join(root, 'learned'),
        '--imported-root', path.join(root, 'imported'), '--home', root,
        '--runs-file', runsFile, '--now', now,
      ], { encoding: 'utf8', timeout: 10000 });
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      if (args.length === 0) {
        assert.strictEqual(payload.skills.length, 1);
        assert.strictEqual(payload.skills[0].run_count_7d, 2);
        assert.strictEqual(payload.skills[0].success_rate_7d, 1);
        assert.strictEqual(payload.skills[0].pending_amendments, 1);
      } else {
        assert.strictEqual(payload.summary.total_skills, 1);
        assert.strictEqual(payload.panels.amendments.total, 1);
        assert.strictEqual(payload.panels['success-rate'].skills[0].current_7d, 1);
      }
      assert.strictEqual(fs.readFileSync(runsFile, 'utf8'), runsSource);
      assert.strictEqual(fs.readFileSync(amendmentsFile, 'utf8'), amendmentsSource);
    }
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
