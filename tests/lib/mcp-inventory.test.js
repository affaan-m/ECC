'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MCP_SCHEMA_VERSION,
  normalizeTransport,
  summarizeEnv,
  buildSignature,
  redactArgs,
  redactUrl,
  normalizeServerEntry,
  buildInventory
} = require('../../scripts/lib/mcp-inventory/canonical-mcp');
const { readClaudeCodeMcp } = require('../../scripts/lib/mcp-inventory/readers/claude-code');
const { readCodexMcp } = require('../../scripts/lib/mcp-inventory/readers/codex');
const { readOpencodeMcp } = require('../../scripts/lib/mcp-inventory/readers/opencode');
const { collectMcpInventory } = require('../../scripts/lib/mcp-inventory/collect');
const { formatHumanReport, parseArgs, usage, main } = require('../../scripts/mcp-inventory');

console.log('=== Testing mcp-inventory ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL - ${name}`);
    console.log(`        ${error && error.message}`);
  }
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-home-'));
}

const GITHUB_STDIO = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  type: 'stdio'
};

test('normalizeTransport maps harness-specific labels to stdio/http/sse', () => {
  assert.strictEqual(normalizeTransport('stdio'), 'stdio');
  assert.strictEqual(normalizeTransport('local'), 'stdio');
  assert.strictEqual(normalizeTransport('remote', { url: 'https://x' }), 'http');
  assert.strictEqual(normalizeTransport('http'), 'http');
  assert.strictEqual(normalizeTransport('sse'), 'sse');
  assert.strictEqual(normalizeTransport(undefined, { url: 'https://x' }), 'http');
  assert.strictEqual(normalizeTransport(undefined), 'stdio');
});

test('summarizeEnv returns key names only and flags secrets', () => {
  const result = summarizeEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_real_secret', FOO: 'bar' });
  assert.deepStrictEqual(result.envKeys, ['FOO', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.strictEqual(result.hasSecrets, true);
  assert.strictEqual(summarizeEnv({ DEBUG: '1' }).hasSecrets, false);
});

test('normalizeServerEntry strips secret values, keeps only env key names', () => {
  const record = normalizeServerEntry({
    name: 'github', ...GITHUB_STDIO,
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_must_not_leak' },
    source: { harness: 'claude-code', scope: 'user', configPath: '/x/.claude.json' }
  });

  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('ghp_must_not_leak'), 'secret value must not appear in normalized record');
  assert.deepStrictEqual(record.envKeys, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.strictEqual(record.hasSecrets, true);
  assert.strictEqual(record.transport, 'stdio');
  assert.strictEqual(record.command, 'npx');
});

test('redactArgs strips secrets in args (value, --flag value, --flag=value forms)', () => {
  // Real-world leak: browserbase passes the Anthropic key as a CLI arg.
  const out = redactArgs([
    '-y', '@browserbasehq/mcp-server-browserbase',
    '--modelName', 'claude-3-7-sonnet-latest',
    '--modelApiKey', 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE000000',
    '--token=ghp_FAKEFAKEFAKEFAKEFAKEFAKE000000'
  ]);
  const serialized = out.join(' ');
  assert.ok(!serialized.includes('sk-ant-api03'), 'must redact secret after --modelApiKey');
  assert.ok(!serialized.includes('ghp_0123456789'), 'must redact inline --token=secret');
  assert.ok(out.includes('claude-3-7-sonnet-latest'), 'must keep non-secret flag values');
  assert.ok(out.includes('@browserbasehq/mcp-server-browserbase'), 'must keep package names');
  assert.ok(out.includes('--modelApiKey'), 'must keep the flag name itself');
});

test('redactUrl strips userinfo and token query params', () => {
  assert.strictEqual(redactUrl('https://user:pass@mcp.example.com/sse'), 'https://***@mcp.example.com/sse');
  assert.ok(!redactUrl('https://mcp.example.com/sse?token=ghp_FAKEFAKEFAKEFAKEFAKE').includes('ghp_abcdef'));
});

test('normalizeServerEntry redacts secrets hidden in args, not just env, and flags hasSecrets', () => {
  const record = normalizeServerEntry({
    name: 'browserbase', type: 'stdio', command: 'npx',
    args: ['-y', 'mcp-server-browserbase', '--modelApiKey', 'sk-ant-api03-FAKEMUSTNOTAPPEAR000000000000'],
    source: { harness: 'claude-code' }
  });
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('sk-ant-api03-FAKEMUSTNOTAPPEAR'), 'arg secret must not appear anywhere (incl. signature)');
  assert.ok(!record.signature.includes('sk-ant'), 'signature must be built from redacted args');
  assert.strictEqual(record.hasSecrets, true, 'arg-carried secret should set hasSecrets');
});

test('buildSignature collapses identical stdio configs and distinguishes http', () => {
  const a = buildSignature({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] });
  const b = buildSignature({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, buildSignature({ transport: 'http', url: 'https://x' }));
});

test('claude-code reader parses ~/.claude.json mcpServers + project .mcp.json', () => {
  const home = tmpHome();
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { ...GITHUB_STDIO, env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' } } }
  }), 'utf8');
  const projectFile = path.join(home, '.mcp.json');
  fs.writeFileSync(projectFile, JSON.stringify({
    mcpServers: { localtool: { command: 'node', args: ['server.js'], type: 'stdio' } }
  }), 'utf8');

  const records = readClaudeCodeMcp({ homeDir: home, projectConfigPaths: [projectFile] });
  const names = records.map(r => r.name).sort();
  assert.deepStrictEqual(names, ['github', 'localtool']);
  assert.strictEqual(records.find(r => r.name === 'github').source.scope, 'user');
  assert.strictEqual(records.find(r => r.name === 'localtool').source.scope, 'project');
});

