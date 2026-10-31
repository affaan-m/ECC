#!/usr/bin/env node
'use strict';

// The installed tier router owns provisioning and cleanup. This acceptance
// driver transfers only an npm archive and a fixed verifier into the VM.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const NODE_VERSION = '22.18.0';
const NODE_SHA = '2c12913cba67af77ded8a399df3fd91c2e7f8628c7079da40bb9ff33bf00dfc0';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = text => `'${String(text).replace(/'/g, `'"'"'`)}'`;

function command(executable, args, cwd, timeout = 900000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = ''; let stderr = ''; let size = 0; let termination = null; let settled = false;
    const stop = reason => {
      if (!termination) termination = reason;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('timeout'), timeout);
    const collect = key => chunk => {
      size += chunk.length;
      if (size > 24 * 1024 * 1024) { stop('output-limit'); return; }
      if (key === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', error => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve({ code, signal, stdout, stderr, termination });
    });
  });
}

function fingerprintSandboxCli(executable) {
  const resolved = fs.realpathSync(executable);
  fs.accessSync(resolved, fs.constants.X_OK);
  const before = fs.statSync(resolved);
  assert.ok(before.isFile() && before.size > 0 && before.size <= 64 * 1024 * 1024,
    'Sandbox CLI must be a bounded executable file');
  const bytes = fs.readFileSync(resolved);
  const after = fs.statSync(resolved);
  assert.equal(after.dev, before.dev, 'Sandbox CLI changed during fingerprinting');
  assert.equal(after.ino, before.ino, 'Sandbox CLI changed during fingerprinting');
  assert.equal(after.size, before.size, 'Sandbox CLI changed during fingerprinting');
  assert.equal(after.mtimeMs, before.mtimeMs, 'Sandbox CLI changed during fingerprinting');
  const executableDigest = digest(bytes);
  const sourceRoot = path.basename(path.dirname(resolved)) === 'sandbox' ? path.dirname(resolved) : null;
  if (!sourceRoot) return { path: resolved, bytes: bytes.length, digest: executableDigest,
    implementation: { root: null, files: 1, bytes: bytes.length, digest: executableDigest } };
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'Sandbox CLI implementation must not contain symbolic links');
      if (entry.isDirectory()) visit(file);
      else {
        assert.equal(entry.isFile(), true, 'Sandbox CLI implementation must contain regular files only');
        files.push(file);
        assert.ok(files.length <= 512, 'Sandbox CLI implementation exceeds the file bound');
      }
    }
  }
  visit(sourceRoot);
  const hash = crypto.createHash('sha256'); let total = 0;
  for (const file of files) {
    const content = fs.readFileSync(file);
    total += content.length;
    assert.ok(total <= 32 * 1024 * 1024, 'Sandbox CLI implementation exceeds the byte bound');
    hash.update(path.relative(sourceRoot, file).split(path.sep).join('/')).update('\0').update(content);
  }
  return { path: resolved, bytes: bytes.length, digest: executableDigest,
    implementation: { root: sourceRoot, files: files.length, bytes: total, digest: hash.digest('hex') } };
}

function resolveSandboxCli(commandName = 'ecc-sandbox') {
  const candidates = path.isAbsolute(commandName) ? [commandName]
    : (process.env.PATH || '').split(path.delimiter).filter(directory => path.isAbsolute(directory))
      .map(directory => path.join(directory, commandName));
  const executable = candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  });
  assert.ok(executable, 'Sandbox CLI executable was not found');
  return fingerprintSandboxCli(executable);
}

function verifySandboxCli(binding) {
  const current = fingerprintSandboxCli(binding.path);
  assert.deepEqual(current, binding, 'Sandbox CLI changed after acceptance was staged');
  return current;
}

