/**
 * Contract and lifecycle tests for the consolidated Itô baskets data skill.
 * No test contacts Itô, opens a browser, or submits an RFQ/order.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseArgs, run } = require("../../skills/ito-baskets/scripts/ito-baskets");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SKILL_DIR = path.join(REPO_ROOT, "skills", "ito-baskets");
const SKILL_PATH = path.join(SKILL_DIR, "SKILL.md");
const CLIENT = path.join(SKILL_DIR, "scripts", "ito-baskets.js");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [CLIENT, "--json", ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
    timeout: 5000,
  });
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("has valid discoverable frontmatter and consolidated trigger phrases", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  assert.match(skill, /^---\nname: ito-baskets\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n/);
  assert.match(skill, /aliases: ito-basket-compare, ito-market-intelligence, ito-data-atlas-agent, ito-trade-planner/);
  const lower = skill.toLowerCase();
  for (const phrase of [
    "compare this basket", "basket vs", "gap analysis", "stale assumptions", "watchlist",
    "event discovery", "venue comparison", "basket theme", "market brief",
    "planning worksheet", "basket catalog", "index",
  ]) {
    assert.ok(lower.includes(phrase), `missing trigger phrase: ${phrase}`);
  }
});

test("states that it replaces the four former skills and routes their requests", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  assert.match(skill, /replaces the\s+former `ito-basket-compare`, `ito-market-intelligence`, `ito-data-atlas-agent`,\s+and `ito-trade-planner`/);
  const modules = readJson("manifests/install-modules.json").modules;
  const module = modules.find((candidate) => candidate.id === "prediction-market-skills");
  assert.ok(module, "prediction-market-skills module is missing");
  assert.ok(module.paths.includes("skills/ito-baskets"), "consolidated skill is not installed by the module");
  for (const removed of ["ito-basket-compare", "ito-market-intelligence", "ito-data-atlas-agent", "ito-trade-planner"]) {
    assert.ok(!module.paths.includes(`skills/${removed}`), `removed skill still in module: ${removed}`);
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, "skills", removed)), `removed skill directory still exists: ${removed}`);
  }
  assert.strictEqual(module.defaultInstall, false);
  const packed = readJson("package.json").files;
  assert.ok(packed.includes("skills/ito-baskets/"), "consolidated skill missing from npm files");
  for (const removed of ["ito-basket-compare", "ito-market-intelligence", "ito-data-atlas-agent", "ito-trade-planner"]) {
    assert.ok(!packed.includes(`skills/${removed}/`), `removed skill still packed: ${removed}`);
  }
});

test("preserves the non-advisory, non-executing boundary from all four predecessors", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  assert.match(skill, /never advise the user to buy, sell, hold, hedge, lever, allocate, or size/i);
  assert.match(skill, /never place, cancel, route, sign, simulate, or submit/i);
  assert.match(skill, /no execution path and no\s+confirmation can give it one/i);
  assert.match(skill, /`ecc ito find` submits an\s+authenticated RFQ/);
  assert.match(skill, /`ecc ito status` reads RFQ\/procurement status, not\s+basket data/);
  assert.match(skill, /UNSUPPORTED_OPERATION/);
  assert.match(skill, /prediction-market-risk-review/);
  assert.doesNotMatch(skill, /(?:run|invoke|call) `?ecc ito (?:find|status)/i);
  assert.match(skill, /never call a trade good, bad, best, optimal,\s+guaranteed, or risk-free/i);
  for (const advisory of [/\byou should buy\b/i, /\byou should sell\b/i, /\bbest trade\b/i, /\boptimal size\b/i]) {
    assert.doesNotMatch(skill, advisory);
  }
});

test("documents anonymous, keyed, and SDK surfaces with scope and credential separation", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  assert.match(skill, /\/api\/baskets\/bootstrap\?stream=1/);
  assert.match(skill, /ito\.public_basket_read\.v1/);
  assert.match(skill, /\/api\/markets\/hot/);
  assert.match(skill, /https:\/\/itomarkets\.com\/api\/v1/);
  assert.match(skill, /Authorization: Bearer/);
  assert.match(skill, /baskets:read/);
  assert.match(skill, /markets:read/);
  assert.match(skill, /bkt_\*/);
  assert.match(skill, /ito-markets/);
  assert.match(skill, /compute device credential[\s\S]*never a\s+substitute|never a\s+substitute[\s\S]*compute device credential/i);
  assert.match(skill, /never uses device authorization or `ecc ito login`/i);
  assert.match(skill, /x-ito-edge-cache/);
  assert.match(skill, /never send credentials to these routes/i);
});

