'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PassThrough } = require('stream');
const { pathToFileURL } = require('url');

const SERVER = path.join(__dirname, '..', '..', 'scripts', 'memory-mcp.mjs');
const {
  MAX_RESULTS,
  resolveVaultRoots,
  saveMemory,
} = require('../../scripts/lib/memory-vault');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.mcpDiagnostic ? JSON.stringify(error.mcpDiagnostic) : error.stack || error.message}`);
    failed += 1;
  }
}

function createFixture(extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-mcp-'));
  try {
    const projectRoot = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    return {
      root,
      projectRoot,
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          ECC_MEMORY_PROJECT_ROOT: path.join(projectRoot, '.ecc', 'memory'),
          ECC_MEMORY_USER_ROOT: path.join(homeDir, '.ecc', 'memory'),
          ECC_MEMORY_HARNESS: 'claude',
          ECC_MEMORY_ALLOW_USER_SCOPE: '0',
          ...extraEnv,
        }).filter(([, value]) => typeof value === 'string')
      ),
    };
  } catch (error) {
    try { fs.rmSync(root, { recursive: true, force: true }); }
    catch {
      const failure = new Error('MCP fixture cleanup failed', { cause: error });
      failure.mcpCleanupFailure = 'fixture_removal_error';
      throw failure;
    }
    throw error;
  }
}

function parseTextResult(result) {
  const text = result.content?.find(item => item.type === 'text')?.text;
  assert.ok(text, 'MCP result should contain text');
  return JSON.parse(text);
}

async function withClient(fn, options = {}) {
  const started = Date.now();
  const pending = new Map();
  const mode = options.env?.ECC_MEMORY_ALLOW_USER_SCOPE === '1' ? 'allow' : 'deny';
  let fixture;
  let child;
  let phase = 'setup';
  let nextId = 1;
  let stdout = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let closed = false;
  let tearingDown = false;
  let transportError;
  let primaryError;
  let primaryFailed = false;
  let failureKind;
  let failureElapsedMs;
  let teardownStarted;
  let failurePhase;
  let cleanupFailure;
  let killStatus = 'not_attempted';
  let notifyClose;
  const closePromise = new Promise(resolve => { notifyClose = resolve; });
  let rejectTransport;
  const transportFailure = new Promise((_, reject) => { rejectTransport = reject; });
  // The child may fail before the initialize or callback race is installed.
  transportFailure.catch(() => {});

  const bounded = value => Math.min(2147483647, Math.max(0, Math.trunc(value)));
  const safeCode = error => [
    'EPIPE', 'ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'ECONNRESET',
    'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_ASSERTION',
  ].includes(error?.code) ? error.code : null;
  const diagnostic = () => ({
    phase: failurePhase || phase,
    mode,
    reason: failureKind || cleanupFailure || 'assertion_or_callback',
    failureElapsedMs: failureElapsedMs ?? null,
    teardownElapsedMs: bounded(Date.now() - teardownStarted),
    elapsedMs: bounded(Date.now() - started),
    stdoutBytes,
    stderrBytes,
    pendingRequests: pending.size,
    childStarted: Boolean(child?.pid),
    childClosed: closed,
    exitCode: Number.isInteger(child?.exitCode) ? child.exitCode : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(child?.signalCode) ? child.signalCode : null,
    errorCode: safeCode(primaryError),
    cleanupFailure: cleanupFailure || null,
    killStatus,
  });
  function settleAll(error) {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }
  function fail(kind, cause) {
    if (tearingDown) {
      cleanupFailure ||= kind;
      return;
    }
    if (transportError) return;
    transportError = new Error(`MCP test client ${kind}`);
    if (safeCode(cause)) transportError.code = safeCode(cause);
    failurePhase = phase;
    failureKind = kind;
    settleAll(transportError);
    rejectTransport(transportError);
  }
  function send(message) {
    if (transportError) throw transportError;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`, error => {
        if (error) fail('stdin_write_error', error);
      });
    } catch (error) {
      fail('stdin_write_error', error);
      throw transportError;
    }
  }
  function request(method, params = {}) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      if (transportError || tearingDown || closed) {
        reject(transportError || new Error('MCP test client is closed'));
        return;
      }
      const timer = setTimeout(() => {
        fail('request_timeout');
      }, 5000);
      function settle(fn, value) {
        clearTimeout(timer);
        pending.delete(id);
        fn(value);
      }
      pending.set(id, {
        resolve: value => settle(resolve, value),
        reject: error => settle(reject, error),
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
    // Teardown rejects abandoned requests too, without an unhandled rejection.
    promise.catch(() => {});
    return promise;
  }

  try {
    fixture = createFixture(options.env);
    phase = 'spawn';
    child = spawn(process.execPath, [options.server || SERVER], {
      cwd: fixture.projectRoot,
      env: fixture.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', error => fail('child_error', error));
    child.on('exit', () => {
      if (!tearingDown) fail('child_exit');
    });
    child.once('close', () => {
      closed = true;
      notifyClose();
      if (!tearingDown) fail('child_close');
    });
    for (const stream of ['stdin', 'stdout', 'stderr']) {
      child[stream].on('error', error => fail(`${stream}_error`, error));
    }
    child.stdout.on('end', () => { if (!tearingDown) fail('stdout_end'); });
    for (const stream of ['stdin', 'stdout']) {
      child[stream].on('close', () => { if (!tearingDown) fail(`${stream}_close`); });
    }
    child.stderr.on('data', chunk => {
      stderrBytes = bounded(stderrBytes + chunk.length);
    });
    child.stdout.on('data', chunk => {
      stdoutBytes = bounded(stdoutBytes + chunk.length);
      if (transportError || tearingDown) return;
      // Decode complete lines, so a UTF-8 character split across chunks survives.
      stdout = Buffer.concat([stdout, chunk]);
      let newlineIndex;
      while ((newlineIndex = stdout.indexOf(10)) >= 0) {
        if (newlineIndex > 1024 * 1024) { fail('oversized_frame'); return; }
        const line = stdout.subarray(0, newlineIndex).toString('utf8');
        stdout = stdout.subarray(newlineIndex + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
          if (!message || message.jsonrpc !== '2.0' || !Number.isInteger(message.id)
            || (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))
            || (Object.hasOwn(message, 'error') && (!message.error
              || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string'))) {
            fail('invalid_frame');
            return;
          }
        } catch {
          fail('malformed_frame');
          return;
        }
        const waiter = pending.get(message.id);
        if (waiter) {
          if (message.error) {
            // Existing authorization/protocol assertions inspect this RPC error.
            // The test logger emits only mcpDiagnostic when it escapes the helper.
            waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
          } else {
            waiter.resolve(message.result);
          }
        }
      }
      if (stdout.length > 1024 * 1024) fail('oversized_frame');
    });

    phase = 'initialize';
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'ecc-memory-test', version: '1.0.0' },
    });
    phase = 'protocol';
    assert.strictEqual(initialized.protocolVersion, '2025-11-25');
    phase = 'notification';
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const client = {
      listTools: () => request('tools/list'),
      listToolsRaw: params => request('tools/list', params),
      callTool: ({ name, arguments: toolArguments }) => request(
        'tools/call',
        { name, arguments: toolArguments }
      ),
      callToolRaw: params => request('tools/call', params),
      ping: params => request('ping', params),
    };
    phase = 'callback';
    await Promise.race([Promise.resolve().then(() => fn(client, fixture)), transportFailure]);
    if (transportError) throw transportError;
    assert.strictEqual(pending.size, 0, 'MCP callback must await its requests');
  } catch (error) {
    primaryError = error;
    primaryFailed = true;
    failurePhase ||= phase;
    failureElapsedMs = bounded(Date.now() - started);
    if (error?.mcpCleanupFailure === 'fixture_removal_error') {
      cleanupFailure ||= 'fixture_removal_error';
    }
  } finally {
    tearingDown = true;
    teardownStarted = Date.now();
    phase = 'teardown';
    settleAll(new Error('MCP test client is closing'));
    stdout = Buffer.alloc(0);
    if (child && !closed) {
      // Keep the original total 2000 ms budget. Reserve its latter half for
      // direct-child termination and stdio close, including on Windows.
      let killTimer;
      let deadlineTimer;
      function terminate() {
        try { killStatus = child.kill() ? 'requested' : 'not_sent'; }
        catch { killStatus = 'error'; }
      }
      const deadline = new Promise(resolve => {
        deadlineTimer = setTimeout(resolve, 2000);
        killTimer = setTimeout(terminate, 1000);
      });
      try {
        try { child.stdin.end(); }
        catch {
          cleanupFailure ||= 'stdin_end_error';
          clearTimeout(killTimer);
          terminate();
        }
        await Promise.race([closePromise, deadline]);
      } finally {
        clearTimeout(killTimer);
        clearTimeout(deadlineTimer);
      }
      if (!closed) cleanupFailure ||= 'child_close_timeout';
    }
    if (fixture && (!child || closed)) {
      try { fs.rmSync(fixture.root, { recursive: true, force: true }); }
      catch { cleanupFailure ||= 'fixture_removal_error'; }
    }
  }
  if (primaryFailed || cleanupFailure) {
    if (!primaryFailed) primaryError = new Error('MCP test client cleanup failed');
    // Keep the primary assertion/RPC/callback error; cleanup must not replace it.
    // A wrapper retains non-extensible or non-Error thrown values as its cause.
    if (!primaryError || typeof primaryError !== 'object' || !Object.isExtensible(primaryError)
      || Object.getOwnPropertyDescriptor(primaryError, 'mcpDiagnostic')?.configurable === false
      || Object.getOwnPropertyDescriptor(primaryError, 'mcpCleanupFailure')?.configurable === false) {
      primaryError = new Error('MCP test client failed', { cause: primaryError });
    }
    Object.defineProperty(primaryError, 'mcpDiagnostic', { value: diagnostic(), configurable: true });
    if (cleanupFailure) {
      Object.defineProperty(primaryError, 'mcpCleanupFailure', { value: cleanupFailure, configurable: true });
    }
    throw primaryError;
  }
}

