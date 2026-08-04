/**
 * Tests for skill health dashboard.
 *
 * Run with: node tests/lib/skill-dashboard.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dashboard = require('../../scripts/lib/skill-evolution/dashboard');
const versioning = require('../../scripts/lib/skill-evolution/versioning');
const _provenance = require('../../scripts/lib/skill-evolution/provenance');

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

function runCli(args) {
  return spawnSync(process.execPath, [HEALTH_SCRIPT, ...args], {
    encoding: 'utf8',
  });
}

function runTests() {
  console.log('\n=== Testing skill dashboard ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = createTempDir('skill-dashboard-repo-');
  const homeDir = createTempDir('skill-dashboard-home-');
  const skillsRoot = path.join(repoRoot, 'skills');
  const learnedRoot = path.join(homeDir, '.claude', 'skills', 'learned');
  const importedRoot = path.join(homeDir, '.claude', 'skills', 'imported');
  const runsFile = path.join(homeDir, '.claude', 'state', 'skill-runs.jsonl');
  const now = '2026-03-15T12:00:00.000Z';

  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.mkdirSync(learnedRoot, { recursive: true });
  fs.mkdirSync(importedRoot, { recursive: true });

  try {
    console.log('Chart primitives:');

    if (test('sparkline maps float values to Unicode block characters', () => {
      const result = dashboard.sparkline([1, 0.5, 0]);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0], '\u2588');
      assert.strictEqual(result[2], '\u2581');
    })) passed++; else failed++;

    if (test('sparkline returns empty string for empty array', () => {
      assert.strictEqual(dashboard.sparkline([]), '');
    })) passed++; else failed++;

    if (test('sparkline renders null values as empty block', () => {
      const result = dashboard.sparkline([null, 0.5, null]);
      assert.strictEqual(result[0], '\u2591');
      assert.strictEqual(result[2], '\u2591');
      assert.strictEqual(result.length, 3);
    })) passed++; else failed++;

    if (test('horizontalBar renders correct fill ratio', () => {
      const result = dashboard.horizontalBar(5, 10, 10);
      const filled = (result.match(/\u2588/g) || []).length;
      const empty = (result.match(/\u2591/g) || []).length;
      assert.strictEqual(filled, 5);
      assert.strictEqual(empty, 5);
      assert.strictEqual(result.length, 10);
    })) passed++; else failed++;

    if (test('horizontalBar handles zero value', () => {
      const result = dashboard.horizontalBar(0, 10, 10);
      const filled = (result.match(/\u2588/g) || []).length;
      assert.strictEqual(filled, 0);
      assert.strictEqual(result.length, 10);
    })) passed++; else failed++;

    if (test('panelBox renders box-drawing characters with title', () => {
      const result = dashboard.panelBox('Test Panel', ['line one', 'line two'], 30);
      assert.match(result, /\u250C/);
      assert.match(result, /\u2510/);
      assert.match(result, /\u2514/);
      assert.match(result, /\u2518/);
      assert.match(result, /Test Panel/);
      assert.match(result, /line one/);
      assert.match(result, /line two/);
    })) passed++; else failed++;

    console.log('\nTime-series bucketing:');

    if (test('bucketByDay groups records into daily bins', () => {
      const nowMs = Date.parse(now);
      const records = [
        { skill_id: 'alpha', outcome: 'success', recorded_at: '2026-03-15T10:00:00.000Z' },
        { skill_id: 'alpha', outcome: 'failure', recorded_at: '2026-03-15T08:00:00.000Z' },
        { skill_id: 'alpha', outcome: 'success', recorded_at: '2026-03-14T10:00:00.000Z' },
      ];

      const buckets = dashboard.bucketByDay(records, nowMs, 3);
      assert.strictEqual(buckets.length, 3);
      const todayBucket = buckets[buckets.length - 1];
      assert.strictEqual(todayBucket.runs, 2);
      assert.strictEqual(todayBucket.rate, 0.5);
    })) passed++; else failed++;

    if (test('bucketByDay returns null rate for empty days', () => {
      const nowMs = Date.parse(now);
      const buckets = dashboard.bucketByDay([], nowMs, 5);
      assert.strictEqual(buckets.length, 5);
      for (const bucket of buckets) {
        assert.strictEqual(bucket.rate, null);
        assert.strictEqual(bucket.runs, 0);
      }
    })) passed++; else failed++;

    console.log('\nPanel renderers:');

    const alphaSkillDir = createSkill(skillsRoot, 'alpha', '# Alpha\n');
    const betaSkillDir = createSkill(learnedRoot, 'beta', '# Beta\n');

    versioning.createVersion(alphaSkillDir, {
      timestamp: '2026-03-14T11:00:00.000Z',
      author: 'observer',
      reason: 'bootstrap',
    });

    fs.writeFileSync(path.join(alphaSkillDir, 'SKILL.md'), '# Alpha v2\n');
    versioning.createVersion(alphaSkillDir, {
      timestamp: '2026-03-15T11:00:00.000Z',
      author: 'observer',
      reason: 'accepted-amendment',
    });

    versioning.createVersion(betaSkillDir, {
      timestamp: '2026-03-14T11:00:00.000Z',
      author: 'observer',
      reason: 'bootstrap',
    });

    const { appendFile } = require('../../scripts/lib/utils');
    const alphaAmendmentsPath = path.join(alphaSkillDir, '.evolution', 'amendments.jsonl');
    appendFile(alphaAmendmentsPath, JSON.stringify({
      event: 'proposal',
      status: 'pending',
      created_at: '2026-03-15T07:00:00.000Z',
    }) + '\n');

    appendJsonl(runsFile, [
      {
        skill_id: 'alpha',
        skill_version: 'v2',
        task_description: 'Success task',
        outcome: 'success',
        failure_reason: null,
        tokens_used: 100,
        duration_ms: 1000,
        user_feedback: 'accepted',
        recorded_at: '2026-03-14T10:00:00.000Z',
      },
      {
        skill_id: 'alpha',
        skill_version: 'v2',
        task_description: 'Failed task',
        outcome: 'failure',
        failure_reason: 'Regression',
        tokens_used: 100,
        duration_ms: 1000,
        user_feedback: 'rejected',
        recorded_at: '2026-03-13T10:00:00.000Z',
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
        recorded_at: '2026-02-20T10:00:00.000Z',
      },
      {
        skill_id: 'beta',
        skill_version: 'v1',
        task_description: 'Beta success',
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
        task_description: 'Beta failure',
        outcome: 'failure',
        failure_reason: 'Bad import',
        tokens_used: 90,
        duration_ms: 800,
        user_feedback: 'corrected',
        recorded_at: '2026-02-20T09:00:00.000Z',
      },
    ]);

    const testRecords = [
      { skill_id: 'alpha', outcome: 'success', failure_reason: null, recorded_at: '2026-03-14T10:00:00.000Z' },
      { skill_id: 'alpha', outcome: 'failure', failure_reason: 'Regression', recorded_at: '2026-03-13T10:00:00.000Z' },
      { skill_id: 'alpha', outcome: 'success', failure_reason: null, recorded_at: '2026-02-20T10:00:00.000Z' },
      { skill_id: 'beta', outcome: 'success', failure_reason: null, recorded_at: '2026-03-15T09:00:00.000Z' },
      { skill_id: 'beta', outcome: 'failure', failure_reason: 'Bad import', recorded_at: '2026-02-20T09:00:00.000Z' },
    ];

    if (test('renderSuccessRatePanel produces one row per skill with sparklines', () => {
      const skills = [{ skill_id: 'alpha' }, { skill_id: 'beta' }];
      const result = dashboard.renderSuccessRatePanel(testRecords, skills, { now });

      assert.ok(result.text.includes('Success Rate'));
      assert.ok(result.data.skills.length >= 2);

      const alpha = result.data.skills.find(s => s.skill_id === 'alpha');
      assert.ok(alpha);
      assert.ok(Array.isArray(alpha.daily_rates));
      assert.strictEqual(alpha.daily_rates.length, 30);
      assert.ok(typeof alpha.sparkline === 'string');
      assert.ok(alpha.sparkline.length > 0);
    })) passed++; else failed++;

    if (test('renderFailureClusterPanel groups failures by reason', () => {
      const failureRecords = [
        { skill_id: 'alpha', outcome: 'failure', failure_reason: 'Regression' },
        { skill_id: 'alpha', outcome: 'failure', failure_reason: 'Regression' },
        { skill_id: 'beta', outcome: 'failure', failure_reason: 'Bad import' },
        { skill_id: 'alpha', outcome: 'success', failure_reason: null },
      ];

      const result = dashboard.renderFailureClusterPanel(failureRecords);
      assert.ok(result.text.includes('Failure Patterns'));
      assert.strictEqual(result.data.clusters.length, 2);
      assert.strictEqual(result.data.clusters[0].pattern, 'regression');
      assert.strictEqual(result.data.clusters[0].count, 2);
      assert.strictEqual(result.data.total_failures, 3);
    })) passed++; else failed++;

    if (test('renderAmendmentPanel lists pending amendments', () => {
      const skillsById = new Map();
      skillsById.set('alpha', { skill_id: 'alpha', skill_dir: alphaSkillDir });

      const result = dashboard.renderAmendmentPanel(skillsById);
      assert.ok(result.text.includes('Pending Amendments'));
      assert.ok(result.data.total >= 1);
      assert.ok(result.data.amendments.some(a => a.skill_id === 'alpha'));
    })) passed++; else failed++;

    if (test('renderVersionTimelinePanel shows version history', () => {
      const skillsById = new Map();
      skillsById.set('alpha', { skill_id: 'alpha', skill_dir: alphaSkillDir });
      skillsById.set('beta', { skill_id: 'beta', skill_dir: betaSkillDir });

      const result = dashboard.renderVersionTimelinePanel(skillsById);
      assert.ok(result.text.includes('Version History'));
      assert.ok(result.data.skills.length >= 1);

      const alphaVersions = result.data.skills.find(s => s.skill_id === 'alpha');
      assert.ok(alphaVersions);
      assert.ok(alphaVersions.versions.length >= 2);
    })) passed++; else failed++;

    console.log('\nFull dashboard:');

    if (test('renderDashboard produces all four panels', () => {
      const result = dashboard.renderDashboard({
        skillsRoot,
        learnedRoot,
        importedRoot,
        homeDir,
        runsFilePath: runsFile,
        now,
        warnThreshold: 0.1,
      });

      assert.ok(result.text.includes('ECC Skill Health Dashboard'));
      assert.ok(result.text.includes('Success Rate'));
      assert.ok(result.text.includes('Failure Patterns'));
      assert.ok(result.text.includes('Pending Amendments'));
      assert.ok(result.text.includes('Version History'));
      assert.ok(result.data.generated_at === now);
      assert.ok(result.data.summary);
      assert.ok(result.data.panels['success-rate']);
      assert.ok(result.data.panels['failures']);
      assert.ok(result.data.panels['amendments']);
      assert.ok(result.data.panels['versions']);
    })) passed++; else failed++;

    if (test('renderDashboard supports single panel selection', () => {
      const result = dashboard.renderDashboard({
        skillsRoot,
        learnedRoot,
        importedRoot,
        homeDir,
        runsFilePath: runsFile,
        now,
        panel: 'failures',
      });

      assert.ok(result.text.includes('Failure Patterns'));
      assert.ok(!result.text.includes('Version History'));
      assert.ok(result.data.panels['failures']);
      assert.ok(!result.data.panels['versions']);
    })) passed++; else failed++;

    if (test('renderDashboard rejects unknown panel names', () => {
      assert.throws(() => {
        dashboard.renderDashboard({
          skillsRoot,
          learnedRoot,
          importedRoot,
          homeDir,
          runsFilePath: runsFile,
          now,
          panel: 'nonexistent',
        });
      }, /Unknown panel/);
    })) passed++; else failed++;

    console.log('\nCLI integration:');

    if (test('CLI --dashboard --json returns valid JSON with all panels', () => {
      const result = runCli([
        '--dashboard',
        '--json',
        '--skills-root', skillsRoot,
        '--learned-root', learnedRoot,
        '--imported-root', importedRoot,
        '--home', homeDir,
        '--runs-file', runsFile,
        '--now', now,
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim());
      assert.ok(payload.panels);
      assert.ok(payload.panels['success-rate']);
      assert.ok(payload.panels['failures']);
      assert.ok(payload.summary);
    })) passed++; else failed++;

    if (test('CLI --panel failures --json returns only the failures panel', () => {
      const result = runCli([
        '--dashboard',
        '--panel', 'failures',
        '--json',
        '--skills-root', skillsRoot,
        '--learned-root', learnedRoot,
        '--imported-root', importedRoot,
        '--home', homeDir,
        '--runs-file', runsFile,
        '--now', now,
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout.trim());
      assert.ok(payload.panels['failures']);
      assert.ok(!payload.panels['versions']);
    })) passed++; else failed++;

    if (test('CLI --help mentions --dashboard', () => {
      const result = runCli(['--help']);
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /--dashboard/);
      assert.match(result.stdout, /--panel/);
    })) passed++; else failed++;

    console.log('\nEdge cases:');

    if (test('dashboard renders gracefully with no execution records', () => {
      const emptyRunsFile = path.join(homeDir, '.claude', 'state', 'empty-runs.jsonl');
      fs.mkdirSync(path.dirname(emptyRunsFile), { recursive: true });
      fs.writeFileSync(emptyRunsFile, '', 'utf8');

      const emptySkillsRoot = path.join(repoRoot, 'empty-skills');
      fs.mkdirSync(emptySkillsRoot, { recursive: true });

      const result = dashboard.renderDashboard({
        skillsRoot: emptySkillsRoot,
        learnedRoot: path.join(homeDir, '.claude', 'skills', 'empty-learned'),
        importedRoot: path.join(homeDir, '.claude', 'skills', 'empty-imported'),
        homeDir,
        runsFilePath: emptyRunsFile,
        now,
      });

      assert.ok(result.text.includes('ECC Skill Health Dashboard'));
      assert.ok(result.text.includes('No failure patterns detected'));
      assert.strictEqual(result.data.summary.total_skills, 0);
    })) passed++; else failed++;

    if (test('failure cluster panel handles all successes', () => {
      const successRecords = [
        { skill_id: 'alpha', outcome: 'success', failure_reason: null },
        { skill_id: 'beta', outcome: 'success', failure_reason: null },
      ];

      const result = dashboard.renderFailureClusterPanel(successRecords);
      assert.strictEqual(result.data.clusters.length, 0);
      assert.strictEqual(result.data.total_failures, 0);
      assert.ok(result.text.includes('No failure patterns detected'));
    })) passed++; else failed++;

    if (test('chart helpers handle zero widths, truncation, and invalid buckets', () => {
      assert.strictEqual(dashboard.horizontalBar(10, 0, 4), '\u2591\u2591\u2591\u2591');
      assert.strictEqual(dashboard.horizontalBar(10, 10, 0), '');

      const boxed = dashboard.panelBox('LongTitleForTinyPanel', ['abcdefghijklmnopqrstuvwxyz'], 10);
      assert.ok(boxed.includes('abcdefgh'), 'long content should be truncated to inner width');

      const defaultBox = dashboard.panelBox('Default Width', ['ok']);
      assert.ok(defaultBox.split('\n')[0].length >= 60, 'omitted width should use default panel width');

      const buckets = dashboard.bucketByDay([
        { skill_id: 'alpha', outcome: 'success', recorded_at: 'not-a-date' },
        { skill_id: 'alpha', outcome: 'success', recorded_at: now },
      ], Date.parse(now), 1);
      assert.strictEqual(buckets[0].runs, 1, 'invalid dates should be ignored');
    })) passed++; else failed++;

    if (test('success rate panel handles no skills, missing records, and trend directions', () => {
      const empty = dashboard.renderSuccessRatePanel([], [], { now });
      assert.ok(empty.text.includes('No skill execution data available'));
      assert.deepStrictEqual(empty.data.skills, []);

      const orphan = dashboard.renderSuccessRatePanel([], [{ skill_id: 'orphan' }], { now });
      assert.strictEqual(orphan.data.skills.length, 1);
      assert.strictEqual(orphan.data.skills[0].current_7d, null);
      assert.ok(orphan.text.includes('n/a'));

      const declining = dashboard.renderSuccessRatePanel([
        { skill_id: 'gamma', outcome: 'failure', recorded_at: '2026-03-15T08:00:00.000Z' },
        { skill_id: 'gamma', outcome: 'success', recorded_at: '2026-02-28T08:00:00.000Z' },
        { skill_id: 'gamma', outcome: 'success', recorded_at: '2026-02-27T08:00:00.000Z' },
      ], [{ skill_id: 'gamma' }], { now });
      assert.strictEqual(declining.data.skills[0].trend, '\u2198');

      const flat = dashboard.renderSuccessRatePanel([
        { skill_id: 'delta', outcome: 'success', recorded_at: '2026-03-15T08:00:00.000Z' },
        { skill_id: 'delta', outcome: 'success', recorded_at: '2026-02-28T08:00:00.000Z' },
      ], [{ skill_id: 'delta' }], { now });
      assert.strictEqual(flat.data.skills[0].trend, '\u2192');
    })) passed++; else failed++;

    if (test('failure cluster panel labels unknown single-skill failures', () => {
      const result = dashboard.renderFailureClusterPanel([
        { skill_id: 'alpha', outcome: 'failure', failure_reason: '' },
      ]);

      assert.strictEqual(result.data.clusters.length, 1);
      assert.strictEqual(result.data.clusters[0].pattern, 'unknown');
      assert.strictEqual(result.data.clusters[0].percentage, 100);
      assert.ok(result.text.includes('(1 skill)'));
    })) passed++; else failed++;

    if (test('amendment panel handles missing dirs and pending proposal defaults', () => {
      const proposalSkillDir = createSkill(skillsRoot, 'proposal-defaults', '# Proposal Defaults\n');
      const proposalLog = path.join(proposalSkillDir, '.evolution', 'amendments.jsonl');
      appendFile(proposalLog, JSON.stringify({ event: 'proposal' }) + '\n');
      appendFile(proposalLog, JSON.stringify({ event: 'proposal', status: 'applied' }) + '\n');

      const skillsById = new Map();
      skillsById.set('missing-dir', { skill_id: 'missing-dir' });
      skillsById.set('proposal-defaults', { skill_id: 'proposal-defaults', skill_dir: proposalSkillDir });

      const result = dashboard.renderAmendmentPanel(skillsById, { width: 80 });
      assert.strictEqual(result.data.total, 1);
      assert.strictEqual(result.data.amendments[0].event, 'proposal');
      assert.strictEqual(result.data.amendments[0].status, 'pending');
      assert.strictEqual(result.data.amendments[0].created_at, null);
      assert.ok(result.text.includes('1 amendment pending review'));
      assert.ok(result.text.includes(' -'));
    })) passed++; else failed++;

    if (test('version timeline skips missing dirs and empty histories', () => {
      const emptyVersionDir = createSkill(skillsRoot, 'empty-version-history', '# Empty Version History\n');
      const skillsById = new Map();
      skillsById.set('missing-dir', { skill_id: 'missing-dir' });
      skillsById.set('empty-version-history', { skill_id: 'empty-version-history', skill_dir: emptyVersionDir });

      const result = dashboard.renderVersionTimelinePanel(skillsById);
      assert.deepStrictEqual(result.data.skills, []);
      assert.ok(result.text.includes('No version history available'));
    })) passed++; else failed++;

    if (test('version timeline renders fallback date and reason values', () => {
      const originalListVersions = versioning.listVersions;
      const originalGetEvolutionLog = versioning.getEvolutionLog;
      versioning.listVersions = () => [
        { version: 9, created_at: null },
      ];
      versioning.getEvolutionLog = () => [
        { version: 9, reason: '' },
      ];

      try {
        const skillsById = new Map();
        skillsById.set('fallback-version', { skill_id: 'fallback-version', skill_dir: skillsRoot });
        const result = dashboard.renderVersionTimelinePanel(skillsById);

        assert.strictEqual(result.data.skills.length, 1);
        assert.strictEqual(result.data.skills[0].versions[0].reason, null);
        assert.ok(result.text.includes('v9'));
        assert.ok(result.text.includes(' - '));
      } finally {
        versioning.listVersions = originalListVersions;
        versioning.getEvolutionLog = originalGetEvolutionLog;
      }
    })) passed++; else failed++;

    if (test('renderDashboard rejects invalid timestamps', () => {
      assert.throws(() => {
        dashboard.renderDashboard({
          skillsRoot,
          learnedRoot,
          importedRoot,
          homeDir,
          runsFilePath: runsFile,
          now: 'not-a-timestamp',
        });
      }, /Invalid now timestamp/);
    })) passed++; else failed++;

    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  } finally {
    cleanupTempDir(repoRoot);
    cleanupTempDir(homeDir);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
