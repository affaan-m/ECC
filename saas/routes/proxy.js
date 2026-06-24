'use strict';

const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

const { optimizeRequest } = require('../lib/prompt-optimizer');
const { calculateCost } = require('../lib/providers');
const cache = require('../lib/cache-manager');
const db = require('../lib/db');
const { countTokens } = require('../lib/token-counter');

// Extract org ID from API key or header
function extractOrgId(req) {
  const key = req.headers['x-tokenguard-org'] || req.headers['authorization'] || 'default';
  return key.slice(0, 16).replace(/[^a-z0-9]/gi, '_');
}

// Detect provider from path prefix: /proxy/openai/v1/... or /proxy/anthropic/v1/...
function detectProvider(req) {
  const parts = req.path.split('/').filter(Boolean);
  return parts[0] || 'openai';
}

// Forward request to upstream provider
function forwardRequest(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : '';

    const reqHeaders = {
      ...headers,
      host: url.hostname,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(bodyStr),
    };
    // Remove hop-by-hop headers
    ['connection', 'transfer-encoding', 'x-tokenguard-org', 'x-tokenguard-aggressive'].forEach(h => delete reqHeaders[h]);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: proxyRes.statusCode, headers: proxyRes.headers, raw });
      });
    });
    proxyReq.on('error', reject);
    if (bodyStr) proxyReq.write(bodyStr);
    proxyReq.end();
  });
}

// Build upstream URL for each provider
function buildUpstreamUrl(provider, originalPath) {
  const UPSTREAM = {
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com',
    google: 'https://us-central1-aiplatform.googleapis.com',
    bedrock: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  };
  const base = UPSTREAM[provider] || UPSTREAM.openai;
  // Strip /proxy/<provider> prefix
  const stripped = originalPath.replace(new RegExp(`^/proxy/${provider}`), '');
  return base + (stripped || '/');
}

// ── Main proxy handler ─────────────────────────────────────────────────────
router.all('/:provider/*', async (req, res) => {
  const provider = req.params.provider;
  const aggressive = req.headers['x-tokenguard-aggressive'] === 'true';
  const noCache = req.headers['x-tokenguard-no-cache'] === 'true';
  const orgId = extractOrgId(req);

  let body = req.body;
  const model = body?.model || 'unknown';
  const isChat = body?.messages && Array.isArray(body.messages);

  let optimization = { savedTokens: 0, savingPct: 0, techniques: [], originalTokens: 0, optimizedTokens: 0 };
  let cacheHit = false;
  let upstreamResponse = null;

  // ── Cache check ────────────────────────────────────────────────────────
  if (isChat && !noCache) {
    const cached = cache.get(provider, model, body.messages);
    if (cached) {
      cacheHit = true;
      const { cost: savedCost, co2Grams: savedCo2 } = calculateCost(
        provider, model,
        cached.usage?.prompt_tokens || cached.usage?.input_tokens || 0,
        cached.usage?.completion_tokens || cached.usage?.output_tokens || 0
      );
      db.recordRequest({
        orgId, provider, model, cacheHit: true,
        inputTokens: 0, outputTokens: 0,
        savedTokens: cached.usage?.prompt_tokens || 0,
        savedCost, savedCo2, techniques: ['cache-hit'],
        savingPct: 100,
      });
      return res.json({ ...cached, _tokenguard: { cacheHit: true, savedCost, savedCo2Grams: savedCo2 } });
    }
  }

  // ── Prompt optimization ────────────────────────────────────────────────
  if (isChat) {
    optimization = optimizeRequest(body, { aggressive });
    body = optimization.optimizedBody;
  }

  // ── Forward to upstream ────────────────────────────────────────────────
  try {
    const upstreamUrl = buildUpstreamUrl(provider, req.path);
    const result = await forwardRequest(upstreamUrl, req.method, req.headers, body);
    let parsed = null;
    try { parsed = JSON.parse(result.raw); } catch { /* passthrough non-JSON */ }

    upstreamResponse = parsed || result.raw;

    // Extract actual token usage from response
    const usage = parsed?.usage || {};
    const inputTokens = usage.prompt_tokens || usage.input_tokens || optimization.optimizedTokens;
    const outputTokens = usage.completion_tokens || usage.output_tokens || 0;

    // Cost of what we sent vs what we would have sent without optimization
    const { cost: actualCost, co2Grams: actualCo2 } = calculateCost(provider, model, inputTokens, outputTokens);
    const { cost: wouldBeCost, co2Grams: wouldBeCo2 } = calculateCost(provider, model, optimization.originalTokens, outputTokens);
    const savedCost = Math.max(0, wouldBeCost - actualCost);
    const savedCo2 = Math.max(0, wouldBeCo2 - actualCo2);

    // Store in cache
    if (isChat && !noCache && parsed) {
      cache.set(provider, model, (optimization.optimizedBody || body).messages, parsed);
    }

    db.recordRequest({
      orgId, provider, model, cacheHit: false,
      inputTokens, outputTokens,
      savedTokens: optimization.savedTokens,
      savedCost, savedCo2,
      techniques: optimization.techniques,
      savingPct: optimization.savingPct,
    });

    const tgMeta = {
      optimizedTokens: optimization.optimizedTokens,
      originalTokens: optimization.originalTokens,
      savedTokens: optimization.savedTokens,
      savingPct: optimization.savingPct,
      techniques: optimization.techniques,
      savedCostUSD: savedCost,
      savedCo2Grams: savedCo2,
      cacheHit: false,
    };

    if (parsed) {
      return res.status(result.status).json({ ...parsed, _tokenguard: tgMeta });
    }
    res.status(result.status).send(result.raw);

  } catch (err) {
    res.status(502).json({ error: 'TokenGuard proxy error', detail: err.message });
  }
});

module.exports = router;
