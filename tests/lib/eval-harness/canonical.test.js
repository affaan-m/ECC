'use strict';

const assert = require('assert');
const { canonicalize, canonicalJson, hashValue } = require('../../../scripts/lib/eval-harness/canonical');
const { test, finish } = require('./helpers');

function ownProto(value) {
  return JSON.parse('{"__proto__":' + JSON.stringify(value) + '}');
}

test('own __proto__ data survives at root, nested and array positions', () => {
  const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const value of [null, 'text', 3, true, [1, 2], { a: 1, z: 2 }]) {
    const input = ownProto(value);
    const before = JSON.stringify(input);
    const expected = '{"__proto__":' + JSON.stringify(value) + '}';
    for (const [data, bytes, omitted] of [[input, expected, {}], [{ nested: input }, '{"nested":' + expected + '}', { nested: {} }], [[input], '[' + expected + ']', [{}]]]) {
      assert.strictEqual(canonicalJson(data), bytes);
      assert.notStrictEqual(hashValue(data), hashValue(omitted));
    }
    const output = canonicalize(input);
    assert.strictEqual(Object.getPrototypeOf(output), Object.prototype);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(output, '__proto__'), { value, writable: true, enumerable: true, configurable: true });
    assert.strictEqual(JSON.stringify(input), before);
    assert.notStrictEqual(hashValue(input), hashValue(ownProto({ different: true })));
  }
  assert.deepStrictEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototypeBefore);
});

test('key order, ordinary special names and null-prototype input are preserved', () => {
  const input = JSON.parse('{"prototype":3,"constructor":2,"__proto__":{"z":2,"a":1},"a":0}');
  const expected = '{"__proto__":{"a":1,"z":2},"a":0,"constructor":2,"prototype":3}';
  assert.strictEqual(canonicalJson(input), expected);
  assert.strictEqual(canonicalJson(JSON.parse(expected)), expected);
  const nullInput = Object.assign(Object.create(null), input);
  assert.strictEqual(canonicalJson(nullInput), expected);
  const inherited = Object.create({ hidden: 'inherited' });
  Object.defineProperty(inherited, '__proto__', { value: 'own', enumerable: true });
  assert.strictEqual(canonicalJson(inherited), '{"__proto__":"own"}');
  assert.strictEqual(Object.getPrototypeOf(canonicalize(nullInput)), Object.prototype);
});

// Captured from pinned base5141 before changing canonical.js, not regenerated expectations.
const baseline = {
  "mixed": {
    "bytes": "{\"a\":{\"2\":\"two\",\"10\":\"ten\",\"a\":[1,\"snow \u2603\",false],\"b\":true},\"z\":null}",
    "hash": "57371228e405924baac7878d77624cfd8a7f399eb007180b8b9fc52dcf7bca69"
  },
  "scalars": [
    {
      "value": null,
      "bytes": "null",
      "hash": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
    },
    {
      "value": true,
      "bytes": "true",
      "hash": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b"
    },
    {
      "value": false,
      "bytes": "false",
      "hash": "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa"
    },
    {
      "value": 0,
      "bytes": "0",
      "hash": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "value": 0,
      "bytes": "0",
      "hash": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "value": 1.5,
      "bytes": "1.5",
      "hash": "9f29a130438b81170b92a42650f9a94291ecad60bd47af2a3886e75f7f728725"
    },
    {
      "value": -2,
      "bytes": "-2",
      "hash": "cf3bae39dd692048a8bf961182e6a34dfd323eeb0748e162eaf055107f1cb873"
    },
    {
      "value": "snow \u2603",
      "bytes": "\"snow \u2603\"",
      "hash": "1d1d4876c8b93fbb464386c82434a3dcc2cdbf5fcd42fdbbf3a903a686215ce2"
    }
  ]
};

test('pre-fix ordinary JSON bytes and hashes remain identical', () => {
  const mixed = { z: null, a: { '10': 'ten', '2': 'two', b: true, a: [1, 'snow \u2603', false] }, omit: undefined };
  assert.strictEqual(canonicalJson(mixed), baseline.mixed.bytes);
  assert.strictEqual(hashValue(mixed), baseline.mixed.hash);
  for (const vector of baseline.scalars) {
    assert.strictEqual(canonicalJson(vector.value), vector.bytes);
    assert.strictEqual(hashValue(vector.value), vector.hash);
  }
  assert.strictEqual(canonicalJson(-0), '0');
});

test('this fix retains existing non-JSON omission and coercion policy', () => {
  assert.strictEqual(canonicalJson({ x: undefined, f: () => 1, symbol: Symbol('fixture') }), '{}');
  const sparse = [undefined]; sparse.length = 2; sparse.push(NaN, Infinity);
  assert.strictEqual(canonicalJson(sparse), '[null,null,null,null]');
  const input = Object.create(null); input.__proto__ = undefined;
  assert.strictEqual(canonicalJson(input), '{}');
});

