/**
 * Tests for scripts/session-inspect.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getFallbackSessionRecordingPath } = require('../../scripts/lib/session-adapters/canonical-session');

const { parseArgs } = require('../../scripts/session-inspect');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'session-inspect.js');

function run(args = [], options = {}) {
  const envOverrides = {
    ...(options.env || {})
  };

  if (typeof envOverrides.HOME === 'string' && !('USERPROFILE' in envOverrides)) {
    envOverrides.USERPROFILE = envOverrides.HOME;
  }

  if (typeof envOverrides.USERPROFILE === 'string' && !('HOME' in envOverrides)) {
    envOverrides.HOME = envOverrides.USERPROFILE;
  }

  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...envOverrides
      }
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

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

function runTests() {
  console.log('\n=== Testing session-inspect.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('option values are not mistaken for positional targets', () => {
    const cases = [
      ['--adapter', 'claude-history'],
      ['--target-type', 'claude-history'],
      ['--skill', 'api-design'],
      ['--amendment-id', 'amend-1'],
      ['--observations', 'observations.jsonl'],
      ['--write', 'snapshot.json']
    ];
    for (const option of cases) {
      assert.strictEqual(parseArgs(['node', SCRIPT, ...option, 'skills:health']).target, 'skills:health');
      assert.strictEqual(parseArgs(['node', SCRIPT, 'skills:health', ...option]).target, 'skills:health');
      assert.strictEqual(parseArgs(['node', SCRIPT, ...option]).target, null);
    }
  })) passed++; else failed++;

  if (test('rejects missing option values, unknown flags and extra targets', () => {
    for (const flag of ['--adapter', '--target-type', '--skill', '--amendment-id', '--observations', '--write']) {
      assert.throws(() => parseArgs(['node', SCRIPT, 'skills:health', flag]), /Missing value/);
      assert.throws(() => parseArgs(['node', SCRIPT, flag, '--list-adapters']), /Missing value/);
    }
    assert.throws(() => parseArgs(['node', SCRIPT, 'skills:health', '--unknown']), /Unknown argument/);
    assert.throws(() => parseArgs(['node', SCRIPT, 'skills:health', 'claude:latest']), /Only one target/);
  })) passed++; else failed++;

  if (test('skill-health CLI accepts options before its target', () => {
    const result = run(['--skill', 'api-design', 'skills:health']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).schemaVersion, 'ecc.skill-health.v1');
  })) passed++; else failed++;

  if (test('accepts leading-dash paths while rejecting following known options', () => {
    for (const flag of ['--write', '--observations']) {
      const parsed = parseArgs(['node', SCRIPT, flag, './--snapshot.json', 'skills:health']);
      assert.strictEqual(parsed[flag === '--write' ? 'writePath' : 'observationsPath'], './--snapshot.json');
      for (const nextFlag of ['--write', '--observations', '--skill', '--list-adapters']) {
        assert.throws(() => parseArgs(['node', SCRIPT, flag, nextFlag]), /Missing value/);
      }
    }
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-inspect-dash-path-'));
    try {
      fs.writeFileSync(path.join(fixture, '--observations.jsonl'), '');
      const result = run(['--observations', '--observations.jsonl', 'skills:health'], { cwd: fixture });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).totalObservations, 0);
      for (const flag of ['--write', '--observations']) {
        const invalid = run(['skills:health', flag, '--bogus'], { cwd: fixture });
        assert.strictEqual(invalid.code, 1);
        assert.match(invalid.stderr, /Missing value/);
        assert.strictEqual(fs.existsSync(path.join(fixture, '--bogus')), false);
      }
      const written = run(['skills:health', '--write', './--snapshot.json'], { cwd: fixture });
      assert.strictEqual(written.code, 0, written.stderr);
      assert.ok(fs.existsSync(path.join(fixture, '--snapshot.json')));
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('shows usage when no target is provided', () => {
    const result = run();
    assert.strictEqual(result.code, 1);
    assert.ok(result.stdout.includes('Usage:'));
  })) passed++; else failed++;

  if (test('lists registered adapters', () => {
    const result = run(['--list-adapters']);
    assert.strictEqual(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.adapters));
    assert.ok(payload.adapters.some(adapter => adapter.id === 'claude-history'));
    assert.ok(payload.adapters.some(adapter => adapter.id === 'dmux-tmux'));
  })) passed++; else failed++;

  if (test('prints canonical JSON for claude history targets', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-home-'));
    const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-recordings-'));
    const sessionsDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    try {
      fs.writeFileSync(
        path.join(sessionsDir, '2026-03-13-a1b2c3d4-session.tmp'),
        '# Inspect Session\n\n**Branch:** feat/session-inspect\n'
      );

      const result = run(['claude:latest'], {
        env: {
          HOME: homeDir,
          ECC_SESSION_RECORDING_DIR: recordingDir
        }
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      const recordingPath = getFallbackSessionRecordingPath(payload, { recordingDir });
      const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
      assert.strictEqual(payload.adapterId, 'claude-history');
      assert.strictEqual(payload.session.kind, 'history');
      assert.strictEqual(payload.workers[0].branch, 'feat/session-inspect');
      assert.strictEqual(persisted.latest.adapterId, 'claude-history');
      assert.strictEqual(persisted.history.length, 1);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(recordingDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('supports explicit target types for structured registry routing', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-home-'));
    const sessionsDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    try {
      fs.writeFileSync(
        path.join(sessionsDir, '2026-03-13-a1b2c3d4-session.tmp'),
        '# Inspect Session\n\n**Branch:** feat/typed-inspect\n'
      );

      const result = run(['latest', '--target-type', 'claude-history'], {
        env: { HOME: homeDir }
      });

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.adapterId, 'claude-history');
      assert.strictEqual(payload.session.sourceTarget.type, 'claude-history');
      assert.strictEqual(payload.workers[0].branch, 'feat/typed-inspect');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('writes snapshot JSON to disk when --write is provided', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-home-'));
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-out-'));
    const sessionsDir = path.join(homeDir, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const outputPath = path.join(outputDir, 'snapshot.json');

    try {
      fs.writeFileSync(
        path.join(sessionsDir, '2026-03-13-a1b2c3d4-session.tmp'),
        '# Inspect Session\n\n**Branch:** feat/session-inspect\n'
      );

      const result = run(['claude:latest', '--write', outputPath], {
        env: { HOME: homeDir }
      });

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(fs.existsSync(outputPath));
      const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      assert.strictEqual(written.adapterId, 'claude-history');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('inspects skill health from recorded observations', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-skills-'));
    const observationsDir = path.join(projectRoot, '.claude', 'ecc', 'skills');
    fs.mkdirSync(observationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(observationsDir, 'observations.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-1',
          timestamp: '2026-03-14T12:00:00.000Z',
          task: 'Review auth middleware',
          skill: { id: 'security-review', path: 'skills/security-review/SKILL.md' },
          outcome: { success: false, status: 'failure', error: 'missing csrf guidance', feedback: 'Need CSRF coverage' },
          run: { variant: 'baseline', amendmentId: null, sessionId: 'sess-1' }
        }),
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-2',
          timestamp: '2026-03-14T12:05:00.000Z',
          task: 'Review auth middleware',
          skill: { id: 'security-review', path: 'skills/security-review/SKILL.md' },
          outcome: { success: false, status: 'failure', error: 'missing csrf guidance', feedback: null },
          run: { variant: 'baseline', amendmentId: null, sessionId: 'sess-2' }
        })
      ].join('\n') + '\n'
    );

    try {
      const result = run(['skills:health'], { cwd: projectRoot });
      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.skill-health.v1');
      assert.ok(payload.skills.some(skill => skill.skill.id === 'security-review'));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('proposes skill amendments through session-inspect', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-amend-'));
    const observationsDir = path.join(projectRoot, '.claude', 'ecc', 'skills');
    fs.mkdirSync(observationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(observationsDir, 'observations.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-1',
          timestamp: '2026-03-14T12:00:00.000Z',
          task: 'Add rate limiting',
          skill: { id: 'api-design', path: 'skills/api-design/SKILL.md' },
          outcome: { success: false, status: 'failure', error: 'missing rate limiting guidance', feedback: 'Need rate limiting examples' },
          run: { variant: 'baseline', amendmentId: null, sessionId: 'sess-1' }
        })
      ].join('\n') + '\n'
    );

    try {
      const result = run(['skills:amendify', '--skill', 'api-design'], { cwd: projectRoot });
      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.skill-amendment-proposal.v1');
      assert.strictEqual(payload.skill.id, 'api-design');
      assert.ok(payload.patch.preview.includes('Failure-Driven Amendments'));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('builds skill evaluation scaffolding through session-inspect', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-inspect-eval-'));
    const observationsDir = path.join(projectRoot, '.claude', 'ecc', 'skills');
    fs.mkdirSync(observationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(observationsDir, 'observations.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-1',
          timestamp: '2026-03-14T12:00:00.000Z',
          task: 'Fix flaky login test',
          skill: { id: 'e2e-testing', path: 'skills/e2e-testing/SKILL.md' },
          outcome: { success: false, status: 'failure', error: null, feedback: null },
          run: { variant: 'baseline', amendmentId: null, sessionId: 'sess-1' }
        }),
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-2',
          timestamp: '2026-03-14T12:10:00.000Z',
          task: 'Fix flaky checkout test',
          skill: { id: 'e2e-testing', path: 'skills/e2e-testing/SKILL.md' },
          outcome: { success: true, status: 'success', error: null, feedback: null },
          run: { variant: 'baseline', amendmentId: null, sessionId: 'sess-2' }
        }),
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-3',
          timestamp: '2026-03-14T12:20:00.000Z',
          task: 'Fix flaky login test',
          skill: { id: 'e2e-testing', path: 'skills/e2e-testing/SKILL.md' },
          outcome: { success: true, status: 'success', error: null, feedback: null },
          run: { variant: 'amended', amendmentId: 'amend-1', sessionId: 'sess-3' }
        }),
        JSON.stringify({
          schemaVersion: 'ecc.skill-observation.v1',
          observationId: 'obs-4',
          timestamp: '2026-03-14T12:30:00.000Z',
          task: 'Fix flaky checkout test',
          skill: { id: 'e2e-testing', path: 'skills/e2e-testing/SKILL.md' },
          outcome: { success: true, status: 'success', error: null, feedback: null },
          run: { variant: 'amended', amendmentId: 'amend-1', sessionId: 'sess-4' }
        })
      ].join('\n') + '\n'
    );

    try {
      const result = run(['skills:evaluate', '--skill', 'e2e-testing', '--amendment-id', 'amend-1'], { cwd: projectRoot });
      assert.strictEqual(result.code, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.skill-evaluation.v1');
      assert.strictEqual(payload.recommendation, 'promote-amendment');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
