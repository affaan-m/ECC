'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withCarrierFixture } = require('./helpers/context-carrier-fixture');
const { createDirectoryLink, update, withFixture, write } = require('./helpers/context-fixture');
const { compileContextProfile } = require('../../scripts/lib/context-profiles');
const { digestObject } = require('../../scripts/lib/context-profile-support');

function request(repoRoot, options = {}) {
  const input = { repoRoot, profileId: 'lean@1', target: 'codex', selectionMode: 'manual', ...options };
  const expectedPlan = compileContextProfile(input);
  const { planContextCarrier } = require('../../scripts/lib/context-carriers');
  return { repoRoot, expectedPlan, artifact: planContextCarrier(input) };
}

function resign(artifact, changes) {
  const { carrierDigest: _, ...value } = { ...artifact, ...changes };
  return { ...value, carrierDigest: digestObject(value) };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('materialization uses unique owned temporary roots and emits only structural evidence', () => withFixture(repoRoot => {
  const options = freeze(request(repoRoot));
  const roots = [];
  const inspect = fixture => {
    roots.push(fixture.root);
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(fixture.root));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const evidence = fixture.verify();
    assert.equal(evidence.schemaVersion, 'ecc.context-fixture-evidence.v1');
    assert.equal(evidence.status, 'verified');
    assert.equal(evidence.evidenceKind, 'structural');
    assert.equal(evidence.nativeSupport, 'unobserved');
    assert.equal(evidence.activation, 'unobserved');
    assert.equal(evidence.carrierDigest, options.artifact.carrierDigest);
    assert.equal(evidence.planDigest, options.expectedPlan.planDigest);
    assert.equal(evidence.fileCount, options.artifact.files.length);
    assert.deepEqual(evidence.files.map(file => file.path), options.artifact.files.map(file => file.destinationPath).sort());
    assert.ok(!JSON.stringify(evidence).includes(fixture.root));
    assert.ok(!JSON.stringify(evidence).includes(repoRoot));
    return evidence;
  };
  assert.deepEqual(withCarrierFixture(options, inspect), withCarrierFixture(options, inspect));
  assert.notEqual(roots[0], roots[1]);
  assert.ok(roots.every(root => !fs.existsSync(root)));
}));

test('copies preserve full binary bytes and never execute bundled scripts', () => withFixture(repoRoot => {
  const binary = Buffer.from([0, 255, 254, 128, 1, 10, 13, 0]);
  const binaryPath = 'skills/ecc-guide/assets/payload.bin';
  fs.mkdirSync(path.dirname(path.join(repoRoot, binaryPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, binaryPath), binary);
  write(repoRoot, 'skills/ecc-guide/run.js', 'throw new Error("Bundled scripts must never execute");');
  const options = request(repoRoot);
  withCarrierFixture(options, ({ root, verify }) => {
    const file = options.artifact.files.find(value => value.sourcePath === binaryPath);
    assert.ok(file, 'full selected resource tree must include the binary');
    assert.deepEqual(fs.readFileSync(path.join(root, file.destinationPath)), binary);
    const observed = verify().files.find(value => value.path === file.destinationPath);
    assert.equal(observed.bytes, binary.length);
    assert.equal(observed.digest, sha256(binary));
  });
}));

test('generated manifests materialize the exact declared UTF-8 bytes', () => withFixture(repoRoot => {
  const options = request(repoRoot, { target: 'claude' });
  const generated = options.artifact.files.filter(file => file.kind === 'generated');
  assert.ok(generated.length > 0);
  withCarrierFixture(options, ({ root, verify }) => {
    for (const file of generated) {
      assert.deepEqual(fs.readFileSync(path.join(root, file.destinationPath)), Buffer.from(file.content, 'utf8'));
    }
    assert.equal(verify().fileCount, options.artifact.files.length);
  });
}));

test('verification remains relocatable after original sources are removed', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  withCarrierFixture(options, ({ verify }) => {
    const before = verify();
    fs.renameSync(path.join(repoRoot, 'skills'), path.join(repoRoot, 'held-source-skills'));
    assert.deepEqual(verify(), before);
  });
}));

test('source drift is rejected before entering the materialized-fixture callback', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  fs.appendFileSync(path.join(repoRoot, 'skills/ecc-guide/SKILL.md'), '\nChanged after planning.\n');
  let entered = false;
  assert.throws(() => withCarrierFixture(options, () => { entered = true; }), /digest|drift|source|binding/i);
  assert.equal(entered, false);
}));

