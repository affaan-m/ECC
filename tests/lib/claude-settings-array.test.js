'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const { materializeManagedHooks } = require('../../scripts/lib/install/claude-settings');

function config(command) {
  return {
    hooks: {
      Stop: [{ id: 'ecc:array', hooks: [{ type: 'command', command }] }],
    },
  };
}

function materialize(command, root = '/opt/ecc') {
  return materializeManagedHooks(config(command), root).Stop[0].hooks[0].command;
}

const tests = [
  ['materializes every array command without changing the source', () => {
    const source = config([
      'node -e "var e=process.env.CLAUDE_PLUGIN_ROOT;console.log(e)"',
      'node -e "var e=process.env.CLAUDE_PLUGIN_ROOT;console.log(e)"',
      '${CLAUDE_PLUGIN_ROOT}/scripts/start.js',
      '--unchanged',
    ]);
    const before = JSON.parse(JSON.stringify(source));
    const command = materializeManagedHooks(source, '/opt/ecc').Stop[0].hooks[0].command;
    assert.deepStrictEqual(source, before);
    assert.notStrictEqual(command, source.hooks.Stop[0].hooks[0].command);
    assert.ok(command.slice(0, 2).every(value => !value.includes('process.env.CLAUDE_PLUGIN_ROOT')));
    assert.deepStrictEqual(command.slice(2), ['/opt/ecc/scripts/start.js', '--unchanged']);
  }],
  ['array argv commands execute with the exact root in a clean process', () => {
    const root = '/tmp/ECC space/\'"$`\\路径';
    const command = materialize([
      process.execPath,
      '-e',
      'var e=process.env.CLAUDE_PLUGIN_ROOT;process.stdout.write(e);',
    ], root);
    const result = spawnSync(command[0], command.slice(1), {
      env: {},
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, root);
  }],
  ...[0, 1].map(index => [
    `rejects an unresolved root read in array element ${index}`,
    () => {
      const command = ['echo first', 'echo second'];
      command[index] = 'node -e "const root=process.env.CLAUDE_PLUGIN_ROOT"';
      assert.throws(() => materialize(command), /Unable to resolve CLAUDE_PLUGIN_ROOT/);
    },
  ]),
  ['rejects a remaining root read after resolving an array prologue', () => {
    assert.throws(() => materialize([
      'var e=process.env.CLAUDE_PLUGIN_ROOT;console.log(process.env.CLAUDE_PLUGIN_ROOT);',
    ]), /Unable to resolve CLAUDE_PLUGIN_ROOT/);
  }],
  ['retains supported root assignments in array commands', () => {
    const command = materialize([
      'var e=process.env.CLAUDE_PLUGIN_ROOT;process.env.CLAUDE_PLUGIN_ROOT=e;',
    ]);
    assert.ok(!command[0].includes('var e=process.env.CLAUDE_PLUGIN_ROOT;'));
    assert.ok(command[0].includes('process.env.CLAUDE_PLUGIN_ROOT=e;'));
  }],
  ['invalid arrays still fail command validation', () => {
    for (const command of [[], ['node', null], ['node', 3], ['node', ' ']]) {
      assert.throws(() => materialize(command), /invalid command/);
    }
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${error.stack || error.message}`);
  }
}
console.log(`\nResults: Passed: ${tests.length - failed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
