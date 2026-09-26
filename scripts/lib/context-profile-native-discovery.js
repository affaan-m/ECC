'use strict';

const { spawn, spawnSync } = require('node:child_process');
const LIMIT = 2 * 1024 * 1024;

function discoverSync(command, options) {
  const result = spawnSync(process.execPath, [__filename, command], { ...options,
    encoding: 'utf8', timeout: 35000, maxBuffer: LIMIT });
  if (result.error || result.status !== 0) throw new Error('Native Codex discovery failed or exceeded its bound');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Native Codex discovery returned invalid JSON'); }
}

async function discover(command) {
  const child = spawn(command, ['app-server', '--stdio'], { cwd: process.cwd(), env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let outputBytes = 0; let errorBytes = 0; let nextId = 0;
  const pending = new Map();
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = () => {
    for (const handler of pending.values()) handler.reject(new Error('Native Codex discovery protocol failed'));
    pending.clear();
    child.kill('SIGKILL');
  };
  child.once('error', fail);
  child.once('exit', fail);
  child.stdin.on('error', fail);
  child.stderr.on('data', bytes => { errorBytes += bytes.length; if (errorBytes > LIMIT) fail(); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', bytes => {
    outputBytes += Buffer.byteLength(bytes);
    if (outputBytes > LIMIT) { fail(); return; }
    buffer += bytes;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { fail(); return; }
      const handler = pending.get(message.id);
      if (handler) {
        pending.delete(message.id);
        if (message.error) handler.reject(new Error('Native Codex discovery request failed'));
        else handler.resolve(message.result);
      }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const timer = setTimeout(fail, 25000);
  try {
    await request('initialize', { clientInfo: { name: 'ecc-native-profile', version: '1.0.0' },
      capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    return await request('skills/list', { cwds: [process.cwd()], forceReload: true });
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await closed;
  }
}

if (require.main === module) {
  discover(process.argv[2]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => { process.stderr.write('Native Codex discovery failed\n'); process.exitCode = 1; });
}
module.exports = { discoverSync };