test("documents provenance, deterministic normalization, and recovery contracts", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  for (const field of ["source_type", "source_uri", "retrieved_at", "as_of", "freshness_status", "access_mode"]) {
    assert.match(skill, new RegExp(`\\b${field}\\b`), `missing provenance field: ${field}`);
  }
  for (const code of ["INVALID_INPUT", "AUTH_MISSING", "AUTH_REJECTED", "AUTH_FORBIDDEN", "RATE_LIMITED", "TIMEOUT", "UPSTREAM_ERROR", "INVALID_RESPONSE", "STALE_SOURCE", "UNSUPPORTED_OPERATION"]) {
    assert.ok(skill.includes(code), `missing error code: ${code}`);
  }
  assert.match(skill, /Unicode NFKC/);
  assert.match(skill, /24 hours for market\/basket/);
  assert.match(skill, /30 days for notes\/research/);
  assert.match(skill, /identical output/i);
  assert.match(skill, /match.*conflict.*missing.*stale/is);
  assert.match(skill, /120 requests\/minute/);
  assert.match(skill, /untrusted data/i);
  assert.match(skill, /never treat[\s\S]*draft[\s\S]*approval|confirmation during planning is never an order/i);
});

test("keeps every mode disclaimer exact", () => {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  assert.ok(skill.includes("This is market data, not investment or trading advice."));
  assert.ok(skill.includes("This comparison is informational and not investment or trading advice."));
  assert.ok(skill.includes("This is a planning worksheet, not investment or trading advice. Review venue rules and make any trading decisions yourself."));
});

test("ships agent metadata for the consolidated skill", () => {
  const agentMetadata = fs.readFileSync(path.join(SKILL_DIR, "agents", "openai.yaml"), "utf8");
  assert.match(agentMetadata, /display_name: "Itô Baskets"/);
  assert.match(agentMetadata, /default_prompt: "Use \$ito-baskets /);
});

test("keyed client keeps the GET-only contract and never echoes credentials", async () => {
  let result = invoke(["search-markets"]);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(JSON.parse(result.stderr).error.code, "AUTH_MISSING");
  assert.match(JSON.parse(result.stderr).error.message, /anonymous basket-index\/basket-detail/);

  result = invoke(["search-markets"], { ITO_API_KEY: "secret", ITO_MARKET_API_URL: "http://example.com/api/v1" });
  assert.strictEqual(JSON.parse(result.stderr).error.code, "CONFIG");
  assert.ok(!result.stderr.includes("secret"));

  const fetchSuccess = async (url, request) => {
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.headers.Authorization, "Bearer test-key");
    assert.match(url.toString(), /\/markets\/search\?platform=all&limit=1$/);
    return new Response(JSON.stringify({ data: [{ market_id: "m1", title: "Example" }], meta: { updated_at: "2026-08-07T12:00:00Z" } }), { status: 200, headers: { "x-ratelimit-limit": "120", "x-ratelimit-remaining": "119", "x-ratelimit-reset": "1786128733" } });
  };
  const payload = await run(parseArgs(["node", CLIENT, "search-markets", "--platform", "all", "--limit", "1"]), { ITO_API_KEY: "test-key" }, fetchSuccess);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.access_mode, "keyed");
  assert.strictEqual(payload.source.provider, "Itô Markets");
  assert.strictEqual(payload.freshness.source_updated_at, "2026-08-07T12:00:00Z");
  assert.deepStrictEqual(payload.rate_limit, { limit: 120, remaining: 119, reset_epoch: 1786128733 });
  assert.deepStrictEqual(payload.data, [{ market_id: "m1", title: "Example" }]);
  assert.ok(!JSON.stringify(payload).includes("test-key"));

  const fetchPage = async (url) => {
    assert.match(url.toString(), /\/baskets\?page=2&per_page=5$/);
    return new Response(JSON.stringify({ data: [], meta: { page: 2, per_page: 5 } }), { status: 200 });
  };
  const pagePayload = await run(parseArgs(["node", CLIENT, "list-baskets", "--page", "2", "--per-page", "5"]), { ITO_API_KEY: "test-key" }, fetchPage);
  assert.strictEqual(pagePayload.meta.per_page, 5);

  await assert.rejects(
    run(parseArgs(["node", CLIENT, "list-baskets"]), { ITO_API_KEY: "revoked" }, async () => new Response("{}", { status: 401 })),
    (error) => error.code === "AUTH_REJECTED" && !error.message.includes("revoked")
  );
  await assert.rejects(
    run(parseArgs(["node", CLIENT, "list-baskets"]), { ITO_API_KEY: "key" }, async () => new Response("{}", { status: 429, headers: { "retry-after": "7" } })),
    (error) => error.code === "RATE_LIMITED" && error.details.retry_after_seconds === 7
  );
  await assert.rejects(
    run(parseArgs(["node", CLIENT, "--timeout-ms", "100", "list-baskets"]), { ITO_API_KEY: "key" }, async (_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })),
    (error) => error.code === "TIMEOUT" && !error.message.includes("key")
  );
  await assert.rejects(
    run(parseArgs(["node", CLIENT, "list-baskets"]), { ITO_API_KEY: "key" }, async () => new Response("<html>bad gateway</html>", { status: 502 })),
    (error) => error.code === "INVALID_RESPONSE" && !error.message.includes("bad gateway")
  );
});

