/**
 * Tests for scripts/lib/astra-review/codex.js
 *
 * Run with: node tests/lib/astra-review-codex.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codex = require('../../scripts/lib/astra-review/codex');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

const { RUBRIC } = require('../../scripts/lib/astra-review/prompt');

const reviewJson = JSON.stringify({
  verdict: 'PASS',
  summary: 'ok',
  checks: RUBRIC.map(([criterion]) => ({ criterion, result: 'PASS', detail: 'ok' })),
  findings: [],
});

function fakeSpawn({ status = 0, stderr = '', error = null, writeOutput = true, servers = [] } = {}) {
  const calls = [];
  const spawnSync = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args.includes('mcp') && args.includes('list')) {
      return { status: 0, stdout: JSON.stringify(servers.map((name) => ({ name, enabled: true }))), stderr: '' };
    }
    if (writeOutput) {
      const outIndex = args.indexOf('--output-last-message');
      if (outIndex !== -1) fs.writeFileSync(args[outIndex + 1], reviewJson, 'utf8');
    }
    return { status, stderr, stdout: '', error };
  };
  return { spawnSync, calls };
}

console.log('=== Testing astra-review/codex.js ===\n');

test('buildCodexArgs runs exec read-only with model, schema, and output file', () => {
  const args = codex.buildCodexArgs({
    cwd: '/repo', model: 'gpt-6-astra', outputFile: '/tmp/out.txt', schemaFile: '/tmp/schema.json',
  });

  assert.deepStrictEqual(args.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
  assert.ok(args.includes('--sandbox') && args[args.indexOf('--sandbox') + 1] === 'read-only');
  assert.strictEqual(args[args.indexOf('-m') + 1], 'gpt-6-astra');
  assert.strictEqual(args[args.indexOf('--cd') + 1], '/repo');
  assert.strictEqual(args[args.indexOf('--output-schema') + 1], '/tmp/schema.json');
  assert.strictEqual(args[args.indexOf('--output-last-message') + 1], '/tmp/out.txt');
  assert.strictEqual(args[args.length - 1], '-');
});

test('buildCodexArgs disables web search, skips the user config, and disables each configured MCP server', () => {
  const args = codex.buildCodexArgs({
    cwd: '/r', model: 'm', outputFile: 'o', schemaFile: 's', mcpServers: ['github', 'playwright'],
  });

  assert.ok(args.some((a) => a.startsWith('web_search=')));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('mcp_servers.github={command="true",enabled=false}'));
  assert.ok(args.includes('mcp_servers.playwright={command="true",enabled=false}'));
  assert.ok(!args.some((a) => a === 'mcp_servers={}'), 'an empty table does not clear inherited servers');
  assert.ok(!args.some((a) => /^mcp_servers\.\w+\.enabled=false$/.test(a)), 'a bare enabled=false is rejected by codex when the server is not loaded');
});

test('buildCodexArgs refuses MCP server names that codex -c cannot address (spaces, dots)', () => {
  for (const name of ['bad name', 'review.probe', '"quoted"']) {
    assert.throws(
      () => codex.buildCodexArgs({ cwd: '/r', model: 'm', outputFile: 'o', schemaFile: 's', mcpServers: [name] }),
      /MCP server name/
    );
  }
});

test('listConfiguredMcpServers parses codex mcp list --json', () => {
  const spawn = (cmd, args) => {
    assert.deepStrictEqual(args.slice(-3), ['mcp', 'list', '--json']);
    return { status: 0, stdout: JSON.stringify([{ name: 'github', enabled: true }, { name: 'memory', enabled: false }]), stderr: '' };
  };

  const names = codex.listConfiguredMcpServers({ command: 'codex', prefixArgs: [] }, { spawnSync: spawn, env: {} });

  assert.deepStrictEqual(names, ['github', 'memory']);
});

test('listConfiguredMcpServers fails loudly when the listing cannot be trusted', () => {
  const broken = () => ({ status: 1, stdout: '', stderr: 'boom' });

  assert.throws(
    () => codex.listConfiguredMcpServers({ command: 'codex', prefixArgs: [] }, { spawnSync: broken, env: {} }),
    /MCP servers could not be listed/
  );
});

test('buildEnvironment keeps only the allowlisted variables', () => {
  const env = codex.buildEnvironment({
    PATH: '/bin', HOME: '/home/u', OPENAI_API_KEY: 'x', SECRET_TOKEN: 'y',
  });

  assert.deepStrictEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('buildEnvironment keeps Windows-style Path and other allowlisted keys case-insensitively', () => {
  const env = codex.buildEnvironment({ Path: 'C:/Windows;C:/npm', USERPROFILE: 'C:/Users/me', Secret: 'x' });

  assert.deepStrictEqual(env, { Path: 'C:/Windows;C:/npm', USERPROFILE: 'C:/Users/me' });
});

test('filtered Windows environment still lets resolveCodexCommand find the npm shim', () => {
  const dir = 'C:\\npm';
  const entry = path.win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const existing = new Set([path.win32.join(dir, 'codex.cmd'), entry]);
  const env = codex.buildEnvironment({ Path: `C:\\Windows;${dir}` });

  const resolved = codex.resolveCodexCommand({
    platform: 'win32', env, existsSync: (file) => existing.has(file), execPath: 'node.exe',
  });

  assert.deepStrictEqual(resolved, { command: 'node.exe', prefixArgs: [entry] });
});

test('runCodexReview lists MCP servers, then sends the prompt on stdin and returns the parsed review', () => {
  const spawn = fakeSpawn({ servers: ['github'] });

  const result = codex.runCodexReview(
    { prompt: 'review this', cwd: os.tmpdir(), model: 'gpt-6-astra', timeoutMs: 60_000 },
    { spawnSync: spawn.spawnSync, env: { PATH: '/bin' } }
  );

  assert.strictEqual(result.verdict, 'PASS');
  assert.strictEqual(spawn.calls.length, 2);
  assert.deepStrictEqual(spawn.calls[0].args.slice(-3), ['mcp', 'list', '--json']);
  const execCall = spawn.calls[1];
  assert.strictEqual(execCall.cmd, 'codex');
  assert.ok(execCall.args.includes('mcp_servers.github={command="true",enabled=false}'));
  assert.strictEqual(execCall.options.input, 'review this');
  assert.strictEqual(execCall.options.timeout, 60_000);
});

test('runCodexReview writes the JSON schema file before invoking codex', () => {
  const spawn = fakeSpawn();
  let schemaSeen = null;
  const spy = (cmd, args, options) => {
    const idx = args.indexOf('--output-schema');
    if (idx !== -1) schemaSeen = JSON.parse(fs.readFileSync(args[idx + 1], 'utf8'));
    return spawn.spawnSync(cmd, args, options);
  };

  codex.runCodexReview(
    { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
    { spawnSync: spy, env: {} }
  );

  assert.strictEqual(schemaSeen.type, 'object');
});

test('runCodexReview cleans up its temp directory', () => {
  const spawn = fakeSpawn();
  let tempDir = null;
  const spy = (cmd, args, options) => {
    const idx = args.indexOf('--output-last-message');
    if (idx !== -1) tempDir = path.dirname(args[idx + 1]);
    return spawn.spawnSync(cmd, args, options);
  };

  codex.runCodexReview(
    { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
    { spawnSync: spy, env: {} }
  );

  assert.ok(tempDir);
  assert.strictEqual(fs.existsSync(tempDir), false);
});

test('runCodexReview reports a missing Codex CLI clearly', () => {
  const spawn = fakeSpawn({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }), writeOutput: false });

  assert.throws(
    () => codex.runCodexReview(
      { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
      { spawnSync: spawn.spawnSync, env: {} }
    ),
    /Codex CLI is not installed/
  );
});

test('runCodexReview reports timeouts clearly', () => {
  const spawn = fakeSpawn({ error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), writeOutput: false });

  assert.throws(
    () => codex.runCodexReview(
      { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
      { spawnSync: spawn.spawnSync, env: {} }
    ),
    /timed out/
  );
});

test('runCodexReview surfaces the last stderr line on non-zero exit', () => {
  const spawn = fakeSpawn({ status: 1, stderr: 'warn\nmodel gpt-6-astra not available', writeOutput: false });

  assert.throws(
    () => codex.runCodexReview(
      { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
      { spawnSync: spawn.spawnSync, env: {} }
    ),
    /model gpt-6-astra not available/
  );
});

test('runCodexReview rejects an empty prompt', () => {
  assert.throws(
    () => codex.runCodexReview(
      { prompt: '  ', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
      { spawnSync: fakeSpawn().spawnSync, env: {} }
    ),
    /empty/
  );
});

test('runCodexReview rejects timeouts outside the safety range', () => {
  assert.throws(
    () => codex.runCodexReview(
      { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 1_000 },
      { spawnSync: fakeSpawn().spawnSync, env: {} }
    ),
    /timeout/
  );
});

test('resolveCodexCommand uses the bare codex binary outside Windows', () => {
  const resolved = codex.resolveCodexCommand({ platform: 'linux', env: { PATH: '/usr/bin' } });

  assert.deepStrictEqual(resolved, { command: 'codex', prefixArgs: [] });
});

test('resolveCodexCommand runs the npm shim entry point through node on Windows', () => {
  const dir = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const entry = path.win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const existing = new Set([path.win32.join(dir, 'codex.cmd'), entry]);

  const resolved = codex.resolveCodexCommand({
    platform: 'win32',
    env: { PATH: `C:\\Windows;${dir}` },
    existsSync: (file) => existing.has(file),
    execPath: 'C:\\node\\node.exe',
  });

  assert.deepStrictEqual(resolved, { command: 'C:\\node\\node.exe', prefixArgs: [entry] });
});

test('resolveCodexCommand prefers a native codex.exe on Windows when present', () => {
  const dir = 'C:\\tools';
  const exe = path.win32.join(dir, 'codex.exe');

  const resolved = codex.resolveCodexCommand({
    platform: 'win32', env: { Path: dir }, existsSync: (file) => file === exe, execPath: 'node.exe',
  });

  assert.deepStrictEqual(resolved, { command: exe, prefixArgs: [] });
});

test('resolveCodexCommand falls back to codex on Windows when nothing is found', () => {
  const resolved = codex.resolveCodexCommand({
    platform: 'win32', env: { PATH: 'C:\\nothing' }, existsSync: () => false, execPath: 'node.exe',
  });

  assert.deepStrictEqual(resolved, { command: 'codex', prefixArgs: [] });
});

test('runCodexReview spawns the resolved command with prefix args first', () => {
  const spawn = fakeSpawn();

  codex.runCodexReview(
    { prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 },
    { spawnSync: spawn.spawnSync, env: {}, resolveCodexCommand: () => ({ command: 'node.exe', prefixArgs: ['C:\\codex.js'] }) }
  );

  assert.ok(spawn.calls.every((call) => call.cmd === 'node.exe' && call.args[0] === 'C:\\codex.js'));
  assert.deepStrictEqual(spawn.calls[1].args.slice(0, 3), ['C:\\codex.js', '--ask-for-approval', 'never']);
});

const fixJson = JSON.stringify({ summary: 'fixed', fixed: [{ title: 'Bug', file: 'a.js', change: 'guard' }], skipped: [] });

test('buildCodexArgs uses workspace-write only when asked and refuses full access', () => {
  const base = { cwd: '/r', model: 'm', outputFile: 'o', schemaFile: 's' };

  const writeArgs = codex.buildCodexArgs({ ...base, sandbox: 'workspace-write' });

  assert.strictEqual(writeArgs[writeArgs.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(writeArgs.includes('--ignore-user-config'));
  assert.throws(() => codex.buildCodexArgs({ ...base, sandbox: 'danger-full-access' }), /sandbox/);
});

test('buildCodexArgs keeps workspace-write off /tmp, $TMPDIR, and the network', () => {
  const base = { cwd: '/r', model: 'm', outputFile: 'o', schemaFile: 's' };

  const writeArgs = codex.buildCodexArgs({ ...base, sandbox: 'workspace-write' });
  const readArgs = codex.buildCodexArgs(base);

  assert.ok(writeArgs.includes('sandbox_workspace_write.exclude_tmpdir_env_var=true'));
  assert.ok(writeArgs.includes('sandbox_workspace_write.exclude_slash_tmp=true'));
  assert.ok(writeArgs.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(!readArgs.some((arg) => arg.startsWith('sandbox_workspace_write.')));
});

test('runCodexFix runs in a workspace-write sandbox and returns the parsed fix result', () => {
  const calls = [];
  const spawnSync = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args.includes('mcp') && args.includes('list')) return { status: 0, stdout: '[]', stderr: '' };
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], fixJson, 'utf8');
    return { status: 0, stdout: '', stderr: '' };
  };

  const result = codex.runCodexFix(
    { prompt: 'fix this', cwd: os.tmpdir(), model: 'gpt-6-astra', timeoutMs: 60_000 },
    { spawnSync, env: { PATH: '/bin', OPENAI_API_KEY: 'sk-secret' } }
  );

  assert.strictEqual(result.fixed.length, 1);
  const execArgs = calls[1].args;
  assert.strictEqual(execArgs[execArgs.indexOf('--sandbox') + 1], 'workspace-write');
  assert.strictEqual(calls[1].options.input, 'fix this');
  assert.strictEqual(calls[1].options.env.OPENAI_API_KEY, undefined);
});

test('runCodexFix labels failures as fix failures', () => {
  const spawnSync = (cmd, args) => (args.includes('mcp')
    ? { status: 0, stdout: '[]', stderr: '' }
    : { status: 1, stdout: '', stderr: 'boom' });

  assert.throws(
    () => codex.runCodexFix({ prompt: 'p', cwd: os.tmpdir(), model: 'm', timeoutMs: 60_000 }, { spawnSync, env: {} }),
    /Codex fix failed: boom/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
