/**
 * Tests for scripts/lib/codex-status-line.js
 *
 * Run with: node tests/lib/codex-status-line.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_WIDGETS,
  statusLineToml,
  hasStatusLine,
  ensureCodexStatusLineDefault,
  statusLineStatus,
} = require('../../scripts/lib/codex-status-line');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed += 1;
  }
}

function withCodexHome(fn) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-status-'));
  try {
    fn(codexHome, path.join(codexHome, 'config.toml'));
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
}

console.log('\n=== Testing codex-status-line.js ===\n');

test('statusLineToml renders the default widget list', () => {
  const line = statusLineToml();
  assert.ok(line.startsWith('status_line = ['), `got: ${line}`);
  for (const widget of DEFAULT_WIDGETS) {
    assert.ok(line.includes(`"${widget}"`), `expected widget ${widget}`);
  }
});

test('creates config.toml with a [tui] table when none exists', () => {
  withCodexHome((codexHome, configPath) => {
    const result = ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(result.action, 'configured');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(/\[tui\]\nstatus_line = \[/.test(content), `got: ${content}`);
  });
});

test('appends a [tui] table after existing content', () => {
  withCodexHome((codexHome, configPath) => {
    fs.writeFileSync(configPath, 'model = "gpt-5.6"\n\n[projects."/home/user"]\ntrust_level = "trusted"\n');
    const result = ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(result.action, 'configured');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(content.includes('trust_level = "trusted"'), 'existing content preserved');
    assert.ok(/\[tui\]\nstatus_line = \[/.test(content), 'tui table appended');
  });
});

test('inserts into an existing [tui] table without status_line', () => {
  withCodexHome((codexHome, configPath) => {
    fs.writeFileSync(configPath, '[tui]\ntheme = "dark"\n\n[projects."/x"]\ntrust_level = "trusted"\n');
    const result = ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(result.action, 'configured');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.strictEqual(content.match(/\[tui\]/g).length, 1, 'single tui table');
    assert.ok(/\[tui\]\nstatus_line = \[/.test(content), 'inserted after header');
    assert.ok(content.includes('theme = "dark"'), 'existing tui keys preserved');
  });
});

test('an existing tui.status_line is never overwritten', () => {
  withCodexHome((codexHome, configPath) => {
    fs.writeFileSync(configPath, '[tui]\nstatus_line = ["model"]\n');
    const result = ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(result.action, 'kept-existing');
    assert.strictEqual(fs.readFileSync(configPath, 'utf8'), '[tui]\nstatus_line = ["model"]\n');
  });
});

test('a stray top-level status_line does not count as configured', () => {
  withCodexHome((codexHome, configPath) => {
    fs.writeFileSync(configPath, 'status_line = ["model"]\n\n[projects."/x"]\ntrust_level = "trusted"\n');
    assert.strictEqual(hasStatusLine(fs.readFileSync(configPath, 'utf8')), false);
    const result = ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(result.action, 'configured');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(/\[tui\]\nstatus_line = \[/.test(content), 'working tui entry added');
    assert.ok(content.startsWith('status_line = ["model"]'), 'stray key left untouched');
  });
});

test('statusLineStatus reflects each state', () => {
  withCodexHome(codexHome => {
    assert.strictEqual(statusLineStatus({ codexHome }).installed, false);
    ensureCodexStatusLineDefault({ codexHome });
    assert.strictEqual(statusLineStatus({ codexHome }).installed, true);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
