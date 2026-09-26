#!/usr/bin/env node
'use strict';

// Runs only inside the disposable acceptance environment. The supervisor owns
// the verdict and resource cleanup; this script supplies independently checked
// file and public-CLI assertions, not a production-readiness assertion.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function discoverPublishedSkills(packageRoot) {
  const skillsRoot = path.join(packageRoot, 'skills');
  const nativeNames = new Set();
  return fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => {
    if (!entry.isDirectory()) return false;
    assert.equal(entry.isSymbolicLink(), false, 'Published skill directory must not be a symlink');
    return fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md'));
  }).map(entry => {
    assert.match(entry.name, NAME, 'Canonical skill directory has an invalid name');
    const source = fs.readFileSync(path.join(skillsRoot, entry.name, 'SKILL.md'), 'utf8')
      .replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    assert.ok(frontmatter, `Missing skill metadata: ${entry.name}`);
    const names = frontmatter[1].split('\n').map(line => line.match(/^name:[ \t]*([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]*$/))
      .filter(Boolean).map(match => match[1]);
    assert.equal(names.length, 1, `Skill requires one plain native name: ${entry.name}`);
    assert.equal(nativeNames.has(names[0]), false, `Duplicate native skill name: ${names[0]}`);
    nativeNames.add(names[0]);
    return { id: `skill:${entry.name}`, sourceName: entry.name, nativeName: names[0] };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function smoke(packageRoot, workspace) {
  const cli = path.join(packageRoot, 'scripts/ecc.js');
  // macOS exposes /tmp as a system symlink to /private/tmp. Canonicalize the
  // newly created directory so the production store can keep rejecting
  // symlinked managed paths without rejecting this isolated acceptance root.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(workspace, 'lifecycle-')));
  const stateRoot = path.join(root, 'store');
  const nativeRoot = path.join(root, 'native');
  const sentinel = path.join(root, 'user-owned.txt');
  fs.writeFileSync(sentinel, 'preserve unrelated user content\n');
  const checks = [];
  function invoke(args, expected = 0) {
    const child = spawnSync(process.execPath, [cli, 'profile', ...args, '--json'], {
      cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, expected, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }
  function profile(args, expected) { return invoke([...args, '--state-root', stateRoot], expected); }
  const preview = profile(['set', 'lean', '--dry-run']);
  assert.equal(preview.status, 'success');
  assert.equal(fs.existsSync(stateRoot), false);
  checks.push('dry-run-does-not-create-state');

  const full = profile(['set', 'full', '--exclude', 'skill:python-testing']).store;
  assert.ok(full.selectedIds.length > 200);
  assert.ok(!full.selectedIds.includes('skill:python-testing'));
  const verify = value => {
    const carrier = JSON.parse(fs.readFileSync(path.join(path.dirname(value.generationRoot), 'carrier.json')));
    for (const file of carrier.files) {
      const bytes = fs.readFileSync(path.join(value.generationRoot, file.destinationPath));
      assert.equal(bytes.length, file.bytes);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.digest);
    }
    return carrier.files.length;
  };
  const fullFiles = verify(full);
  const repeated = profile(['set', 'full', '--exclude', 'skill:python-testing']).store;
  assert.equal(repeated.revision, full.revision);
  profile(['set', 'lean', '--expected-revision', '0'], 1);
  assert.equal(profile(['status']).store.revision, full.revision);
  checks.push('idempotent-install-and-stale-revision-rejection');

  const lean = profile(['set', 'lean']).store;
  assert.equal(lean.selectedIds.length, 3);
  const leanFiles = verify(lean);
  assert.equal(profile(['status']).store.carrierDigest, lean.carrierDigest);
  const restored = profile(['rollback']).store;
  assert.equal(restored.carrierDigest, full.carrierDigest);
  assert.deepEqual(restored.selectedIds, full.selectedIds);
  checks.push('full-lean-full-byte-verified-rollback');

  // Independent layout oracle: do not import the carrier generator or its tests.
  const allSkills = discoverPublishedSkills(packageRoot);
  const kernel = new Set(['skill:configure-ecc', 'skill:context-budget', 'skill:ecc-guide']);
  const layouts = { claude: 'skills', codex: 'skills', pi: 'skills',
    opencode: '.opencode/skills', cursor: '.cursor/skills' };
  const manifests = { claude: ['.claude-plugin/plugin.json', { name: 'ecc-context-carrier', skills: ['./skills/'] }],
    codex: ['.codex-plugin/plugin.json', { name: 'ecc-context-carrier', skills: './skills/' }],
    pi: ['package.json', { name: 'ecc-context-carrier', private: true, pi: { skills: ['./skills'] } }] };
  const walk = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, 'Carrier resource must not be a symlink');
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  }).sort();
  const matrix = [];
  for (const [target, skillRoot] of Object.entries(layouts)) {
    for (const base of ['lean', 'full']) {
      const value = invoke(['set', base, '--target', target,
        '--state-root', path.join(root, `matrix-${target}-${base}`)]).store;
      const expected = base === 'lean' ? allSkills.filter(skill => kernel.has(skill.id)) : allSkills;
      assert.deepEqual(value.selectedIds, expected.map(skill => skill.id));
      const expectedFiles = [];
      for (const skill of expected) {
        const source = path.join(packageRoot, 'skills', skill.sourceName);
        for (const relative of walk(source)) {
          const destination = path.posix.join(skillRoot, skill.nativeName, relative);
          expectedFiles.push(destination);
          assert.deepEqual(fs.readFileSync(path.join(value.generationRoot, destination)), fs.readFileSync(path.join(source, relative)));
        }
      }
      if (manifests[target]) {
        const [filename, expectedManifest] = manifests[target];
        expectedFiles.push(filename);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(value.generationRoot, filename))), expectedManifest);
      }
      assert.deepEqual(walk(value.generationRoot), expectedFiles.sort(), 'Unexpected, missing, or authority-bearing carrier file');
      matrix.push({ target, profile: base, skills: expected.length, files: verify(value), nativeInvocation: 'unobserved' });
    }
  }
  checks.push('ten-packed-carrier-layouts-exact-resource-bytes-and-file-set');

  profile(['set', 'lean', '--selection', 'auto']);
  const taskFile = path.join(root, 'task.json');
  const task = { sessionId: 'acceptance', taskId: 'task', revision: 1, phase: 'implement',
    query: 'Use Python patterns to explain a list comprehension.', explicitIds: ['skill:python-patterns'] };
  fs.writeFileSync(taskFile, JSON.stringify(task));
  const loaded = profile(['resolve', '--task-input', taskFile, '--load']).selection;
  assert.deepEqual(loaded.loadedIds, ['skill:python-patterns']);
  assert.ok(loaded.resources.length > 0);
  profile(['mode', 'suggest']);
  assert.deepEqual(profile(['resolve', '--task-input', taskFile, '--load']).selection.loadedIds, []);
  profile(['mode', 'manual']);
  fs.writeFileSync(taskFile, JSON.stringify({ ...task, explicitIds: [] }));
  assert.deepEqual(profile(['resolve', '--task-input', taskFile, '--load']).selection.loadedIds, []);
  profile(['mode', 'auto']);
  const pending = profile(['resolve', '--task-input', taskFile]).selection;
  assert.equal(pending.receipt.decision, 'pending');
  assert.deepEqual(pending.loadedIds, []);
  checks.push('auto-manual-suggest-and-pending-admission');

  const native = profile(['prepare-native', '--native-root', nativeRoot]).native;
  assert.equal(native.ready, true);
  assert.equal(native.credentialsCopied, false);
  assert.equal(native.selectedIds.length, 3);
  const nativeDry = profile(['run', '--native-root', nativeRoot, '--task-input', taskFile, '--dry-run']).launch;
  assert.equal(nativeDry.status, 'proposed');
  assert.deepEqual(nativeDry.selection.loadedIds, []);
  checks.push('isolated-native-discovery-and-pinned-launch-preview');
  const interactive = profile(['start', '--native-root', nativeRoot, '--dry-run']).interactive;
  assert.equal(interactive.status, 'proposed');
  assert.equal(interactive.launched, false);
  checks.push('interactive-start-preview-without-authentication');

  // A user edit inside managed content must block a switch, preserving bytes.
  const current = profile(['status']).store;
  const ownedFile = path.join(current.generationRoot, 'skills/ecc-guide/SKILL.md');
  fs.appendFileSync(ownedFile, '\nUser customization\n');
  profile(['set', 'full'], 1);
  assert.match(fs.readFileSync(ownedFile, 'utf8'), /User customization/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve unrelated user content\n');
  checks.push('modified-managed-and-unrelated-files-preserved');
  return { schemaVersion: 'ecc.context-sandbox-smoke.v1', passed: true, os: process.platform,
    arch: process.arch, node: process.version, packageVersion: require(path.join(packageRoot, 'package.json')).version,
    fullSkills: full.selectedIds.length, fullFiles, leanSkills: lean.selectedIds.length, leanFiles,
    nativeVersion: native.providerVersion, matrix, checks, authenticated: false, taskOutcomes: 'unobserved' };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(smoke(path.resolve(process.argv[2]), path.resolve(process.argv[3])))}\n`); }
  catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
}
module.exports = { discoverPublishedSkills, smoke };
