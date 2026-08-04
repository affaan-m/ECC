/**
 * Tests for scripts/hooks/ecc-context-monitor.js
 *
 * Run with: node tests/hooks/ecc-context-monitor.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, evaluateConditions, detectLoop, severityLabel, costWarningsEnabled } = require('../../scripts/hooks/ecc-context-monitor');
const { getBridgePath, writeBridgeAtomic } = require('../../scripts/lib/session-bridge');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function withEnv(name, value, fn) {
  const original = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

function runTests() {
  console.log('\n=== Testing ecc-context-monitor.js ===\n');

  let passed = 0;
  let failed = 0;

  // evaluateConditions — context warnings
  console.log('evaluateConditions (context):');

  if (
    test('remaining 20% triggers CRITICAL context warning', () => {
      const warnings = evaluateConditions({ context_remaining_pct: 20 });
      const ctx = warnings.find(w => w.type === 'context');
      assert.ok(ctx, 'Expected a context warning');
      assert.strictEqual(ctx.severity, 3);
      assert.ok(ctx.message.includes('CRITICAL'), 'Message should contain CRITICAL');
    })
  )
    passed++;
  else failed++;

  if (
    test('remaining 30% triggers WARNING context warning', () => {
      const warnings = evaluateConditions({ context_remaining_pct: 30 });
      const ctx = warnings.find(w => w.type === 'context');
      assert.ok(ctx, 'Expected a context warning');
      assert.strictEqual(ctx.severity, 2);
      assert.ok(ctx.message.includes('WARNING'), 'Message should contain WARNING');
    })
  )
    passed++;
  else failed++;

  if (
    test('remaining 50% triggers no context warning', () => {
      const warnings = evaluateConditions({ context_remaining_pct: 50 });
      const ctx = warnings.find(w => w.type === 'context');
      assert.strictEqual(ctx, undefined);
    })
  )
    passed++;
  else failed++;

  // evaluateConditions — cost warnings
  console.log('\nevaluateConditions (cost):');

  if (
    test('cost $55 triggers CRITICAL cost warning', () => {
      const warnings = evaluateConditions({ total_cost_usd: 55 });
      const cost = warnings.find(w => w.type === 'cost');
      assert.ok(cost, 'Expected a cost warning');
      assert.strictEqual(cost.severity, 3);
      assert.ok(cost.message.includes('CRITICAL'), 'Message should contain CRITICAL');
    })
  )
    passed++;
  else failed++;

  if (
    test('cost $12 triggers WARNING cost warning', () => {
      const warnings = evaluateConditions({ total_cost_usd: 12 });
      const cost = warnings.find(w => w.type === 'cost');
      assert.ok(cost, 'Expected a cost warning');
      assert.strictEqual(cost.severity, 2);
      assert.ok(cost.message.includes('WARNING'), 'Message should contain WARNING');
    })
  )
    passed++;
  else failed++;

  if (
    test('cost $6 triggers NOTICE cost warning', () => {
      const warnings = evaluateConditions({ total_cost_usd: 6 });
      const cost = warnings.find(w => w.type === 'cost');
      assert.ok(cost, 'Expected a cost warning');
      assert.strictEqual(cost.severity, 1);
      assert.ok(cost.message.includes('NOTICE'), 'Message should contain NOTICE');
    })
  )
    passed++;
  else failed++;

  if (
    test('cost $2 triggers no cost warning', () => {
      const warnings = evaluateConditions({ total_cost_usd: 2 });
      const cost = warnings.find(w => w.type === 'cost');
      assert.strictEqual(cost, undefined);
    })
  )
    passed++;
  else failed++;

  if (
    test('cost warnings can be suppressed without hiding context warnings', () => {
      const warnings = evaluateConditions({ total_cost_usd: 55, context_remaining_pct: 20 }, { costWarnings: false });
      assert.strictEqual(warnings.find(w => w.type === 'cost'), undefined);
      const ctx = warnings.find(w => w.type === 'context');
      assert.ok(ctx, 'Expected context warning to remain enabled');
      assert.strictEqual(ctx.severity, 3);
    })
  )
    passed++;
  else failed++;

  if (
    test('ECC_CONTEXT_MONITOR_COST_WARNINGS=off disables only run-time cost warnings', () => {
      const sessionId = `ctx-monitor-cost-off-${process.pid}-${Date.now()}`;
      const input = JSON.stringify({ session_id: sessionId, tool_name: 'Bash' });
      const warnPath = path.join(os.tmpdir(), `ecc-ctx-warn-${sessionId}.json`);
      try {
        writeBridgeAtomic(sessionId, {
          context_remaining_pct: 20,
          total_cost_usd: 55,
          last_timestamp: new Date().toISOString()
        });
        const result = withEnv('ECC_CONTEXT_MONITOR_COST_WARNINGS', 'off', () => JSON.parse(run(input)));
        const message = result.hookSpecificOutput.additionalContext;
        assert.ok(message.includes('CONTEXT CRITICAL'), 'Expected context warning to remain');
        assert.ok(!message.includes('COST CRITICAL'), 'Expected cost warning to be suppressed');
      } finally {
        fs.rmSync(getBridgePath(sessionId), { force: true });
        fs.rmSync(warnPath, { force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('cost warning env defaults on and accepts false-like values', () => {
      assert.strictEqual(withEnv('ECC_CONTEXT_MONITOR_COST_WARNINGS', undefined, () => costWarningsEnabled()), true);
      assert.strictEqual(withEnv('ECC_CONTEXT_MONITOR_COST_WARNINGS', 'false', () => costWarningsEnabled()), false);
      assert.strictEqual(withEnv('ECC_CONTEXT_MONITOR_COST_WARNINGS', '0', () => costWarningsEnabled()), false);
      assert.strictEqual(withEnv('ECC_CONTEXT_MONITOR_COST_WARNINGS', 'yes', () => costWarningsEnabled()), true);
    })
  )
    passed++;
  else failed++;

  // evaluateConditions — scope warnings
  console.log('\nevaluateConditions (scope):');

  if (
    test('25 files triggers scope WARNING', () => {
      const warnings = evaluateConditions({ files_modified_count: 25 });
      const scope = warnings.find(w => w.type === 'scope');
      assert.ok(scope, 'Expected a scope warning');
      assert.strictEqual(scope.severity, 2);
      assert.ok(scope.message.includes('SCOPE'), 'Message should contain SCOPE');
    })
  )
    passed++;
  else failed++;

  if (
    test('10 files triggers no scope warning', () => {
      const warnings = evaluateConditions({ files_modified_count: 10 });
      const scope = warnings.find(w => w.type === 'scope');
      assert.strictEqual(scope, undefined);
    })
  )
    passed++;
  else failed++;

  // detectLoop tests
  console.log('\ndetectLoop:');

  if (
    test('3 identical entries returns detected true', () => {
      const entries = [
        { tool: 'Bash', hash: 'aabbccdd' },
        { tool: 'Bash', hash: 'aabbccdd' },
        { tool: 'Bash', hash: 'aabbccdd' }
      ];
      const result = detectLoop(entries);
      assert.strictEqual(result.detected, true);
      assert.strictEqual(result.tool, 'Bash');
      assert.ok(result.count >= 3);
    })
  )
    passed++;
  else failed++;

  if (
    test('all different entries returns detected false', () => {
      const entries = [
        { tool: 'Bash', hash: '11111111' },
        { tool: 'Edit', hash: '22222222' },
        { tool: 'Write', hash: '33333333' }
      ];
      const result = detectLoop(entries);
      assert.strictEqual(result.detected, false);
    })
  )
    passed++;
  else failed++;

  if (
    test('empty array returns detected false', () => {
      const result = detectLoop([]);
      assert.strictEqual(result.detected, false);
    })
  )
    passed++;
  else failed++;

  // severityLabel tests
  console.log('\nseverityLabel:');

  if (
    test('severity 3 returns critical', () => {
      assert.strictEqual(severityLabel(3), 'critical');
    })
  )
    passed++;
  else failed++;

  if (
    test('severity 2 returns warning', () => {
      assert.strictEqual(severityLabel(2), 'warning');
    })
  )
    passed++;
  else failed++;

  if (
    test('severity 1 returns notice', () => {
      assert.strictEqual(severityLabel(1), 'notice');
    })
  )
    passed++;
  else failed++;

  // run tests
  console.log('\nrun:');

  if (
    test('empty input returns input unchanged', () => {
      const result = run('');
      assert.strictEqual(result, '');
    })
  )
    passed++;
  else failed++;

  if (
    test('input without session_id returns input unchanged', () => {
      const input = JSON.stringify({ tool_name: 'Bash' });
      const result = run(input);
      assert.strictEqual(result, input);
    })
  )
    passed++;
  else failed++;

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