test('source directory-link substitution is rejected before materialization', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  fs.renameSync(path.join(repoRoot, 'skills'), path.join(repoRoot, 'held-skills'));
  createDirectoryLink(path.join(repoRoot, 'held-skills'), path.join(repoRoot, 'skills'));
  assert.throws(() => withCarrierFixture(options, () => assert.fail('unsafe source accepted')), /symlink|symbolic|identity/i);
}));

for (const mutation of ['missing', 'extra', 'tampered']) {
  test(`independent observation rejects ${mutation} staged files`, () => withFixture(repoRoot => {
    const options = request(repoRoot);
    withCarrierFixture(options, ({ root, verify }) => {
      const destination = path.join(root, options.artifact.files[0].destinationPath);
      if (mutation === 'missing') fs.unlinkSync(destination);
      if (mutation === 'extra') fs.writeFileSync(path.join(root, 'unexpected.txt'), 'unplanned');
      if (mutation === 'tampered') fs.appendFileSync(destination, 'changed');
      assert.throws(verify, /missing|extra|unexpected|digest|mismatch|changed|file set/i);
    });
  }));
}

test('schema and carrier digest validation precede fixture writes', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  for (const artifact of [
    { ...options.artifact, carrierDigest: '0'.repeat(64) },
    resign(options.artifact, { unexpected: 'field' }),
    resign(options.artifact, { active: true }),
  ]) {
    assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('invalid artifact accepted')),
      /schema|digest|active|additional|contract/i);
  }
}));

test('independent expected plan cannot be replaced with forged provenance', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  const artifact = resign(options.artifact, { planDigest: '0'.repeat(64) });
  assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('forged binding accepted')),
    /plan|binding|digest/i);
  const expectedPlan = { ...options.expectedPlan, selectedIds: [] };
  assert.throws(() => withCarrierFixture({ ...options, expectedPlan }, () => assert.fail('tampered expected plan accepted')),
    /plan|digest|selected|binding/i);
}));

test('self-consistently hashed artifacts cannot omit selected entrypoints or bundled resources', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/ecc-guide/references/required.md', 'Required reference.');
  update(repoRoot, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value, overrides: [{
    id: 'skill:ecc-guide', requiredResources: ['skills/ecc-guide/references/required.md'],
  }] }));
  const options = request(repoRoot);
  for (const sourcePath of ['skills/ecc-guide/SKILL.md', 'skills/ecc-guide/references/required.md']) {
    const artifact = resign(options.artifact, { files: options.artifact.files.filter(file => file.sourcePath !== sourcePath) });
    assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('omitted source accepted')),
      /missing|required|resource|entrypoint|file set|closure/i);
  }
  const artifact = resign(options.artifact, { entries: options.artifact.entries.map(entry => ({ ...entry, requiredResources: [] })) });
  assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('erased declaration accepted')),
    /required|declaration|entry|mismatch/i);
}));

test('self-consistent false source-byte claims fail against independently read sources', () => withFixture(repoRoot => {
  const options = request(repoRoot);
  const copied = options.artifact.files.find(file => file.kind === 'copy');
  const artifact = resign(options.artifact, { files: options.artifact.files.map(file => file === copied
    ? { ...file, digest: '0'.repeat(64), bytes: file.bytes + 1 } : file) });
  assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('false source claim accepted')),
    /source|bytes|digest|mismatch/i);
}));

test('unsafe or colliding destinations are rejected while outside sentinels remain unchanged', () => withFixture(repoRoot => {
  const sentinel = path.join(repoRoot, 'outside-sentinel.txt');
  fs.writeFileSync(sentinel, 'preserve existing source-side file');
  const options = request(repoRoot);
  for (const destinationPath of ['../outside-sentinel.txt', sentinel, 'folder/../../outside-sentinel.txt']) {
    const artifact = resign(options.artifact, { files: options.artifact.files.map((file, index) => index === 0
      ? { ...file, destinationPath } : file) });
    assert.throws(() => withCarrierFixture({ ...options, artifact }, () => assert.fail('unsafe destination accepted')),
      /path|relative|destination|schema|escape/i);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve existing source-side file');
  }
  const duplicate = resign(options.artifact, { files: [...options.artifact.files, options.artifact.files[0]] });
  assert.throws(() => withCarrierFixture({ ...options, artifact: duplicate }, () => assert.fail('duplicate accepted')),
    /duplicate|collision|destination|schema/i);
}));

