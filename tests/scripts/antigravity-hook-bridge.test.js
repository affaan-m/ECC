'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { spawnSync } = require('child_process');
const { adaptAntigravityInputToEcc } = require('../../scripts/hooks/antigravity-hook-bridge');

const bridgePath = path.resolve(__dirname, '../../scripts/hooks/antigravity-hook-bridge.js');
async function invoke({ hook = 'pre:edit-write:gateguard-fact-force', mode = 'pre-tool-use', raw = '{}', truncated = false, result = {}, child, readError = false, hookError = false } = {}) {
  let output = '';
  let spawnOptions;
  let hookCalls = 0;
  const module = { exports: {} };
  const run = () => { hookCalls += 1; if (hookError) throw new Error('hook failed'); return result; };
  const imports = {
    path,
    child_process: { spawnSync: (_file, _args, options) => { spawnOptions = options; return child; } },
    './bash-hook-dispatcher': { runPreBash: run },
    './gateguard-fact-force': { run },
    './doc-file-warning': { run },
    './post-edit-accumulator': { run },
    './stop-format-typecheck': { run },
    './hook-input': {
      resolveMaxStdin: () => 1024,
      readStdinRaw: async () => { if (readError) throw new Error('read failed'); return { raw, truncated }; },
    },
  };
  const requireStub = name => imports[name];
  requireStub.main = module;
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), {
    require: requireStub, module, __dirname: path.dirname(bridgePath),
    process: { argv: ['node', bridgePath, '--mode', mode, '--hook', hook], env: {}, execPath: process.execPath, stdin: {}, stdout: { write: text => { output += text; } } },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { response: JSON.parse(output), spawnOptions, hookCalls };
}

async function main() {
  for (const [native, expected] of [['run_command', 'Bash'], ['write_to_file', 'Write'], ['replace_file_content', 'Edit'], ['multi_replace_file_content', 'Edit']]) {
    const input = adaptAntigravityInputToEcc({ toolCall: { name: native, args: { CommandLine: 'echo ok', TargetFile: '/tmp/code.js' } } });
    assert.strictEqual(input.tool_name, expected);
    assert.strictEqual(input.tool_input.command, 'echo ok');
    assert.strictEqual(input.tool_input.file_path, '/tmp/code.js');
  }
  const session = adaptAntigravityInputToEcc({ conversationId: 'session-a', workspacePaths: ['/workspace/app'] });
  assert.strictEqual(session.session_id, 'session-a');
  assert.strictEqual(session.cwd, '/workspace/app');
  const denial = { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'Inspect first\nThen retry' } };
  assert.deepStrictEqual((await invoke({ result: { exitCode: 0, stdout: JSON.stringify(denial) } })).response, { decision: 'deny', reason: 'Inspect first Then retry' });
  assert.strictEqual((await invoke({ hook: 'pre:bash:dispatcher', result: { exitCode: 0, output: JSON.stringify(denial) } })).response.decision, 'deny');
  assert.match((await invoke({ hook: 'pre:write:doc-file-warning', result: { exitCode: 0, additionalContext: ['warning one', 'warning two'] } })).response.reason, /warning one.*warning two/);
  for (const failure of [{ raw: '{' }, { raw: '' }, { raw: 'null' }, { raw: '[]' }, { truncated: true }, { readError: true }, { hookError: true }]) {
    assert.strictEqual((await invoke(failure)).response.decision, 'deny', JSON.stringify(failure));
  }
  for (const child of [{ status: null, error: new Error('timed out') }, { status: 1, stderr: 'failed' }, { status: 2, stderr: 'blocked' }]) {
    const result = await invoke({ hook: 'pre:config-protection', child });
    assert.strictEqual(result.response.decision, 'deny');
    assert.ok(result.spawnOptions.timeout > 0 && result.spawnOptions.timeout <= 10000);
  }
  assert.strictEqual((await invoke({ hook: 'pre:config-protection', child: { status: 0, stderr: '' } })).response.decision, 'allow');
  assert.strictEqual((await invoke({ result: '{}' })).response.decision, 'allow');
  assert.strictEqual((await invoke({ mode: 'stop', raw: '{' })).response.decision, 'allow');
  assert.strictEqual((await invoke({ mode: 'post-tool-use', hook: 'post:edit:accumulator' })).hookCalls, 1);
  assert.strictEqual((await invoke({ mode: 'post-tool-use', hook: 'post:edit:accumulator', raw: JSON.stringify({ error: 'write failed' }) })).hookCalls, 0);
  assert.deepStrictEqual((await invoke({ mode: 'stop', hook: 'stop:format-typecheck', raw: JSON.stringify({ fullyIdle: false }) })).response, { decision: 'allow' });
  assert.deepStrictEqual((await invoke({ mode: 'stop', hook: 'stop:format-typecheck', child: { status: 0, stderr: '' } })).response, { decision: 'allow' });
  for (const hook of ['stop:check-console-log', 'stop:format-typecheck']) {
    const stop = await invoke({ mode: 'stop', hook, child: { status: 0, stderr: 'Remove console.log' } });
    assert.deepStrictEqual(stop.response, { decision: 'continue', reason: 'Remove console.log' });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-bridge-'));
  const conversationId = path.basename(root);
  const accumulator = path.join(os.tmpdir(), `ecc-edited-${conversationId}.txt`);
  const target = path.join(root, 'component.js');
  const payload = { conversationId, workspacePaths: [root], toolCall: { name: 'multi_replace_file_content', args: { TargetFile: target } } };
  const cli = (mode, hook, input = payload, extraEnv = {}) => {
    const child = spawnSync(process.execPath, [bridgePath, '--mode', mode, '--hook', hook], {
      input: JSON.stringify(input), encoding: 'utf8',
      env: { ...process.env, GATEGUARD_STATE_DIR: root, GATEGUARD_DISABLED: '0', GATEGUARD_EXEMPT_PATHS: '', ...extraEnv },
    });
    assert.strictEqual(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  try {
    assert.strictEqual(cli('pre-tool-use', 'pre:edit-write:gateguard-fact-force').decision, 'deny');
    const warning = cli('pre-tool-use', 'pre:write:doc-file-warning', { toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, 'NOTES.md') } } });
    assert.match(warning.reason, /Ad-hoc documentation/);
    assert.strictEqual(cli('pre-tool-use', 'pre:config-protection', payload, { ECC_HOOK_INPUT_MAX_BYTES: '2' }).decision, 'deny');
    cli('post-tool-use', 'post:edit:accumulator');
    assert.strictEqual(fs.readFileSync(accumulator, 'utf8').trim(), target);
    cli('stop', 'stop:format-typecheck', { conversationId });
    assert.ok(!fs.existsSync(accumulator) || fs.readFileSync(accumulator, 'utf8') === '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(accumulator, { force: true });
  }
  console.log('antigravity-hook-bridge regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