async function main() {
  console.log('\n=== Testing ECC memory MCP server ===\n');

  await test('registers the bounded read/write/search/doctor tool surface', async () => {
    await withClient(async client => {
      const tools = await client.listTools();
      assert.deepStrictEqual(
        tools.tools.map(tool => tool.name).sort(),
        ['memory_doctor', 'memory_read', 'memory_save', 'memory_search']
      );
      const save = tools.tools.find(tool => tool.name === 'memory_save');
      const search = tools.tools.find(tool => tool.name === 'memory_search');
      assert.ok(save.description.includes('unreviewed'));
      assert.ok(!JSON.stringify(save.inputSchema).includes('trust'));
      assert.ok(!JSON.stringify(save.inputSchema).includes('sourceHarness'));
      assert.ok(!JSON.stringify(search.inputSchema).includes('targetHarness'));
      assert.strictEqual(save.inputSchema.properties.body.minLength, 1);
    });
  });

  await test('accepts reserved tools/list params and rejects malformed values', async () => {
    await withClient(async client => {
      const withMeta = await client.listToolsRaw({
        _meta: { progressToken: 'progress-123' },
      });
      assert.strictEqual(withMeta.tools.length, 4);

      const withCursor = await client.listToolsRaw({ cursor: 'next-page' });
      assert.strictEqual(withCursor.tools.length, 4);

      const withCursorAndMeta = await client.listToolsRaw({
        cursor: 'next-page',
        _meta: { progressToken: 'progress-456' },
      });
      assert.strictEqual(withCursorAndMeta.tools.length, 4);

      const withoutMeta = await client.listTools();
      assert.deepStrictEqual(
        withoutMeta.tools.map(tool => tool.name).sort(),
        ['memory_doctor', 'memory_read', 'memory_save', 'memory_search']
      );

      for (const badMeta of [null, ['not', 'an', 'object'], 'string', 42, true]) {
        await assert.rejects(
          client.listToolsRaw({ _meta: badMeta }),
          /-32602/,
          `expected _meta=${JSON.stringify(badMeta)} to be rejected`
        );
      }

      for (const badCursor of [null, {}, [], 42, true]) {
        await assert.rejects(
          client.listToolsRaw({ cursor: badCursor }),
          /-32602/,
          `expected cursor=${JSON.stringify(badCursor)} to be rejected`
        );
      }

      await assert.rejects(
        client.listToolsRaw({ unexpected: true }),
        /-32602/
      );
    });
  });

  await test('accepts the reserved _meta param on ping and rejects malformed values (#2810)', async () => {
    await withClient(async client => {
      assert.deepStrictEqual(await client.ping({ _meta: { progressToken: 'progress-1' } }), {});
      assert.deepStrictEqual(await client.ping(), {});
      assert.deepStrictEqual(await client.ping({}), {});

      for (const badMeta of [null, ['not', 'an', 'object'], 'string', 42, true]) {
        await assert.rejects(
          client.ping({ _meta: badMeta }),
          /-32602/,
          `expected ping _meta=${JSON.stringify(badMeta)} to be rejected`
        );
      }

      await assert.rejects(client.ping({ unexpected: true }), /-32602/);
      await assert.rejects(client.ping({ _meta: {}, unexpected: true }), /-32602/);
    });
  });

  await test('accepts the reserved _meta param on tools/call and rejects malformed values', async () => {
    await withClient(async client => {
      // A valid `_meta` object (e.g. progressToken) must not block the tool call.
      const withMeta = await client.callToolRaw({
        name: 'memory_doctor',
        arguments: {},
        _meta: { progressToken: 'progress-123' },
      });
      assert.ok(Array.isArray(withMeta.content));

      // Baseline: no `_meta` still works.
      const withoutMeta = await client.callToolRaw({
        name: 'memory_doctor',
        arguments: {},
      });
      assert.ok(Array.isArray(withoutMeta.content));

      // A malformed `_meta` (null, array, or scalar) must be rejected.
      for (const badMeta of [null, ['not', 'an', 'object'], 'string', 42, true]) {
        await assert.rejects(
          client.callToolRaw({ name: 'memory_doctor', arguments: {}, _meta: badMeta }),
          /-32602/,
          `expected _meta=${JSON.stringify(badMeta)} to be rejected`
        );
      }

      // Unrelated top-level params must still be rejected.
      await assert.rejects(
        client.callToolRaw({ name: 'memory_doctor', arguments: {}, unexpected: true }),
        /-32602/
      );
    });
  });

  await test('starts when the npm bin invokes the server through a symlink', async () => {
    const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-bin-'));
    const binPath = path.join(binRoot, 'ecc-memory-mcp');
    fs.symlinkSync(SERVER, binPath);
    try {
      await withClient(async client => {
        const tools = await client.listTools();
        assert.strictEqual(tools.tools.length, 4);
      }, { server: binPath });
    } finally {
      fs.rmSync(binRoot, { recursive: true, force: true });
    }
  });

  await test('rejects an oversized partial line and recovers at the next message boundary', async () => {
    const {
      MAX_MESSAGE_BYTES,
      runStdioServer,
    } = await import(pathToFileURL(SERVER).href);
    const input = new PassThrough();
    const output = new PassThrough();
    let rawOutput = '';
    output.on('data', chunk => {
      rawOutput += chunk.toString('utf8');
    });
    runStdioServer({
      input,
      output,
      serviceOptions: { harness: 'claude' },
    });

    input.write(Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x78));
    input.write(`\n${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'bounded-test', version: '1.0.0' },
      },
    })}\n`);
    input.end();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for bounded output.')), 3000);
      const poll = () => {
        if (rawOutput.trim().split('\n').length >= 2) {
          clearTimeout(timeout);
          resolve();
        } else {
          setImmediate(poll);
        }
      };
      poll();
    });

    const messages = rawOutput.trim().split('\n').map(line => JSON.parse(line));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].error.code, -32700);
    assert.strictEqual(messages[1].result.protocolVersion, '2025-11-25');
  });

  await test('shares a saved handoff through MCP search and read', async () => {
    await withClient(async client => {
      const savedResult = await client.callTool({
        name: 'memory_save',
        arguments: {
          title: 'Codex to Claude handoff',
          body: 'The migration is green; review the rollout note.',
          kind: 'handoff',
          scope: 'project',
          targetHarnesses: ['claude'],
          tags: ['migration'],
        },
      });
      assert.strictEqual(savedResult.isError, undefined);
      const saved = parseTextResult(savedResult);
      assert.strictEqual(saved.memory.trust, 'unreviewed');
      assert.strictEqual(saved.memory.sourceHarness, 'claude');
      assert.strictEqual(Object.hasOwn(saved.memory, 'body'), false);

      const searchResult = await client.callTool({
        name: 'memory_search',
        arguments: {
          query: 'migration rollout',
          limit: 5,
        },
      });
      const search = parseTextResult(searchResult);
      assert.strictEqual(search.results.length, 1);
      assert.strictEqual(search.results[0].memory.id, saved.memory.id);

      const readResult = await client.callTool({
        name: 'memory_read',
        arguments: { id: saved.memory.id },
      });
      const read = parseTextResult(readResult);
      assert.strictEqual(read.memory.body, 'The migration is green; review the rollout note.');

      const doctorResult = await client.callTool({
        name: 'memory_doctor',
        arguments: {},
      });
      const doctor = parseTextResult(doctorResult);
      assert.strictEqual(doctor.ok, true);
      assert.strictEqual(doctor.memoryCount, 1);
    });
  });

  await test('rejects caller identity spoofing and hides other-harness memories', async () => {
    await withClient(async client => {
      await assert.rejects(
        () => client.callTool({
          name: 'memory_save',
          arguments: {
            title: 'Spoofed source',
            body: 'This must not be accepted.',
            sourceHarness: 'hermes',
          },
        }),
        /-32602/
      );
      await assert.rejects(
        () => client.callTool({
          name: 'memory_search',
          arguments: {
            query: '',
            targetHarness: 'hermes',
          },
        }),
        /-32602/
      );

      const savedResult = await client.callTool({
        name: 'memory_save',
        arguments: {
          title: 'Hermes-only handoff',
          body: 'Only Hermes should receive this context.',
          kind: 'handoff',
          targetHarnesses: ['hermes'],
        },
      });
      const saved = parseTextResult(savedResult);
      assert.strictEqual(saved.memory.sourceHarness, 'claude');

      const searchResult = await client.callTool({
        name: 'memory_search',
        arguments: { query: 'Hermes-only' },
      });
      assert.strictEqual(parseTextResult(searchResult).results.length, 0);

      const readResult = await client.callTool({
        name: 'memory_read',
        arguments: { id: saved.memory.id },
      });
      assert.strictEqual(readResult.isError, true);
      assert.strictEqual(parseTextResult(readResult).error.code, 'MEMORY_READ_FAILED');

      const doctor = parseTextResult(await client.callTool({
        name: 'memory_doctor',
        arguments: {},
      }));
      assert.strictEqual(doctor.memoryCount, 0);
      assert.strictEqual(Object.hasOwn(doctor, 'brokenLinks'), false);
      assert.strictEqual(Object.hasOwn(doctor, 'invalidFiles'), false);
      assert.strictEqual(JSON.stringify(doctor).includes(saved.memory.id), false);
    });
  });

  await test('filters harness-visible backlinks before applying the response cap', async () => {
    await withClient(async (client, fixture) => {
      const roots = resolveVaultRoots({
        cwd: fixture.projectRoot,
        env: fixture.env,
      });
      const saveWithId = (input, id) => saveMemory(input, {
        roots,
        now: () => '2026-07-26T20:00:00.000Z',
        idFactory: () => id,
      });
      const targetId = 'mem_backlink_target';
      saveWithId({
        title: 'Backlink target',
        body: 'Visible target body.',
        targetHarnesses: ['claude'],
      }, targetId);

      for (let index = 0; index < MAX_RESULTS; index += 1) {
        saveWithId({
          title: `Hidden backlink ${index}`,
          body: 'Only Hermes may see this backlink.',
          targetHarnesses: ['hermes'],
          links: [targetId],
        }, `mem_backlink_hidden_${String(index).padStart(3, '0')}`);
      }
      saveWithId({
        title: 'Visible backlink',
        body: 'Claude must still receive this backlink.',
        targetHarnesses: ['claude'],
        links: [targetId],
      }, 'mem_backlink_visible_zzz');

      const read = parseTextResult(await client.callTool({
        name: 'memory_read',
        arguments: { id: targetId },
      }));
      assert.deepStrictEqual(
        read.backlinks.map(memory => memory.id),
        ['mem_backlink_visible_zzz']
      );
      assert.strictEqual(read.backlinksTruncated, false);
    });
  });

  await test('denies user scope unless the server explicitly grants it', async () => {
    await withClient(async client => {
      await assert.rejects(
        () => client.callTool({
          name: 'memory_save',
          arguments: {
            title: 'Private preference',
            body: 'Keep this in the user vault.',
            scope: 'user',
          },
        }),
        /user memory scope is disabled/
      );
      await assert.rejects(
        () => client.callTool({
          name: 'memory_search',
          arguments: { scopes: ['user'] },
        }),
        /user memory scope is disabled/
      );
      await assert.rejects(
        () => client.callTool({
          name: 'memory_read',
          arguments: {
            id: 'mem_20260726_user_scope_denied',
            scope: 'user',
          },
        }),
        /user memory scope is disabled/
      );
    });

    await withClient(async client => {
      const savedResult = await client.callTool({
        name: 'memory_save',
        arguments: {
          title: 'Private preference',
          body: 'Keep this in the user vault.',
          scope: 'user',
        },
      });
      const saved = parseTextResult(savedResult);
      assert.strictEqual(saved.memory.scope, 'user');

      const defaultSearch = parseTextResult(await client.callTool({
        name: 'memory_search',
        arguments: { query: 'Private preference' },
      }));
      assert.strictEqual(defaultSearch.results.length, 0);

      const userSearch = parseTextResult(await client.callTool({
        name: 'memory_search',
        arguments: {
          query: 'Private preference',
          scopes: ['user'],
        },
      }));
      assert.strictEqual(userSearch.results[0].memory.id, saved.memory.id);

      const userRead = parseTextResult(await client.callTool({
        name: 'memory_read',
        arguments: {
          id: saved.memory.id,
          scope: 'user',
        },
      }));
      assert.strictEqual(userRead.memory.id, saved.memory.id);
    }, { env: { ECC_MEMORY_ALLOW_USER_SCOPE: '1' } });
  });

  await test('requires server identity and strictly validates JSON-RPC envelopes', async () => {
    const { createMemoryMcpService } = await import(pathToFileURL(SERVER).href);
    assert.throws(
      () => createMemoryMcpService({ env: {} }),
      /ECC_MEMORY_HARNESS/
    );

    const fixture = createFixture({ ECC_MEMORY_HARNESS: undefined });
    try {
      const started = spawnSync(process.execPath, [SERVER], {
        cwd: fixture.projectRoot,
        env: fixture.env,
        encoding: 'utf8',
      });
      assert.strictEqual(started.error, undefined);
      assert.strictEqual(started.status, 1);
      assert.match(started.stderr, /ECC_MEMORY_HARNESS/);
      assert.ok(!started.stderr.includes('\n    at '));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }

    const service = createMemoryMcpService({ harness: 'claude' });
    for (const id of [null, false, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1, '']) {
      const response = await service.handle({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {},
      });
      assert.strictEqual(response.id, null);
      assert.strictEqual(response.error.code, -32600);
    }

    const initialized = await service.handle({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'strict-test', version: '1.0.0' },
      },
    });
    assert.strictEqual(initialized.id, 0);
    await service.handle({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });

    for (const toolArguments of [null, false, 0, '', []]) {
      const response = await service.handle({
        jsonrpc: '2.0',
        id: `args-${String(toolArguments)}`,
        method: 'tools/call',
        params: {
          name: 'memory_doctor',
          arguments: toolArguments,
        },
      });
      assert.strictEqual(response.error.code, -32602);
    }
    const invalidParams = await service.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: [],
    });
    assert.strictEqual(invalidParams.error.code, -32600);
  });

  await test('bounds queued transport work under a single-chunk request flood', async () => {
    const {
      MAX_PENDING_MESSAGES,
      runStdioServer,
    } = await import(pathToFileURL(SERVER).href);
    const input = new PassThrough();
    const output = new PassThrough();
    let rawOutput = '';
    output.on('data', chunk => {
      rawOutput += chunk.toString('utf8');
    });
    runStdioServer({
      input,
      output,
      serviceOptions: { harness: 'claude' },
    });

    const requests = [
      {
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'flood-test', version: '1.0.0' },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      },
      ...Array.from({ length: MAX_PENDING_MESSAGES * 4 }, (_, index) => ({
        jsonrpc: '2.0',
        id: `ping-${index}`,
        method: 'ping',
        params: {},
      })),
    ];
    input.end(`${requests.map(JSON.stringify).join('\n')}\n`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for queue-limit response.')),
        3000
      );
      const poll = () => {
        if (rawOutput.includes('queue limit exceeded')) {
          clearTimeout(timeout);
          resolve();
        } else {
          setImmediate(poll);
        }
      };
      poll();
    });

    const messages = rawOutput.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(messages.some(message => message.error?.code === -32000));
    assert.ok(messages.length <= MAX_PENDING_MESSAGES + 2);
  });

  await test('bounds serialized tool responses before writing to stdout', async () => {
    const {
      MAX_RESPONSE_BYTES,
      textResult,
    } = await import(pathToFileURL(SERVER).href);
    assert.throws(
      () => textResult({ body: 'x'.repeat(MAX_RESPONSE_BYTES + 1) }),
      /bounded output limit/
    );
  });

  await test('returns a structured tool error without a stack trace for secret-bearing writes', async () => {
    await withClient(async client => {
      await assert.rejects(
        () => client.callTool({
          name: 'memory_save',
          arguments: {
            title: 'Empty body',
            body: '',
          },
        }),
        /-32602/
      );
      const secret = `ghp_${'A1'.repeat(12)}`;
      const result = await client.callTool({
        name: 'memory_save',
        arguments: {
          title: 'Do not persist this',
          body: `credential ${secret}`,
        },
      });
      assert.strictEqual(result.isError, true);
      const error = parseTextResult(result);
      assert.strictEqual(error.error.code, 'MEMORY_WRITE_REJECTED');
      assert.ok(error.error.message.includes('suspected secret'));
      assert.ok(!JSON.stringify(error).includes(secret));
      assert.ok(!JSON.stringify(error).includes('\n    at '));
    });
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
