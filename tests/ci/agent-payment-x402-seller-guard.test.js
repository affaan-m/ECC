'use strict';

// Run the canonical and translated seller replay guard against the real x402
// Express middleware and resource server, so verification, the onAfterVerify
// hook, the handler and settlement happen in their real order. Payments are
// signed by the real @x402/evm client with a throwaway key; the facilitator is
// a local stand-in that checks the EIP-3009 signature with viem and settles
// each nonce once. Redis and @solana/kit are stubbed. No network or funds.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// Node 18 exposes WebCrypto through node:crypto, but not as a global by default.
// The real signing client used only by this fixture requires that standard API.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
const express = require('express');
const x402Express = require('@x402/express');
const coreServer = require('@x402/core/server');
const { x402Client, x402HTTPClient } = require('@x402/core/client');
const { ExactEvmScheme: ExactEvmServer } = require('@x402/evm/exact/server');
const { ExactEvmScheme: ExactEvmClient } = require('@x402/evm/exact/client');
const { toClientEvmSigner } = require('@x402/evm');
const viemFromEvm = createRequire(require.resolve('@x402/evm'));
const { verifyTypedData } = viemFromEvm('viem');
const { privateKeyToAccount, generatePrivateKey } = viemFromEvm('viem/accounts');

const ROOT = path.resolve(__dirname, '../..');
const DOCS = [
  'skills/agent-payment-x402/SKILL.md',
  'docs/ja-JP/skills/agent-payment-x402/SKILL.md',
  'docs/zh-CN/skills/agent-payment-x402/SKILL.md',
];
const NOW_S = 1_800_000_000; // fixed clock for the guard's expiry arithmetic
const PAY_TO = '0x000000000000000000000000000000000000dEaD';

// Wire format: compact-u16 signature count (one byte below 128), 64 bytes per
// signature, then the message. Enough of a decoder for the stubbed kit.
const kit = {
  getBase64Encoder: () => ({ encode: text => new Uint8Array(Buffer.from(text, 'base64')) }),
  getTransactionDecoder: () => ({ decode: bytes => ({ messageBytes: bytes.slice(1 + 64 * bytes[0]) }) }),
};

// Stand-in facilitator: real signature check, each nonce settles once.
class Facilitator {
  constructor() { this.settles = 0; this.consumed = new Set(); }
  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} };
  }
  async verify(payload, req) {
    const a = payload.payload.authorization;
    const valid = await verifyTypedData({
      address: a.from,
      domain: { name: req.extra.name, version: req.extra.version, chainId: 8453, verifyingContract: req.asset },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ] },
      primaryType: 'TransferWithAuthorization',
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature: payload.payload.signature,
    }).catch(() => false);
    if (!valid) return { isValid: false, invalidReason: 'invalid_exact_evm_payload_signature', payer: a.from };
    if (this.consumed.has(a.nonce)) return { isValid: false, invalidReason: 'invalid_exact_evm_payload_authorization_nonce_used', payer: a.from };
    return { isValid: true, payer: a.from };
  }
  async settle(payload) {
    this.settles++;
    const { nonce, from } = payload.payload.authorization;
    if (this.consumed.has(nonce)) return { success: false, errorReason: 'nonce_used', transaction: '', network: 'eip155:8453', payer: from };
    this.consumed.add(nonce);
    return { success: true, transaction: `0x${'ab'.repeat(32)}`, network: 'eip155:8453', payer: from };
  }
}

