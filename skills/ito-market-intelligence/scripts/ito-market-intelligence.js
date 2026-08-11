#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://itomarkets.com/api/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(code, message, details = {}, exitCode = 1) {
  const error = new Error(message);
  Object.assign(error, { code, details, exitCode });
  throw error;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { json: false, timeoutMs: DEFAULT_TIMEOUT_MS, params: {} };
  while (args[0]?.startsWith('--')) {
    const flag = args.shift();
    if (flag === '--json') options.json = true;
    else if (flag === '--timeout-ms') options.timeoutMs = Number(args.shift());
    else fail('USAGE', `Unknown global option: ${flag}`, {}, 2);
  }
  options.command = args.shift();
  while (args.length) {
    const flag = args.shift();
    if (!flag?.startsWith('--') || !args.length) fail('USAGE', `Invalid option: ${flag || '(missing)'}`, {}, 2);
    options.params[flag.slice(2)] = args.shift();
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000) {
    fail('USAGE', '--timeout-ms must be an integer from 100 to 60000', {}, 2);
  }
  return options;
}

function commandPath(command, params) {
  const enc = encodeURIComponent;
  if (command === 'list-baskets') return ['/baskets', new Set(['page', 'per-page'])];
  if (command === 'search-markets') return ['/markets/search', new Set(['platform', 'category', 'expiration', 'limit'])];
  if (command === 'get-market' && params['market-id']) return [`/markets/${enc(params['market-id'])}`, new Set(['platform'])];
  if (command === 'market-history' && params['market-id']) return [`/markets/${enc(params['market-id'])}/history`, new Set(['platform', 'days'])];
  fail('USAGE', 'Use list-baskets, search-markets, get-market --market-id ID, or market-history --market-id ID', {}, 2);
}

function safeBaseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('CONFIG', 'ITO_MARKET_API_URL must be an absolute URL'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    fail('CONFIG', 'ITO_MARKET_API_URL must use HTTPS (HTTP is allowed only for loopback tests)');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

async function run(options, environment = process.env, fetchImpl = fetch) {
  const apiKey = environment.ITO_API_KEY?.trim();
  if (!apiKey) fail('AUTH_MISSING', 'No Itô market API credential is configured. Set ITO_API_KEY outside chat.');
  const base = safeBaseUrl(environment.ITO_MARKET_API_URL || DEFAULT_BASE_URL);
  const [pathname, allowed] = commandPath(options.command, options.params);
  const url = new URL(`${base.pathname}${pathname}`, base);
  for (const [key, value] of Object.entries(options.params)) {
    if (key === 'market-id') continue;
    if (!allowed.has(key)) fail('USAGE', `Option --${key} is not valid for ${options.command}`, {}, 2);
    url.searchParams.set(key === 'per-page' ? 'per_page' : key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const retrievedAt = new Date().toISOString();
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (error) {
    if (error?.name === 'AbortError') fail('TIMEOUT', `Itô market API did not respond within ${options.timeoutMs}ms`);
    fail('UPSTREAM_ERROR', 'Itô market API request failed');
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await response.json(); } catch { fail('INVALID_RESPONSE', 'Itô market API returned non-JSON content'); }
  if (response.status === 401 || response.status === 403) fail('AUTH_REJECTED', 'Itô rejected the credential or required read scope');
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after'));
    fail('RATE_LIMITED', 'Itô market API rate limit reached', Number.isFinite(retry) ? { retry_after_seconds: retry } : {});
  }
  if (!response.ok) fail('UPSTREAM_ERROR', `Itô market API returned HTTP ${response.status}`, { status: response.status });
  const rateLimit = {};
  for (const [field, header] of [['limit', 'x-ratelimit-limit'], ['remaining', 'x-ratelimit-remaining'], ['reset_epoch', 'x-ratelimit-reset']]) {
    const value = Number(response.headers.get(header));
    if (Number.isFinite(value)) rateLimit[field] = value;
  }
  return {
    ok: true,
    command: options.command,
    retrieved_at: retrievedAt,
    source: { provider: 'Itô Markets', url: url.toString(), http_status: response.status },
    freshness: { source_updated_at: body?.meta?.updated_at || body?.data?.updated_at || null, caveat: 'Snapshot at retrieval time; verify source timestamps before acting.' },
    rate_limit: Object.keys(rateLimit).length ? rateLimit : null,
    data: body?.data ?? body,
    meta: body?.meta ?? null,
  };
}

function print(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.command}: ${JSON.stringify(result.data)}\nSource: ${result.source.url}\nRetrieved: ${result.retrieved_at}\n`);
}

if (require.main === module) {
  let options = { json: process.argv.includes('--json') };
  Promise.resolve().then(() => { options = parseArgs(process.argv); return run(options); })
    .then(result => print(result, options.json))
    .catch(error => {
      const payload = { ok: false, error: { code: error.code || 'INTERNAL', message: error.message, ...(error.details && Object.keys(error.details).length ? { details: error.details } : {}) } };
      process.stderr.write(`${options.json ? JSON.stringify(payload, null, 2) : `${payload.error.code}: ${payload.error.message}`}\n`);
      process.exitCode = error.exitCode || 1;
    });
}

module.exports = { parseArgs, run, safeBaseUrl };
