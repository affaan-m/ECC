'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const commands = [
  'commands/santa-loop.md',
  'docs/ja-JP/commands/santa-loop.md',
  'docs/zh-CN/commands/santa-loop.md',
];

if (process.platform === 'win32') {
  console.log('Skipped: Santa Loop examples require Bash');
  console.log('Passed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed++;
  }
}

function runCodexExample(commandPath, configuredModel) {
  const source = fs.readFileSync(path.join(repoRoot, commandPath), 'utf8');
  const invocation = source.match(/^\s*codex exec[^\n]+/m);
  assert.ok(invocation, 'Expected a Codex reviewer invocation');
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-santa-model-')));
  try {
    const promptFile = path.join(tempRoot, 'prompt.md');
    fs.writeFileSync(promptFile, 'Independent review only.');
    fs.writeFileSync(path.join(tempRoot, 'codex.js'), `const fs = require('fs');
const args = process.argv.slice(2);
const modelFlag = args.findIndex(arg => arg === '-m' || arg === '--model');
const model = modelFlag < 0 ? process.env.ECC_TEST_CONFIGURED_MODEL : args[modelFlag + 1];
if (model !== process.env.ECC_TEST_CONFIGURED_MODEL) {
  console.error('400: model is not supported by this account');
  process.exit(1);
}
console.log(JSON.stringify({ args, model, prompt: fs.readFileSync(0, 'utf8') }));
`);
    fs.writeFileSync(path.join(tempRoot, 'codex'), '#!/bin/sh\nexec "$ECC_TEST_NODE" "$0.js" "$@"\n', { mode: 0o755 });
    // Ignore exported functions and startup scripts so CLI dispatch stays inside the fixture.
    const result = spawnSync('bash', ['-p', '-c', invocation[0]], {
      cwd: tempRoot,
      env: { ...process.env, PATH: `${tempRoot}${path.delimiter}${process.env.PATH}`,
        PROMPT_FILE: promptFile, ECC_TEST_CONFIGURED_MODEL: configuredModel, ECC_TEST_NODE: process.execPath },
      encoding: 'utf8', timeout: 10000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    return { ...JSON.parse(result.stdout), cwd: tempRoot };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('\n=== Testing Santa Loop Codex model selection (stub CLI) ===\n');

for (const commandPath of commands) {
  test(`${commandPath} has no obsolete fixed-model promise`, () => {
    const source = fs.readFileSync(path.join(repoRoot, commandPath), 'utf8');
    assert.ok(!/gpt-5\.4/i.test(source), 'Codex model selection must agree throughout the command');
  });
  for (const model of ['account-default', 'configured-review-model']) {
    test(`${commandPath} respects ${model} and preserves review inputs`, () => {
      const result = runCodexExample(commandPath, model);
      assert.strictEqual(result.model, model);
      assert.strictEqual(result.args[0], 'exec');
      assert.strictEqual(result.args[result.args.indexOf('--sandbox') + 1], 'read-only');
      assert.strictEqual(result.args[result.args.indexOf('-C') + 1], result.cwd);
      assert.strictEqual(result.args.at(-1), '-');
      assert.strictEqual(result.prompt, 'Independent review only.');
    });
  }
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
