/**
 * observe.sh must record PreToolUse as tool_start on manual installs.
 *
 * The manual settings.json block in continuous-learning-v2/SKILL.md calls
 * observe.sh with no phase argument. Claude Code sends the event as
 * hook_event_name in the stdin JSON and does not export
 * CLAUDE_HOOK_EVENT_NAME, so the phase has to come from the payload.
 *
 * Run with: node tests/hooks/observe-hook-phase.test.js
 */

'use strict';

if (process.platform === 'win32') {
  console.log('Skipping bash-dependent observe tests on Windows');
  process.exit(0);
}

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(repoRoot, 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-phase-'));
  try {
    fn(homeDir);
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    failed += 1;
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function runObserve(homeDir, { event, args = [], extraEnv = {} }) {
  const cwd = path.join(homeDir, 'work');
  fs.mkdirSync(cwd, { recursive: true });
  const payload = {
    session_id: 'session-phase-test',
    tool_name: 'Read',
    tool_input: { file_path: 'README.md' },
    tool_response: 'file body',
    cwd,
  };
  if (event) payload.hook_event_name = event;
  // Storage resolves CLV2_HOMUNCULUS_DIR, then XDG_DATA_HOME, then HOME, so pin
  // it here: an inherited path would send these records to the real store.
  const configPath = path.join(homeDir, 'clv2-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ observer: { enabled: false } }));
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    CLV2_HOMUNCULUS_DIR: path.join(homeDir, 'homunculus'),
    CLV2_CONFIG: configPath,
    CLAUDE_PROJECT_DIR: '',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    ECC_HOOK_PROFILE: 'standard',
    ECC_SKIP_OBSERVE: '0',
  };
  delete env.CLAUDE_HOOK_EVENT_NAME;
  delete env.ECC_DISABLED_HOOKS;
  const result = spawnSync('bash', [observeShPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...env, ...extraEnv },
  });
  assert.strictEqual(result.status, 0, result.stderr);
}

function findObservationFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findObservationFiles(full);
    return entry.name === 'observations.jsonl' ? [full] : [];
  });
}

function readObservations(homeDir) {
  const files = findObservationFiles(homeDir);
  assert.strictEqual(files.length, 1, `Expected one observations.jsonl, found ${files.length}`);
  return fs.readFileSync(files[0], 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

console.log('\n=== observe.sh hook phase ===\n');

test('manual install: native PreToolUse and PostToolUse payloads record tool_start then tool_complete', homeDir => {
  runObserve(homeDir, { event: 'PreToolUse' });
  runObserve(homeDir, { event: 'PostToolUse' });
  const [start, complete] = readObservations(homeDir);
  assert.strictEqual(start.event, 'tool_start');
  assert.strictEqual(start.input, '{"file_path": "README.md"}', 'the tool input is captured on tool_start');
  assert.strictEqual(start.output, undefined);
  assert.strictEqual(complete.event, 'tool_complete');
  assert.strictEqual(complete.output, 'file body');
});

test('the positional phase from the plugin wrapper wins over the payload event', homeDir => {
  runObserve(homeDir, { event: 'PreToolUse', args: ['post'] });
  assert.strictEqual(readObservations(homeDir)[0].event, 'tool_complete');
});

test('the payload event wins over a conflicting CLAUDE_HOOK_EVENT_NAME', homeDir => {
  runObserve(homeDir, { event: 'PreToolUse', extraEnv: { CLAUDE_HOOK_EVENT_NAME: 'PostToolUse' } });
  assert.strictEqual(readObservations(homeDir)[0].event, 'tool_start');
});

test('payloads without hook_event_name keep the CLAUDE_HOOK_EVENT_NAME fallback', homeDir => {
  runObserve(homeDir, { extraEnv: { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' } });
  assert.strictEqual(readObservations(homeDir)[0].event, 'tool_start');
});

test('with no argument, event field or env var the phase still defaults to post', homeDir => {
  runObserve(homeDir, {});
  assert.strictEqual(readObservations(homeDir)[0].event, 'tool_complete');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