test('toJSON values canonicalize as JSON.stringify serializes them', () => {
  const early = new Date('2024-01-01T00:00:00.000Z');
  const late = new Date('2025-06-01T00:00:00.000Z');
  assert.strictEqual(canonicalJson(early), '"2024-01-01T00:00:00.000Z"');
  assert.strictEqual(canonicalJson({ since: early, list: [late] }), '{"list":["2025-06-01T00:00:00.000Z"],"since":"2024-01-01T00:00:00.000Z"}');
  assert.notStrictEqual(hashValue({ since: early }), hashValue({ since: late }));
  assert.notStrictEqual(hashValue({ since: early }), hashValue({ since: {} }));
  const seen = [];
  const custom = { toJSON(key) { seen.push(key); return { z: 1, a: [2] }; } };
  assert.strictEqual(canonicalJson({ outer: custom, list: [custom] }), '{"list":[{"a":[2],"z":1}],"outer":{"a":[2],"z":1}}');
  assert.deepStrictEqual(seen.sort(), ['0', 'outer']);
  assert.strictEqual(canonicalJson({ gone: { toJSON: () => undefined }, kept: 1 }), '{"kept":1}');
  assert.strictEqual(canonicalJson([{ toJSON: () => undefined }]), '[null]');
  for (const value of [{ when: early, nested: { list: [late, custom] } }, [early, 1, 'x']]) {
    assert.strictEqual(canonicalJson(value), canonicalJson(JSON.parse(JSON.stringify(value))));
  }
});

test('boxed JSON scalars retain their values at root, nested and array positions', () => {
  const { runInNewContext } = require('vm');
  const values = [0, -0, 7, 1.25, NaN, Infinity, false, true, '', 'value'];
  for (const value of values) {
    const boxed = Object(value);
    boxed.ignored = 'not part of a JSON scalar';
    for (const input of [boxed, { z: boxed }, [boxed]]) {
      const jsonValue = JSON.parse(JSON.stringify(input));
      assert.strictEqual(canonicalJson(input), canonicalJson(jsonValue));
      assert.strictEqual(hashValue(input), hashValue(jsonValue));
    }
    assert.strictEqual(boxed.ignored, 'not part of a JSON scalar');
  }
  const foreign = runInNewContext('[Object(7), Object(false), Object("value")]');
  assert.strictEqual(canonicalJson(foreign), '[7,false,"value"]');
  assert.notStrictEqual(hashValue(Object(7)), hashValue(Object(8)));
  assert.notStrictEqual(hashValue(Object(false)), hashValue(Object(true)));
  assert.notStrictEqual(hashValue(Object(7)), hashValue({}));
});

test('boxed scalar conversion follows JSON coercion after toJSON', () => {
  const number = Object(7);
  number.valueOf = () => 9;
  const text = Object('before');
  text.toString = () => 'after';
  const boolean = Object(false);
  boolean.valueOf = () => true; // JSON uses its internal boolean value.
  for (const input of [number, text, boolean, { toJSON: () => Object(3) }]) {
    assert.strictEqual(canonicalJson(input), JSON.stringify(input));
  }
  number[Symbol.toPrimitive] = () => 1n;
  assert.throws(() => JSON.stringify(number), TypeError);
  assert.throws(() => canonicalJson(number), TypeError);
  text[Symbol.toPrimitive] = () => Symbol('value');
  assert.throws(() => JSON.stringify(text), TypeError);
  assert.throws(() => canonicalJson(text), TypeError);
  const tagged = { [Symbol.toStringTag]: 'Number', z: 2, a: 1 };
  assert.strictEqual(canonicalJson(tagged), '{"a":1,"z":2}');
  const symbol = Object(Symbol('value'));
  symbol.z = 2;
  symbol.a = 1;
  assert.strictEqual(canonicalJson(symbol), '{"a":1,"z":2}');
});

test('boxed BigInt is rejected unless toJSON supplies a serializable value', () => {
  const { runInNewContext } = require('vm');
  for (const boxed of [Object(1n), runInNewContext('Object(2n)')]) {
    for (const input of [boxed, { value: boxed }, [boxed]]) {
      assert.throws(() => JSON.stringify(input), TypeError);
      assert.throws(() => canonicalJson(input), TypeError);
      assert.throws(() => hashValue(input), TypeError);
    }
  }
  const serializable = Object(12n);
  serializable.toJSON = () => '12';
  assert.strictEqual(canonicalJson(serializable), '"12"');
});

finish('canonical');