function validateReport(stdout, { tier, manifest }) {
  try {
    const report = JSON.parse(stdout);
    assert.ok(report && typeof report === 'object' && !Array.isArray(report));
    assert.equal(report.result, 'pass');
    assert.equal(report.backend, tier === 1 ? 'podman' : 'lume');
    assert.equal(report.tier, tier);
    assert.equal(report.execution_mode, 'real');
    const installDiff = report.install_diff;
    assert.ok(installDiff && typeof installDiff === 'object' && !Array.isArray(installDiff));
    for (const key of ['files_added', 'files_changed', 'files_deleted', 'path_changes',
      'services_registered', 'dotfiles_touched']) assert.ok(Array.isArray(installDiff[key]));
    if (tier === 1) assert.equal(installDiff.complete, true);
    else {
      assert.equal(installDiff.method, 'scan');
      assert.equal(installDiff.complete, false);
      assert.ok(report.notes?.includes('VM install diff is a bounded best-effort path scan, not a complete disk diff'));
    }
    assert.equal(report.assertions?.length, manifest.steps.assert.length);
    for (let index = 0; index < manifest.steps.assert.length; index++) {
      assert.deepEqual(report.assertions[index], { cmd: manifest.steps.assert[index], pass: true });
    }
    const assertion = manifest.steps.assert.at(-1);
    const step = report.steps?.findLast(item => item?.cmd === assertion);
    assert.equal(step?.exit, 0);
    assert.equal(typeof step.stdout_tail, 'string');
    const smoke = JSON.parse(step.stdout_tail.trim());
    assert.equal(smoke?.schemaVersion, 'ecc.context-sandbox-smoke.v1');
    assert.equal(smoke.passed, true);
    assert.equal(smoke.os, tier === 1 ? 'linux' : 'darwin');
    assert.equal(smoke.arch, 'arm64');
    assert.equal(smoke.authenticated, false);
    assert.equal(smoke.taskOutcomes, 'unobserved');
    assert.equal(smoke.matrix?.length, 10);
    const layouts = smoke.matrix.map(item => `${item.target}/${item.profile}`).sort();
    assert.deepEqual(layouts, ['claude/full', 'claude/lean', 'codex/full', 'codex/lean',
      'cursor/full', 'cursor/lean', 'opencode/full', 'opencode/lean', 'pi/full', 'pi/lean']);
    return { report, smoke };
  } catch {
    throw new Error('Sandbox acceptance report or final smoke payload is invalid');
  }
}

function manifestFor({ tier, archiveDigest, verifierDigest, url, runName }) {
  assert.ok([1, 2].includes(tier));
  for (const value of [archiveDigest, verifierDigest]) assert.match(value, /^[a-f0-9]{64}$/);
  assert.match(runName, /^[a-z0-9-]+$/);
  const guestRoot = tier === 1 ? `/home/ecc/${runName}` : `/tmp/${runName}`;
  const setup = [`mkdir -m 700 ${quote(guestRoot)}`];
  let runtime = '';
  if (tier === 2) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'http:');
    assert.equal(parsed.username, ''); assert.equal(parsed.password, '');
    assert.equal(net.isIP(parsed.hostname), 4, 'Artifact URL requires an IPv4 address');
    setup.push(`curl -fsS --max-time 120 https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz -o ${quote(`${guestRoot}/node.tgz`)} && test "$(shasum -a 256 ${quote(`${guestRoot}/node.tgz`)} | cut -d ' ' -f 1)" = ${NODE_SHA} && tar -xzf ${quote(`${guestRoot}/node.tgz`)} -C ${quote(guestRoot)}`);
    runtime = `export PATH=${quote(`${guestRoot}/node-v${NODE_VERSION}-darwin-arm64/bin`)}:$PATH; `;
    for (const file of ['package.tgz', 'sandbox-smoke.js']) {
      setup.push(`curl -fsS --max-time 120 ${quote(`${url}/${file}`)} -o ${quote(`${guestRoot}/${file}`)}`);
    }
  } else {
    setup.push(`cp /workspace/source/package.tgz /workspace/source/sandbox-smoke.js ${quote(guestRoot)}/`);
  }
  const check = `const fs=require('fs'),c=require('crypto'); for(const [f,h] of ${JSON.stringify([['package.tgz', archiveDigest], ['sandbox-smoke.js', verifierDigest]])}) {if(c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==h)throw Error('Input digest mismatch')}`;
  setup.push(`${runtime}cd ${quote(guestRoot)} && node -e ${quote(check)} && npm install --ignore-scripts --omit=dev --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 --prefix consumer ./package.tgz && npm install --ignore-scripts --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 --prefix tools @openai/codex@0.154.0 ${quote(`@openai/codex-${tier === 2 ? 'darwin' : 'linux'}-arm64@npm:@openai/codex@0.154.0-${tier === 2 ? 'darwin' : 'linux'}-arm64`)}`);
  const assertion = `${runtime}export PATH=${quote(`${guestRoot}/tools/node_modules/.bin`)}:$PATH; node ${quote(`${guestRoot}/sandbox-smoke.js`)} ${quote(`${guestRoot}/consumer/node_modules/ecc-universal`)} ${quote(guestRoot)}`;
  const manifest = { name: runName, needs: { os: [tier === 1 ? 'linux' : 'macos'], arch: ['arm64'],
    capabilities: ['clean-home', 'pkg-install', 'network:*'], trust: 'first-party', native: tier === 2 },
  resources: { cpu: 2, memory: tier === 1 ? '1GB' : '2GB', timeout: 900 },
  steps: { setup, assert: [assertion] }, report: 'install-diff' };
  for (const step of [...setup, assertion]) assert.ok(step.length <= 8192);
  return manifest;
}