for (const [label, spellings] of [
  ['case-folded', ['Case', 'case']],
  ['Unicode-normalized', ['caf\u00e9', 'cafe\u0301']],
]) {
  test(`${label} directory-prefix aliases fail before the first staging write`, context => withFixture(repoRoot => {
    const initial = request(repoRoot);
    const files = ['one.txt', 'two.txt'];
    spellings.forEach((directory, index) => {
      write(repoRoot, `skills/ecc-guide/${directory}/${files[index]}`, `resource ${index}`);
    });
    const skillRoot = path.join(fs.realpathSync(repoRoot), 'skills/ecc-guide');
    const originalList = fs.readdirSync;
    const originalOpen = fs.opendirSync;
    // Model both directory spellings even when the test host aliases them.
    context.mock.method(fs, 'opendirSync', (directory, ...args) => {
      let names;
      if (directory === skillRoot) {
        names = [...originalList(directory).filter(name => !spellings.includes(name)), ...spellings];
      } else {
        const index = spellings.findIndex(spelling => directory === path.join(skillRoot, spelling));
        if (index < 0) return originalOpen(directory, ...args);
        names = [files[index]];
      }
      let index = 0;
      return {
        readSync: () => index < names.length ? { name: names[index++] } : null,
        closeSync() {},
      };
    });
    const { loadContextRegistry } = require('../../scripts/lib/context-pack-registry');
    const registry = loadContextRegistry({ repoRoot });
    const expectedPlan = compileContextProfile({ repoRoot, target: 'codex', selectionMode: 'manual' });
    const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
    const selected = expectedPlan.selectedIds.map(id => byId.get(id));
    const copies = selected.flatMap(entry => entry.resources.map(resource => ({
      kind: 'copy', skillId: entry.id, sourcePath: resource.path,
      destinationPath: `${initial.artifact.layout.skillRoot}/${entry.name}/${resource.path.slice(path.posix.dirname(entry.sourcePath).length + 1)}`,
      digest: resource.digest, bytes: resource.bytes,
    })));
    const bindings = Object.fromEntries(['registryDigest', 'profileDigest', 'compilerDigest', 'planDigest']
      .map(key => [key, expectedPlan[key]]));
    const artifact = resign(initial.artifact, { ...bindings,
      entries: initial.artifact.entries.map(entry => ({ ...entry, contentDigest: byId.get(entry.id).contentDigest })),
      files: [...copies, ...initial.artifact.files.filter(file => file.kind === 'generated')]
        .sort((left, right) => left.destinationPath < right.destinationPath ? -1 : 1),
    });
    const originalWrite = fs.writeFileSync;
    let stagingWrites = 0;
    let failure;
    context.mock.method(fs, 'writeFileSync', (...args) => {
      stagingWrites++;
      return originalWrite(...args);
    });
    try { withCarrierFixture({ repoRoot, artifact, expectedPlan }, () => {}); }
    catch (error) { failure = error; }
    context.mock.restoreAll();
    assert.equal(stagingWrites, 0, 'Portable ancestor aliases must fail before writing the owned stage');
    assert.ok(failure, 'Portable ancestor alias must be rejected');
    assert.match(failure.message, /ancestor|collision|alias|prefix/i);
  }));
}

test('unsupported carriers cannot create a staged fixture', () => withFixture(repoRoot => {
  const options = request(repoRoot, { target: 'gemini' });
  assert.equal(options.artifact.status, 'unsupported');
  assert.throws(() => withCarrierFixture(options, () => assert.fail('unsupported target accepted')), /unsupported/i);
}));

test('failure cleanup removes only the helper-owned stage and preserves outside data', () => withFixture(repoRoot => {
  const sentinel = path.join(repoRoot, 'outside-sentinel.txt');
  fs.writeFileSync(sentinel, 'preserve');
  let stagedRoot;
  assert.throws(() => withCarrierFixture(request(repoRoot), ({ root }) => {
    stagedRoot = root;
    throw new Error('intentional acceptance failure');
  }), /intentional acceptance failure/);
  assert.ok(stagedRoot);
  assert.equal(fs.existsSync(stagedRoot), false);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
}));

test('root-link substitution fails observation and cleanup never follows the outside link', () => withFixture(repoRoot => {
  const sentinel = path.join(repoRoot, 'outside-sentinel.txt');
  fs.writeFileSync(sentinel, 'preserve');
  let stageContainer;
  withCarrierFixture(request(repoRoot), ({ root, verify }) => {
    stageContainer = path.dirname(root);
    fs.renameSync(root, `${root}-held`);
    createDirectoryLink(repoRoot, root);
    assert.throws(verify, /symlink|symbolic|root|identity/i);
  });
  assert.equal(fs.existsSync(stageContainer), false);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
}));