function load(doc, { mode = 'ok', failClosed = true, handlerRejects = false } = {}) {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const blocks = [...text.matchAll(/```typescript\n([\s\S]*?)\n```/g)];
  const block = blocks.find(match => match[1].includes('.onAfterVerify('));
  assert.ok(block, 'document must retain a runnable seller replay guard');
  let source = block[1];
  if (!failClosed) source = source.replace('const FAIL_CLOSED = true;', 'const FAIL_CLOSED = false;');
  const facilitator = new Facilitator();
  const store = new Set();
  const redis = {
    options: null, listeners: {}, sets: [],
    on(event, fn) { this.listeners[event] = fn; return this; },
    connect: () => Promise.reject(new Error('ECONNREFUSED')),
    async set(key, value, opts) {
      this.sets.push({ key, opts });
      if (mode === 'offline') throw new Error('The client is offline');
      if (mode === 'hang') return new Promise(() => {});
      if (mode === 'late' && this.sets.length === 1) await new Promise(r => setTimeout(r, 400)); // the first write lands after the claim timeout
      if (store.has(key)) return null;
      store.add(key);
      return 'OK';
    },
    async del(key) { store.delete(key); return 1; },
  };
  const modules = {
    'node:crypto': crypto,
    express,
    '@x402/express': x402Express,
    '@x402/core/server': { ...coreServer, HTTPFacilitatorClient: function HTTPFacilitatorClient() { return facilitator; } },
    '@x402/evm/exact/server': { ExactEvmScheme: ExactEvmServer },
    '@solana/kit': kit,
    redis: { createClient: options => { redis.options = options; return redis; } },
  };
  const compiled = ts.transpileModule(`${source}\nmodule.exports = { app, claimOf, resourceServer };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics || []).length, 0);
  const runs = [];
  class FixedDate extends Date { static now() { return NOW_S * 1000; } }
  const context = vm.createContext({
    require: name => modules[name], module: { exports: {} }, exports: {},
    Buffer, Promise, setTimeout, Date: FixedDate, console: { warn() {} },
    process: { env: { REDIS_URL: 'redis://stub', FACILITATOR_URL: 'http://stub', PAY_TO } },
    // A handler that takes time, like the expensive ones the guard is for, so
    // concurrent copies are all verified while the first one is still running.
    buildReport: async () => {
      runs.push(1);
      await new Promise(r => setTimeout(r, 150));
      if (handlerRejects) throw new Error('synthetic report failure');
      return { report: 'ok' };
    },
  });
  new vm.Script(compiled.outputText, { filename: doc }).runInContext(context);
  return { ...context.module.exports, facilitator, redis, runs };
}

async function serve(h) {
  const server = await new Promise(resolve => { const s = h.app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/report`;
  const client = new x402HTTPClient(new x402Client().register('eip155:8453',
    new ExactEvmClient(toClientEvmSigner(privateKeyToAccount(generatePrivateKey())))));
  const post = (headers, options = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}', ...options });
  const sign = async () => {
    const challenge = await post({});
    const required = client.getPaymentRequiredResponse(name => challenge.headers.get(name), await challenge.json().catch(() => undefined));
    return client.encodePaymentSignatureHeader(await client.createPaymentPayload(required));
  };
  const reason = res => {
    const header = res.headers.get('payment-required');
    return header ? JSON.parse(Buffer.from(header, 'base64').toString()).error : undefined;
  };
  // Node 18's close() waits for idle keep-alive sockets left by fetch.
  return { post, sign, reason, close: (force = false) => new Promise(resolve => {
    server.close(resolve);
    if (force) server.closeAllConnections?.();
    else server.closeIdleConnections?.();
  }) };
}

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');
const evmPayload = (nonce, validBefore, from = '0xAbC0000000000000000000000000000000000001') =>
  ({ payload: { signature: '0x00', authorization: { from, nonce, validBefore: String(validBefore) } } });
const svmPayload = feeSlot => ({ payload: { transaction: Buffer.concat([
  Buffer.from([2]), Buffer.alloc(64, feeSlot), Buffer.alloc(64, 7), Buffer.from('payer-signed-message')]).toString('base64') } });
const REQ = { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };

const tests = [];
for (const doc of DOCS) {
  const add = (name, test) => tests.push([`${doc}: ${name}`, test]);
  add('three concurrent copies of one signed payment run the handler once', async () => {
    const h = load(doc);
    const s = await serve(h);
    try {
      const header = await s.sign();
      const results = await Promise.all([1, 2, 3].map(() => s.post(header)));
      assert.equal(h.runs.length, 1);
      assert.equal(h.facilitator.settles, 1);
      const refused = results.filter(r => r.status === 402);
      assert.equal(refused.length, 2);
      for (const r of refused) assert.equal(s.reason(r), 'payment_replayed');
      for (const { opts } of h.redis.sets) {
        assert.equal(opts.condition, 'NX');
        assert.equal(opts.expiration.type, 'EXAT');
        assert.equal(opts.expiration.value, NOW_S + 900);
      }
    } finally { await s.close(); }
  });
  add('a rejected report reaches the Express error handler without settlement or replay', async () => {
    const h = load(doc, { handlerRejects: true });
    const errors = [];
    h.app.use((error, _req, res, _next) => {
      errors.push(error.message);
      res.status(500).json({ error: 'report_failed' });
    });
    const s = await serve(h);
    try {
      const header = await s.sign();
      const response = await s.post(header, { signal: AbortSignal.timeout(1500) });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'report_failed' });
      assert.deepEqual(errors, ['synthetic report failure']);
      assert.equal(h.runs.length, 1);
      assert.equal(h.facilitator.settles, 0, 'a failed response must not be settled');
      const retry = await s.post(header);
      assert.equal(retry.status, 402);
      assert.equal(s.reason(retry), 'payment_replayed');
      assert.equal(h.runs.length, 1, 'keep the claim because work may already have side effects');
      assert.equal(h.facilitator.settles, 0);
      assert.equal((await s.post({})).status, 402, 'the server remains responsive');
    } finally { await s.close(true); }
  });
  add('an invalid signature takes no claim; the valid payment is then served', async () => {
    const h = load(doc);
    const s = await serve(h);
    try {
      const header = await s.sign();
      const payload = JSON.parse(Buffer.from(header['PAYMENT-SIGNATURE'], 'base64').toString());
      const signature = payload.payload.signature;
      assert.match(signature, /^0x[0-9a-f]{130}$/i, 'the SDK returns a 65-byte ECDSA signature');
      // r = 0 is outside the valid ECDSA scalar range. Changing only the tail
      // can preserve r/s and merely normalize the recovery byte from 27 to 0.
      const invalidSignature = `0x${'00'.repeat(32)}${signature.slice(66)}`;
      const originalBytes = Buffer.from(signature.slice(2), 'hex');
      const invalidBytes = Buffer.from(invalidSignature.slice(2), 'hex');
      assert.equal(invalidBytes.length, originalBytes.length);
      assert.notDeepEqual(invalidBytes, originalBytes, 'the forgery must change the signed scalar bytes');
      assert.deepEqual(invalidBytes.subarray(32), originalBytes.subarray(32), 'preserve s and the recovery byte');
      const forged = { ...payload, payload: { ...payload.payload, signature: invalidSignature } };
      const bad = await s.post({ 'PAYMENT-SIGNATURE': b64(forged) });
      assert.equal(bad.status, 402);
      assert.equal(h.redis.sets.length, 0, 'an unverified payment must not be claimed');
      assert.equal(h.runs.length, 0, 'an unverified payment must not run the handler');
      assert.equal(h.facilitator.settles, 0, 'an unverified payment must not settle');
      assert.equal((await s.post(header)).status, 200);
      assert.equal(h.runs.length, 1);
      assert.equal(h.facilitator.settles, 1);
    } finally { await s.close(); }
  });
  add('fails closed when the store is offline or hangs: no handler run, no settlement', async () => {
    for (const mode of ['offline', 'hang']) {
      const h = load(doc, { mode });
      const s = await serve(h);
      try {
        const started = Date.now();
        const res = await s.post(await s.sign());
        assert.equal(res.status, 402, mode);
        assert.equal(s.reason(res), 'claim_unavailable', mode);
        assert.equal(h.runs.length, 0, mode);
        assert.equal(h.facilitator.settles, 0, mode);
        assert.ok(Date.now() - started < 2000, `${mode}: the claim timeout bounds the wait`);
      } finally { await s.close(); }
    }
  });
  add('a claim that lands after the timeout is released, so the retry is served', async () => {
    const h = load(doc, { mode: 'late' });
    const s = await serve(h);
    try {
      const header = await s.sign();
      const first = await s.post(header);
      assert.equal(s.reason(first), 'claim_unavailable');
      await new Promise(r => setTimeout(r, 600)); // the late write lands, then is released
      const retry = await s.post(header);
      assert.equal(retry.status, 200, `retry: ${s.reason(retry)}`);
      assert.equal(h.runs.length, 1);
      assert.equal(h.facilitator.settles, 1);
    } finally { await s.close(); }
  });
  add('failing open is an explicit choice that gives up duplicate protection', async () => {
    const h = load(doc, { mode: 'offline', failClosed: false });
    const s = await serve(h);
    try {
      const header = await s.sign();
      await Promise.all([1, 2].map(() => s.post(header)));
      assert.equal(h.runs.length, 2);
    } finally { await s.close(); }
  });
  add('claim derivation failures and unsupported authorizations fail closed', async () => {
    const h = load(doc);
    const hooks = h.resourceServer.afterVerifyHooks;
    assert.ok(Array.isArray(hooks), 'pinned SDK must expose registered after-verify hooks');
    for (const paymentPayload of [
      evmPayload('0xAD', (2n ** 256n).toString()),
      evmPayload('0xAE', 'not-an-integer'),
      { payload: {} },
    ]) {
      const result = await hooks[0]({ paymentPayload, requirements: REQ, result: { isValid: true } });
      assert.equal(result.abort, true);
      assert.equal(h.redis.sets.length, 0, 'unsupported claims must not reach the store');
    }
  });
  add('client starts without waiting on the store and cannot be crashed by its errors', async () => {
    const h = load(doc);
    assert.equal(h.redis.options.disableOfflineQueue, true);
    assert.ok(h.redis.options.commandsQueueMaxLength > 0);
    assert.equal(typeof h.redis.listeners.error, 'function');
    h.redis.listeners.error(new Error('socket closed'));
  });
  add('claim keys identify the authorization and last until it expires', async () => {
    const { claimOf } = load(doc);
    const a = claimOf(evmPayload('0xAA', NOW_S + 3600), REQ);
    assert.equal(a.key, claimOf(evmPayload('0xaa', NOW_S + 3600, '0xabc0000000000000000000000000000000000001'), REQ).key);
    assert.notEqual(a.key, claimOf(evmPayload('0xAB', NOW_S + 3600), REQ).key);
    assert.notEqual(a.key, claimOf(evmPayload('0xAA', NOW_S + 3600), { ...REQ, asset: '0x0000000000000000000000000000000000000001' }).key);
    assert.equal(a.until, NOW_S + 3660);
    assert.equal(claimOf(evmPayload('0xAC', NOW_S + 60), REQ).until, NOW_S + 900);
    assert.throws(() => claimOf(evmPayload('0xAD', (2n ** 256n).toString()), REQ), /retention horizon/);
    assert.throws(() => claimOf(evmPayload('0xAE', NOW_S + 732 * 86400), REQ), /retention horizon/);
    const permit2 = nonce => ({ payload: { permit2Authorization: { from: '0xAbC0000000000000000000000000000000000001', nonce, deadline: String(NOW_S + 3600) } } });
    assert.equal(claimOf(permit2('1'), REQ).key, claimOf(permit2('0x1'), REQ).key);
    assert.equal(claimOf(permit2('1'), REQ).key, claimOf(permit2('01'), REQ).key);
    assert.equal(claimOf(permit2('1'), REQ).until, NOW_S + 3660);
    assert.equal(claimOf(svmPayload(0), REQ).key, claimOf(svmPayload(9), REQ).key);
    assert.equal(claimOf(svmPayload(0), REQ).until, NOW_S + 900);
  });
}

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
// The guard's claim timer is unref'd, as a server's should be; hold the event
// loop open so the hanging-store case is awaited instead of exiting early.
const keepAlive = setInterval(() => {}, 1000);
(async () => {
  let passed = 0;
  for (const [name, test] of tests) {
    try { await test(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
  }
  await new Promise(resolve => setImmediate(resolve));
  if (unhandled) console.error(`FAIL unhandled promise rejections: ${unhandled}`);
  console.log(`Passed: ${passed}\nFailed: ${tests.length - passed + unhandled}`);
  process.exitCode = passed === tests.length && !unhandled ? 0 : 1;
  clearInterval(keepAlive);
})();
