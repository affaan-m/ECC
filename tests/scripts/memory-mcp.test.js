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
    console.log(`    ${error.stack || error.message}`);
    failed += 1;
  }
}

function createFixture(extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-mcp-'));
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
        ...extraEnv,
      }).filter(([, value]) => typeof value === 'string')
    ),
  };
}

function parseTextResult(result) {
  const text = result.content?.find(item => item.type === 'text')?.text;
  assert.ok(text, 'MCP result should contain text');
  return JSON.parse(text);
}

async function withClient(fn, options = {}) {
  const fixture = createFixture(options.env);
  const child = spawn(process.execPath, [options.server || SERVER], {
    cwd: fixture.projectRoot,
    env: fixture.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    let newlineIndex = stdout.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdout.slice(0, newlineIndex);
      stdout = stdout.slice(newlineIndex + 1);
      if (line.trim()) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) {
            waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
          } else {
            waiter.resolve(message.result);
          }
        }
      }
      newlineIndex = stdout.indexOf('\n');
    }
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr}`));
      }, 5000);
      pending.set(id, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'ecc-memory-test', version: '1.0.0' },
  });
  assert.strictEqual(initialized.protocolVersion, '2025-11-25');
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

  const client = {
    listTools: () => request('tools/list'),
    callTool: ({ name, arguments: toolArguments }) => request(
      'tools/call',
      { name, arguments: toolArguments }
    ),
    callToolRaw: params => request('tools/call', params),
  };

  try {
    await fn(client, fixture);
  } finally {
    child.stdin.end();
    await new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    fs.rmSync(fixture.root, { recursive: true, force: true });
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
