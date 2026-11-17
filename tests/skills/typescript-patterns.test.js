'use strict';

// Tests for the typescript-patterns skill: the SKILL.md examples must match
// their strict-TypeScript claims. Compile the real fixture and execute its
// emitted functions so the type checks and runtime regressions share one source.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'typescript-patterns', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(
        () => { passed += 1; console.log(`  ✓ ${name}`); },
        error => { failed += 1; console.log(`  ✗ ${name}`); console.log(`    ${error.message}`); }
      ));
      return;
    }
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

console.log('\n=== TypeScript patterns skill tests ===\n');

// ---- Skill document claims ---------------------------------------------

test('loadUser validates instead of asserting the payload', () => {
  assert.doesNotMatch(skill, /response\.json\(\) as Promise<User>/);
  assert.match(skill, /function isUser\(value: unknown\): value is User/);
});

test('config example validates every consumed field', () => {
  assert.doesNotMatch(skill, /value as Config/);
  assert.match(skill, /toPositiveInt\(raw\['timeout'\]/);
  assert.match(skill, /toPositiveInt\(raw\['retries'\]/);
  assert.match(skill, /DEFAULT_CONFIG/);
});

test('concurrency example narrows indexed access', () => {
  assert.doesNotMatch(skill, /mapper\(items\[index\]\)/);
  assert.match(skill, /Number\.isInteger\(limit\) \|\| limit < 1/);
  assert.match(skill, /noUncheckedIndexedAccess/);
});

test('async error prose states the real semantics', () => {
  assert.match(skill, /always surfaces throws as rejections/);
  assert.doesNotMatch(skill, /lets them escape as rejected promises inconsistently/);
});

// ---- Compile and execute the actual strict TypeScript fixture ----------

const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'typescript-patterns', 'examples.ts');
const configPath = path.join(path.dirname(fixturePath), 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);

test('actual fixture compiles with the recommended index-signature baseline', () => {
  assert.strictEqual(parsedConfig.options.noPropertyAccessFromIndexSignature, true);
  const diagnostics = [config.error, ...parsedConfig.errors, ...ts.getPreEmitDiagnostics(program)].filter(Boolean);
  assert.deepStrictEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});

test('compiled validation and concurrency bodies match the published examples', () => {
  const printer = ts.createPrinter({ removeComments: true });
  function bodies(source, filename) {
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const found = new Map();
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        found.set(node.name.text, printer.printNode(ts.EmitHint.Unspecified, node.body, file));
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
  }
  const documented = [...skill.matchAll(/```typescript\n([\s\S]*?)```/g)].map(match => match[1]).join('\n');
  const docs = bodies(documented, 'skill.ts');
  const fixtures = bodies(fs.readFileSync(fixturePath, 'utf8'), fixturePath);
  for (const name of ['parseConfig', 'assertIsStringArray', 'assertUserId', 'isUser', 'loadUser', 'mapWithConcurrency']) {
    assert.ok(docs.has(name), `${name} is missing from the skill`);
    const fixtureBody = name === 'loadUser' ? fixtures.get(name).replace(/\bfetchJson\b/g, 'fetch') : fixtures.get(name);
    assert.strictEqual(fixtureBody, docs.get(name), `${name} fixture drifted from the published example`);
  }
});

const emitted = ts.transpileModule(fs.readFileSync(fixturePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const fixtureExports = {};
// Only checked-in fixture code is evaluated; no filesystem or network access.
new Function('exports', emitted)(fixtureExports);
const { parseConfig } = fixtureExports.ConfigExample;
const { assertIsStringArray } = fixtureExports.AssertionExample;
const { loadUser } = fixtureExports.UserExample;
const { mapWithConcurrency } = fixtureExports.ConcurrencyExample;

const okFetch = payload => async () => ({ ok: true, status: 200, json: async () => payload });
const badFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

// ---- parseConfig --------------------------------------------------------

test('parseConfig accepts a valid configuration', () => {
  assert.deepStrictEqual(parseConfig({ timeout: 1000, retries: 5 }), { timeout: 1000, retries: 5 });
});

test('parseConfig rejects a string-valued retries field', () => {
  assert.throws(() => parseConfig({ timeout: 1000, retries: '3' }), TypeError);
});

test('parseConfig applies declared defaults for missing fields', () => {
  assert.deepStrictEqual(parseConfig({}), { timeout: 30_000, retries: 3 });
  assert.deepStrictEqual(parseConfig(null), { timeout: 30_000, retries: 3 });
});

test('parseConfig rejects zero and negative values', () => {
  assert.throws(() => parseConfig({ timeout: 0, retries: 3 }), TypeError);
  assert.throws(() => parseConfig({ timeout: 1000, retries: -1 }), TypeError);
  assert.throws(() => parseConfig({ timeout: 1.5, retries: 3 }), TypeError);
});

// ---- assertIsStringArray -------------------------------------------------

test('assertIsStringArray rejects wholly and partially sparse arrays', () => {
  assert.throws(() => assertIsStringArray(new Array(3)), TypeError);
  const partial = ['first', 'second'];
  delete partial[1];
  assert.throws(() => assertIsStringArray(partial), TypeError);
});

test('assertIsStringArray accepts dense strings and rejects present non-strings', () => {
  assert.doesNotThrow(() => assertIsStringArray([]));
  assert.doesNotThrow(() => assertIsStringArray(['', 'hello']));
  for (const invalid of [['hello', undefined], ['hello', 1], null, 'hello']) {
    assert.throws(() => assertIsStringArray(invalid), TypeError);
  }
});

// ---- loadUser / isUser ----------------------------------------------------

test('loadUser returns a valid user', async () => {
  const user = await loadUser('u_1', okFetch({ id: 'u_1', email: 'a@example.com' }));
  assert.deepStrictEqual(user, { id: 'u_1', email: 'a@example.com' });
});

test('loadUser rejects invalid identifiers without making a request', async () => {
  const invalidIds = ['', '../profile', '..', 'a/b', 'a\\b', '%2e%2e', 'u_1?admin=1', 'u_1#bio', 'u_1\n', 'u_\u{1F600}', 1, null];
  for (const userId of invalidIds) {
    let requests = 0;
    const fetchJson = async () => {
      requests += 1;
      return { ok: true, status: 200, json: async () => ({ id: 'u_1', email: 'a@example.com' }) };
    };
    await assert.rejects(loadUser(userId, fetchJson), TypeError);
    assert.strictEqual(requests, 0, `request made for invalid ID ${JSON.stringify(userId)}`);
  }
});

test('loadUser preserves valid identifiers as one endpoint segment', async () => {
  for (const userId of ['u_1', 'User-123', '42']) {
    let requested;
    const user = await loadUser(userId, async url => {
      requested = url;
      return { ok: true, status: 200, json: async () => ({ id: userId, email: 'a@example.com' }) };
    });
    assert.strictEqual(requested, `/users/${userId}`);
    assert.strictEqual(user.id, userId);
  }
});

test('loadUser rejects a response missing email', async () => {
  await assert.rejects(loadUser('u_1', okFetch({ id: 'u_1' })), TypeError);
});

test('loadUser rejects fields with incorrect types', async () => {
  await assert.rejects(loadUser('u_1', okFetch({ id: 1, email: 'a@example.com' })), TypeError);
  await assert.rejects(loadUser('u_1', okFetch({ id: 'u_1', email: 'not-an-email' })), TypeError);
});

test('loadUser rejects null, arrays, and other malformed payloads', async () => {
  await assert.rejects(loadUser('u_1', okFetch(null)), TypeError);
  await assert.rejects(loadUser('u_1', okFetch([{ id: 'u_1', email: 'a@example.com' }])), TypeError);
  await assert.rejects(loadUser('u_1', okFetch('oops')), TypeError);
});

test('loadUser rejects failed fetches and invalid JSON', async () => {
  await assert.rejects(loadUser('u_1', badFetch), /Failed to load user/);
  await assert.rejects(loadUser('u_1', async () => { throw new Error('bad json'); }), /bad json/);
});

// ---- mapWithConcurrency ----------------------------------------------------

test('mapWithConcurrency handles an empty input array', async () => {
  assert.deepStrictEqual(await mapWithConcurrency([], 4, async x => x), []);
});

test('mapWithConcurrency maps with a valid limit', async () => {
  assert.deepStrictEqual(await mapWithConcurrency([1, 2, 3], 2, async x => x * 2), [2, 4, 6]);
});

test('mapWithConcurrency accepts limits greater than the input length', async () => {
  assert.deepStrictEqual(await mapWithConcurrency([1, 2], 10, async x => x + 1), [2, 3]);
});

test('mapWithConcurrency rejects zero and negative limits', async () => {
  await assert.rejects(mapWithConcurrency([1], 0, async x => x), RangeError);
  await assert.rejects(mapWithConcurrency([1], -2, async x => x), RangeError);
});

test('mapWithConcurrency rejects fractional and non-finite limits', async () => {
  await assert.rejects(mapWithConcurrency([1], 1.5, async x => x), RangeError);
  await assert.rejects(mapWithConcurrency([1], NaN, async x => x), RangeError);
  await assert.rejects(mapWithConcurrency([1], Infinity, async x => x), RangeError);
});

test('mapWithConcurrency maps a present undefined element', async () => {
  const seen = [];
  const out = await mapWithConcurrency([undefined, 1], 2, async x => {
    seen.push(x);
    return x === undefined ? 0 : x;
  });
  assert.deepStrictEqual(seen, [undefined, 1]);
  assert.deepStrictEqual(out, [0, 1]);
});

test('mapWithConcurrency skips only genuine sparse-array holes', async () => {
  // Index 1 is a real hole; index 0 holds a present `undefined` value.
  const input = new Array(3);
  input[0] = undefined;
  input[2] = 3;
  const seen = [];
  const out = await mapWithConcurrency(input, 3, async x => {
    seen.push(x);
    return x === undefined ? 'was-undefined' : x;
  });
  // The hole never reaches the mapper; the present undefined does.
  assert.deepStrictEqual(seen, [undefined, 3]);
  assert.strictEqual(out[0], 'was-undefined');
  assert.strictEqual(out[2], 3);
  assert.ok(!(1 in out), 'hole at index 1 should stay a hole in the result, not become a value');
  assert.strictEqual(out.length, 3);
});

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

test('mapWithConcurrency preserves order when mappers complete out of their input order', async () => {
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  const completed = [];
  const resultPromise = mapWithConcurrency([0, 1, 2, 3], 4, async x => {
    started.push(x);
    await gates[x].promise;
    completed.push(x);
    return x * 10;
  });
  // No gate has been released yet, so having every mapper started proves
  // concurrency happened before any completion.
  await Promise.resolve();
  assert.deepStrictEqual(started, [0, 1, 2, 3]);
  // Release the gates in reverse input order and record the actual
  // completion order; determinism comes from the gates, not timers.
  for (let i = 3; i >= 0; i -= 1) {
    gates[i].release();
  }
  const out = await resultPromise;
  assert.deepStrictEqual(completed, [3, 2, 1, 0]);
  // The completion order differs from input order, yet results still land
  // in input order.
  assert.deepStrictEqual(out, [0, 10, 20, 30]);
});

test('mapWithConcurrency propagates mapper rejection', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async x => { if (x === 2) throw new Error('boom'); return x; }),
    /boom/
  );
});

test('mapWithConcurrency never exceeds the configured limit', async () => {
  let active = 0;
  let maxActive = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async x => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return x;
  });
  assert.ok(maxActive <= 2, `peak concurrency ${maxActive} exceeded limit 2`);
  assert.ok(maxActive > 1, 'workers never overlapped; pool may be serial');
});

test('async functions surface throws as rejections, sync returns do not', async () => {
  const { asyncFails, lazyFails } = fixtureExports.AsyncErrorsExample;
  await assert.rejects(asyncFails(), /becomes a rejection/);
  assert.throws(() => lazyFails(), /throws synchronously/);
});

Promise.allSettled(pending).then(() => {
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
});
