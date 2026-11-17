'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveInvocationEnvironment } = require('../../scripts/lib/invocation-environment');

const PROBE = 'ECC_INVOCATION_ENVIRONMENT_PROBE';

function withProbe(value, fn) {
  const saved = process.env[PROBE];
  process.env[PROBE] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) {
      delete process.env[PROBE];
    } else {
      process.env[PROBE] = saved;
    }
  }
}

test('with no options the ambient process environment is returned as a copy', () => {
  withProbe('ambient', () => {
    const resolved = resolveInvocationEnvironment();
    assert.notEqual(resolved, process.env);
    assert.deepEqual(resolved, { ...process.env });
    assert.equal(resolved[PROBE], 'ambient');
  });
});

test('an empty options object behaves like no options', () => {
  withProbe('ambient', () => {
    assert.deepEqual(resolveInvocationEnvironment({}), { ...process.env });
  });
});

test('mutating the copy never writes back to process.env', () => {
  const resolved = resolveInvocationEnvironment();
  resolved[PROBE] = 'leaked';
  delete resolved.PATH;
  assert.equal(process.env[PROBE], undefined);
  assert.equal(typeof process.env.PATH, 'string');
});

test('the copy is a snapshot and does not see later process.env changes', () => {
  const resolved = resolveInvocationEnvironment();
  withProbe('later', () => {
    assert.equal(resolved[PROBE], undefined);
  });
});

test('an explicit env is copied, not shared, and replaces the ambient environment', () => {
  withProbe('ambient', () => {
    const source = { HOME: '/scoped/home', PATH: '/scoped/bin' };
    const resolved = resolveInvocationEnvironment({ env: source });
    assert.notEqual(resolved, source);
    assert.deepEqual(resolved, source);
    assert.equal(resolved[PROBE], undefined);

    resolved.EXTRA = '1';
    assert.equal(source.EXTRA, undefined);
  });
});

test('only own enumerable keys of an explicit env are copied', () => {
  const source = Object.create({ INHERITED: 'yes' });
  source.OWN = 'yes';
  Object.defineProperty(source, 'HIDDEN', { value: 'yes', enumerable: false });
  assert.deepEqual(resolveInvocationEnvironment({ env: source }), { OWN: 'yes' });
});

test('env: null and env: undefined mean an empty environment, not the ambient one', () => {
  withProbe('ambient', () => {
    assert.deepEqual(resolveInvocationEnvironment({ env: null }), {});
    assert.deepEqual(resolveInvocationEnvironment({ env: undefined }), {});
  });
});

test('an explicit env wins over homeDir', () => {
  const resolved = resolveInvocationEnvironment({ env: { A: '1' }, homeDir: '/scoped' });
  assert.deepEqual(resolved, { A: '1' });
});

test('a scoped homeDir gives an empty environment so ambient variables cannot leak into the install', () => {
  withProbe('ambient', () => {
    const resolved = resolveInvocationEnvironment({ homeDir: '/scoped/home' });
    assert.deepEqual(resolved, {});
    assert.equal(resolved.HOME, undefined);
    assert.equal(resolved[PROBE], undefined);
  });
});

test('a blank or non-string homeDir does not count as scoped', () => {
  withProbe('ambient', () => {
    for (const homeDir of ['', '   ', '\n', null, undefined, 42, true]) {
      assert.deepEqual(resolveInvocationEnvironment({ homeDir }), { ...process.env }, `homeDir ${JSON.stringify(homeDir)} should fall back to the ambient environment`);
    }
  });
});

test('each call returns a distinct object', () => {
  assert.notEqual(resolveInvocationEnvironment(), resolveInvocationEnvironment());
  assert.notEqual(resolveInvocationEnvironment({ homeDir: '/scoped' }), resolveInvocationEnvironment({ homeDir: '/scoped' }));
});
