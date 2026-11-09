'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preview, apply, rollback, probeStdio, doctor } = require('../../scripts/lib/copilot-mcp');
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}: ${error.stack}`); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-'));
const configPath = path.join(dir, 'config with spaces', 'mcp-config.json');
const catalog = { mcpServers: { github: { command: 'github' }, demo: { command: process.execPath, args: ['server.js'], env: { API_TOKEN: 'YOUR_KEY' } } } };
const request = { configPath, catalog, selected: [{ name: 'demo', alias: 'my-demo', tools: ['lookup'] }] };
(async () => {
  await test('preview is non-mutating, selected-only and never stores credentials or approvals', () => {
    const plan = preview(request);
    assert(!fs.existsSync(configPath));
    assert.deepStrictEqual(Object.keys(plan.additions), ['my-demo']);
    assert.strictEqual(plan.additions['my-demo'].env.API_TOKEN, '${API_TOKEN}');
    assert.deepStrictEqual(plan.additions['my-demo'].tools, ['lookup']);
    assert(!JSON.stringify(plan).includes('YOUR_KEY'));
    assert.strictEqual(plan.native_status, 'native-unverified');
    assert.deepStrictEqual(Object.keys(preview({ ...request, selected: [{ name: 'github' }] }).additions), []);
  });
  await test('apply preserves unknown config keys; reapply is idempotent', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ custom: { nested: 42 }, mcpServers: { own: { command: 'unchanged' } } }));
    const plan = preview(request); apply(plan);
    const actual = JSON.parse(fs.readFileSync(configPath));
    assert.deepStrictEqual(actual.custom, { nested: 42 });
    assert.strictEqual(actual.mcpServers.own.command, 'unchanged');
    assert.strictEqual(actual.mcpServers['my-demo'].env.API_TOKEN, '${API_TOKEN}');
    const again = preview(request); assert.deepStrictEqual(again.additions, {}); apply(again);
  });
  await test('collisions and changed ownership cannot overwrite user entries', () => {
    assert.throws(() => preview({ ...request, selected: [{ name: 'demo', alias: 'own' }] }), /collision/i);
    const config = JSON.parse(fs.readFileSync(configPath));
    config.mcpServers['my-demo'].args = ['user-change']; fs.writeFileSync(configPath, JSON.stringify(config));
    assert.throws(() => preview(request), /modified|collision/i);
    const result = rollback({ configPath });
    assert(result.preserved.includes('my-demo'));
    assert.strictEqual(JSON.parse(fs.readFileSync(configPath)).mcpServers['my-demo'].args[0], 'user-change');
  });
  await test('stale preview and concurrent writer are rejected before mutation', () => {
    const target = path.join(dir, 'stale.json'); const plan = preview({ ...request, configPath: target });
    fs.writeFileSync(target, '{"mcpServers":{},"new":true}'); assert.throws(() => apply(plan), /changed/i);
    const current = preview({ ...request, configPath: target });
    fs.writeFileSync(`${target}.ecc-lock`, 'busy'); assert.throws(() => apply(current), /lock|EEXIST/i);
    fs.unlinkSync(`${target}.ecc-lock`);
  });
  await test('rollback removes only intact owned entries and preserves all user properties', () => {
    const target = path.join(dir, 'rollback.json'); apply(preview({ ...request, configPath: target }));
    const value = JSON.parse(fs.readFileSync(target)); value.userSetting = true;
    fs.writeFileSync(target, JSON.stringify(value));
    assert.deepStrictEqual(rollback({ configPath: target }).removed, ['my-demo']);
    assert.strictEqual(JSON.parse(fs.readFileSync(target)).userSetting, true);
  });
  await test('mapping rejects unknown fields, unsafe names, literal credentials and malformed config', () => {
    for (const selected of [[{ name: 'missing' }], [{ name: 'demo', alias: '__proto__' }]]) assert.throws(() => preview({ ...request, selected }));
    assert.throws(() => preview({ ...request, catalog: { mcpServers: { demo: { command: 'x', args: [], headers: { Authorization: 'secret' } } } } }), /unsupported/i);
    const target = path.join(dir, 'bad.json'); fs.writeFileSync(target, '[]');
    assert.throws(() => preview({ ...request, configPath: target }), /object/i);
    fs.writeFileSync(target, '{"servers":{}}'); assert.throws(() => preview({ ...request, configPath: target }), /format/i);
  });
  await test('doctor is read-only and does not launch a selected server', async () => {
    const result = doctor({ configPath }); assert.strictEqual(result.native_status, 'native-unverified');
    assert.strictEqual(result.servers['my-demo'], 'configured-not-probed');
  });
  await test('stdio handshake is bounded; never invokes or retries tools', async () => {
    const fixture = path.join(dir, 'server.js');
    fs.writeFileSync(fixture, `const readline=require('readline');readline.createInterface({input:process.stdin}).on('line',s=>{const m=JSON.parse(s);if(m.method!=='initialize'){process.exit(40)};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fixture',version:'1'}}})+'\\n')});`);
    const config = { type: 'local', command: process.execPath, args: [fixture], env: {} };
    assert.strictEqual((await probeStdio(config, { timeoutMs: 3000 })).status, 'healthy');
    assert.strictEqual((await probeStdio({ ...config, env: { REQUIRED: '${MISSING_ECC_TEST_VAR}' } }, { env: {}, timeoutMs: 100 })).status, 'missing-env');
    assert.strictEqual((await probeStdio({ ...config, args: ['-e', 'setInterval(()=>{},1000)'] }, { timeoutMs: 100 })).status, 'timeout');
    assert.strictEqual((await probeStdio({ ...config, args: ['-e', 'process.stdout.write("bad\\n")'] }, { timeoutMs: 3000 })).status, 'invalid-response');
    assert.strictEqual((await probeStdio({ ...config, args: ['-e', 'process.exit(2)'] }, { timeoutMs: 3000 })).status, 'process-exit');
  });
  await test('CLI requires explicit scope, previews safely and rejects unsupported selections', async () => {
    const { main } = require('../../scripts/copilot-mcp');
    await assert.rejects(main(['preview']), /absolute/);
    await assert.rejects(main(['preview', '--config', configPath, '--select', 'no-such-server']), /Unknown/);
    const result = await main(['preview', '--config', path.join(dir, 'cli.json'), '--select', 'context7']);
    assert(result.additions.context7); assert(!fs.existsSync(path.join(dir, 'cli.json')));
    const explicit = await main(['preview', '--config', path.join(dir, 'cli.json'), '--select', 'context7', '--tools', 'query-docs']);
    assert.deepStrictEqual(explicit.additions.context7.tools, ['query-docs']);
    await assert.rejects(main(['doctor', '--config', configPath, '--probe', 'absent']), /Unknown/);
  });
  await test('linked config and unsupported ownership versions fail safely', () => {
    const target = path.join(dir, 'linked.json');
    try { fs.symlinkSync(configPath, target); }
    catch (error) { if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error; return; }
    assert.throws(() => preview({ ...request, configPath: target }), /Linked/);
    const future = path.join(dir, 'future.json');
    fs.writeFileSync(`${future}.ecc-managed.json`, JSON.stringify({ version: 99, managed: {} }));
    assert.throws(() => preview({ ...request, configPath: future }), /version/);
  });
  await test('invalid mappings, malformed plans and duplicate CLI options are rejected', async () => {
    const { main } = require('../../scripts/copilot-mcp');
    for (const argv of [[], ['bad'], ['preview', '--unknown', 'x'], ['preview', '--config'],
      ['preview', '--config', configPath, '--config', configPath], ['preview', '--select', 'a:b:c'],
      ['preview', '--config', configPath], ['preview', '--config', configPath, '--timeout', '10']]) {
      await assert.rejects(main(argv));
    }
    const target = path.join(dir, 'validation.json');
    const local = { ...request, configPath: target };
    assert.throws(() => apply({ ...preview(local), version: 99 }), /version/);
    assert.throws(() => preview({ ...local, selected: [{ name: 'demo' }, { name: 'demo' }] }), /Duplicate/);
    assert.throws(() => preview({ ...local, selected: null }), /selection/);
    for (const demo of [null, { command: '', args: [] }, { command: 'x', args: null },
      { command: 'x', args: [null] }, { command: 'x', args: [], type: 'http' },
      { command: 'x', args: [], env: { 'BAD-KEY': 'x' } }]) {
      assert.throws(() => preview({ ...local, catalog: { mcpServers: { demo } } }));
    }
    assert.throws(() => preview({ ...local, selected: [{ name: 'demo', tools: [null] }] }), /tool/i);
    const modified = preview(local); modified.additions['my-demo'].env.API_TOKEN = 'SECRET';
    assert.throws(() => apply(modified), /mapped/);
    await main(['apply', '--config', target, '--select', 'context7']);
    assert.strictEqual((await main(['doctor', '--config', target])).status, 'configured');
    const probe = await main(['doctor', '--config', configPath, '--probe', 'my-demo', '--timeout', '5']);
    assert.strictEqual(probe.probe.status, 'missing-env');
    assert.strictEqual((await main(['rollback', '--config', target])).status, 'rolled-back');
  });
  await test('health distinguishes invalid schema, output quota, unavailable process and unsupported transport', async () => {
    assert.strictEqual((await probeStdio({ type: 'http' })).status, 'unsupported-transport');
    assert.strictEqual((await probeStdio({ command: null, args: [] })).status, 'invalid-config');
    assert.throws(() => probeStdio({}, { timeoutMs: 0 }), /timeout/i);
    const server = { command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(70000))'] };
    assert.strictEqual((await probeStdio(server)).status, 'output-limit');
    assert.strictEqual((await probeStdio({ command: path.join(dir, 'absent-command'), args: [] })).status, 'spawn-error');
    const bad = 'process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:"2024-11-05",serverInfo:"wrong",capabilities:[]}})+"\\n")';
    assert.strictEqual((await probeStdio({ command: process.execPath, args: ['-e', bad] })).status, 'invalid-response');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nPassed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
})();
