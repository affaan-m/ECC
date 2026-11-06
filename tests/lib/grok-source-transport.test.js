'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { fetchPinnedGitSource, preparePinnedGrokSource } = require('../../scripts/lib/grok-source-identity');

const SHA = 'b'.repeat(40);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-grok-transport-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('rejects helper transports, SSH, relative remotes, and option-shaped sources before Git runs', t => {
  const root = fixture(t);
  for (const source of ['ecc-test::payload', 'ecc-test://host/repo', 'ext::sh payload', 'ssh://host/repo',
    'git@host:repo', 'http://host/repo', 'origin', '--upload-pack=payload',
    'https://', 'https://user:password@host/repo', 'https://host/repo\n',
    'file://remote-host/repo', '//server/repo', '\\\\server\\repo', '', null]) {
    assert.throws(() => fetchPinnedGitSource(source, SHA, root, () => {
      assert.fail('invalid source reached Git');
    }), /Grok source must use HTTPS or an absolute local repository/);
  }
  assert.throws(() => fetchPinnedGitSource('https://example.invalid/ECC.git', '--help', root,
    () => assert.fail('invalid SHA reached Git')), /must pin a 40-character/);
  assert.deepEqual(fs.readdirSync(root), [], 'invalid inputs must not create a Git directory');
});

test('HTTPS fetch restricts actual Git transport and retains SHA verification', t => {
  const root = fixture(t);
  let fetchOptions;
  const execute = (_command, args, options) => {
    if (args.includes('fetch')) {
      fetchOptions = options;
      assert.deepEqual(args.slice(-3), ['--', 'https://example.invalid/ECC.git', SHA]);
    }
    return args.includes('rev-parse') ? SHA : '';
  };
  fetchPinnedGitSource('https://example.invalid/ECC.git', SHA, root, execute);
  assert.equal(fetchOptions.env.GIT_ALLOW_PROTOCOL, 'https');
  assert.ok(fetchOptions.timeout > 0);
  assert.throws(() => fetchPinnedGitSource('https://example.invalid/ECC.git', SHA, root,
    (_command, args) => args.includes('rev-parse') ? 'a'.repeat(40) : ''), /does not match pinned SHA/);
});

test('local paths and file URLs still fetch the pinned commit', t => {
  const root = fixture(t);
  const repo = path.join(root, 'local source');
  execFileSync('git', ['init', '--quiet', repo]);
  fs.writeFileSync(path.join(repo, 'payload.txt'), 'verified payload\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=ECC test', '-c', 'user.email=ecc@example.invalid',
    'commit', '--quiet', '-m', 'source']);
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const previousAllow = process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_ALLOW_PROTOCOL = 'ecc-test';
  t.after(() => {
    if (previousAllow === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
    else process.env.GIT_ALLOW_PROTOCOL = previousAllow;
  });
  for (const [index, source] of [repo, pathToFileURL(repo).href].entries()) {
    const fetched = fetchPinnedGitSource(source, sha, path.join(root, String(index)));
    assert.equal(execFileSync('git', ['-C', fetched, 'show', `${sha}:payload.txt`],
      { encoding: 'utf8' }), 'verified payload\n');
  }
  const rewriteToFile = (command, args, options) => execFileSync(command, [
    '-c', `url.${pathToFileURL(repo).href}.insteadOf=https://example.invalid/ECC.git`, ...args,
  ], { ...options, env: { ...process.env, ...options.env, LC_ALL: 'C' } });
  assert.throws(() => fetchPinnedGitSource('https://example.invalid/ECC.git', sha,
    path.join(root, 'rewritten'), rewriteToFile), /transport 'file' not allowed/);
});

// A marker-only remote helper proves rejection occurs before subprocess execution.
function installHelper(t, root) {
  const marker = path.join(root, 'helper-invoked');
  fs.writeFileSync(path.join(root, 'git-remote-ecc-test'),
    '#!/bin/sh\nprintf invoked > "$ECC_GROK_HELPER_MARKER"\nexit 1\n', { mode: 0o755 });
  for (const [key, value] of Object.entries({
    PATH: `${root}${path.delimiter}${process.env.PATH}`,
    ECC_GROK_HELPER_MARKER: marker,
    GIT_ALLOW_PROTOCOL: 'https:file:ecc-test',
  })) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  return marker;
}

test('matching marketplace and registry cannot invoke a custom remote helper',
  { skip: process.platform === 'win32' }, t => {
    const root = fixture(t);
    const marker = installHelper(t, root);
    const sourceRoot = path.join(root, 'extracted');
    const homeDir = path.join(root, 'home');
    fs.mkdirSync(path.join(sourceRoot, '.grok-plugin'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.grok/installed-plugins'), { recursive: true });
    const url = 'ecc-test::payload';
    fs.writeFileSync(path.join(sourceRoot, '.grok-plugin/marketplace.json'), JSON.stringify({
      plugins: [{ version: '1.0.0', source: { source: 'url', url, sha: SHA } }],
    }));
    fs.writeFileSync(path.join(homeDir, '.grok/installed-plugins/registry.json'), JSON.stringify({
      repos: { ecc: { path: sourceRoot, kind: { type: 'Git', url, commit: SHA } } },
    }));
    assert.throws(() => preparePinnedGrokSource({ sourceRoot, homeDir }));
    assert.equal(fs.existsSync(marker), false, 'remote helper executed before SHA verification');
  });

test('Git URL rewrites cannot escape the HTTPS transport allowlist',
  { skip: process.platform === 'win32' }, t => {
    const root = fixture(t);
    const marker = installHelper(t, root);
    const execute = (command, args, options) => execFileSync(command, [
      '-c', 'protocol.ecc-test.allow=always',
      '-c', 'url.ecc-test::payload.insteadOf=https://example.invalid/ECC.git', ...args,
    ], options);
    assert.throws(() => fetchPinnedGitSource('https://example.invalid/ECC.git', SHA, root, execute));
    assert.equal(fs.existsSync(marker), false, 'rewritten transport executed a remote helper');
  });
