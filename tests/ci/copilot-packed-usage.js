'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  assertDownloadedArtifact,
  assertHash,
  createLifecycleEnvironment,
  hashFile,
  parseEnvironment,
} = require('./packed-artifact-lifecycle');

const launcher = '.github/ecc/scripts/usage/copilot-cost-report.cjs';
const skill = '.github/skills/cost-tracking/SKILL.md';

function run(command, args, cwd, env, status = 0) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${command} ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-usage-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'ecc-universal': pathToFileURL(artifact).href },
  }));
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], project, env);
  } else {
    run('npm', args, project, env);
  }
  return path.join(project, 'node_modules', 'ecc-universal');
}

function verifyInstalledUsage(root, packageRoot, env) {
  const workspace = path.join(root, 'Usage project café');
  const foreign = path.join(root, 'Another project');
  for (const dir of [workspace, foreign]) fs.mkdirSync(dir);
  const manifest = path.join(workspace, 'package.json');
  const manifestContent = '{"type":"module","private":true}\n';
  fs.writeFileSync(manifest, manifestContent);
  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  run(process.execPath, [cli, 'install', '--target', 'copilot', '--skills', 'cost-tracking', '--json'], workspace, env);
  assert.ok(fs.readFileSync(path.join(workspace, skill), 'utf8').includes(launcher));
  assert.equal(fs.readFileSync(manifest, 'utf8'), manifestContent);
  assert.equal(fs.existsSync(path.join(workspace, '.github/ecc/scripts/package.json')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.github/hooks')), false);

  const invoke = (args = [], status = 0, overrides = {}) => run(
    process.execPath, [launcher, ...args], workspace, { ...env, ...overrides }, status
  );
  const report = (args, status, overrides) => JSON.parse(invoke(args, status, overrides).stdout);
  const states = path.join(env.COPILOT_HOME, 'session-state');
  const write = (dir, id, lines) => {
    const session = path.join(dir, id);
    fs.mkdirSync(session, { recursive: true });
    const file = path.join(session, 'events.jsonl');
    fs.writeFileSync(file, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
    return file;
  };
  const start = (id, cwd = workspace) => ({ type: 'session.start', data: { sessionId: id, context: { cwd } } });
  const usage = (type, total, modelMetrics) => ({ type, data: { totalNanoAiu: total, modelMetrics } });
  const metrics = JSON.parse('{"__proto__":{"usage":{"inputTokens":100,"cacheReadTokens":8},"requests":{"count":1}}}');
  const good = write(states, 'good', [
    start('good'),
    { type: 'user.message', data: { content: 'Private transcript fixture' } },
    usage('session.usage_checkpoint', 7),
    { type: 'session.shutdown', data: { totalNanoAiu: 12, totalPremiumRequests: 1.5, modelMetrics: metrics } },
  ]);
  write(states, 'foreign', [start('foreign', foreign), usage('session.shutdown', 40)]);
  fs.mkdirSync(path.join(states, 'unfinished'));
  write(states, 'malformed', [start('malformed'), '{not valid JSON}']);
  write(states, 'mixed', [start('mixed'), { type: 'session.context_changed', data: { cwd: foreign } }]);
  const linked = path.join(states, 'linked');
  fs.symlinkSync(path.join(states, 'good'), linked, process.platform === 'win32' ? 'junction' : 'dir');

  const original = fs.readFileSync(good);
  const aggregate = report();
  assert.deepEqual(aggregate.sessions.map(row => row.sessionId), ['good']);
  assert.deepEqual(aggregate.skipped, { missing: 1, invalid: 3, foreign: 1 });
  assert.equal(aggregate.complete, false);
  assert.equal(aggregate.totalNanoAiu, 12);
  assert.equal(aggregate.estimatedCostUsd, null);
  assert.doesNotMatch(JSON.stringify(aggregate), /Private transcript fixture|Another project/);

  const explicit = report(['--session', 'good']);
  assert.equal(explicit.complete, true);
  assert.equal(explicit.sessions[0].totalPremiumRequests, 1.5);
  assert.ok(Object.hasOwn(explicit.sessions[0].modelMetrics, '__proto__'));
  assert.equal(explicit.sessions[0].modelMetrics.__proto__.usage.inputTokens, 100);
  assert.equal(explicit.sessions[0].modelMetrics.__proto__.usage.outputTokens, null);

  for (const id of ['foreign', 'unfinished', 'malformed', 'mixed', 'linked', 'absent']) {
    assert.match(report(['--session', id], 1).error, /Usage unavailable/);
  }
  const csv = invoke(['--csv']);
  assert.match(csv.stdout, /^session_id,total_nano_aiu,total_premium_requests,complete\ngood,12,1\.5,true\n$/);
  assert.match(csv.stderr, /incomplete.*missing=1.*invalid=3.*foreign=1/);
  assert.deepEqual(fs.readFileSync(good), original);

  write(states, 'resumed', [
    start('resumed'),
    usage('session.shutdown', 3, { example: { usage: { inputTokens: 8 } } }),
    usage('session.usage_checkpoint', 5),
  ]);
  const resumed = report(['--session', 'resumed']);
  assert.equal(resumed.complete, false);
  assert.equal(resumed.totalNanoAiu, 5);
  assert.deepEqual(resumed.sessions[0].modelMetrics, {});

  const empty = report([], 0, { COPILOT_HOME: path.join(root, 'Empty') });
  assert.equal(empty.totalNanoAiu, null);
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.sessions, []);

  const limitedHome = path.join(root, 'Limiting fixture');
  const limited = path.join(limitedHome, 'session-state');
  write(limited, 'good', [start('good'), usage('session.shutdown', 12)]);
  for (let index = 0; index < 17; index++) {
    const file = write(limited, `invalid-${index}`, []);
    fs.truncateSync(file, 4 * 1024 * 1024);
  }
  const limitEnv = { COPILOT_HOME: limitedHome };
  assert.match(report([], 1, limitEnv).error, /limit exceeded/i);
  assert.equal(report(['--session', 'good'], 0, limitEnv).totalNanoAiu, 12);

  const countHome = path.join(root, 'Count fixture');
  const countStates = path.join(countHome, 'session-state');
  fs.mkdirSync(countStates, { recursive: true });
  for (let index = 0; index < 1001; index++) fs.mkdirSync(path.join(countStates, `entry-${index}`));
  assert.match(report([], 1, { COPILOT_HOME: countHome }).error, /limit exceeded/i);

  const exactHome = path.join(root, 'Exact count fixture');
  const exactStates = path.join(exactHome, 'session-state');
  write(exactStates, 'first', [start('first'), usage('session.shutdown', Number.MAX_SAFE_INTEGER)]);
  write(exactStates, 'second', [start('second'), usage('session.shutdown', 1)]);
  assert.match(report([], 1, { COPILOT_HOME: exactHome }).error, /limit exceeded/i);

  run(process.execPath, [cli, 'uninstall', '--target', 'copilot', '--json'], workspace, env);
  assert.equal(fs.existsSync(path.join(workspace, launcher)), false);
  assert.deepEqual(fs.readFileSync(good), original);
}

function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-usage-'));
  try {
    const packageProject = path.join(root, 'packed package');
    const home = path.join(root, 'home');
    fs.mkdirSync(packageProject);
    fs.mkdirSync(home);
    const env = { ...createLifecycleEnvironment(process.env, home), COPILOT_HOME: path.join(home, 'copilot') };
    verifyInstalledUsage(root, installPackage(packageProject, env, packagePath), env);
    console.log('Packed Copilot usage verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledUsage };

if (require.main === module) main();