test("anonymous index commands never send a credential and validate the public contract", async () => {
  const indexBody = { contractVersion: "ito.public_basket_read.v1", generated_at: "2026-08-12T00:00:00Z", baskets: [{ basket_id: "b1" }] };
  const fetchIndex = async (url, request) => {
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.headers.Authorization, undefined);
    assert.strictEqual(url.hostname, "itomarkets.com");
    assert.strictEqual(url.pathname, "/api/baskets/bootstrap");
    assert.strictEqual(url.search, "?stream=1");
    return new Response(JSON.stringify(indexBody), { status: 200, headers: { "cache-control": "public, max-age=30", "x-ito-edge-cache": "HIT" } });
  };
  // Even with ITO_API_KEY configured, anonymous commands must not transmit it.
  const payload = await run(parseArgs(["node", CLIENT, "basket-index"]), { ITO_API_KEY: "must-not-leak" }, fetchIndex);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.access_mode, "anonymous");
  assert.strictEqual(payload.freshness.source_updated_at, "2026-08-12T00:00:00Z");
  assert.strictEqual(payload.cache.edge_cache, "HIT");
  assert.ok(!JSON.stringify(payload).includes("must-not-leak"));

  await assert.rejects(
    run(parseArgs(["node", CLIENT, "basket-index"]), {}, async () => new Response(JSON.stringify({ contractVersion: "ito.public_basket_read.v0", baskets: [] }), { status: 200 })),
    (error) => error.code === "INVALID_RESPONSE" && /contract changed or missing/.test(error.message)
  );
  await assert.rejects(
    run(parseArgs(["node", CLIENT, "basket-index"]), {}, async () => new Response(JSON.stringify({ contractVersion: "ito.public_basket_read.v1", generated_at: "2026-08-12T00:00:00Z" }), { status: 200 })),
    (error) => error.code === "INVALID_RESPONSE" && /baskets array/.test(error.message)
  );
  await assert.rejects(
    run(parseArgs(["node", CLIENT, "basket-detail", "--basket-id", "b1"]), {}, async () => new Response(JSON.stringify({ contractVersion: "ito.public_basket_read.v1", generated_at: "2026-08-12T00:00:00Z", basket: {}, underlyers: [], charts: {}, metrics: {} }), { status: 200 })),
    (error) => error.code === "INVALID_RESPONSE" && /commentary/.test(error.message)
  );

  const detailBody = { contractVersion: "ito.public_basket_read.v1", generated_at: "2026-08-12T00:00:00Z", basket: { basket_id: "b1" }, underlyers: [], charts: {}, metrics: {}, commentary: {} };
  const detail = await run(parseArgs(["node", CLIENT, "basket-detail", "--basket-id", "b1"]), {}, async (url) => {
    assert.strictEqual(url.hostname, "itomarkets.com");
    assert.strictEqual(url.pathname, "/api/baskets/b1/bootstrap");
    return new Response(JSON.stringify(detailBody), { status: 200 });
  });
  assert.strictEqual(detail.ok, true);
  assert.strictEqual(detail.access_mode, "anonymous");
});

test("client rejects unknown commands, mutations, and bad options before any fetch", () => {
  for (const args of [["create-basket"], ["delete-basket"], ["order"], ["basket-detail"], ["basket-index", "--page", "1"]]) {
    const result = invoke(args, { ITO_API_KEY: "key" });
    assert.strictEqual(result.status, 2, `expected USAGE exit 2 for: ${args.join(" ")}`);
    assert.strictEqual(JSON.parse(result.stderr).error.code, "USAGE");
  }
  fs.accessSync(CLIENT, fs.constants.R_OK);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
      failed += 1;
    }
  }
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  else console.log("PASS ito-baskets skill contract");
})();
