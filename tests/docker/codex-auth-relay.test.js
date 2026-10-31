'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

const script = path.resolve(__dirname, '../../docker/plugin-setup/codex-auth-relay.js');

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('actual relay forwards callback bytes and closes its upstream when the client leaves', { timeout: 10000 }, async t => {
  const upstreamSockets = new Set();
  const upstream = net.createServer(socket => {
    upstreamSockets.add(socket);
    socket.on('close', () => upstreamSockets.delete(socket));
    socket.on('data', data => socket.write(data));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const relayPort = await availablePort();
  const child = spawn(process.execPath, [script], { env: { ...process.env,
    ECC_RELAY_LISTEN: String(relayPort), ECC_RELAY_TARGET: String(upstream.address().port) } });
  t.after(async () => {
    child.kill();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
  });
  const startup = await Promise.race([once(child.stdout, 'data'), once(child, 'exit')]);
  assert.ok(Buffer.isBuffer(startup[0]), 'Relay must start before exiting');
  const client = net.connect(relayPort, '127.0.0.1');
  t.after(() => client.destroy());
  await once(client, 'connect');
  client.write('GET /auth/callback?state=fixture&code=fixture HTTP/1.1\r\n\r\n');
  const [bytes] = await once(client, 'data');
  assert.equal(bytes.toString(), 'GET /auth/callback?state=fixture&code=fixture HTTP/1.1\r\n\r\n');
  const socket = [...upstreamSockets][0];
  const closed = once(socket, 'close');
  client.destroy();
  await closed;
  assert.equal(child.exitCode, null);
});

for (const value of ['0', '-1', '65536', '1.5', 'not-a-port']) {
  test(`rejects invalid relay port ${value} before listening`, { timeout: 5000 }, async () => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ECC_RELAY_LISTEN: value } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /ECC_RELAY_LISTEN must be an integer port/);
  });
}

for (const port of ['1455', '24567']) {
  test(`rejects self-relaying port ${port} before listening`, () => {
    const child = spawnSync(process.execPath, [script], { timeout: 1500, encoding: 'utf8',
      env: { ...process.env, ECC_RELAY_LISTEN: port, ECC_RELAY_TARGET: port } });
    assert.equal(child.status, 1, 'equal ports must exit immediately without a listener');
    assert.match(child.stderr, /ECC_RELAY_LISTEN and ECC_RELAY_TARGET must differ/);
    assert.equal(child.stdout, '');
  });
}

test('occupied listener reports a bounded relay diagnostic without a startup banner', { timeout: 5000 }, async t => {
  const occupied = net.createServer();
  occupied.listen(0, '0.0.0.0');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const port = occupied.address().port;
  const child = spawn(process.execPath, [script], { env: { ...process.env,
    ECC_RELAY_LISTEN: String(port), ECC_RELAY_TARGET: String(port === 1455 ? 1456 : 1455) } });
  let stderr = '';let stdout = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => { stdout += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(stderr, /^codex-auth-relay: .*EADDRINUSE/m);
  assert.doesNotMatch(stderr, /Unhandled 'error' event/);
  assert.equal(stdout, '');
});
