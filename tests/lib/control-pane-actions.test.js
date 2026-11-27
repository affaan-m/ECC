/**
 * Tests for allowlisted ECC2 control-pane actions.
 */

const assert = require('assert');
const path = require('path');

const {
  buildControlPaneActions,
  buildControlPaneAction,
  shellQuote,
} = require('../../scripts/lib/control-pane/actions');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing control-pane actions ===\n');

  let passed = 0;
  let failed = 0;

  if (test('builds copyable and executable allowlisted ECC2 actions', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const actions = buildControlPaneActions({
      repoRoot,
      query: 'Hermes Desktop Zellij',
      limit: 25,
    });

    assert.ok(actions.some(action => action.id === 'sync-knowledge'));
    assert.ok(actions.some(action => action.id === 'recall-knowledge'));
    assert.ok(actions.some(action => action.id === 'open-dashboard'));

    const sync = actions.find(action => action.id === 'sync-knowledge');
    assert.strictEqual(sync.executable, true);
    assert.strictEqual(sync.command, 'cargo');
    assert.deepStrictEqual(sync.args, [
      'run',
      '--quiet',
      '--',
      'graph',
      'connector-sync',
      '--all',
      '--json',
      '--limit',
      '25',
    ]);
    assert.strictEqual(sync.cwd, path.join(repoRoot, 'ecc2'));
    assert.ok(sync.commandLine.includes('connector-sync'));
  })) passed++; else failed++;

  if (test('preserves recall query as a single argument instead of shell text', () => {
    const action = buildControlPaneAction('recall-knowledge', {
      repoRoot: '/repo/ecc',
      query: 'Hermes "Desktop"; rm -rf ~',
      limit: 7,
    });

    assert.deepStrictEqual(action.args, [
      'run',
      '--quiet',
      '--',
      'graph',
      'recall',
      'Hermes "Desktop"; rm -rf ~',
      '--json',
      '--limit',
      '7',
    ]);
    assert.ok(action.commandLine.includes("'Hermes \"Desktop\"; rm -rf ~'"));
  })) passed++; else failed++;

  if (test('rejects unknown action identifiers', () => {
    assert.throws(
      () => buildControlPaneAction('rm -rf', { repoRoot: '/repo/ecc' }),
      /Unknown control-pane action/
    );
  })) passed++; else failed++;

  if (test('shellQuote handles empty strings and single quotes', () => {
    assert.strictEqual(shellQuote(''), "''");
    assert.strictEqual(shellQuote("can't"), "'can'\\''t'");
    assert.strictEqual(shellQuote('simple'), 'simple');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
