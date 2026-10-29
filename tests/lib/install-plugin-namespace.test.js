/**
 * Tests for scripts/lib/install/plugin-namespace.js — manual Claude installs
 * place agents, commands and skills at bare names, so plugin-prefixed
 * `ecc:<name>` references in copied markdown must lose the prefix.
 */

'use strict';

const assert = require('assert');

const { stripPluginNamespace } = require('../../scripts/lib/install/plugin-namespace');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    console.error(error.stack || error);
    return false;
  }
}

function runTests() {
  console.log('Running install plugin-namespace tests...\n');
  let passed = 0;
  let failed = 0;
  const record = ok => (ok ? passed++ : failed++);

  record(test('strips the prefix from agent names in code spans, bold and tables', () => {
    const input = [
      '| ecc:planner | Planning |',
      '1. Use **ecc:code-reviewer** agent',
      'Use `ecc:tdd-guide` here',
    ].join('\n');
    assert.strictEqual(stripPluginNamespace(input), [
      '| planner | Planning |',
      '1. Use **code-reviewer** agent',
      'Use `tdd-guide` here',
    ].join('\n'));
  }));

  record(test('strips the prefix from agent frontmatter and tool-call arguments', () => {
    assert.strictEqual(
      stripPluginNamespace('agent: ecc:security-reviewer'),
      'agent: security-reviewer'
    );
    assert.strictEqual(
      stripPluginNamespace('Agent(subagent_type: "ecc:planner", prompt: "...")'),
      'Agent(subagent_type: "planner", prompt: "...")'
    );
  }));

  record(test('strips the prefix from slash commands', () => {
    assert.strictEqual(stripPluginNamespace('see `/ecc:ecc-guide`'), 'see `/ecc-guide`');
    assert.strictEqual(stripPluginNamespace('/ecc:plan "Add auth"'), '/plan "Add auth"');
  }));

  record(test('leaves the plugin identifier ecc@ecc untouched', () => {
    const input = '`/plugin install ecc@ecc` and `ecc@ecc`';
    assert.strictEqual(stripPluginNamespace(input), input);
  }));

  record(test('leaves words that only end in "ecc" untouched', () => {
    const input = 'the decc:thing and tecc:value';
    assert.strictEqual(stripPluginNamespace(input), input);
  }));

  record(test('does not touch a colon with no identifier after it', () => {
    const input = 'the `ecc:` prefix in plugin mode';
    assert.strictEqual(stripPluginNamespace(input), input);
  }));

  record(test('returns content with no prefix unchanged', () => {
    const input = '# Plain markdown\n\nNo namespace here.\n';
    assert.strictEqual(stripPluginNamespace(input), input);
  }));

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  return failed === 0;
}

const ok = runTests();
process.exit(ok ? 0 : 1);
