'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const worker = path.join(__dirname, 'helpers', 'session-alias-worker.js');

async function waitFor(file, children) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file)) {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Child exited before barrier: ' + file);
    }
    if (Date.now() > deadline) throw new Error('Barrier timed out: ' + file);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function start(root, role, action) {
  const child = spawn(process.execPath, [worker, root, role, action], {
    env: { ...process.env, HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: path.join(root, '.claude') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) reject(new Error('Worker failed: ' + code + '/' + signal + ' ' + stderr));
      else {
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      }
    });
  });
  child.done.catch(() => {});
  return child;
}
async function race(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-alias-race-'));
  const dataDir = path.join(root, '.claude');
  fs.mkdirSync(dataDir);
  const aliasesPath = path.join(dataDir, 'session-aliases.json');
  fs.writeFileSync(aliasesPath, JSON.stringify({
    version: '1.0',
    aliases: { existing: { sessionPath: '/existing', createdAt: '2026-01-01', title: 'Original' } },
    metadata: {},
  }));
  const children = [];
  const timer = setTimeout(() => children.forEach(child => child.kill('SIGKILL')), 20000);
  try {
    const alpha = start(root, 'alpha', action);
    children.push(alpha);
    await waitFor(path.join(root, 'alpha.read'), children);
    const beta = start(root, 'beta', action);
    children.push(beta);
    await waitFor(path.join(root, 'beta.attempt'), children);
    fs.writeFileSync(path.join(root, 'alpha.release'), '');
    assert.strictEqual((await alpha.done).success, true);
    fs.writeFileSync(path.join(root, 'beta.release'), '');
    assert.strictEqual((await beta.done).success, true);
    const data = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
    assert.ok(data.aliases.alpha, action + ' must preserve the preceding writer');
    if (action === 'set') assert.ok(data.aliases.beta);
    if (['delete', 'cleanup', 'rename'].includes(action)) assert.ok(!data.aliases.existing);
    if (action === 'rename') assert.ok(data.aliases.renamed);
    if (action === 'title') assert.strictEqual(data.aliases.existing.title, 'Updated');
    assert.strictEqual(data.metadata.totalCount, Object.keys(data.aliases).length);
    assert.deepStrictEqual(fs.readdirSync(dataDir), ['session-aliases.json']);
  } finally {
    clearTimeout(timer);
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await Promise.allSettled(children.map(child => child.done));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
(async () => {
  let failed = 0;
  for (const action of ['set', 'delete', 'rename', 'title', 'cleanup']) {
    try { await race(action); console.log('PASS concurrent ' + action); }
    catch (error) { failed++; console.error('FAIL concurrent ' + action + ': ' + error.message); }
  }
  process.exitCode = failed ? 1 : 0;
})();
