/**
 * Hooks that branch on the hook event must read it from the payload.
 *
 * Claude Code sends the event as `hook_event_name` in the stdin JSON and does
 * not export CLAUDE_HOOK_EVENT_NAME. These cases run the shipped hooks.json
 * commands with native payloads and no event variable, as Claude Code does.
 *
 * Run with: node tests/hooks/native-hook-event.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { run: runGovernanceCapture } = require('../../scripts/hooks/governance-capture');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS = require('../../hooks/hooks.json').hooks;
const tempRoots = [];
process.on('exit', () => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-native-hook-event-'));
  tempRoots.push(dir);
  return dir;
}

function hookCommand(event, needle) {
  const command = HOOKS[event]
    .flatMap(entry => entry.hooks.map(hook => hook.command))
    .find(candidate => candidate.includes(needle));
  assert.ok(command, `hooks.json ${event} has no command containing ${needle}`);
  return command;
}

const MCP_PRE = hookCommand('PreToolUse', 'pre:mcp-health-check');
const MCP_FAILURE = hookCommand('PostToolUseFailure', 'post:mcp-health-check');
const GOVERNANCE_PRE = hookCommand('PreToolUse', 'pre:governance-capture');
const POST_SYNC = hookCommand('PostToolUse', "require(s).cli()\" sync");

const SCRUBBED = [
  'CLAUDE_HOOK_EVENT_NAME', 'CLAUDE_CONFIG_DIR', 'ECC_HOOK_PROFILE', 'ECC_DISABLED_HOOKS',
  'ECC_HOOKS_ENABLED', 'ECC_GOVERNANCE_CAPTURE', 'ECC_SESSION_ID', 'ECC_MCP_RECONNECT_COMMAND',
  'ECC_MCP_RECONNECT_ALLOW', 'ECC_MCP_HEALTH_FAIL_OPEN', 'ECC_MCP_CONFIG_PATH', 'ECC_MCP_HEALTH_STATE_PATH',
  'ECC_MCP_HEALTH_TTL_MS', 'ECC_MCP_RECONNECT_TIMEOUT_MS', 'ECC_MCP_ALLOW_WORKSPACE_PROBE',
];

function hookEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: REPO_ROOT };
  for (const key of SCRUBBED) delete env[key];
  return { ...env, ...extra };
}

function runCommand(command, env, payload, cwd) {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
  });
  return { code: result.status, stderr: result.stderr || '' };
}

/** A healthy stdio MCP server named `shared`, with an isolated cache and no reconnect command. */
function mcpFixture() {
  const dir = makeTempDir();
  const serverPath = path.join(dir, 'server.js');
  const configPath = path.join(dir, 'config.json');
  const statePath = path.join(dir, 'state.json');
  fs.mkdirSync(path.join(dir, 'home'));
  fs.writeFileSync(serverPath, 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: { shared: { command: process.execPath, args: [serverPath] } },
  }));
  const env = hookEnv(path.join(dir, 'home'), {
    ECC_MCP_CONFIG_PATH: configPath,
    ECC_MCP_HEALTH_STATE_PATH: statePath,
    ECC_MCP_HEALTH_TIMEOUT_MS: '1000',
    // A zero backoff would make the failed server due for a probe at once.
    ECC_MCP_HEALTH_BACKOFF_MS: '60000',
  });
  const fire = (command, payload, extraEnv = {}) => runCommand(command, { ...env, ...extraEnv }, {
    session_id: 'native-event-session',
    tool_name: 'mcp__shared__ping',
    tool_input: {},
    ...payload,
  }, dir);
  const status = () => JSON.parse(fs.readFileSync(statePath, 'utf8')).servers.shared.status;
  return { fire, status };
}

function governanceEvents(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter(line => line.startsWith('[governance] '))
    .map(line => JSON.parse(line.slice('[governance] '.length)));
}

