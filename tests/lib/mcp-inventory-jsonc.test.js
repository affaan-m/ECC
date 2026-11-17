'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readOpencodeMcp } = require('../../scripts/lib/mcp-inventory/readers/opencode');
const { collectMcpInventory } = require('../../scripts/lib/mcp-inventory/collect');
const { parseJsoncConfig } = require('../../scripts/lib/install/hook-consent');

let passed = 0;
let failed = 0;

function test(name, callback) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-jsonc-'));
  try {
    callback(home);
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${error.stack}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeConfig(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function configFor(name) {
  return JSON.stringify({ mcp: { [name]: { type: 'local', command: ['node', name] } } });
}

const JSONC_CONFIG = `{
  // Local and remote servers share the same user configuration.
  "mcp": {
    "local": {
      "type": "local",
      "command": ["node", "worker.js", "--token", "synthetic-argument-secret",],
      "environment": {"API_TOKEN": "synthetic-environment-secret", "DEBUG": "1",},
      "enabled": false,
    },
    "remote": {
      "type": "remote",
      "url": "https://example.test/api//v1?path=/*literal*/&token=synthetic-url-secret",
    }, /* block comment before the trailing comma is removed */
  },
}`;

test('discovers opencode.jsonc and preserves server fields and comment-like string contents', home => {
  const configPath = writeConfig(path.join(home, '.config', 'opencode', 'opencode.jsonc'), JSONC_CONFIG);
  const records = readOpencodeMcp({ homeDir: home });
  assert.deepStrictEqual(records.map(record => record.name), ['local', 'remote']);
  assert.deepStrictEqual(records[0].args, ['worker.js', '--token', 'synthetic-argument-secret']);
  assert.deepStrictEqual(records[0].env, { API_TOKEN: 'synthetic-environment-secret', DEBUG: '1' });
  assert.strictEqual(records[0].enabled, false);
  assert.strictEqual(records[1].url, 'https://example.test/api//v1?path=/*literal*/&token=synthetic-url-secret');
  assert.ok(records.every(record => record.source.configPath === configPath));
});

test('accepts JSONC in existing .json filenames with LF, CRLF, and CR comments', home => {
  const configPath = path.join(home, '.config', 'opencode', 'opencode.json');
  for (const newline of ['\n', '\r\n', '\r']) {
    writeConfig(configPath, JSONC_CONFIG.replaceAll('\n', newline));
    assert.deepStrictEqual(readOpencodeMcp({ homeDir: home }).map(record => record.name), ['local', 'remote']);
  }
});

test('prefers opencode.jsonc without merging lower-priority files', home => {
  const root = path.join(home, '.config', 'opencode');
  writeConfig(path.join(root, 'opencode.json'), configFor('json'));
  writeConfig(path.join(root, 'config.json'), configFor('legacy'));
  writeConfig(path.join(home, '.opencode.json'), configFor('home'));
  const configPath = writeConfig(path.join(root, 'opencode.jsonc'), configFor('jsonc'));
  const records = readOpencodeMcp({ homeDir: home });
  assert.deepStrictEqual(records.map(record => record.name), ['jsonc']);
  assert.strictEqual(records[0].source.configPath, configPath);
});

test('discovers JSONC through explicit and XDG configuration roots', home => {
  const explicitRoot = path.join(home, 'explicit');
  const xdgRoot = path.join(home, 'xdg');
  writeConfig(path.join(explicitRoot, 'opencode.jsonc'), configFor('explicit'));
  writeConfig(path.join(xdgRoot, 'opencode', 'opencode.jsonc'), configFor('xdg'));
  const explicit = readOpencodeMcp({
    homeDir: home,
    env: { OPENCODE_CONFIG_DIR: explicitRoot, XDG_CONFIG_HOME: xdgRoot },
  });
  const xdg = readOpencodeMcp({ homeDir: home, env: { XDG_CONFIG_HOME: xdgRoot } });
  assert.deepStrictEqual(explicit.map(record => record.name), ['explicit']);
  assert.deepStrictEqual(xdg.map(record => record.name), ['xdg']);
});

test('an explicit configPath parses JSONC and overrides discovered filenames', home => {
  writeConfig(path.join(home, '.config', 'opencode', 'opencode.jsonc'), configFor('default'));
  const configPath = writeConfig(path.join(home, 'selected.config'), JSONC_CONFIG);
  const records = readOpencodeMcp({ homeDir: home, configPath });
  assert.deepStrictEqual(records.map(record => record.name), ['local', 'remote']);
  assert.ok(records.every(record => record.source.configPath === configPath));
});

test('an explicit home still isolates JSONC discovery from ambient overrides', home => {
  const ambientRoot = path.join(home, 'ambient');
  writeConfig(path.join(ambientRoot, 'opencode.jsonc'), configFor('ambient'));
  writeConfig(path.join(home, '.config', 'opencode', 'opencode.jsonc'), configFor('isolated'));
  const readerPath = require.resolve('../../scripts/lib/mcp-inventory/readers/opencode');
  const child = spawnSync(process.execPath, ['-e', [
    'const { readOpencodeMcp } = require(process.env.ECC_TEST_READER);',
    'process.stdout.write(JSON.stringify(readOpencodeMcp({ homeDir: process.env.ECC_TEST_HOME })));',
  ].join('\n')], {
    encoding: 'utf8',
    env: { ...process.env, ECC_TEST_READER: readerPath, ECC_TEST_HOME: home, OPENCODE_CONFIG_DIR: ambientRoot },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.deepStrictEqual(JSON.parse(child.stdout).map(record => record.name), ['isolated']);
});

function assertInventory(inventory, configPath) {
  assert.strictEqual(inventory.aggregates.serverCount, 2);
  const local = inventory.servers.find(server => server.name === 'local');
  const remote = inventory.servers.find(server => server.name === 'remote');
  assert.strictEqual(local.transport, 'stdio');
  assert.strictEqual(local.enabled, false);
  assert.deepStrictEqual(local.envKeys, ['API_TOKEN', 'DEBUG']);
  assert.deepStrictEqual(local.args, ['worker.js', '--token', '***']);
  assert.strictEqual(remote.url, 'https://example.test/api//v1?path=/*literal*/&token=***');
  assert.strictEqual(remote.transport, 'http');
  assert.ok(inventory.servers.every(server => server.sources[0].configPath === configPath));
  assert.ok(!JSON.stringify(inventory).includes('synthetic-'), 'credential values must not reach the inventory');
}

test('collectMcpInventory includes JSONC servers without exposing credential values', home => {
  const configPath = writeConfig(path.join(home, '.config', 'opencode', 'opencode.jsonc'), JSONC_CONFIG);
  const inventory = collectMcpInventory({ readerOptions: { shared: { homeDir: home } } });
  assertInventory(inventory, configPath);
});

test('the real inventory CLI reports JSONC servers with the existing secret stripping', home => {
  const configRoot = path.join(home, 'opencode');
  const configPath = writeConfig(path.join(configRoot, 'opencode.jsonc'), JSONC_CONFIG);
  const child = spawnSync(process.execPath, [require.resolve('../../scripts/mcp-inventory'), '--json'], {
    cwd: home,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, OPENCODE_CONFIG_DIR: configRoot },
  });
  assert.strictEqual(child.status, 0, child.stderr);
  assertInventory(JSON.parse(child.stdout), configPath);
});

test('strict JSON discovery keeps the existing relative priority and fallbacks', home => {
  const root = path.join(home, '.config', 'opencode');
  const candidates = [path.join(root, 'opencode.json'), path.join(root, 'config.json'), path.join(home, '.opencode.json')];
  candidates.forEach((filePath, index) => writeConfig(filePath, configFor(`server${index}`)));
  candidates.forEach((filePath, index) => {
    assert.deepStrictEqual(readOpencodeMcp({ homeDir: home }).map(record => record.name), [`server${index}`]);
    fs.unlinkSync(filePath);
  });
  assert.deepStrictEqual(readOpencodeMcp({ homeDir: home }), []);
});

test('legacy mcpServers mappings and invalid server entries keep their existing behavior', home => {
  const configPath = writeConfig(path.join(home, 'selected.json'), JSON.stringify({
    mcpServers: {
      absent: null,
      invalid: 42,
      local: { command: 'node', args: ['worker.js'], env: { MODE: 'test' } },
      remote: { url: 'https://example.test/mcp' },
      defaults: {},
    },
  }));
  const records = readOpencodeMcp({ homeDir: home, configPath });
  assert.deepStrictEqual(records.map(record => record.name), ['local', 'remote', 'defaults']);
  assert.strictEqual(records[0].command, 'node');
  assert.deepStrictEqual(records[0].args, ['worker.js']);
  assert.deepStrictEqual(records[0].env, { MODE: 'test' });
  assert.strictEqual(records[1].type, 'remote');
  assert.strictEqual(records[2].command, null);
  assert.deepStrictEqual(records[2].args, []);
});

test('invalid JSONC remains best effort and the installer parser export stays compatible', home => {
  const configPath = path.join(home, 'selected.jsonc');
  for (const content of ['null', '[]', '42', '"text"', '{,}', '{"mcp":{,}}', '{"mcp":{}} /* unclosed', '{"other":true}']) {
    writeConfig(configPath, content);
    assert.deepStrictEqual(readOpencodeMcp({ homeDir: home, configPath }), []);
  }
  assert.deepStrictEqual(parseJsoncConfig('{"plugin":["https://example.test/a//b",/* keep */],}', 'opencode.json'), {
    plugin: ['https://example.test/a//b'],
  });
  assert.throws(() => parseJsoncConfig('{/*', 'custom.jsonc'), /Failed to parse custom\.jsonc/);
  assert.throws(() => parseJsoncConfig('[]', 'custom.jsonc'), /Invalid custom\.jsonc: expected a JSON object/);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
