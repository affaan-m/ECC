'use strict';
// Execute distributed runtime from an isolated install, without source imports.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-phase-install-'));
const env = { ...process.env, COPILOT_HOME: path.join(root, 'private'), ECC_HOOKS_ENABLED: 'true',
  ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '', ECC_COPILOT_OBSERVE: '1', ECC_COPILOT_QUALITY_MODE: 'check' };
let passed = 0;
function invoke(entry, payload, expectedStatus = 0) {
  const result = spawnSync(process.execPath, entry.args, { cwd: root, env, input: JSON.stringify(payload),
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, expectedStatus, result.stderr);
  return JSON.parse(result.stdout);
}
try {
  applyInstallPlan(withHookConsent(createManifestInstallPlan({ target: 'copilot', moduleIds: ['hooks-runtime'],
    projectRoot: root, homeDir: path.join(root, 'home'), env: {} }), 'enabled'));
  const hooks = JSON.parse(fs.readFileSync(path.join(root, '.github/hooks/ecc.json'), 'utf8')).hooks;
  const payload = { cwd: root, sessionId: 'phase-test', toolCallId: 'edit-one', toolName: 'edit',
    toolArgs: { path: 'src/main.ts' }, toolResult: { success: true } };
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/main.ts'), 'const answer: number = 42;\n');
  const guard = hooks.preToolUse.find(entry => entry.args[2] === 'pre:copilot:guard');
  const deny = invoke(guard, { ...payload, toolName: 'powershell', toolArgs: { command: 'Remove-Item -Recurse -Force .git' } }, 1);
  assert.equal(deny.permissionDecision, 'deny');
  assert.deepEqual(invoke(guard, { ...payload, toolName: 'powershell', toolArgs: { command: 'Get-ChildItem' } }), {});
  console.log('PASS installed PowerShell guard denies destructive and permits benign request'); passed++;
  for (const entry of hooks.postToolUse.filter(item => /copilot-(?:quality|observe)\.js$/.test(item.args[0]))) invoke(entry, payload);
  const quality = hooks.agentStop.find(entry => /copilot-quality\.js$/.test(entry.args[0]));
  const result = invoke(quality, { cwd: root, sessionId: 'phase-test' }, 2);
  assert.match(result.additionalContext, /unavailable/);
  assert.deepEqual(invoke(quality, { cwd: root, sessionId: 'phase-test' }), {});
  console.log('PASS installed quality checks once and reports absent toolchain unavailable'); passed++;
  const sessionRoot = path.join(env.COPILOT_HOME, 'ecc/projects');
  const projects = fs.readdirSync(sessionRoot);
  const observation = fs.readFileSync(path.join(sessionRoot, projects[0], 'observations.jsonl'), 'utf8');
  assert.equal(JSON.parse(observation.trim()).outcome, 'succeeded');
  assert.equal(observation.includes('main.ts'), false);
  console.log('PASS installed observations persist metadata without edited path or source'); passed++;
  env.ECC_COPILOT_FACTFORCE = '1';
  const recorder = event => hooks[event].find(entry => /copilot-evidence\.js$/.test(entry.args[0]));
  const boundary = () => ({ cwd: root, sessionId: 'phase-test', timestamp: Date.now() });
  assert.equal(invoke(guard, { ...payload, timestamp: Date.now() }, 1).permissionDecision, 'deny');
  invoke(recorder('sessionStart'), boundary());
  const read = { ...payload, toolName: 'view', toolCallId: 'observed-read', toolArgs: { path: 'src/main.ts' } };
  invoke(recorder('preToolUse'), { ...read, timestamp: Date.now() });
  invoke(recorder('postToolUse'), { ...read, timestamp: Date.now(), toolResult: { resultType: 'success', textResultForLlm: fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8') } });
  assert.deepEqual(invoke(guard, { ...payload, timestamp: Date.now() }), {});
  invoke(recorder('agentStop'), boundary());
  assert.equal(invoke(guard, { ...payload, timestamp: Date.now() }, 1).permissionDecision, 'deny');
  console.log('PASS installed read evidence unlocks unchanged ordinary code only until observed stop'); passed++;
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
