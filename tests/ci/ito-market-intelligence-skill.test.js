const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, run } = require('../../skills/ito-market-intelligence/scripts/ito-market-intelligence');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'ito-market-intelligence');
const CLIENT = path.join(SKILL, 'scripts', 'ito-market-intelligence.js');

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [CLIENT, '--json', ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 5000,
  });
}

(async () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: ito-market-intelligence\ndescription: [^\n]+\n---/);
  assert.doesNotMatch(skill.split('---')[1], /\nmetadata:/);
  for (const trigger of ['event discovery', 'venue comparison', 'basket theme', 'market brief']) assert.ok(skill.includes(trigger));
  for (const contract of ['retrieved_at', 'source-provided timestamps', 'AUTH_REJECTED', 'RATE_LIMITED', 'TIMEOUT']) assert.ok(skill.includes(contract));
  const agentMetadata = fs.readFileSync(path.join(SKILL, 'agents', 'openai.yaml'), 'utf8');
  assert.match(agentMetadata, /display_name: "Itô Market Intelligence"/);
  assert.match(agentMetadata, /default_prompt: "Use \$ito-market-intelligence /);

  let result = invoke(['search-markets']);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(JSON.parse(result.stderr).error.code, 'AUTH_MISSING');

  result = invoke(['search-markets'], { ITO_API_KEY: 'secret', ITO_MARKET_API_URL: 'http://example.com/api/v1' });
  assert.strictEqual(JSON.parse(result.stderr).error.code, 'CONFIG');
  assert.ok(!result.stderr.includes('secret'));

  const fetchSuccess = async (url, request) => {
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(request.headers.Authorization, 'Bearer test-key');
    assert.match(url.toString(), /\/markets\/search\?platform=all&limit=1$/);
    return new Response(JSON.stringify({ data: [{ market_id: 'm1', title: 'Example' }], meta: { updated_at: '2026-08-07T12:00:00Z' } }), { status: 200, headers: { 'x-ratelimit-limit': '120', 'x-ratelimit-remaining': '119', 'x-ratelimit-reset': '1786128733' } });
  };
  const payload = await run(parseArgs(['node', CLIENT, 'search-markets', '--platform', 'all', '--limit', '1']), { ITO_API_KEY: 'test-key' }, fetchSuccess);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.source.provider, 'Itô Markets');
  assert.strictEqual(payload.freshness.source_updated_at, '2026-08-07T12:00:00Z');
  assert.deepStrictEqual(payload.rate_limit, { limit: 120, remaining: 119, reset_epoch: 1786128733 });
  assert.deepStrictEqual(payload.data, [{ market_id: 'm1', title: 'Example' }]);
  assert.ok(!JSON.stringify(payload).includes('test-key'));

  const fetchPage = async url => {
    assert.match(url.toString(), /\/baskets\?page=2&per_page=5$/);
    return new Response(JSON.stringify({ data: [], meta: { page: 2, per_page: 5 } }), { status: 200 });
  };
  const pagePayload = await run(parseArgs(['node', CLIENT, 'list-baskets', '--page', '2', '--per-page', '5']), { ITO_API_KEY: 'test-key' }, fetchPage);
  assert.strictEqual(pagePayload.meta.per_page, 5);

  await assert.rejects(
    run(parseArgs(['node', CLIENT, 'list-baskets']), { ITO_API_KEY: 'revoked' }, async () => new Response('{}', { status: 401 })),
    error => error.code === 'AUTH_REJECTED' && !error.message.includes('revoked')
  );

  await assert.rejects(
    run(parseArgs(['node', CLIENT, 'list-baskets']), { ITO_API_KEY: 'key' }, async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } })),
    error => error.code === 'RATE_LIMITED' && error.details.retry_after_seconds === 7
  );

  await assert.rejects(
    run(parseArgs(['node', CLIENT, '--timeout-ms', '100', 'list-baskets']), { ITO_API_KEY: 'key' }, async (_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })),
    error => error.code === 'TIMEOUT' && !error.message.includes('key')
  );

  await assert.rejects(
    run(parseArgs(['node', CLIENT, 'list-baskets']), { ITO_API_KEY: 'key' }, async () => new Response('<html>bad gateway</html>', { status: 502 })),
    error => error.code === 'INVALID_RESPONSE' && !error.message.includes('bad gateway')
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-modules.json')));
  assert.ok(manifest.modules.some(module => module.paths?.includes('skills/ito-market-intelligence')));
  const packed = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).files;
  assert.ok(packed.includes('skills/ito-market-intelligence/'));
  fs.accessSync(CLIENT, fs.constants.R_OK);
  console.log('PASS ito-market-intelligence skill contract');
})().catch(error => { console.error(error); process.exitCode = 1; });
