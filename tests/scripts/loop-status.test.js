/**
 * Tests for scripts/loop-status.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'loop-status.js');
const {
  analyzeTranscript,
  buildStatus,
  getStatusExitCode,
  parseArgs,
  writeStatusSnapshots,
} = require('../../scripts/loop-status');
const NOW = '2026-04-30T10:00:00.000Z';

function run(args = [], options = {}) {
  const envOverrides = {
    ...(options.env || {}),
  };

  if (typeof envOverrides.HOME === 'string' && !('USERPROFILE' in envOverrides)) {
    envOverrides.USERPROFILE = envOverrides.HOME;
  }

  if (typeof envOverrides.USERPROFILE === 'string' && !('HOME' in envOverrides)) {
    envOverrides.HOME = envOverrides.USERPROFILE;
  }

  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  return {
    code: result.status || (result.signal ? 1 : 0),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-home-'));
}

function writeTranscript(homeDir, projectSlug, fileName, entries) {
  const transcriptDir = path.join(homeDir, '.claude', 'projects', projectSlug);
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, fileName);
  fs.writeFileSync(
    transcriptPath,
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    'utf8'
  );
  return transcriptPath;
}

function toolUse(timestamp, sessionId, id, name, input = {}) {
  return {
    timestamp,
    sessionId,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id,
          name,
          input,
        },
      ],
    },
  };
}

function toolResult(timestamp, sessionId, toolUseId, content = 'ok') {
  return {
    timestamp,
    sessionId,
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
        },
      ],
    },
  };
}

function assistantMessage(timestamp, sessionId, text) {
  return {
    timestamp,
    sessionId,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text,
        },
      ],
    },
  };
}

function parsePayload(stdout) {
  return JSON.parse(stdout.trim());
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing loop-status.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('reports overdue ScheduleWakeup calls from Claude transcripts', () => {
    const homeDir = createTempHome();

    try {
      const transcriptPath = writeTranscript(homeDir, '-Users-affoon-project-a', 'session-a.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-a', 'toolu_wake', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Iter 15: continue autonomous loop',
        }),
      ]);

      const result = run(['--home', homeDir, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.loop-status.v1');
      assert.strictEqual(payload.sessions.length, 1);
      assert.strictEqual(payload.sessions[0].sessionId, 'session-a');
      assert.strictEqual(payload.sessions[0].transcriptPath, transcriptPath);
      assert.strictEqual(payload.sessions[0].state, 'attention');
      assert.ok(payload.sessions[0].signals.some(signal => signal.type === 'schedule_wakeup_overdue'));
      assert.strictEqual(payload.sessions[0].latestWake.dueAt, '2026-04-30T09:05:00.000Z');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('analyzeTranscript applies default thresholds when called directly', () => {
    const homeDir = createTempHome();

    try {
      const transcriptPath = writeTranscript(homeDir, '-Users-affoon-project-direct', 'session-direct.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-direct', 'toolu_direct_wake', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Direct API default threshold check',
        }),
      ]);

      const session = analyzeTranscript(transcriptPath, { now: NOW });

      assert.strictEqual(session.state, 'attention');
      assert.ok(session.signals.some(signal => signal.type === 'schedule_wakeup_overdue'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('reports stale Bash tool_use entries without matching tool_result', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-b', 'session-b.jsonl', [
        toolUse('2026-04-30T09:10:00.000Z', 'session-b', 'toolu_bash', 'Bash', {
          command: 'pytest tests/integration/test_pipeline.py',
        }),
      ]);

      const result = run(['--home', homeDir, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions[0].state, 'attention');
      assert.ok(payload.sessions[0].signals.some(signal => (
        signal.type === 'pending_bash_tool_result'
        && signal.toolUseId === 'toolu_bash'
        && signal.ageSeconds === 3000
      )));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not flag Bash tool_use entries that have a matching tool_result', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-c', 'session-c.jsonl', [
        toolUse('2026-04-30T09:40:00.000Z', 'session-c', 'toolu_bash_ok', 'Bash', {
          command: 'npm test',
        }),
        toolResult('2026-04-30T09:41:00.000Z', 'session-c', 'toolu_bash_ok', 'passed'),
      ]);

      const result = run(['--home', homeDir, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions[0].state, 'ok');
      assert.deepStrictEqual(payload.sessions[0].signals, []);
      assert.deepStrictEqual(payload.sessions[0].pendingTools, []);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not flag ScheduleWakeup when later assistant progress exists', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-d', 'session-d.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-d', 'toolu_wake_ok', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Loop checkpoint',
        }),
        assistantMessage('2026-04-30T09:06:00.000Z', 'session-d', 'Wake fired; continuing.'),
      ]);

      const result = run(['--home', homeDir, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions[0].state, 'ok');
      assert.ok(!payload.sessions[0].signals.some(signal => signal.type === 'schedule_wakeup_overdue'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('supports inspecting one transcript path directly', () => {
    const homeDir = createTempHome();

    try {
      const transcriptPath = writeTranscript(homeDir, '-Users-affoon-project-e', 'session-e.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-e', 'toolu_direct', 'Bash', {
          command: 'sleep 999',
        }),
      ]);

      const result = run(['--transcript', transcriptPath, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions.length, 1);
      assert.strictEqual(payload.sessions[0].transcriptPath, transcriptPath);
      assert.ok(payload.sessions[0].signals.some(signal => signal.type === 'pending_bash_tool_result'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('prints text output with state and recommended action', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-f', 'session-f.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-f', 'toolu_text', 'ScheduleWakeup', {
          delaySeconds: 600,
          reason: 'Loop checkpoint',
        }),
      ]);

      const result = run(['--home', homeDir, '--now', NOW]);

      assert.strictEqual(result.code, 0, result.stderr);
      assert.match(result.stdout, /session-f/);
      assert.match(result.stdout, /attention/);
      assert.match(result.stdout, /schedule_wakeup_overdue/);
      assert.match(result.stdout, /Open the transcript or interrupt the parked session/);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('continues when an explicit transcript path cannot be read', () => {
    const missingTranscript = path.join(os.tmpdir(), `missing-loop-status-${Date.now()}.jsonl`);

    const result = run(['--transcript', missingTranscript, '--now', NOW, '--json']);

    assert.strictEqual(result.code, 0, result.stderr);
    const payload = parsePayload(result.stdout);
    assert.deepStrictEqual(payload.sessions, []);
    assert.strictEqual(payload.errors.length, 1);
    assert.strictEqual(payload.errors[0].transcriptPath, missingTranscript);
  })) passed++; else failed++;

  if (test('text output distinguishes explicit transcript read failures from empty discovery', () => {
    const missingTranscript = path.join(os.tmpdir(), `missing-loop-status-text-${Date.now()}.jsonl`);

    const result = run(['--transcript', missingTranscript, '--now', NOW]);

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /No readable Claude transcript JSONL files were found/);
    assert.match(result.stdout, /Skipped transcript errors/);
    assert.ok(!result.stdout.includes('No Claude transcript JSONL files found under'));
  })) passed++; else failed++;

  if (test('continues when one transcript directory cannot be read', () => {
    const homeDir = createTempHome();
    const blockedDir = path.join(homeDir, '.claude', 'projects', '-blocked-project');
    const originalReaddirSync = fs.readdirSync;

    try {
      writeTranscript(homeDir, '-Users-affoon-project-readable', 'session-readable.jsonl', [
        toolResult('2026-04-30T09:41:00.000Z', 'session-readable', 'toolu_done', 'done'),
      ]);
      fs.mkdirSync(blockedDir, { recursive: true });
      fs.readdirSync = (dir, options) => {
        if (path.resolve(dir) === path.resolve(blockedDir)) {
          const error = new Error('permission denied');
          error.code = 'EACCES';
          throw error;
        }
        return originalReaddirSync(dir, options);
      };

      const payload = buildStatus({ home: homeDir, now: NOW });

      assert.strictEqual(payload.sessions.length, 1);
      assert.strictEqual(payload.sessions[0].sessionId, 'session-readable');
      assert.strictEqual(payload.errors.length, 1);
      assert.strictEqual(payload.errors[0].code, 'EACCES');
      assert.strictEqual(payload.errors[0].transcriptPath, blockedDir);
    } finally {
      fs.readdirSync = originalReaddirSync;
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('reports malformed JSONL lines as an attention signal', () => {
    const homeDir = createTempHome();

    try {
      const transcriptDir = path.join(homeDir, '.claude', 'projects', '-Users-affoon-project-malformed');
      fs.mkdirSync(transcriptDir, { recursive: true });
      fs.writeFileSync(
        path.join(transcriptDir, 'session-malformed.jsonl'),
        [
          JSON.stringify({
            timestamp: '2026-04-30T09:55:00.000Z',
            sessionId: 'session-malformed',
            message: { role: 'assistant', content: [{ type: 'text', text: 'partial log' }] },
          }),
          '{"timestamp":',
        ].join('\n') + '\n',
        'utf8'
      );

      const result = run(['--home', homeDir, '--now', NOW, '--json']);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions[0].state, 'attention');
      assert.ok(payload.sessions[0].signals.some(signal => (
        signal.type === 'transcript_parse_errors'
        && signal.count === 1
      )));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('rejects non-integer limit values', () => {
    const result = run(['--limit', '1.5']);

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /--limit must be a positive integer/);
  })) passed++; else failed++;

  if (test('parses watch mode controls', () => {
    const options = parseArgs([
      'node',
      'scripts/loop-status.js',
      '--exit-code',
      '--watch',
      '--watch-count',
      '2',
      '--watch-interval-seconds',
      '0.01',
    ]);

    assert.strictEqual(options.exitCode, true);
    assert.strictEqual(options.watch, true);
    assert.strictEqual(options.watchCount, 2);
    assert.strictEqual(options.watchIntervalSeconds, 0.01);
  })) passed++; else failed++;

  if (test('parses write-dir snapshot option', () => {
    const options = parseArgs([
      'node',
      'scripts/loop-status.js',
      '--write-dir',
      '/tmp/ecc-loop-snapshots',
    ]);

    assert.strictEqual(options.writeDir, '/tmp/ecc-loop-snapshots');
  })) passed++; else failed++;

  if (test('exit-code mode returns 2 when attention signals are present', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-exit-code', 'session-exit-code.jsonl', [
        toolUse('2026-04-30T09:10:00.000Z', 'session-exit-code', 'toolu_exit_bash', 'Bash', {
          command: 'pytest tests/integration/test_pipeline.py',
        }),
      ]);

      const result = run(['--home', homeDir, '--now', NOW, '--json', '--exit-code']);

      assert.strictEqual(result.code, 2, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions[0].state, 'attention');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('exit-code mode returns 1 for scan errors without attention signals', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-missing-'));
    const missingTranscript = path.join(tempDir, 'missing.jsonl');
    const result = run(['--transcript', missingTranscript, '--now', NOW, '--json', '--exit-code']);

    try {
      assert.strictEqual(result.code, 1, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.sessions.length, 0);
      assert.strictEqual(payload.errors.length, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('exit-code mode rejects unbounded watch mode', () => {
    const result = run(['--watch', '--exit-code']);

    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /--exit-code with --watch requires --watch-count/);
  })) passed++; else failed++;

  if (test('getStatusExitCode prioritizes attention signals over scan errors', () => {
    const payload = {
      errors: [{ message: 'unreadable' }],
      sessions: [{ state: 'attention' }],
    };

    assert.strictEqual(getStatusExitCode(payload), 2);
  })) passed++; else failed++;

  if (test('watch mode emits repeated JSON status frames', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-watch', 'session-watch.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-watch', 'toolu_watch', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Loop checkpoint',
        }),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--watch',
        '--watch-count',
        '2',
        '--watch-interval-seconds',
        '0.01',
      ]);

      assert.strictEqual(result.code, 0, result.stderr);
      const frames = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.strictEqual(frames.length, 2);
      assert.strictEqual(frames[0].schemaVersion, 'ecc.loop-status.v1');
      assert.strictEqual(frames[1].schemaVersion, 'ecc.loop-status.v1');
      assert.strictEqual(frames[0].sessions[0].sessionId, 'session-watch');
      assert.strictEqual(frames[1].sessions[0].sessionId, 'session-watch');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('watch mode honors exit-code after bounded refreshes', () => {
    const homeDir = createTempHome();

    try {
      writeTranscript(homeDir, '-Users-affoon-project-watch-exit', 'session-watch-exit.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-watch-exit', 'toolu_watch_exit', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Loop checkpoint',
        }),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--watch',
        '--watch-count',
        '1',
        '--watch-interval-seconds',
        '0.01',
        '--exit-code',
      ]);

      assert.strictEqual(result.code, 2, result.stderr);
      const frame = JSON.parse(result.stdout.trim());
      assert.strictEqual(frame.sessions[0].state, 'attention');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('writes per-session status snapshots and index when write-dir is set', () => {
    const homeDir = createTempHome();
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-snapshots-'));

    try {
      writeTranscript(homeDir, '-Users-affoon-project-snapshot', 'session-snapshot.jsonl', [
        toolUse('2026-04-30T09:00:00.000Z', 'session-snapshot', 'toolu_snapshot', 'ScheduleWakeup', {
          delaySeconds: 300,
          reason: 'Loop checkpoint',
        }),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--write-dir',
        snapshotDir,
      ]);

      assert.strictEqual(result.code, 0, result.stderr);
      const stdoutPayload = parsePayload(result.stdout);
      assert.strictEqual(stdoutPayload.schemaVersion, 'ecc.loop-status.v1');

      const indexPath = path.join(snapshotDir, 'index.json');
      const snapshotPath = path.join(snapshotDir, 'session-snapshot.json');
      assert.ok(fs.existsSync(indexPath), 'write-dir should include an index.json file');
      assert.ok(fs.existsSync(snapshotPath), 'write-dir should include a per-session snapshot');

      const indexPayload = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.strictEqual(indexPayload.schemaVersion, 'ecc.loop-status.index.v1');
      assert.strictEqual(indexPayload.sessions.length, 1);
      assert.strictEqual(indexPayload.sessions[0].sessionId, 'session-snapshot');
      assert.strictEqual(indexPayload.sessions[0].state, 'attention');
      assert.strictEqual(indexPayload.sessions[0].snapshotPath, snapshotPath);

      const snapshotPayload = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      assert.strictEqual(snapshotPayload.schemaVersion, 'ecc.loop-status.session.v1');
      assert.strictEqual(snapshotPayload.generatedAt, NOW);
      assert.strictEqual(snapshotPayload.session.sessionId, 'session-snapshot');
      assert.ok(snapshotPayload.session.signals.some(signal => signal.type === 'schedule_wakeup_overdue'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('keeps index.json reserved when session id sanitizes to index', () => {
    const homeDir = createTempHome();
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-index-collision-'));

    try {
      writeTranscript(homeDir, '-Users-affoon-project-index-collision', 'index.jsonl', [
        assistantMessage('2026-04-30T09:55:00.000Z', 'index', 'Loop checkpoint.'),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--write-dir',
        snapshotDir,
      ]);

      assert.strictEqual(result.code, 0, result.stderr);

      const indexPath = path.join(snapshotDir, 'index.json');
      const indexPayload = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.strictEqual(indexPayload.schemaVersion, 'ecc.loop-status.index.v1');
      assert.strictEqual(indexPayload.sessions.length, 1);
      assert.strictEqual(indexPayload.sessions[0].sessionId, 'index');
      assert.notStrictEqual(indexPayload.sessions[0].snapshotPath, indexPath);

      const snapshotPayload = JSON.parse(fs.readFileSync(indexPayload.sessions[0].snapshotPath, 'utf8'));
      assert.strictEqual(snapshotPayload.schemaVersion, 'ecc.loop-status.session.v1');
      assert.strictEqual(snapshotPayload.session.sessionId, 'index');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('avoids Windows reserved basenames for session snapshots', () => {
    const homeDir = createTempHome();
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-windows-name-'));

    try {
      writeTranscript(homeDir, '-Users-affoon-project-windows-name', 'con.jsonl', [
        assistantMessage('2026-04-30T09:55:00.000Z', 'con', 'Loop checkpoint.'),
      ]);
      writeTranscript(homeDir, '-Users-affoon-project-windows-name', 'con-txt.jsonl', [
        assistantMessage('2026-04-30T09:56:00.000Z', 'con.txt', 'Loop checkpoint.'),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--write-dir',
        snapshotDir,
      ]);

      assert.strictEqual(result.code, 0, result.stderr);

      const indexPath = path.join(snapshotDir, 'index.json');
      const indexPayload = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.strictEqual(indexPayload.sessions.length, 2);

      for (const sessionIndex of indexPayload.sessions) {
        const snapshotName = path.basename(sessionIndex.snapshotPath);
        assert.notStrictEqual(snapshotName.toLowerCase(), `${sessionIndex.sessionId}.json`);
        assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(snapshotName.split('.')[0]));

        const snapshotPayload = JSON.parse(fs.readFileSync(sessionIndex.snapshotPath, 'utf8'));
        assert.strictEqual(snapshotPayload.schemaVersion, 'ecc.loop-status.session.v1');
        assert.strictEqual(snapshotPayload.session.sessionId, sessionIndex.sessionId);
      }
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('cleans temporary snapshot files when atomic rename fails', () => {
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-loop-status-rename-failure-'));
    const originalRenameSync = fs.renameSync;

    try {
      fs.renameSync = () => {
        throw new Error('simulated rename failure');
      };

      assert.throws(() => writeStatusSnapshots({
        errors: [],
        generatedAt: NOW,
        sessions: [
          {
            eventCount: 1,
            lastEventAt: NOW,
            pendingTools: [],
            recommendedAction: 'No action needed.',
            sessionId: 'rename-failure',
            signals: [],
            state: 'ok',
            transcriptPath: path.join(snapshotDir, 'rename-failure.jsonl'),
          },
        ],
        source: {},
      }, snapshotDir), /simulated rename failure/);

      const tempFiles = fs.readdirSync(snapshotDir).filter(fileName => fileName.endsWith('.tmp'));
      assert.deepStrictEqual(tempFiles, []);
    } finally {
      fs.renameSync = originalRenameSync;
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('write-dir failures do not suppress normal stdout', () => {
    const homeDir = createTempHome();

    try {
      const blockedPath = path.join(homeDir, 'snapshot-target-is-a-file');
      fs.writeFileSync(blockedPath, 'not a directory\n', 'utf8');
      writeTranscript(homeDir, '-Users-affoon-project-write-error', 'session-write-error.jsonl', [
        assistantMessage('2026-04-30T09:55:00.000Z', 'session-write-error', 'Loop checkpoint.'),
      ]);

      const result = run([
        '--home',
        homeDir,
        '--now',
        NOW,
        '--json',
        '--write-dir',
        blockedPath,
      ]);

      assert.strictEqual(result.code, 0, result.stderr);
      const payload = parsePayload(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.loop-status.v1');
      assert.strictEqual(payload.sessions[0].sessionId, 'session-write-error');
      assert.match(result.stderr, /\[loop-status\] WARNING: could not write status snapshots:/);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
