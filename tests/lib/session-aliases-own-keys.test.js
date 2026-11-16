'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aliases = require('../../scripts/lib/session-aliases');

const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
let passed = 0;
let failed = 0;

function test(name, callback) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-alias-own-'));
  const originalDataHome = process.env.ECC_AGENT_DATA_HOME;
  // Restore these even when testing the old implementation, which can mutate
  // inherited objects before an assertion reports the regression.
  const targets = [Object.prototype, Object, Object.prototype.toString, Object.prototype.hasOwnProperty];
  const descriptors = targets.map(target => ({
    target,
    title: Object.getOwnPropertyDescriptor(target, 'title'),
    updatedAt: Object.getOwnPropertyDescriptor(target, 'updatedAt')
  }));
  try {
    process.env.ECC_AGENT_DATA_HOME = fixture;
    const filePath = path.join(fixture, 'session-aliases.json');
    assert.strictEqual(aliases.getAliasesPath(), filePath);
    callback(filePath);
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  } finally {
    for (const descriptor of descriptors) {
      for (const key of ['title', 'updatedAt']) {
        if (descriptor[key]) Object.defineProperty(descriptor.target, key, descriptor[key]);
        else delete descriptor.target[key];
      }
    }
    if (originalDataHome === undefined) delete process.env.ECC_AGENT_DATA_HOME;
    else process.env.ECC_AGENT_DATA_HOME = originalDataHome;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function read(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

for (const name of names) {
  test(`an absent ${name} is not a session alias`, filePath => {
    assert.strictEqual(aliases.resolveAlias(name), null);
    assert.strictEqual(aliases.resolveSessionAlias(name), name);
    assert.strictEqual(fs.existsSync(filePath), false);
  });

  test(`${name} can be created, updated and removed without losing its record`, filePath => {
    const created = aliases.setAlias(name, '/fixture/session-one', 'First title');
    assert.strictEqual(created.success, true);
    assert.strictEqual(created.isNew, true);
    const first = read(filePath);
    assert.strictEqual(Object.hasOwn(first.aliases, name), true);
    assert.strictEqual(first.metadata.totalCount, 1);
    assert.ok(first.aliases[name].createdAt);
    assert.strictEqual(aliases.resolveAlias(name).sessionPath, '/fixture/session-one');
    assert.deepStrictEqual(aliases.listAliases().map(entry => entry.name), [name]);

    const updated = aliases.setAlias(name, '/fixture/session-two', 'Second title');
    assert.strictEqual(updated.success, true);
    assert.strictEqual(updated.isNew, false);
    assert.strictEqual(read(filePath).aliases[name].createdAt, first.aliases[name].createdAt);
    assert.strictEqual(aliases.resolveAlias(name).sessionPath, '/fixture/session-two');
    assert.strictEqual(aliases.deleteAlias(name).success, true);
    assert.strictEqual(aliases.resolveAlias(name), null);
    assert.strictEqual(read(filePath).metadata.totalCount, 0);
  });

  test(`renaming to an unused ${name} publishes an own alias entry`, filePath => {
    assert.strictEqual(aliases.setAlias('original', '/fixture/session', 'Keep this title').success, true);
    const first = read(filePath).aliases.original;
    assert.strictEqual(aliases.renameAlias('original', name).success, true);
    const renamed = read(filePath);
    assert.strictEqual(Object.hasOwn(renamed.aliases, name), true);
    assert.strictEqual(Object.hasOwn(renamed.aliases, 'original'), false);
    assert.strictEqual(renamed.metadata.totalCount, 1);
    assert.strictEqual(renamed.aliases[name].createdAt, first.createdAt);
    assert.strictEqual(aliases.resolveAlias(name).sessionPath, first.sessionPath);
    assert.strictEqual(aliases.resolveAlias(name).title, first.title);
  });
}

for (const [operation, mutate] of [
  ['delete', name => aliases.deleteAlias(name)],
  ['rename', name => aliases.renameAlias(name, 'destination')],
  ['update title', name => aliases.updateAliasTitle(name, 'Must not be stored')]
]) {
  test(`${operation} rejects inherited names without changing the store or built-ins`, filePath => {
    assert.strictEqual(aliases.setAlias('ordinary', '/fixture/session').success, true);
    const before = fs.readFileSync(filePath, 'utf8');
    for (const name of names) {
      const target = ({})[name];
      const beforeTitle = Object.getOwnPropertyDescriptor(target, 'title');
      const beforeUpdatedAt = Object.getOwnPropertyDescriptor(target, 'updatedAt');
      const result = mutate(name);
      assert.strictEqual(result.success, false, `${name} must be absent`);
      assert.match(result.error, /not found/);
      assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before);
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(target, 'title'), beforeTitle);
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(target, 'updatedAt'), beforeUpdatedAt);
    }
  });
}

test('existing JSON-owned special names remain readable and writable', filePath => {
  const createdAt = '2024-01-01T00:00:00.000Z';
  const entries = Object.fromEntries(names.map(name => [name, {
    sessionPath: `/fixture/${name}`, createdAt, updatedAt: createdAt, title: 'Imported'
  }]));
  assert.strictEqual(aliases.saveAliases({ version: '1.0', aliases: entries }), true);
  assert.strictEqual(Object.getPrototypeOf(aliases.loadAliases().aliases), Object.prototype);
  for (const name of names) {
    assert.strictEqual(aliases.resolveAlias(name).sessionPath, `/fixture/${name}`);
    assert.strictEqual(aliases.updateAliasTitle(name, 'Changed').success, true);
    assert.strictEqual(aliases.resolveAlias(name).title, 'Changed');
    const result = aliases.setAlias(name, `/fixture/updated/${name}`);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.isNew, false);
    assert.strictEqual(read(filePath).aliases[name].createdAt, createdAt);
  }
  assert.strictEqual(read(filePath).metadata.totalCount, names.length);
});

test('an existing own __proto__ entry still blocks a conflicting rename', filePath => {
  const record = { sessionPath: '/fixture/existing', createdAt: '2024-01-01T00:00:00.000Z', title: null };
  assert.strictEqual(aliases.saveAliases({ version: '1.0', aliases: { ['__proto__']: record, ordinary: record } }), true);
  const before = fs.readFileSync(filePath, 'utf8');
  const result = aliases.renameAlias('ordinary', '__proto__');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /already exists/);
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before);
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
