'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const gate = require('../../../scripts/lib/eval-harness/gate');
const { test, tempDir, cleanup, finish } = require('./helpers');

function writeTree(root, entries) {
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, content] of entries) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function pair(run) {
  const root = tempDir('variant-digest');
  try { run(path.join(root, 'left'), path.join(root, 'right')); }
  finally { cleanup(root); }
}

test('file bytes containing NUL-delimited paths cannot stand in for additional files', () => {
  for (const [first, second, before, after] of [
    ['a.bin', 'b.bin', Buffer.from('left'), Buffer.from('right')],
    ['assets/a.bin', 'assets/b.bin', Buffer.alloc(0), Buffer.alloc(0)],
    ['assets/a-é.bin', 'assets/b-中文.bin', Buffer.from([0, 255, 128]), Buffer.from('value\0é')],
  ]) {
    pair((left, right) => {
      // Old framing hashes both trees as first\0before\0second\0after\0.
      const combined = Buffer.concat([before, Buffer.from(`\0${second}\0`), after]);
      writeTree(left, [[first, combined]]);
      writeTree(right, [[first, before], [second, after]]);
      assert.notStrictEqual(gate.digestDir(left), gate.digestDir(right), second);
    });
  }
});

test('loadVariant distinguishes valid source trees with the same former digest input', () => {
  pair((left, right) => {
    const common = [
      ['run.js', 'module.exports = { solve: value => value };\n'],
      ['variant.json', JSON.stringify({ name: 'example', effect_class: 'SE0' })],
    ];
    writeTree(left, [...common, ['assets/a.bin', 'one\0assets/b.bin\0two']]);
    writeTree(right, [...common, ['assets/a.bin', 'one'], ['assets/b.bin', 'two']]);
    const a = gate.loadVariant(left);
    const b = gate.loadVariant(right);
    assert.strictEqual(a.name, b.name);
    assert.strictEqual(a.entry, b.entry);
    assert.strictEqual(a.effect_class, b.effect_class);
    assert.notStrictEqual(a.digest, b.digest);
    assert.match(a.digest, /^[0-9a-f]{64}$/);
    assert.match(b.digest, /^[0-9a-f]{64}$/);
    assert.throws(() => gate.runVariant(a), error => error.code === 'gate.isolation_required');
  });
});

test('identical trees keep the same digest across creation order and excluded-directory changes', () => {
  pair((left, right) => {
    const entries = [
      ['a.bin', Buffer.from([0, 1, 255])],
      ['assets/é.txt', '中文\0text'],
      ['assets/empty', Buffer.alloc(0)],
      ['z.txt', 'last'],
    ];
    writeTree(left, entries);
    writeTree(right, entries.slice().reverse());
    const digest = gate.digestDir(left);
    assert.strictEqual(gate.digestDir(left), digest);
    assert.strictEqual(gate.digestDir(right), digest);
    writeTree(left, [['.git/objects/data', 'left'], ['node_modules/pkg/index.js', 'left']]);
    writeTree(right, [['.git/objects/data', 'right'], ['node_modules/pkg/index.js', 'right']]);
    assert.strictEqual(gate.digestDir(left), digest);
    assert.strictEqual(gate.digestDir(right), digest);
  });
});

test('empty files, renamed paths and binary content changes remain distinguishable', () => {
  pair((left, right) => {
    writeTree(left, []);
    writeTree(right, []);
    const empty = gate.digestDir(left);
    assert.match(empty, /^[0-9a-f]{64}$/);
    assert.strictEqual(gate.digestDir(right), empty);
    writeTree(left, [['empty', Buffer.alloc(0)]]);
    assert.notStrictEqual(gate.digestDir(left), empty);
    writeTree(right, [['renamed', Buffer.alloc(0)]]);
    assert.notStrictEqual(gate.digestDir(left), gate.digestDir(right));
    writeTree(left, [['empty', Buffer.from([0, 255])]]);
    const original = gate.digestDir(left);
    writeTree(left, [['empty', Buffer.from([0, 254])]]);
    assert.notStrictEqual(gate.digestDir(left), original);
  });
});

finish('Variant digest');