test('codex reader parses [mcp_servers.*] TOML tables', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), [
    '[mcp_servers.github]',
    'command = "npx"',
    'args = ["-y", "@modelcontextprotocol/server-github"]',
    '',
    '[mcp_servers.github.env]',
    'GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_codex_secret"',
    '',
    '[mcp_servers.remotehub]',
    'url = "https://mcp.example.com/sse"'
  ].join('\n'), 'utf8');

  const records = readCodexMcp({ homeDir: home });
  const github = records.find(r => r.name === 'github');
  const remote = records.find(r => r.name === 'remotehub');
  assert.ok(github, 'parses stdio server');
  assert.strictEqual(github.command, 'npx');
  assert.strictEqual(github.source.harness, 'codex');
  assert.ok(remote && remote.url === 'https://mcp.example.com/sse', 'parses http/url server');
});

test('opencode reader splits command array and reads environment', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    mcp: {
      github: {
        type: 'local',
        command: ['npx', '-y', '@modelcontextprotocol/server-github'],
        environment: { GITHUB_TOKEN: 'github_pat_secret' },
        enabled: true
      },
      disabledtool: { type: 'local', command: ['foo'], enabled: false }
    }
  }), 'utf8');

  const records = readOpencodeMcp({ homeDir: home });
  const github = records.find(r => r.name === 'github');
  assert.strictEqual(github.command, 'npx');
  assert.deepStrictEqual(github.args, ['-y', '@modelcontextprotocol/server-github']);
  assert.deepStrictEqual(Object.keys(github.env), ['GITHUB_TOKEN']);
  assert.strictEqual(records.find(r => r.name === 'disabledtool').enabled, false);
});

test('collectMcpInventory merges harnesses, detects fragmentation + drift, redacts secrets', () => {
  const home = tmpHome();
  // claude + opencode agree on github (consistent); codex github uses a
  // different command (drift). github appears in all 3 => fragmentation x3.
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { ...GITHUB_STDIO, env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret_claude' } } }
  }), 'utf8');
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    mcp: { github: { type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-github'] } }
  }), 'utf8');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), [
    '[mcp_servers.github]',
    'command = "docker"',
    'args = ["run", "ghcr.io/github/mcp"]',
    '[mcp_servers.solo]',
    'command = "node"'
  ].join('\n'), 'utf8');

  const inventory = collectMcpInventory({
    readerOptions: { 'claude-code': { homeDir: home }, codex: { homeDir: home }, opencode: { homeDir: home } }
  });

  assert.strictEqual(inventory.schemaVersion, MCP_SCHEMA_VERSION);
  assert.ok(!JSON.stringify(inventory).includes('ghp_secret_claude'), 'no secret values in inventory');

  const github = inventory.servers.find(s => s.name === 'github');
  assert.strictEqual(github.harnessCount, 3);
  assert.strictEqual(github.consistent, false, 'codex docker command should flag drift');

  const frag = inventory.fragmentation.find(f => f.name === 'github');
  assert.strictEqual(frag.harnessCount, 3);
  assert.deepStrictEqual(frag.harnesses.sort(), ['claude-code', 'codex', 'opencode']);

  assert.strictEqual(inventory.aggregates.serverCount, 2);
  assert.strictEqual(inventory.aggregates.harnessCount, 3);
  assert.strictEqual(inventory.aggregates.duplicateServerCount, 1);
  assert.strictEqual(inventory.aggregates.inconsistentServerCount, 1);
});

