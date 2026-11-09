'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const python = process.env.ECC_TEST_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-installed-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exercise(name, moduleIds, hooks) {
  const project = path.join(root, name); fs.mkdirSync(project);
  const env = { ...process.env, COPILOT_HOME: path.join(project, 'private'), ECC_COPILOT_OBSERVE: '1',
    HOME: root, USERPROFILE: root, ECC_HOOK_PROFILE: 'standard' };
  applyInstallPlan(withHookConsent(createManifestInstallPlan({ target: 'copilot', moduleIds,
    projectRoot: project, homeDir: root, env: {} }), hooks ? 'enabled' : 'declined'));
  const installed = path.join(project, '.github/ecc');
  const observer = require(path.join(installed, 'scripts/lib/copilot-observer'));
  const sink = require(path.join(installed, 'scripts/lib/copilot-observations'));
  const cli = (program, args, input) => {
    const result = spawnSync(program, args, { cwd: project, env, input, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout;
  };
  const invoke = args => JSON.parse(cli(process.execPath, ['.github/ecc/scripts/copilot-observer.js', ...args]));
  assert.equal(invoke(['status']).status, 'stopped', 'installation must not start analysis');
  assert.equal(fs.existsSync(env.COPILOT_HOME), false);
  const identity = JSON.parse(cli(python, ['.github/ecc/scripts/copilot-learning.py', 'identity', '--apply']));
  assert.equal(identity.ok, true); assert.equal(identity.applied, true);
  for (const sessionId of ['first', 'second', 'third']) {
    for (const [native, normalized] of [['view', 'Read'], ['edit', 'Edit']]) {
      if (hooks) {
        // Exercise the installed native-shaped event adapter, not synthetic JSONL.
        cli(process.execPath, ['.github/ecc/scripts/hooks/copilot-observe.js', 'postToolUse'], JSON.stringify({
          cwd: project, sessionId, toolName: native, toolArgs: { path: 'sample.txt' },
          toolCallId: `${sessionId}-${native}`, toolResult: { resultType: 'success', textResultForLlm: 'PRIVATE OUTPUT MUST NOT ENTER THE STORE' },
        }));
      } else {
        // Skill-only installs intentionally have no host hooks. Feed the installed
        // sink's public normalized input as a separately configured producer would.
        assert.equal(sink.observe({ schemaVersion: 1, event: 'postToolUse', sessionId,
          callId: `${sessionId}-${native}`, workspace: { canonical: project }, tool: { name: normalized },
          outcome: { status: 'succeeded' } }, env).status, 'recorded');
      }
      await delay(2); // Distinct delivery timestamps; equal timestamps are ambiguous.
    }
  }
  const captured = sink.readObservations(project, env);
  assert.equal(captured.length, 6);
  assert.equal(new Set(captured.map(record => record.session)).size, 3);
  assert.ok(captured.every(record => record.outcome === 'succeeded'));
  const observationFile = sink.observationFile(project, env);
  const observationsBefore = fs.readFileSync(observationFile, 'utf8');
  assert.doesNotMatch(observationsBefore, /PRIVATE OUTPUT|sample.txt|first|second|third/);
  assert.equal(invoke(['once', '--backend', 'metadata-sequences']).candidates, 1);
  const pending = invoke(['candidates']); assert.equal(pending.activated, false);
  assert.equal(pending.state.candidates[0].status, 'pending-review');
  assert.equal(pending.state.candidates[0].evidence.sessions, 3);
  const before = fs.readFileSync(observer.stateFile(project, env), 'utf8');
  const exported = cli(process.execPath, ['.github/ecc/scripts/copilot-observer.js', 'export', '--candidate', 'metadata-read-before-edit']);
  const canonical = path.join(installed, 'skills/continuous-learning-v2/scripts/instinct-cli.py');
  const parsed = JSON.parse(cli(python, ['-c', 'import importlib.util,json,sys; sys.dont_write_bytecode=True; s=importlib.util.spec_from_file_location("instinct",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.parse_instinct_file(sys.stdin.read())))', canonical], exported));
  assert.equal(parsed.length, 1); assert.equal(parsed[0].project_id, identity.mapping.learningProjectId);
  assert.equal(parsed[0].id, 'metadata-read-before-edit'); assert.equal(parsed[0].scope, 'project');
  assert.equal(invoke(['once', '--backend', 'metadata-sequences']).status, 'unchanged');
  assert.equal(fs.readFileSync(observer.stateFile(project, env), 'utf8'), before);
  invoke(['start', '--backend', 'metadata-sequences', '--interval-ms', '250', '--duration-ms', '5000', '--max-runs', '20']);
  try {
    const deadline = Date.now() + 4000;
    while (invoke(['status']).status === 'starting' && Date.now() < deadline) await delay(25);
    assert.equal(invoke(['status']).status, 'registered');
    assert.equal(invoke(['stop']).signalSent, false);
    while (invoke(['status']).status !== 'stopped' && Date.now() < deadline) await delay(25);
    const stopped = invoke(['status']); assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.lastResult.status, 'stopped');
    assert.equal(fs.readFileSync(observer.stateFile(project, env), 'utf8'), before);
    assert.equal(fs.readFileSync(observationFile, 'utf8'), observationsBefore);
    const personal = path.join(env.COPILOT_HOME, 'ecc/homunculus/projects', identity.mapping.learningProjectId, 'instincts/personal');
    assert.ok(!fs.existsSync(personal) || fs.readdirSync(personal).length === 0, 'candidate must never activate');
  } finally { observer.stop(project, env); }
  console.log(`PASS installed ${name}: identity → capture → pending → canonical export → replay → cooperative stop`);
}
(async () => {
  await exercise('commands-with-hooks', ['commands-core', 'hooks-runtime'], true);
  await exercise('skills-without-hooks', ['workflow-quality'], false);
  console.log('Passed: 2, Failed: 0');
})().then(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
