'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { command, manifestFor, resolveSandboxCli, serveInputs, validateReport,
  verifySandboxCli } = require('../../docker/context-profiles/run-sandbox');
const { discoverPublishedSkills } = require('../../docker/context-profiles/sandbox-smoke');

const input = { archiveDigest: 'a'.repeat(64), verifierDigest: 'b'.repeat(64), runName: 'acceptance',
  url: 'http://127.0.0.1:1234/opaque' };

test('independent packed oracle separates canonical IDs from native metadata names', () => {
  const skills = discoverPublishedSkills(require('node:path').resolve(__dirname, '../..'));
  const pubmed = skills.find(skill => skill.id === 'skill:scientific-db-pubmed-database');
  assert.deepEqual(pubmed, { id: 'skill:scientific-db-pubmed-database',
    sourceName: 'scientific-db-pubmed-database', nativeName: 'pubmed-database' });
  assert.equal(new Set(skills.map(skill => skill.id)).size, skills.length);
  assert.equal(new Set(skills.map(skill => skill.nativeName)).size, skills.length);
});

test('tier claims and transferred artifact verification remain explicit', () => {
  for (const tier of [1, 2]) {
    const manifest = manifestFor({ ...input, tier });
    assert.equal(manifest.needs.native, tier === 2);
    assert.deepEqual(manifest.needs.os, [tier === 1 ? 'linux' : 'macos']);
    assert.ok(manifest.needs.capabilities.includes('pkg-install'));
    assert.ok(manifest.needs.capabilities.includes('network:*'));
    const commands = [...manifest.steps.setup, ...manifest.steps.assert].join('\n');
    assert.ok(commands.includes(input.archiveDigest));
    assert.ok(commands.includes(input.verifierDigest));
    assert.ok(!commands.includes('auth.json'));
    assert.ok(!commands.includes('dangerously-bypass'));
    if (tier === 2) assert.ok(!commands.includes('/workspace/source'));
  }
});

test('manifest rejects unbounded or untrusted transfer identities', () => {
  assert.throws(() => manifestFor({ ...input, tier: 0 }));
  assert.throws(() => manifestFor({ ...input, tier: 2, archiveDigest: 'bad' }));
  assert.throws(() => manifestFor({ ...input, tier: 2, runName: 'x; touch /tmp/x' }));
  assert.throws(() => manifestFor({ ...input, tier: 2, url: 'http://user:password@127.0.0.1/' }));
  assert.throws(() => manifestFor({ ...input, tier: 2, url: 'http://untrusted.example/' }));
});

test('artifact server serves only named immutable inputs and closes its listener', async () => {
  const server = await serveInputs({ 'package.tgz': Buffer.from('archive'), 'sandbox-smoke.js': Buffer.from('verifier') }, '127.0.0.1');
  try {
    const accepted = await fetch(`${server.url}/package.tgz`);
    assert.equal(await accepted.text(), 'archive');
    assert.equal((await fetch(`${server.url}/auth.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/package.tgz`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(new URL('/package.tgz', server.url))).status, 404);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].file, 'package.tgz');
    assert.match(server.requests[0].digest, /^[a-f0-9]{64}$/);
  } finally { await server.close(); }
  await assert.rejects(fetch(`${server.url}/package.tgz`));
});

test('acceptance report validates the real backend, tier-specific diff and final smoke payload', () => {
  const manifest = manifestFor({ ...input, tier: 1 });
  const smoke = { schemaVersion: 'ecc.context-sandbox-smoke.v1', passed: true,
    os: 'linux', arch: 'arm64', matrix: ['claude', 'codex', 'pi', 'opencode', 'cursor']
      .flatMap(target => ['lean', 'full'].map(profile => ({ target, profile }))),
    authenticated: false, taskOutcomes: 'unobserved' };
  const report = { result: 'pass', backend: 'podman', tier: 1, execution_mode: 'real',
    install_diff: { complete: true, files_added: [], files_changed: [], files_deleted: [],
      path_changes: [], services_registered: [], dotfiles_touched: [] },
    assertions: [{ cmd: manifest.steps.assert[0], pass: true }],
    steps: [{ cmd: manifest.steps.assert[0], exit: 0, stdout_tail: JSON.stringify(smoke), stderr_tail: '' }] };
  assert.deepEqual(validateReport(JSON.stringify(report), { tier: 1, manifest }).smoke, smoke);
  for (const mutate of [
    value => { value.result = 'fail'; },
    value => { value.backend = 'lume'; },
    value => { value.execution_mode = 'dry-run'; },
    value => { value.install_diff.complete = false; },
    value => { value.assertions[0].pass = false; },
    value => { value.steps[0].stdout_tail = '{"passed":true}'; },
  ]) {
    const invalid = structuredClone(report); mutate(invalid);
    assert.throws(() => validateReport(JSON.stringify(invalid), { tier: 1, manifest }), /report|smoke|acceptance/i);
  }

  const tier2Manifest = manifestFor({ ...input, tier: 2 });
  const tier2Smoke = { ...smoke, os: 'darwin' };
  const tier2Report = { ...report, backend: 'lume', tier: 2,
    install_diff: { method: 'scan', complete: false, files_added: [], files_changed: [],
      files_deleted: [], path_changes: [], services_registered: [], dotfiles_touched: [] },
    assertions: [{ cmd: tier2Manifest.steps.assert[0], pass: true }],
    steps: [{ cmd: tier2Manifest.steps.assert[0], exit: 0,
      stdout_tail: JSON.stringify(tier2Smoke), stderr_tail: '' }],
    notes: ['VM install diff is a bounded best-effort path scan, not a complete disk diff'] };
  assert.deepEqual(validateReport(JSON.stringify(tier2Report),
    { tier: 2, manifest: tier2Manifest }).smoke, tier2Smoke);
  delete tier2Report.notes;
  assert.throws(() => validateReport(JSON.stringify(tier2Report),
    { tier: 2, manifest: tier2Manifest }), /report|smoke|acceptance/i);
});

test('sandbox command hard-kills a process that ignores SIGTERM', async () => {
  const started = Date.now();
  const result = await command(process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], process.cwd(), 50);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.termination, 'timeout');
  assert.ok(Date.now() - started < 3000);
});

test('sandbox executable is resolved and fingerprint drift fails closed', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-sandbox-cli-'));
  try {
    const implementation = path.join(root, 'sandbox');
    fs.mkdirSync(implementation);
    const executable = path.join(implementation, 'ecc-sandbox');
    const backend = path.join(implementation, 'backend.js');
    fs.writeFileSync(executable, '#!/usr/bin/env node\n', { mode: 0o700 });
    fs.writeFileSync(backend, 'module.exports = {};\n');
    const binding = resolveSandboxCli(executable);
    assert.equal(binding.path, fs.realpathSync(executable));
    assert.match(binding.digest, /^[a-f0-9]{64}$/);
    assert.match(binding.implementation.digest, /^[a-f0-9]{64}$/);
    verifySandboxCli(binding);
    fs.appendFileSync(backend, 'changed\n');
    assert.throws(() => verifySandboxCli(binding), /changed/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