async function serveInputs(files, host) {
  assert.equal(net.isIP(host), 4, 'Artifact host must be an explicit IPv4 address');
  const token = crypto.randomBytes(24).toString('hex');
  const requests = [];
  const server = http.createServer((request, response) => {
    const file = request.url?.startsWith(`/${token}/`) ? request.url.slice(token.length + 2) : '';
    if (request.method !== 'GET' || !Object.hasOwn(files, file) || requests.length >= 12) {
      response.writeHead(404).end(); return;
    }
    const bytes = files[file]; requests.push({ file, bytes: bytes.length, digest: digest(bytes) });
    response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes);
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return { url: `http://${host}:${server.address().port}/${token}`, requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

async function run(options) {
  assert.ok([1, 2].includes(options.tier), 'Choose --tier 1 or --tier 2');
  assert.equal(process.arch, 'arm64', 'This acceptance currently certifies arm64 only');
  const repoRoot = path.resolve(__dirname, '../..');
  if (options.sandboxCli) assert.ok(path.isAbsolute(options.sandboxCli), '--sandbox-cli must be an absolute trusted executable');
  const sandboxBinding = resolveSandboxCli(options.sandboxCli || 'ecc-sandbox');
  const sandboxCli = sandboxBinding.path;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-profile-sandbox-'));
  const resultRoot = path.resolve(options.output);
  fs.mkdirSync(resultRoot, { recursive: true, mode: 0o700 });
  const runName = `ecc-profile-tier${options.tier}-${crypto.randomUUID()}`;
  let server;
  const receipt = { schemaVersion: 'ecc.context-sandbox-acceptance.v1', runName, tier: options.tier,
    sourceRevision: (await command('git', ['rev-parse', 'HEAD'], repoRoot, 10000)).stdout.trim(),
    sourceDirty: (await command('git', ['status', '--porcelain'], repoRoot, 10000)).stdout.length > 0,
    sandboxCli, sandboxCliDigest: sandboxBinding.digest,
    sandboxImplementationDigest: sandboxBinding.implementation.digest, reportValidated: false,
    credentialsTransferred: false, artifactServerClosed: false, stageRemoved: false };
  try {
    const packed = await command('npm', ['pack', '--json', '--pack-destination', stage], repoRoot);
    assert.equal(packed.code, 0, packed.stderr);
    const pack = JSON.parse(packed.stdout)[0];
    const archive = fs.readFileSync(path.join(stage, pack.filename));
    assert.ok(archive.length < 64 * 1024 * 1024, 'Package exceeds transfer bound');
    const verifier = fs.readFileSync(path.join(__dirname, 'sandbox-smoke.js'));
    assert.ok(verifier.length < 65536);
    const files = { 'package.tgz': archive, 'sandbox-smoke.js': verifier };
    fs.writeFileSync(path.join(stage, 'package.tgz'), archive, { mode: 0o600 });
    fs.writeFileSync(path.join(stage, 'sandbox-smoke.js'), verifier, { mode: 0o600 });
    receipt.packageDigest = digest(archive); receipt.verifierDigest = digest(verifier);
    if (options.tier === 2) {
      const host = options.artifactHost || Object.values(os.networkInterfaces()).flat()
        .find(address => address.address === '192.168.64.1')?.address;
      assert.ok(host, 'Specify --artifact-host with a host IP reachable from the guest');
      server = await serveInputs(files, host);
    }
    const manifest = manifestFor({ tier: options.tier, archiveDigest: receipt.packageDigest,
      verifierDigest: receipt.verifierDigest, url: server?.url, runName });
    receipt.manifestDigest = digest(Buffer.from(JSON.stringify(manifest)));
    const manifestPath = path.join(stage, 'sandbox.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    fs.copyFileSync(manifestPath, path.join(resultRoot, `${runName}.manifest.json`));
    verifySandboxCli(sandboxBinding);
    const preview = await command(sandboxCli, ['run', manifestPath, '--local-only', '--dry-run'], stage, 30000);
    fs.writeFileSync(path.join(resultRoot, `${runName}.preview.json`), preview.stdout, { mode: 0o600 });
    assert.equal(preview.code, 0, preview.stdout || preview.stderr);
    const routes = JSON.parse(preview.stdout).routes;
    assert.equal(routes?.length, 1, 'Expected exactly one admitted sandbox route');
    assert.equal(routes[0].result, 'routable');
    assert.equal(routes[0].tier, options.tier, 'Router chose a different tier');
    assert.equal(routes[0].backend, options.tier === 1 ? 'podman' : 'lume', 'Router chose a different backend');
    process.stderr.write(`Starting ${runName}; package ${receipt.packageDigest}\n`);
    verifySandboxCli(sandboxBinding);
    const result = await command(sandboxCli, ['run', manifestPath, '--local-only'], stage, 960000);
    receipt.exitCode = result.code; receipt.signal = result.signal;
    fs.writeFileSync(path.join(resultRoot, `${runName}.report.json`), result.stdout, { mode: 0o600 });
    fs.writeFileSync(path.join(resultRoot, `${runName}.stderr.log`), result.stderr, { mode: 0o600 });
    receipt.reportPath = path.join(resultRoot, `${runName}.report.json`);
    assert.equal(result.code, 0, result.stdout || result.stderr);
    verifySandboxCli(sandboxBinding);
    const validated = validateReport(result.stdout, { tier: options.tier, manifest });
    receipt.reportValidated = true;
    receipt.smokeDigest = digest(Buffer.from(JSON.stringify(validated.smoke)));
    if (server) receipt.transfers = server.requests;
    return receipt;
  } finally {
    if (server) { await server.close(); receipt.artifactServerClosed = true; }
    else receipt.artifactServerClosed = true;
    fs.rmSync(stage, { recursive: true, force: true }); receipt.stageRemoved = !fs.existsSync(stage);
    fs.writeFileSync(path.join(resultRoot, `${runName}.driver.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2); const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier') options.tier = Number(args[++i]);
    else if (args[i] === '--output') options.output = args[++i];
    else if (args[i] === '--artifact-host') options.artifactHost = args[++i];
    else if (args[i] === '--sandbox-cli') options.sandboxCli = args[++i];
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!options.output) throw new Error('--output is required');
  run(options).then(receipt => { process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`); process.exitCode = receipt.exitCode === 0 ? 0 : 1; })
    .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
module.exports = { command, manifestFor, resolveSandboxCli, serveInputs, validateReport,
  verifySandboxCli, run };
