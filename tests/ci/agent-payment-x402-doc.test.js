'use strict';

// Execute the canonical and translated TypeScript payment boundary offline.
// The x402 adapter models its documented fetch -> 402 -> policy -> sign -> retry
// lifecycle. No signer, key, RPC, user data, or real HTTP client is supplied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const DOCS = [
  'skills/agent-payment-x402/SKILL.md',
  'docs/ja-JP/skills/agent-payment-x402/SKILL.md',
  'docs/zh-CN/skills/agent-payment-x402/SKILL.md',
];
const ORIGIN = 'https://api.example.com';
const URL_PAID = `${ORIGIN}/data`;
const CHALLENGE = {
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  payTo: '7pr7NCaQRz5PEhPy7BAeB3Z72TVkiShhjRyVCN5DA6yC',
  amount: '10000',
};

function harness(doc, options = {}) {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const blocks = [...text.matchAll(/```typescript\n([\s\S]*?)\n```/g)];
  const block = blocks.find(match => match[1].includes('async function payOnce('));
  assert.ok(block, 'document must retain a runnable payment boundary');
  const code = block[1].slice(block[1].indexOf('const ALLOWED_NETWORKS'), block[1].indexOf('const res ='));
  const stats = { prompts: [], requests: [], signs: 0 };
  let policy;
  const client = { registerPolicy(fn) { policy = fn; } };
  const fetch = async request => {
    stats.requests.push(request);
    if (options.fetch) return options.fetch(request);
    return new Response(null, { status: request.headers.has('PAYMENT-SIGNATURE') ? 200 : 402 });
  };
  const wrapFetchWithPayment = tracking => async (url, init) => {
    const request = new Request(options.trackingUrl || url, init);
    const response = await tracking(request);
    if (response.status !== 402) return response;
    const accepted = policy(2, [options.challenge || CHALLENGE]);
    if (!accepted.length) throw new Error('Payment policy rejected challenge');
    stats.signs++;
    const headers = new Headers(request.headers);
    headers.set('PAYMENT-SIGNATURE', 'offline-synthetic-signature');
    return tracking(options.retryUrl || request, { headers });
  };
  const confirmWithUser = async prompt => {
    stats.prompts.push(prompt);
    return options.confirm ? options.confirm(prompt) : true;
  };
  const source = `${code}\nmodule.exports = { payOnce, spent: () => sessionSpent };`;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics || []).length, 0);
  const context = vm.createContext({ client, fetch, wrapFetchWithPayment, confirmWithUser,
    Request, Response, Headers, URL, module: { exports: {} } });
  new vm.Script(compiled.outputText, { filename: doc }).runInContext(context);
  return { ...context.module.exports, stats, policy: (...args) => policy(...args) };
}