function bashPayload(event, command = 'sudo ls /root') {
  return {
    session_id: 'native-event-session',
    hook_event_name: event,
    tool_name: 'Bash',
    tool_use_id: 'toolu_sudo',
    tool_input: { command },
    tool_response: { stdout: '', stderr: '' },
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

const tests = [];

tests.push(['mcp-health-check: a native PreToolUse probes and caches a healthy server', () => {
  const { fire, status } = mcpFixture();
  const pre = fire(MCP_PRE, { hook_event_name: 'PreToolUse' });
  assert.strictEqual(pre.code, 0, pre.stderr);
  assert.strictEqual(status(), 'healthy');
}]);

tests.push(['mcp-health-check: a native PostToolUseFailure marks the server unhealthy and the next call backs off', () => {
  const { fire, status } = mcpFixture();
  assert.strictEqual(fire(MCP_PRE, { hook_event_name: 'PreToolUse' }).code, 0);
  const failure = fire(MCP_FAILURE, { hook_event_name: 'PostToolUseFailure', error: '503 Service Unavailable' });
  assert.strictEqual(failure.code, 0, failure.stderr);
  assert.match(failure.stderr, /shared reported 503; marking server unhealthy/);
  assert.strictEqual(status(), 'unhealthy');
  const retry = fire(MCP_PRE, { hook_event_name: 'PreToolUse' });
  assert.strictEqual(retry.code, 2, retry.stderr);
  assert.match(retry.stderr, /shared is marked unhealthy until .*; skipping ping/);
}]);

tests.push(['mcp-health-check: the payload event wins over a conflicting CLAUDE_HOOK_EVENT_NAME', () => {
  const { fire, status } = mcpFixture();
  assert.strictEqual(fire(MCP_PRE, { hook_event_name: 'PreToolUse' }).code, 0);
  const failure = fire(MCP_FAILURE,
    { hook_event_name: 'PostToolUseFailure', error: 'connection reset by peer' },
    { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' });
  assert.strictEqual(failure.code, 0, failure.stderr);
  assert.strictEqual(status(), 'unhealthy');
}]);

tests.push(['mcp-health-check: payloads without hook_event_name keep the CLAUDE_HOOK_EVENT_NAME fallback', () => {
  const { fire, status } = mcpFixture();
  assert.strictEqual(fire(MCP_PRE, {}, { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' }).code, 0);
  assert.strictEqual(status(), 'healthy');
  const failure = fire(MCP_FAILURE, { error: '503 Service Unavailable' }, { CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure' });
  assert.strictEqual(failure.code, 0, failure.stderr);
  assert.strictEqual(status(), 'unhealthy');
}]);

tests.push(['governance-capture: a native PreToolUse is labelled pre and defers the elevated-command finding', () => {
  const home = makeTempDir();
  const env = hookEnv(home, { ECC_GOVERNANCE_CAPTURE: '1' });
  const payload = bashPayload('PreToolUse', 'sudo git push --force origin main');
  const result = runCommand(GOVERNANCE_PRE, env, payload, home);
  assert.strictEqual(result.code, 0, result.stderr);
  const events = governanceEvents(result.stderr);
  const approvals = events.filter(event => event.eventType === 'approval_requested');
  assert.strictEqual(approvals.length, 1, `expected one approval_requested event, got ${JSON.stringify(events)}`);
  assert.deepStrictEqual(events.map(event => event.payload.hookPhase), events.map(() => 'pre'));
  assert.ok(!events.some(event => event.payload.reason === 'elevated_privilege_command'),
    'the elevated-command finding belongs to the post phase');
}]);

tests.push(['governance-capture: the native PostToolUse dispatcher reports the elevated command once, as post', () => {
  const home = makeTempDir();
  const env = hookEnv(home, { ECC_GOVERNANCE_CAPTURE: '1' });
  const result = runCommand(POST_SYNC, env, bashPayload('PostToolUse'), home);
  assert.strictEqual(result.code, 0, result.stderr);
  const findings = governanceEvents(result.stderr)
    .filter(event => event.payload.reason === 'elevated_privilege_command');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].payload.hookPhase, 'post');
}]);

tests.push(['governance-capture: truncated input takes the phase from the payload prefix', () => {
  const previous = process.env.ECC_GOVERNANCE_CAPTURE;
  const previousEvent = process.env.CLAUDE_HOOK_EVENT_NAME;
  const writes = [];
  const realWrite = process.stderr.write;
  process.env.ECC_GOVERNANCE_CAPTURE = '1';
  delete process.env.CLAUDE_HOOK_EVENT_NAME;
  process.stderr.write = chunk => { writes.push(String(chunk)); return true; };
  try {
    runGovernanceCapture('{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"x',
      { truncated: true, maxStdin: 64 });
  } finally {
    process.stderr.write = realWrite;
    if (previous === undefined) delete process.env.ECC_GOVERNANCE_CAPTURE; else process.env.ECC_GOVERNANCE_CAPTURE = previous;
    if (previousEvent !== undefined) process.env.CLAUDE_HOOK_EVENT_NAME = previousEvent;
  }
  const truncated = governanceEvents(writes.join('')).filter(event => event.eventType === 'hook_input_truncated');
  assert.strictEqual(truncated.length, 1);
  assert.strictEqual(truncated[0].payload.hookPhase, 'pre');
}]);

let passed = 0;
let failed = 0;
console.log('\n=== Testing native hook event routing ===\n');
for (const [name, fn] of tests) {
  if (test(name, fn)) passed += 1; else failed += 1;
}
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
