#!/usr/bin/env node
/**
 * Codex OAuth login relay for the hardened harness.
 *
 * `codex login` binds its callback server to 127.0.0.1:1455 inside the
 * container. A Docker port publish forwards to the container interface, not
 * loopback, so the host browser's redirect to http://localhost:1455 is
 * refused. This bridges the published interface to loopback:
 *
 *   host 127.0.0.1:1455 -> container 0.0.0.0:1456 (this relay) -> 127.0.0.1:1455
 *
 * Run inside the networked session before `codex login`:
 *   node /ecc/docker/plugin-setup/codex-auth-relay.js &
 *
 * Env: ECC_RELAY_LISTEN (default 1456), ECC_RELAY_TARGET (default 1455).
 */

'use strict';

const net = require('net');

function portFromEnv(name, fallback) {
  const value = process.env[name] === undefined ? fallback : process.env[name];
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer port between 1 and 65535`);
  }
  return port;
}

const listenPort = portFromEnv('ECC_RELAY_LISTEN', 1456);
const targetPort = portFromEnv('ECC_RELAY_TARGET', 1455);
if (listenPort === targetPort) {
  throw new Error('ECC_RELAY_LISTEN and ECC_RELAY_TARGET must differ');
}

const server = net.createServer(client => {
  const upstream = net.connect(targetPort, '127.0.0.1');
  client.pipe(upstream).pipe(client);
  const drop = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', drop);
  upstream.on('error', drop);
  client.on('close', drop);
  upstream.on('close', drop);
  client.setTimeout(30000, drop);
  upstream.setTimeout(30000, drop);
});
server.on('error', error => {
  console.error(`codex-auth-relay: ${error.code}: ${error.message}`);
  process.exit(1);
});
server.listen(listenPort, '0.0.0.0', () => {
  console.log(`codex-auth-relay: 0.0.0.0:${listenPort} -> 127.0.0.1:${targetPort}`);
});
