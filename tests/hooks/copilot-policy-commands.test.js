'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
let passed = 0; let failed = 0;
function test(name, action) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc policies-'));
  const env = { ...process.env, COPILOT_HOME: path.join(cwd, 'private'), ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' };
  function invoke(script, args, input = '') {
    const result = spawnSync(process.execPath, [path.join(REPO, script), ...args], { cwd, env, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error); return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  }
  try { action({ cwd, env, invoke }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
const rule = '---\nname: no-bypass\nenabled: true\nevent: bash\naction: block\npattern: "--no-verify"\n---\nGit verification bypass is blocked.\n';
test('Hookify author, list, toggle and real pre-tool denial use Copilot scope', ({ cwd, invoke }) => {
  const script = 'scripts/copilot-hookify.js';
  assert.strictEqual(invoke(script, ['create', '--name', 'no-bypass', '--stdin'], rule).status, 0);
  assert.strictEqual(invoke(script, ['list']).json.rules.length, 1);
  const input = { cwd, sessionId: 's1', toolName: 'bash', toolArgs: { command: 'git commit --no-verify' } };
  assert.strictEqual(invoke(script, ['hook', 'preToolUse'], input).json.permissionDecision, 'deny');
  assert.strictEqual(invoke(script, ['configure', '--name', 'no-bypass', '--enabled', 'false']).status, 0);
  assert.deepStrictEqual(invoke(script, ['hook', 'preToolUse'], input).json, {});
  assert.ok(!fs.existsSync(path.join(cwd, '.claude')));
});
test('Hookify rejects unsafe names, symlinks, regex and prompt blocking before writing', ({ cwd, invoke }) => {
  const script = 'scripts/copilot-hookify.js';
  for (const name of ['../outside', 'nul', 'bad:name']) assert.notStrictEqual(invoke(script, ['create', '--name', name, '--stdin'], rule).status, 0);
  assert.notStrictEqual(invoke(script, ['create', '--name', 'no-bypass', '--stdin'], rule.replace('event: bash', 'event: prompt')).status, 0);
  assert.notStrictEqual(invoke(script, ['create', '--name', 'no-bypass', '--stdin'], rule.replace('--no-verify', '(a+)+')).status, 0);
  fs.mkdirSync(path.join(cwd, '.github')); fs.symlinkSync(os.tmpdir(), path.join(cwd, '.github/ecc'));
  assert.notStrictEqual(invoke(script, ['create', '--name', 'no-bypass', '--stdin'], rule).status, 0);
});
test('prompt warnings append delimited context without granting or blocking', ({ cwd, invoke }) => {
  const script = 'scripts/copilot-hookify.js';
  const warning = rule.replace('event: bash', 'event: prompt').replace('action: block', 'action: warn');
  invoke(script, ['create', '--name', 'no-bypass', '--stdin'], warning);
  const result = invoke(script, ['hook', 'userPromptTransformed'], { cwd, sessionId: 's1', prompt: '--no-verify', transformedPrompt: 'Original --no-verify' });
  assert.match(result.json.modifiedTransformedPrompt, /^Original --no-verify/);
  assert.match(result.json.modifiedTransformedPrompt, /UNTRUSTED LOCAL RULE DATA/);
  assert.ok(!result.json.permissionDecision && !result.json.decision);
});
test('cost report uses latest cumulative native units, preserves unavailable currency and scopes workspace', ({ cwd, env, invoke }) => {
  const dir = path.join(env.COPILOT_HOME, 'session-state', 's1'); fs.mkdirSync(dir, { recursive: true });
  const entries = [
    { type: 'session.start', data: { sessionId: 's1', context: { cwd } } },
    { type: 'session.usage_checkpoint', data: { totalNanoAiu: 10, totalPremiumRequests: 1 } },
    { type: 'session.shutdown', data: { totalNanoAiu: 20, totalPremiumRequests: 2, modelMetrics: { example: { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1 }, requests: { count: 2 } } } } },
  ];
  const file = path.join(dir, 'events.jsonl'); fs.writeFileSync(file, entries.map(JSON.stringify).join('\n'));
  const report = invoke('scripts/copilot-cost-report.js', ['--session', 's1']);
  assert.strictEqual(report.status, 0, report.stderr); assert.strictEqual(report.json.totalNanoAiu, 20);
  assert.strictEqual(report.json.estimatedCostUsd, null); assert.strictEqual(report.json.sessions[0].modelMetrics.example.usage.inputTokens, 100);
  assert.notStrictEqual(invoke('scripts/copilot-cost-report.js', ['--session', '../outside']).status, 0);
  entries[0].data.context.cwd = os.tmpdir(); fs.writeFileSync(file, entries.map(JSON.stringify).join('\n'));
  assert.notStrictEqual(invoke('scripts/copilot-cost-report.js', ['--session', 's1']).status, 0);
});
test('cost report missing totals stay unavailable, malformed and oversized records fail explicitly', ({ cwd, env, invoke }) => {
  const dir = path.join(env.COPILOT_HOME, 'session-state', 's1'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'session.start', data: { sessionId: 's1', context: { cwd } } }) + '\n');
  const result = invoke('scripts/copilot-cost-report.js', ['--session', 's1']);
  assert.strictEqual(result.json.totalNanoAiu, null); assert.strictEqual(result.json.complete, false);
  fs.appendFileSync(file, '{bad}\n'); assert.notStrictEqual(invoke('scripts/copilot-cost-report.js', ['--session', 's1']).status, 0);
});
test('tracked Hookify rules require operator opt-in and stop rules honor native recursion guard', ({ cwd, env, invoke }) => {
  const script = 'scripts/copilot-hookify.js';
  assert.strictEqual(invoke(script, ['create', '--name', 'no-bypass', '--stdin'], rule).status, 0);
  assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd }).status, 0);
  assert.strictEqual(spawnSync('git', ['add', '.github/ecc/hookify'], { cwd }).status, 0);
  const input = { cwd, sessionId: 's1', toolName: 'bash', toolArgs: { command: 'git commit --no-verify' } };
  assert.deepStrictEqual(invoke(script, ['hook', 'preToolUse'], input).json, {});
  env.ECC_HOOKIFY_ALLOW_TRACKED = '1';
  assert.strictEqual(invoke(script, ['hook', 'preToolUse'], input).json.permissionDecision, 'deny');
  const stop = rule.replace('name: no-bypass', 'name: stop-risk').replace('event: bash', 'event: stop').replace('--no-verify', 'risky');
  invoke(script, ['create', '--name', 'stop-risk', '--stdin'], stop);
  const dir = path.join(env.COPILOT_HOME, 'session-state/s1'); fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, 'events.jsonl');
  fs.writeFileSync(transcriptPath, [ { type: 'session.start', data: { sessionId: 's1', context: { cwd } } },
    { type: 'assistant.message', data: { content: 'risky response' } } ].map(JSON.stringify).join('\n'));
  assert.strictEqual(invoke(script, ['hook', 'agentStop'], { cwd, sessionId: 's1', transcriptPath }).json.decision, 'block');
  assert.deepStrictEqual(invoke(script, ['hook', 'agentStop'], { cwd, sessionId: 's1', transcriptPath, stop_hook_active: true }).json, {});
});
console.log(`Passed: ${passed}, Failed: ${failed}`); process.exitCode = failed ? 1 : 0;
