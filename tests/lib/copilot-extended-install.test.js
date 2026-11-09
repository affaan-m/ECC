'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const extended = require('../../scripts/lib/install/copilot-extended-commands');
const REPO = path.resolve(__dirname, '../..');
let passed = 0; let failed = 0;
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc all37-'));
  const home = path.join(root, 'home');
  const options = { repoRoot: REPO, projectRoot: root, homeDir: home, env: {}, targets: ['copilot'] };
  const plan = withHookConsent(createManifestInstallPlan({ ...options, target: 'copilot', moduleIds: ['commands-core', 'hooks-runtime'] }), 'enabled');
  try { applyInstallPlan(plan); action({ root, home, options, plan }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('all37 materialize concrete workflows and closed helper files in the installed project', ({ root, plan }) => {
  assert.strictEqual(new Set(extended.COMMANDS).size, 37);
  const destinations = plan.operations.filter(operation => operation.kind === 'copy-file').map(operation => operation.destinationPath);
  assert.strictEqual(destinations.length, new Set(destinations).size, 'shared runtime ownership must be unique');
  for (const name of extended.COMMANDS) {
    const text = fs.readFileSync(path.join(root, '.github/skills', name, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /not yet ported|status: blocked/); assert.match(text, /status: copilot-native/);
  }
  for (const file of extended.RUNTIME_PATHS) assert.ok(fs.existsSync(path.join(root, '.github/ecc', file)), file);
});
test('installed Hookify actually denies a native command; private usage report executes', ({ root, home }) => {
  const entry = '.github/ecc/scripts/copilot-hookify.js';
  const env = { ...process.env, COPILOT_HOME: home, ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' };
  const rule = '---\nname: no-bypass\nevent: bash\naction: block\npattern: "--no-verify"\n---\nStop bypass.\n';
  const created = spawnSync(process.execPath, [entry, 'create', '--name', 'no-bypass', '--stdin'], { cwd: root, env, input: rule, encoding: 'utf8' });
  assert.strictEqual(created.status, 0, created.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.github/hooks/ecc.json'), 'utf8'));
  const hook = manifest.hooks.preToolUse.find(item => item.args[0].endsWith('copilot-hookify.js'));
  const denied = spawnSync(process.execPath, hook.args, { cwd: root, env, input: JSON.stringify({ cwd: root, sessionId: 's1', toolName: 'bash', toolArgs: { command: 'git commit --no-verify' } }), encoding: 'utf8' });
  assert.strictEqual(JSON.parse(denied.stdout).permissionDecision, 'deny');
  const state = path.join(home, 'session-state/s1'); fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'events.jsonl'), JSON.stringify({ type: 'session.start', data: { sessionId: 's1', context: { cwd: root } } }) + '\n'
    + JSON.stringify({ type: 'session.shutdown', data: { totalNanoAiu: 25 } }) + '\n');
  const report = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-cost-report.js', '--session', 's1'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(report.status, 0, report.stderr); assert.strictEqual(JSON.parse(report.stdout).totalNanoAiu, 25);
});
test('repair restores extended runtime and uninstall preserves private stores and local rules', ({ root, home, options }) => {
  const runtime = path.join(root, '.github/ecc/scripts/copilot-runtime.js');
  fs.unlinkSync(runtime); assert.strictEqual(repairInstalledStates(options).summary.errorCount, 0); assert.ok(fs.existsSync(runtime));
  const local = path.join(root, '.github/ecc/hookify/hookify.local.local.md'); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, 'USER RULE');
  fs.mkdirSync(path.join(home, 'ecc'), { recursive: true }); fs.writeFileSync(path.join(home, 'ecc/private-data'), 'KEEP');
  assert.strictEqual(uninstallInstalledStates(options).summary.errorCount, 0);
  assert.ok(fs.existsSync(local)); assert.ok(fs.existsSync(path.join(home, 'ecc/private-data'))); assert.ok(!fs.existsSync(runtime));
});
test('installed memory MCP and telemetry helpers run without source checkout dependencies', ({ root, home }) => {
  const env = { ...process.env, COPILOT_HOME: home };
  const commands = [
    ['.github/ecc/scripts/copilot-memory.js', 'doctor'],
    ['.github/ecc/scripts/copilot-mcp.js', 'doctor', '--config', path.join(root, '.mcp.json')],
    ['.github/ecc/scripts/copilot-telemetry.js'],
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    if (args[0].endsWith('copilot-memory.js')) assert.strictEqual(report.status, 'unavailable', 'separate canonical vault must be configured explicitly');
    if (args[0].endsWith('copilot-telemetry.js')) assert.strictEqual(report.costUsd, null);
  }
});
console.log(`Passed: ${passed}, Failed: ${failed}`); process.exitCode = failed ? 1 : 0;