test('CLI parseArgs + human report render fragmentation', () => {
  assert.deepStrictEqual(parseArgs(['node', 's', '--json']), { json: true, fragmentedOnly: false, help: false });
  const inventory = buildInventory([
    normalizeServerEntry({ name: 'github', ...GITHUB_STDIO, source: { harness: 'claude-code' } }),
    normalizeServerEntry({ name: 'github', ...GITHUB_STDIO, source: { harness: 'codex' } })
  ]);
  const report = formatHumanReport(inventory);
  assert.ok(report.includes('github'), 'report names the fragmented server');
  assert.ok(report.includes('x2'), 'report shows the harness count');
});


// --- branch/error coverage: readers degrade gracefully, CLI main(), collect skips ---

function captureStdout(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('readers return [] for missing files, malformed JSON, and missing blocks', () => {
  const home = tmpHome();
  assert.deepStrictEqual(readClaudeCodeMcp({ homeDir: home }), []);
  assert.deepStrictEqual(readCodexMcp({ homeDir: home }), []);
  assert.deepStrictEqual(readOpencodeMcp({ homeDir: home }), []);

  fs.writeFileSync(path.join(home, '.claude.json'), '{not valid json', 'utf8');
  assert.deepStrictEqual(readClaudeCodeMcp({ homeDir: home }), []);

  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ other: true }), 'utf8');
  assert.deepStrictEqual(readClaudeCodeMcp({ homeDir: home }), []);

  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), 'nope', 'utf8');
  assert.deepStrictEqual(readOpencodeMcp({ homeDir: home }), []);

  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'this = = broken', 'utf8');
  assert.deepStrictEqual(readCodexMcp({ homeDir: home }), []);
});

test('codex reader returns [] when no TOML parser is available', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.x]\ncommand = "node"\n', 'utf8');
  assert.deepStrictEqual(readCodexMcp({ homeDir: home, parseTomlImpl: () => { throw new Error('no parser'); } }), []);
});

test('collect skips non-function readers and swallows reader errors', () => {
  const inv = collectMcpInventory({
    readers: {
      good: () => ([{ name: 'a', type: 'stdio', command: 'node', source: { harness: 'good' } }]),
      broken: () => { throw new Error('reader blew up'); },
      notAFunction: 'nope'
    }
  });
  assert.strictEqual(inv.servers.length, 1);
  assert.strictEqual(inv.servers[0].name, 'a');
});

test('CLI usage() and parseArgs cover help/fragmented flags', () => {
  assert.ok(usage().includes('mcp-inventory'));
  assert.deepStrictEqual(parseArgs(['node', 's', '-h']), { json: false, fragmentedOnly: false, help: true });
  assert.deepStrictEqual(parseArgs(['node', 's', '--fragmented']), { json: false, fragmentedOnly: true, help: false });
});

test('CLI main() renders help, JSON, and human output paths', () => {
  const help = captureStdout(() => main(['node', 's', '--help']));
  assert.ok(help.includes('Usage: mcp-inventory'));

  const jsonOut = captureStdout(() => main(['node', 's', '--json']));
  const parsed = JSON.parse(jsonOut);
  assert.strictEqual(parsed.schemaVersion, MCP_SCHEMA_VERSION);

  const human = captureStdout(() => main(['node', 's']));
  assert.ok(human.includes('MCP Inventory'));
});

test('formatHumanReport handles the no-fragmentation and fragmented-only branches', () => {
  const solo = buildInventory([
    normalizeServerEntry({ name: 'solo', ...GITHUB_STDIO, source: { harness: 'claude-code' } })
  ]);
  const report = formatHumanReport(solo);
  assert.ok(report.includes('No servers are configured in more than one harness'));

  const fragOnly = formatHumanReport(solo, { fragmentedOnly: true });
  assert.ok(!fragOnly.includes('All servers:'), 'fragmented-only omits the all-servers list');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
