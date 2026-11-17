'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { redactArgs, normalizeServerEntry } = require('../../scripts/lib/mcp-inventory/canonical-mcp');
const { collectMcpInventory } = require('../../scripts/lib/mcp-inventory/collect');

const SECRET = 'synthetic/credential value';

test('credential flag names redact values without relying on a provider token shape', () => {
  for (const flag of [
    '--modelApiKey', '--modelAPIKey', '--clientSecret', '--accessToken',
    '--databasePassword', '--privateKey', '--APIKey', '--MODEL_API_KEY',
    '--model-api-key', '--model_api_key', '-accessToken',
  ]) {
    const separate = Object.freeze([flag, SECRET, '--modelName', 'example-model']);
    assert.deepStrictEqual(redactArgs(separate), [flag, '***', '--modelName', 'example-model'], flag);
    assert.deepStrictEqual(redactArgs([`${flag}=${SECRET}`]), [`${flag}=***`], flag);
    assert.strictEqual(separate[1], SECRET, 'the caller argument vector must not be mutated');
  }
});

test('authorization flags redact the complete value including its scheme', () => {
  for (const flag of ['--authorization', '--proxyAuthorization', '--proxy-authorization']) {
    assert.deepStrictEqual(redactArgs([flag, `Bearer ${SECRET}`]), [flag, '***']);
    assert.deepStrictEqual(redactArgs([`${flag}=Basic ${SECRET}`]), [`${flag}=***`]);
  }
});

test('inline credential values are redacted across line breaks', () => {
  for (const flag of ['--api-key', '--modelApiKey', '--authorization']) {
    for (const value of ['first\nsecond', 'first\r\nsecond', '\n']) {
      assert.deepStrictEqual(redactArgs([`${flag}=${value}`, '--mode=local']), [`${flag}=***`, '--mode=local']);
    }
  }
});

test('noncredential flag names, empty values, and incomplete arguments retain their meaning', () => {
  const safe = [
    '--tokenizer', 'example', '--maxTokens', '4096', '--tokenCount=12',
    '--passwordFile', './credentials.txt', '--author', 'example',
    '--keyboard=default', '--publicKey=public-data', '--privateKeyFile=key.pem',
    '--authType=oauth', '--modelApiKey=', '--modelApiKey',
  ];
  assert.deepStrictEqual(redactArgs(safe), safe);
  assert.deepStrictEqual(redactArgs([null, 42, '--modelName', 'example-model']), ['--modelName', 'example-model']);
  assert.deepStrictEqual(redactArgs(null), []);
});

test('long uppercase flag names retain bounded processing and credential boundaries', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { redactArgs } = require(process.argv[1]);
    const prefix = 'A'.repeat(128000);
    const safe = ['--' + prefix, 'example'];
    assert.deepStrictEqual(redactArgs(safe), safe);
    const flag = '--' + prefix + 'ApiKey';
    assert.deepStrictEqual(redactArgs([flag, 'synthetic/value']), [flag, '***']);
    assert.deepStrictEqual(redactArgs([flag + '=synthetic/value']), [flag + '=***']);
  `;
  const result = spawnSync(process.execPath, [
    '-e', script, path.join(__dirname, '..', '..', 'scripts', 'lib', 'mcp-inventory', 'canonical-mcp.js'),
  ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
});

test('normalized records flag credentials and keep them out of args and signatures', () => {
  for (const args of [['--modelApiKey', SECRET], [`--clientSecret=${SECRET}`], ['--authorization', `Bearer ${SECRET}`]]) {
    const record = normalizeServerEntry({ name: 'example', command: 'node', args, source: { harness: 'test' } });
    assert.strictEqual(record.hasSecrets, true);
    assert.ok(!JSON.stringify(record).includes(SECRET));
    assert.ok(record.signature.includes('***'));
    assert.strictEqual(record.command, 'node');
  }
});

test('real harness configs and both inventory CLI formats omit argument credentials', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-credential-flags-'));
  const configRoot = path.join(home, '.config', 'opencode');
  const cli = path.join(__dirname, '..', '..', 'scripts', 'mcp-inventory.js');
  try {
    fs.mkdirSync(configRoot, { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
      mcpServers: { claudeExample: { command: 'node', args: ['server.js', '--modelApiKey', SECRET] } },
    }));
    fs.writeFileSync(path.join(configRoot, 'opencode.json'), JSON.stringify({
      mcp: { opencodeExample: { type: 'local', command: ['node', 'server.js', `--clientSecret=${SECRET}`] } },
    }));
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), [
      '[mcp_servers.codexExample]',
      'command = "node"',
      `args = ${JSON.stringify(['server.js', '--authorization', `Bearer ${SECRET}`])}`,
    ].join('\n'));

    const inventory = collectMcpInventory({ readerOptions: { shared: { homeDir: home } } });
    assert.strictEqual(inventory.aggregates.serverCount, 3);

    for (const args of [[], ['--json']]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: home, encoding: 'utf8', timeout: 10000, windowsHide: true,
        env: {
          ...process.env, HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, '.config'), OPENCODE_CONFIG_DIR: configRoot,
        },
      });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes(SECRET));
      assert.ok(result.stdout.includes('--modelApiKey'));
      assert.ok(result.stdout.includes('***'));
      if (args.length) {
        const output = JSON.parse(result.stdout);
        assert.strictEqual(output.aggregates.serversWithSecrets, 3);
      } else {
        assert.match(result.stdout, /3 carry secrets/);
      }
    }
    assert.strictEqual(inventory.aggregates.serversWithSecrets, 3);
    assert.ok(!JSON.stringify(inventory).includes(SECRET));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