const tests = [];
for (const doc of DOCS) {
  const add = (name, test) => tests.push([`${doc}: ${name}`, test]);
  add('rejects an unauthorized initial origin before prompt, fetch, or sign', async () => {
    const h = harness(doc);
    await assert.rejects(h.payOnce('https://evil.example/data'), /origin|authorized/i);
    assert.equal(h.stats.prompts.length, 0);
    assert.equal(h.stats.requests.length, 0);
    assert.equal(h.stats.signs, 0);
    assert.equal(h.spent(), 0n);
  });
  add('uses exact origin matching including port, scheme, and host', async () => {
    const h = harness(doc);
    for (const url of ['http://api.example.com/data', 'https://api.example.com:444/data',
      'https://api.example.com.evil.example/data', 'https://api.example.com@evil.example/data']) {
      await assert.rejects(h.payOnce(url), /origin|authorized/i);
    }
    assert.equal(h.stats.requests.length, 0);
    assert.equal(h.stats.prompts.length, 0);
  });
  add('checks each tracking fetch origin before network access or signing', async () => {
    const h = harness(doc, { trackingUrl: 'https://evil.example/challenge' });
    await assert.rejects(h.payOnce(URL_PAID), /origin|authorized/i);
    assert.equal(h.stats.requests.length, 0);
    assert.equal(h.stats.signs, 0);
    assert.equal(h.spent(), 0n);
  });
  add('also checks a signed retry origin before sending the signature', async () => {
    const h = harness(doc, { retryUrl: 'https://evil.example/paid' });
    await assert.rejects(h.payOnce(URL_PAID), /origin|authorized/i);
    assert.equal(h.stats.requests.length, 1);
    assert.equal(h.stats.signs, 1);
    assert.equal(h.spent(), 0n);
  });
  add('forces redirect error even when caller requests follow', async () => {
    const h = harness(doc, { fetch: async request => {
      assert.equal(request.redirect, 'error');
      throw new Error('Redirect blocked by offline fetch');
    } });
    await assert.rejects(h.payOnce(URL_PAID, { redirect: 'follow' }), /Redirect blocked/);
    assert.equal(h.stats.signs, 0);
    assert.equal(h.spent(), 0n);
  });
  add('rejects a cross-origin redirect response before sign', async () => {
    const h = harness(doc, { fetch: async () => new Response(null, {
      status: 302, headers: { Location: 'https://evil.example/data' },
    }) });
    await assert.rejects(h.payOnce(URL_PAID), /redirect/i);
    assert.equal(h.stats.signs, 0);
    assert.equal(h.spent(), 0n);
  });
  for (const [name, change] of [
    ['network', { network: 'eip155:1' }],
    ['asset', { asset: 'unapproved-mint' }],
    ['recipient', { payTo: 'unapproved-recipient' }],
    ['over-cap amount', { amount: '10001' }],
    ['negative amount', { amount: '-1' }],
    ['malformed amount', { amount: 'invalid' }],
  ]) {
    add(`rejects ${name} challenge without signing or retaining a reservation`, async () => {
      const h = harness(doc, { challenge: { ...CHALLENGE, ...change } });
      await assert.rejects(h.payOnce(URL_PAID), /policy rejected/i);
      assert.equal(h.stats.signs, 0);
      assert.equal(h.spent(), 0n);
    });
  }
  add('states origins, networks, assets, recipients and human-unit caps in approval', async () => {
    const h = harness(doc);
    await h.payOnce(URL_PAID);
    assert.equal(h.stats.prompts.length, 1);
    const prompt = h.stats.prompts[0];
    for (const value of [ORIGIN, CHALLENGE.network, 'eip155:8453', CHALLENGE.asset,
      CHALLENGE.payTo, '0.01 USDC', '0.05 USDC']) assert.ok(prompt.includes(value), value);
  });
  add('reserves five concurrent calls before approval and prompts exactly once', async () => {
    let resolveApproval;
    const approval = new Promise(resolve => { resolveApproval = resolve; });
    const h = harness(doc, { confirm: () => approval });
    const pending = Array.from({ length: 5 }, () => h.payOnce(URL_PAID));
    await assert.rejects(h.payOnce(URL_PAID), /budget exhausted/i);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.spent(), 50_000n);
    assert.equal(h.stats.prompts.length, 1);
    assert.equal(h.stats.requests.length, 0);
    resolveApproval(true);
    await Promise.all(pending);
    assert.equal(h.stats.signs, 5);
    assert.equal(h.stats.requests.length, 10);
    assert.equal(h.spent(), 50_000n);
  });
  add('declined shared approval releases every pending reservation', async () => {
    const h = harness(doc, { confirm: async () => false });
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => h.payOnce(URL_PAID)));
    assert.ok(outcomes.every(result => result.status === 'rejected'));
    assert.equal(h.stats.prompts.length, 1);
    assert.equal(h.spent(), 0n);
    assert.equal(h.stats.requests.length, 0);
  });
  add('failed shared approval releases every pending reservation', async () => {
    const h = harness(doc, { confirm: () => { throw new Error('prompt closed'); } });
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => h.payOnce(URL_PAID)));
    assert.ok(outcomes.every(result => result.status === 'rejected'));
    assert.equal(h.stats.prompts.length, 1);
    assert.equal(h.spent(), 0n);
    assert.equal(h.stats.requests.length, 0);
  });
  add('free responses release reservations for later calls', async () => {
    const h = harness(doc, { fetch: async () => new Response(null, { status: 200 }) });
    for (let index = 0; index < 6; index++) await h.payOnce(URL_PAID);
    assert.equal(h.stats.signs, 0);
    assert.equal(h.spent(), 0n);
    assert.equal(h.stats.prompts.length, 1);
  });
  add('a failed signed send retains its worst-case reservation', async () => {
    const h = harness(doc, { fetch: async request => {
      if (request.headers.has('PAYMENT-SIGNATURE')) throw new Error('ambiguous send');
      return new Response(null, { status: 402 });
    } });
    await assert.rejects(h.payOnce(URL_PAID), /ambiguous send/);
    assert.equal(h.spent(), 10_000n);
  });
}
(async () => {
  let passed = 0;
  for (const [name, test] of tests) {
    try { await test(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`Passed: ${passed}\nFailed: ${tests.length - passed}`);
  process.exitCode = passed === tests.length ? 0 : 1;
})();
