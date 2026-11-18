'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function verifyCopilotPackedLifecycle({ packageRoot, projectRoot, env }) {
  const project = fs.realpathSync(projectRoot);
  const github = path.join(project, '.github');
  const manifest = path.join(github, 'hooks', 'ecc.json');
  const installState = path.join(github, 'ecc-install-state.json');
  const userHook = path.join(github, 'hooks', 'user.json');
  const config = path.join(env.HOME, 'copilot-lifecycle');
  const environment = { ...env, COPILOT_HOME: config, ECC_HOOK_PROFILE: 'standard' };

  function run(args, input, shouldSucceed = true) {
    const result = spawnSync(process.execPath, args, {
      cwd: project, env: environment, input, encoding: 'utf8', timeout: 30000,
    });
    assert.ifError(result.error);
    if (shouldSucceed) {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout;
    }
    assert.notEqual(result.status, 0);
    return result.stderr + result.stdout;
  }

  function installArgs(modules, ...flags) {
    return [path.join(packageRoot, 'scripts/install-apply.js'), '--target', 'copilot',
      '--modules', modules, ...flags, '--json'];
  }

  const workflow = 'workflow-quality';
  const withLifecycle = workflow + ',hooks-runtime';
  const consent = () => JSON.parse(fs.readFileSync(installState, 'utf8')).request.hookConsent;

  run(installArgs(withLifecycle));
  assert.ok(!fs.existsSync(manifest), 'the default install leaves hooks inactive');

  fs.mkdirSync(path.dirname(userHook), { recursive: true });
  const userContent = '{"version":1,"hooks":{}}\n';
  fs.writeFileSync(userHook, userContent);

  run(installArgs(withLifecycle, '--enable-hooks'));
  const managedContent = fs.readFileSync(manifest, 'utf8');
  const { hooks } = JSON.parse(managedContent);
  assert.equal(consent(), 'enabled');
  assert.deepEqual(Object.keys(hooks), ['sessionStart', 'agentStop', 'preCompact', 'sessionEnd']);

  function dispatch(event, sessionId, fields = {}) {
    const [hook] = hooks[event];
    assert.equal(hook.type, 'command');
    assert.equal(hook.exec, 'node');
    assert.equal(hook.cwd, '.');
    assert.equal(hook.args[1], event);
    assert.ok(hook.args[0].startsWith('.github/ecc/'));
    return JSON.parse(run(hook.args, JSON.stringify({
      sessionId, timestamp: Date.now(), cwd: project, ...fields,
    })));
  }

  assert.deepEqual(dispatch('sessionStart', 'first', { source: 'startup' }), {});
  run([hooks.sessionStart[0].args[0], 'checkpoint', '--session', 'first', '--stdin'],
    'Release fixture checkpoint');
  assert.deepEqual(dispatch('agentStop', 'first', { stopReason: 'end_turn' }), {});
  assert.deepEqual(dispatch('preCompact', 'first', { trigger: 'manual' }), {});
  assert.deepEqual(dispatch('sessionEnd', 'first', { reason: 'complete' }), {});
  assert.match(dispatch('sessionStart', 'second', { source: 'new' }).additionalContext,
    /Release fixture checkpoint/);

  run(installArgs(workflow));
  assert.equal(fs.readFileSync(manifest, 'utf8'), managedContent);
  assert.equal(consent(), 'enabled');

  const editedContent = managedContent + '\n';
  fs.writeFileSync(manifest, editedContent);
  assert.match(run(installArgs(workflow, '--no-hooks'), undefined, false), /content.*chang|no longer matches/i);
  assert.equal(fs.readFileSync(manifest, 'utf8'), editedContent);
  assert.equal(consent(), 'enabled');

  fs.writeFileSync(manifest, managedContent);
  run(installArgs(workflow, '--no-hooks'));
  assert.ok(!fs.existsSync(manifest));
  assert.equal(consent(), 'declined');
  assert.equal(fs.readFileSync(userHook, 'utf8'), userContent);

  run([path.join(packageRoot, 'scripts/repair.js'), '--target', 'copilot', '--json']);
  assert.ok(!fs.existsSync(manifest), 'repair does not reactivate declined hooks');
  run([path.join(packageRoot, 'scripts/uninstall.js'), '--target', 'copilot', '--json']);
  assert.ok(!fs.existsSync(path.join(project, hooks.sessionStart[0].args[0])));
  assert.equal(fs.readFileSync(userHook, 'utf8'), userContent);
}

module.exports = { verifyCopilotPackedLifecycle };
