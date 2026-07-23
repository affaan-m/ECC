/**
 * Integration tests for scripts/hooks/plan-canvas-sessions.js (SessionStart)
 *
 * Run with: node tests/hooks/plan-canvas-sessions-hook.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'plan-canvas-sessions.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runHook(stateDir) {
  return spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: '{}',
    env: { ...process.env, ECC_PLAN_CANVAS_STATE_DIR: stateDir }
  });
}

function writeState(stateDir, sessions) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions }));
}

function runTests() {
  console.log('\n=== Testing plan-canvas-sessions hook ===\n');

  let passed = 0;
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-hook-'));

  if (test('exits 0 and prints nothing when no state exists', () => {
    const result = runHook(path.join(tmp, 'missing'));
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
  })) passed++; else failed++;

  if (test('exits 0 and prints nothing when all sessions are ended', () => {
    const dir = path.join(tmp, 'ended');
    writeState(dir, {
      abc123abc123: { key: 'abc123abc123', file: '/x/plan.md', status: 'ended', endedBy: 'user', pendingFeedback: [] }
    });
    const result = runHook(dir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
  })) passed++; else failed++;

  if (test('surfaces open sessions with resume guidance', () => {
    const dir = path.join(tmp, 'open');
    writeState(dir, {
      abc123abc123: {
        key: 'abc123abc123',
        file: '/projects/x/.claude/plans/feature.plan.md',
        status: 'feedback',
        pendingFeedback: [{ id: 'fb-1' }, { id: 'fb-2' }]
      }
    });
    const result = runHook(dir);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[PlanCanvas]'));
    assert.ok(result.stdout.includes('/projects/x/.claude/plans/feature.plan.md'));
    assert.ok(result.stdout.includes('2 undelivered feedback items'));
    assert.ok(result.stdout.includes('plan-canvas.js await'));
  })) passed++; else failed++;

  if (test('exits 0 on corrupt state (never blocks session start)', () => {
    const dir = path.join(tmp, 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions.json'), '{nope');
    const result = runHook(dir);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
  })) passed++; else failed++;

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + '='.repeat(40));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(40));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
