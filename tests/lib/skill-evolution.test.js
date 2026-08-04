/**
 * Tests for skill evolution helpers.
 *
 * Run with: node tests/lib/skill-evolution.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const provenance = require('../../scripts/lib/skill-evolution/provenance');
const versioning = require('../../scripts/lib/skill-evolution/versioning');
const tracker = require('../../scripts/lib/skill-evolution/tracker');
const health = require('../../scripts/lib/skill-evolution/health');
const skillEvolution = require('../../scripts/lib/skill-evolution');

const HEALTH_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'skills-health.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function createSkill(skillRoot, name, content) {
  const skillDir = path.join(skillRoot, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  return skillDir;
}

function appendJsonl(filePath, rows) {
  const lines = rows.map(row => JSON.stringify(row)).join('\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [HEALTH_SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
}

function runTests() {
  console.log('\n=== Testing skill evolution ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = createTempDir('skill-evolution-repo-');
  const homeDir = createTempDir('skill-evolution-home-');
  const skillsRoot = path.join(repoRoot, 'skills');
  const learnedRoot = path.join(homeDir, '.claude', 'skills', 'learned');
  const importedRoot = path.join(homeDir, '.claude', 'skills', 'imported');
  const runsFile = path.join(homeDir, '.claude', 'state', 'skill-runs.jsonl');
  const now = '2026-03-15T12:00:00.000Z';

  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.mkdirSync(learnedRoot, { recursive: true });
  fs.mkdirSync(importedRoot, { recursive: true });

  try {
    console.log('Provenance:');

    if (test('classifies curated, learned, and imported skill directories', () => {
      const curatedSkillDir = createSkill(skillsRoot, 'curated-alpha', '# Curated\n');
      const learnedSkillDir = createSkill(learnedRoot, 'learned-beta', '# Learned\n');
      const importedSkillDir = createSkill(importedRoot, 'imported-gamma', '# Imported\n');

      const roots = provenance.getSkillRoots({ repoRoot, homeDir });

      assert.strictEqual(roots.curated, skillsRoot);
      assert.strictEqual(roots.learned, learnedRoot);
      assert.strictEqual(roots.imported, importedRoot);
      assert.strictEqual(
        provenance.classifySkillPath(curatedSkillDir, { repoRoot, homeDir }),
        provenance.SKILL_TYPES.CURATED
      );
      assert.strictEqual(
        provenance.classifySkillPath(learnedSkillDir, { repoRoot, homeDir }),
        provenance.SKILL_TYPES.LEARNED
      );
      assert.strictEqual(
        provenance.classifySkillPath(importedSkillDir, { repoRoot, homeDir }),
        provenance.SKILL_TYPES.IMPORTED
      );
      assert.strictEqual(
        provenance.requiresProvenance(curatedSkillDir, { repoRoot, homeDir }),
        false
      );
      assert.strictEqual(
        provenance.requiresProvenance(learnedSkillDir, { repoRoot, homeDir }),
        true
      );
    })) passed++; else failed++;

    if (test('writes and validates provenance metadata for non-curated skills', () => {
      const importedSkillDir = createSkill(importedRoot, 'imported-delta', '# Imported\n');
      const provenanceRecord = {
        source: 'https://example.com/skills/imported-delta',
        created_at: '2026-03-15T10:00:00.000Z',
        confidence: 0.86,
        author: 'external-importer',
      };

      const writeResult = provenance.writeProvenance(importedSkillDir, provenanceRecord, {
        repoRoot,
        homeDir,
      });

      assert.strictEqual(writeResult.path, path.join(importedSkillDir, '.provenance.json'));
      assert.deepStrictEqual(readJson(writeResult.path), provenanceRecord);
      assert.deepStrictEqual(
        provenance.readProvenance(importedSkillDir, { repoRoot, homeDir }),
        provenanceRecord
      );
      assert.throws(
        () => provenance.writeProvenance(importedSkillDir, {
          source: 'bad',
          created_at: '2026-03-15T10:00:00.000Z',
          author: 'external-importer',
        }, { repoRoot, homeDir }),
        /confidence/
      );
      assert.throws(
        () => provenance.readProvenance(path.join(learnedRoot, 'missing-provenance'), {
          repoRoot,
          homeDir,
          required: true,
        }),
        /Missing provenance metadata/
      );
    })) passed++; else failed++;

    if (test('exports the consolidated module surface from index.js', () => {
      assert.strictEqual(skillEvolution.provenance, provenance);
      assert.strictEqual(skillEvolution.versioning, versioning);
      assert.strictEqual(skillEvolution.tracker, tracker);
      assert.strictEqual(skillEvolution.health, health);
      assert.strictEqual(typeof skillEvolution.collectSkillHealth, 'function');
      assert.strictEqual(typeof skillEvolution.recordSkillExecution, 'function');
    })) passed++; else failed++;

    console.log('\nVersioning:');

    if (test('creates version snapshots and evolution logs for a skill', () => {
      const skillDir = createSkill(skillsRoot, 'alpha', '# Alpha v1\n');

      const versionOne = versioning.createVersion(skillDir, {
        timestamp: '2026-03-15T11:00:00.000Z',
        reason: 'bootstrap',
        author: 'observer',
      });

      assert.strictEqual(versionOne.version, 1);
      assert.ok(fs.existsSync(path.join(skillDir, '.versions', 'v1.md')));
      assert.ok(fs.existsSync(path.join(skillDir, '.evolution', 'observations.jsonl')));
      assert.ok(fs.existsSync(path.join(skillDir, '.evolution', 'inspections.jsonl')));
      assert.ok(fs.existsSync(path.join(skillDir, '.evolution', 'amendments.jsonl')));
      assert.strictEqual(versioning.getCurrentVersion(skillDir), 1);

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Alpha v2\n');
      const versionTwo = versioning.createVersion(skillDir, {
        timestamp: '2026-03-16T11:00:00.000Z',
        reason: 'accepted-amendment',
        author: 'observer',
      });

      assert.strictEqual(versionTwo.version, 2);
      assert.deepStrictEqual(
        versioning.listVersions(skillDir).map(entry => entry.version),
        [1, 2]
      );

      const amendments = versioning.getEvolutionLog(skillDir, 'amendments');
      assert.strictEqual(amendments.length, 2);
      assert.strictEqual(amendments[0].event, 'snapshot');
      assert.strictEqual(amendments[1].version, 2);
    })) passed++; else failed++;

    if (test('rolls back to a previous snapshot without losing history', () => {
      const skillDir = path.join(skillsRoot, 'alpha');

      const rollback = versioning.rollbackTo(skillDir, 1, {
        timestamp: '2026-03-17T11:00:00.000Z',
        author: 'maintainer',
        reason: 'restore known-good version',
      });

      assert.strictEqual(rollback.version, 3);
      assert.strictEqual(
        fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'),
        '# Alpha v1\n'
      );
      assert.deepStrictEqual(
        versioning.listVersions(skillDir).map(entry => entry.version),
        [1, 2, 3]
      );
      assert.strictEqual(versioning.getCurrentVersion(skillDir), 3);

      const amendments = versioning.getEvolutionLog(skillDir, 'amendments');
      const rollbackEntry = amendments[amendments.length - 1];
      assert.strictEqual(rollbackEntry.event, 'rollback');
      assert.strictEqual(rollbackEntry.target_version, 1);
      assert.strictEqual(rollbackEntry.version, 3);
    })) passed++; else failed++;

    console.log('\nTracking:');

    if (test('records skill execution rows to JSONL fallback storage', () => {
      const result = tracker.recordSkillExecution({
        skill_id: 'alpha',
        skill_version: 'v3',
        task_description: 'Fix flaky tests',
        outcome: 'partial',
        failure_reason: 'One integration test still flakes',
        tokens_used: 812,
        duration_ms: 4400,
        user_feedback: 'corrected',
        recorded_at: '2026-03-15T11:30:00.000Z',
      }, {
        runsFilePath: runsFile,
      });

      assert.strictEqual(result.storage, 'jsonl');
      assert.strictEqual(result.path, runsFile);

      const records = tracker.readSkillExecutionRecords({ runsFilePath: runsFile });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].skill_id, 'alpha');
      assert.strictEqual(records[0].task_description, 'Fix flaky tests');
      assert.strictEqual(records[0].outcome, 'partial');
    })) passed++; else failed++;

    if (test('falls back to JSONL when a state-store adapter is unavailable', () => {
      const result = tracker.recordSkillExecution({
        skill_id: 'beta',
        skill_version: 'v1',
        task_description: 'Import external skill',
        outcome: 'success',
        failure_reason: null,
        tokens_used: 215,
        duration_ms: 900,
        user_feedback: 'accepted',
        recorded_at: '2026-03-15T11:35:00.000Z',
      }, {
        runsFilePath: runsFile,
        stateStore: {
          recordSkillExecution() {
            throw new Error('state store offline');
          },
        },
      });

      assert.strictEqual(result.storage, 'jsonl');
      assert.strictEqual(tracker.readSkillExecutionRecords({ runsFilePath: runsFile }).length, 2);
    })) passed++; else failed++;

    if (test('ignores malformed JSONL rows when reading execution records', () => {
      const malformedRunsFile = path.join(homeDir, '.claude', 'state', 'malformed-skill-runs.jsonl');
      fs.writeFileSync(
        malformedRunsFile,
        `${JSON.stringify({
          skill_id: 'alpha',
          skill_version: 'v3',
          task_description: 'Good row',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 1,
          duration_ms: 1,
          user_feedback: 'accepted',
          recorded_at: '2026-03-15T11:45:00.000Z',
        })}\n{bad-json}\n`,
        'utf8'
      );

      const records = tracker.readSkillExecutionRecords({ runsFilePath: malformedRunsFile });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].skill_id, 'alpha');
    })) passed++; else failed++;

    if (test('preserves zero-valued telemetry fields during normalization', () => {
      const record = tracker.normalizeExecutionRecord({
        skill_id: 'zero-telemetry',
        skill_version: 'v1',
        task_description: 'No-op hook',
        outcome: 'success',
        tokens_used: 0,
        duration_ms: 0,
        user_feedback: 'accepted',
        recorded_at: '2026-03-15T11:40:00.000Z',
      });

      assert.strictEqual(record.tokens_used, 0);
      assert.strictEqual(record.duration_ms, 0);
    })) passed++; else failed++;

    if (test('normalizes aliases, defaults, and nullable telemetry fields', () => {
      const aliasRecord = tracker.normalizeExecutionRecord({
        skillId: 'alias-skill',
        skillVersion: 'v2',
        taskAttempted: 'Alias task',
        outcome: 'failure',
        failureReason: 'Needs more examples',
        tokensUsed: null,
        userFeedback: 'rejected',
      }, {
        now: '2026-03-15T12:30:00.000Z',
      });

      assert.deepStrictEqual(aliasRecord, {
        skill_id: 'alias-skill',
        skill_version: 'v2',
        task_description: 'Alias task',
        outcome: 'failure',
        failure_reason: 'Needs more examples',
        tokens_used: null,
        duration_ms: null,
        user_feedback: 'rejected',
        recorded_at: '2026-03-15T12:30:00.000Z',
      });

      const legacyTaskRecord = tracker.normalizeExecutionRecord({
        skill_id: 'legacy-skill',
        skill_version: 'v1',
        task_attempted: 'Legacy attempted task',
        outcome: 'partial',
        durationMs: null,
        recorded_at: '2026-03-15T12:31:00.000Z',
      });

      assert.strictEqual(legacyTaskRecord.task_description, 'Legacy attempted task');
      assert.strictEqual(legacyTaskRecord.failure_reason, null);
      assert.strictEqual(legacyTaskRecord.tokens_used, null);
      assert.strictEqual(legacyTaskRecord.duration_ms, null);
      assert.strictEqual(legacyTaskRecord.user_feedback, null);
    })) passed++; else failed++;

    if (test('rejects invalid execution payloads and numeric telemetry', () => {
      const valid = {
        skill_id: 'alpha',
        skill_version: 'v1',
        task_description: 'Run task',
        outcome: 'success',
        user_feedback: 'accepted',
        recorded_at: '2026-03-15T12:32:00.000Z',
      };

      const cases = [
        [null, /payload must be an object/],
        [[], /payload must be an object/],
        [{ ...valid, skill_id: ' ' }, /skill_id is required/],
        [{ ...valid, skill_version: '' }, /skill_version is required/],
        [{ ...valid, task_description: '\t' }, /task_description is required/],
        [{ ...valid, outcome: 'skipped' }, /outcome must be one of/],
        [{ ...valid, user_feedback: 'ignored' }, /user_feedback must be/],
        [{ ...valid, recorded_at: 'not-a-date' }, /recorded_at must be/],
        [{ ...valid, tokens_used: 'lots' }, /tokens_used must be a number/],
        [{ ...valid, duration_ms: Number.POSITIVE_INFINITY }, /duration_ms must be a number/],
      ];

      for (const [payload, expectedError] of cases) {
        assert.throws(() => tracker.normalizeExecutionRecord(payload), expectedError);
      }
    })) passed++; else failed++;

    if (test('uses state-store adapters for recording and reading when available', () => {
      let capturedRecord = null;
      const stateStore = {
        recordSkillExecution(record) {
          capturedRecord = record;
          return { id: 'run-1' };
        },
        listSkillExecutionRecords() {
          return [{ skill_id: 'stored-skill', outcome: 'success' }];
        },
      };

      const result = tracker.recordSkillExecution({
        skill_id: 'stored-skill',
        skill_version: 'v4',
        task_description: 'Persist in formal store',
        outcome: 'success',
        recorded_at: '2026-03-15T12:33:00.000Z',
      }, {
        stateStore,
      });

      assert.strictEqual(result.storage, 'state-store');
      assert.deepStrictEqual(result.result, { id: 'run-1' });
      assert.strictEqual(capturedRecord.skill_id, 'stored-skill');
      assert.deepStrictEqual(
        tracker.readSkillExecutionRecords({ stateStore }),
        [{ skill_id: 'stored-skill', outcome: 'success' }]
      );
    })) passed++; else failed++;

    if (test('resolves default run paths and treats missing JSONL storage as empty', () => {
      const pathHome = createTempDir('skill-evolution-path-home-');
      try {
        const defaultPath = tracker.getRunsFilePath({ homeDir: pathHome });
        assert.strictEqual(
          defaultPath,
          path.join(pathHome, '.claude', 'state', 'skill-runs.jsonl')
        );
        assert.deepStrictEqual(
          tracker.readSkillExecutionRecords({ homeDir: pathHome }),
          []
        );

        const relativePath = path.join('.', 'relative-skill-runs.jsonl');
        assert.strictEqual(tracker.getRunsFilePath({ runsFilePath: relativePath }), path.resolve(relativePath));
      } finally {
        cleanupTempDir(pathHome);
      }
    })) passed++; else failed++;

    console.log('\nHealth:');

    if (test('computes per-skill health metrics and flags declining skills', () => {
      const betaSkillDir = createSkill(learnedRoot, 'beta', '# Beta v1\n');
      provenance.writeProvenance(betaSkillDir, {
        source: 'observer://session/123',
        created_at: '2026-03-14T10:00:00.000Z',
        confidence: 0.72,
        author: 'observer',
      }, {
        repoRoot,
        homeDir,
      });
      versioning.createVersion(betaSkillDir, {
        timestamp: '2026-03-14T11:00:00.000Z',
        author: 'observer',
        reason: 'bootstrap',
      });

      appendJsonl(path.join(skillsRoot, 'alpha', '.evolution', 'amendments.jsonl'), [
        {
          event: 'proposal',
          status: 'pending',
          created_at: '2026-03-15T07:00:00.000Z',
        },
      ]);

      appendJsonl(runsFile, [
        {
          skill_id: 'alpha',
          skill_version: 'v3',
          task_description: 'Recent success',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 100,
          duration_ms: 1000,
          user_feedback: 'accepted',
          recorded_at: '2026-03-14T10:00:00.000Z',
        },
        {
          skill_id: 'alpha',
          skill_version: 'v3',
          task_description: 'Recent failure',
          outcome: 'failure',
          failure_reason: 'Regression',
          tokens_used: 100,
          duration_ms: 1000,
          user_feedback: 'rejected',
          recorded_at: '2026-03-13T10:00:00.000Z',
        },
        {
          skill_id: 'alpha',
          skill_version: 'v2',
          task_description: 'Prior success',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 100,
          duration_ms: 1000,
          user_feedback: 'accepted',
          recorded_at: '2026-03-06T10:00:00.000Z',
        },
        {
          skill_id: 'alpha',
          skill_version: 'v1',
          task_description: 'Older success',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 100,
          duration_ms: 1000,
          user_feedback: 'accepted',
          recorded_at: '2026-02-24T10:00:00.000Z',
        },
        {
          skill_id: 'beta',
          skill_version: 'v1',
          task_description: 'Recent success',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 90,
          duration_ms: 800,
          user_feedback: 'accepted',
          recorded_at: '2026-03-15T09:00:00.000Z',
        },
        {
          skill_id: 'beta',
          skill_version: 'v1',
          task_description: 'Older failure',
          outcome: 'failure',
          failure_reason: 'Bad import',
          tokens_used: 90,
          duration_ms: 800,
          user_feedback: 'corrected',
          recorded_at: '2026-02-20T09:00:00.000Z',
        },
      ]);

      const report = health.collectSkillHealth({
        repoRoot,
        homeDir,
        runsFilePath: runsFile,
        now,
        warnThreshold: 0.1,
      });

      const alpha = report.skills.find(skill => skill.skill_id === 'alpha');
      const beta = report.skills.find(skill => skill.skill_id === 'beta');

      assert.ok(alpha);
      assert.ok(beta);
      assert.strictEqual(alpha.current_version, 'v3');
      assert.strictEqual(alpha.pending_amendments, 1);
      assert.strictEqual(alpha.success_rate_7d, 0.5);
      assert.strictEqual(alpha.success_rate_30d, 0.75);
      assert.strictEqual(alpha.failure_trend, 'worsening');
      assert.strictEqual(alpha.declining, true);
      assert.strictEqual(beta.failure_trend, 'improving');

      const summary = health.summarizeHealthReport(report);
      assert.deepStrictEqual(summary, {
        total_skills: 6,
        healthy_skills: 5,
        declining_skills: 1,
      });

      const human = health.formatHealthReport(report, { json: false });
      assert.match(human, /alpha/);
      assert.match(human, /worsening/);
      assert.match(
        human,
        new RegExp(`Skills: ${summary.total_skills} total, ${summary.healthy_skills} healthy, ${summary.declining_skills} declining`)
      );
    })) passed++; else failed++;

    if (test('treats an unsnapshotted SKILL.md as v1 and orders last_run by actual time', () => {
      const gammaSkillDir = createSkill(skillsRoot, 'gamma', '# Gamma v1\n');
      const offsetRunsFile = path.join(homeDir, '.claude', 'state', 'offset-skill-runs.jsonl');

      appendJsonl(offsetRunsFile, [
        {
          skill_id: 'gamma',
          skill_version: 'v1',
          task_description: 'Offset timestamp run',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 10,
          duration_ms: 100,
          user_feedback: 'accepted',
          recorded_at: '2026-03-15T00:00:00+02:00',
        },
        {
          skill_id: 'gamma',
          skill_version: 'v1',
          task_description: 'UTC timestamp run',
          outcome: 'success',
          failure_reason: null,
          tokens_used: 11,
          duration_ms: 110,
          user_feedback: 'accepted',
          recorded_at: '2026-03-14T23:30:00Z',
        },
      ]);

      const report = health.collectSkillHealth({
        repoRoot,
        homeDir,
        runsFilePath: offsetRunsFile,
        now,
        warnThreshold: 0.1,
      });

      const gamma = report.skills.find(skill => skill.skill_id === path.basename(gammaSkillDir));
      assert.ok(gamma);
      assert.strictEqual(gamma.current_version, 'v1');
      assert.strictEqual(gamma.last_run, '2026-03-14T23:30:00Z');
    })) passed++; else failed++;

    if (test('CLI emits JSON health output for standalone integration', () => {
      const result = runCli([
        '--json',
        '--skills-root', skillsRoot,
        '--learned-root', learnedRoot,
        '--imported-root', importedRoot,
        '--home', homeDir,
        '--runs-file', runsFile,
        '--now', now,
        '--warn-threshold', '0.1',
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim());
      assert.ok(Array.isArray(payload.skills));
      assert.strictEqual(payload.skills[0].skill_id, 'alpha');
      assert.strictEqual(payload.skills[0].declining, true);
    })) passed++; else failed++;

    if (test('CLI shows help and rejects missing option values', () => {
      const helpResult = runCli(['--help']);
      assert.strictEqual(helpResult.status, 0);
      assert.match(helpResult.stdout, /--learned-root <path>/);
      assert.match(helpResult.stdout, /--imported-root <path>/);

      const errorResult = runCli(['--skills-root']);
      assert.strictEqual(errorResult.status, 1);
      assert.match(errorResult.stderr, /Missing value for --skills-root/);
    })) passed++; else failed++;

    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    cleanupTempDir(repoRoot);
    cleanupTempDir(homeDir);
  }
}

runTests();
