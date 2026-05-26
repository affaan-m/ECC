/**
 * Tests for scripts/lib/agent-data-home.js
 *
 * Run with: node tests/lib/agent-data-home.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    delete require.cache[require.resolve('../../scripts/lib/agent-data-home')];
  }
}

function runTests() {
  console.log('\n=== Testing agent-data-home.js ===\n');
  let passed = 0;
  let failed = 0;

  if (test('defaults to ~/.claude outside Cursor', () => {
    withEnv({
      ECC_AGENT_DATA_HOME: undefined,
      CURSOR_VERSION: undefined,
      CURSOR_PROJECT_DIR: undefined,
    }, () => {
      const agentDataHome = require('../../scripts/lib/agent-data-home');
      const home = os.homedir();
      assert.strictEqual(
        agentDataHome.resolveAgentDataHome(),
        path.join(home, '.claude')
      );
    });
  })) passed++; else failed++;

  if (test('defaults to ~/.cursor/ecc in Cursor hook runtime', () => {
    withEnv({
      ECC_AGENT_DATA_HOME: undefined,
      CURSOR_VERSION: '1.0.0',
      CURSOR_PROJECT_DIR: undefined,
    }, () => {
      const agentDataHome = require('../../scripts/lib/agent-data-home');
      const home = os.homedir();
      assert.strictEqual(
        agentDataHome.resolveAgentDataHome(),
        path.join(home, '.cursor', 'ecc')
      );
    });
  })) passed++; else failed++;

  if (test('honors ECC_AGENT_DATA_HOME over Cursor default', () => {
    const override = path.join(os.tmpdir(), `ecc-override-${Date.now()}`);
    withEnv({
      ECC_AGENT_DATA_HOME: override,
      CURSOR_VERSION: '1.0.0',
    }, () => {
      const agentDataHome = require('../../scripts/lib/agent-data-home');
      assert.strictEqual(agentDataHome.resolveAgentDataHome(), path.resolve(override));
    });
  })) passed++; else failed++;

  if (test('reads project ecc-agent-data.json config file', () => {
    const tmpDir = path.join(process.cwd(), '.tmp-agent-data-home-test');
    fs.mkdirSync(tmpDir, { recursive: true });
    const configPath = path.join(tmpDir, 'ecc-agent-data.json');
    const customHome = path.join(tmpDir, 'data-root');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agentDataHome: customHome }),
      'utf8'
    );

    try {
      withEnv({
        ECC_AGENT_DATA_HOME: undefined,
        CURSOR_VERSION: undefined,
      }, () => {
        const agentDataHome = require('../../scripts/lib/agent-data-home');
        assert.strictEqual(
          agentDataHome.readProjectConfigAt(configPath),
          path.resolve(customHome)
        );
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('readProjectConfigAt logs parse failures', () => {
    const tmpDir = path.join(process.cwd(), '.tmp-agent-data-home-log-test');
    fs.mkdirSync(tmpDir, { recursive: true });
    const configPath = path.join(tmpDir, 'ecc-agent-data.json');
    fs.writeFileSync(configPath, '{ invalid json', 'utf8');

    const originalError = console.error;
    const messages = [];
    console.error = (...args) => {
      messages.push(args.join(' '));
    };

    try {
      withEnv({
        ECC_AGENT_DATA_HOME: undefined,
        CURSOR_VERSION: undefined,
      }, () => {
        const agentDataHome = require('../../scripts/lib/agent-data-home');
        assert.strictEqual(agentDataHome.readProjectConfigAt(configPath), null);
        assert.ok(
          messages.some(message => message.includes(configPath)),
          'Expected config path in error log'
        );
      });
    } finally {
      console.error = originalError;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('ensureAgentDataHomeEnv sets process.env when unset', () => {
    withEnv({
      ECC_AGENT_DATA_HOME: undefined,
      CURSOR_VERSION: '1.0.0',
    }, () => {
      const agentDataHome = require('../../scripts/lib/agent-data-home');
      const resolved = agentDataHome.ensureAgentDataHomeEnv();
      assert.ok(process.env.ECC_AGENT_DATA_HOME);
      assert.strictEqual(process.env.ECC_AGENT_DATA_HOME, resolved);
    });
  })) passed++; else failed++;

  console.log(`\n=== Test Results ===\nPassed: ${passed}\nFailed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

runTests();
