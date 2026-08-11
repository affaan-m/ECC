---
name: ito-basket-compare
description: Compare Itô prediction-market baskets against a user's knowledge base, portfolio notes, financial context, watchlist, or research thesis. Use for read-only basket comparison and gap analysis without investment advice or live trading.
origin: ECC
---

# Itô Basket Compare

Use this skill for requests such as “compare this basket with my research,”
“basket vs watchlist,” “run a gap analysis,” or “find conflicts and stale
assumptions.” It compares a basket, theme, or market set with user-provided or
explicitly selected context. It is read-only and never recommends or executes a
trade.

## Non-negotiable boundaries

- Do not advise the user to buy, sell, hold, hedge, lever, allocate, or size.
- Do not prepare or submit an order, trade, purchase, reservation, or RFQ.
- Do not run `ecc ito find`: despite its name, it submits an authenticated RFQ.
- Do not claim that `ecc ito status` returns basket data; it reads RFQ and
  procurement status. Do not use `ecc ito evals` for basket comparison.
- Do not use private documents, financial context, memory, or account data
  unless the user explicitly identifies the source for this comparison.
- Never print, echo, log, persist, or expose an API key, device token, session
  token, or secret. Never put credentials in arguments, files, or chat.
- If an operation could change external state, stop with `UNSUPPORTED_OPERATION`.
  A later confirmation cannot turn this read-only skill into an execution skill.

## Inputs and access

Accept either a pasted basket or an explicitly authorized read-only source. The
minimum basket input is a stable `basket_id` or basket label plus one or more
underliers. Each underlier should contain `underlier_id`, label, event or claim,
and any weight/probability supplied by the source. The comparison target must be
user-provided or explicitly selected; request missing material instead of
searching private stores broadly.

Record provenance for every input:

- `source_type`: `user_provided`, `public`, or `ito_authenticated`
- `source_uri`: a non-secret URL/identifier, or `null` for pasted material
- `retrieved_at`: UTC RFC 3339 time at retrieval
- `as_of`: source observation/publication time, or `null` when unknown
- `freshness_status`: `fresh`, `stale`, or `unknown`

Never label anonymous product data `ito_authenticated`; use `public`. ECC's real
CLI/MCP surface does not expose a
basket-read command: the CLI supports `login`, validation-only `auth`, `find`,
`status`, and `evals`; MCP exposes `ito_auth`, `ito_find`, and `ito_status`.
Therefore authentication success proves identity only, not basket-data
availability. Prefer the documented public product-data routes when they satisfy
the comparison; otherwise ask the user to paste/export the basket or use a
documented keyed read with the minimum scope.

The canonical product-data surfaces are:

- Anonymous, rate-limited GET routes at `https://itomarkets.com`, including
  `/api/baskets/bootstrap`, `/api/baskets/{basket_id}/bootstrap`, and
  `/api/markets/hot`. These are valid live product reads without a private key.
- The keyed developer API at `https://itomarkets.com/api/v1`. Send a configured
  public API key only as `Authorization: Bearer <key>` to that
  exact HTTPS origin. Basket reads use `GET /baskets`,
  `GET /baskets/{basket_id}`, and their documented GET-only child routes and
  require `baskets:read`. Market lookup uses `GET /markets/search`,
  `GET /markets/{market_id}`, and documented GET-only market-data child routes
  and requires `markets:read`. Never use a write scope, dashboard automation
  key, cookie, or compute device credential as
  a substitute.
- The official Python SDK package `ito-markets`, imported as `ito`, for typed
  basket and market reads. Before using it, record the installed version and
  verify the requested method, response type, origin, and required scope. Do
  not install or upgrade it without confirmation.

Use an anonymous route when it supplies the basket, underliers, and current
quote fields needed by the comparison. Use the SDK or keyed API only for a
documented field absent from public data. Validate the response contract before
comparison and record the endpoint, response `Date`, source observation
timestamp, access mode, SDK version when applicable, and cache headers.

The verified anonymous catalog source is the GET-only endpoint
`https://itomarkets.com/api/baskets/bootstrap?stream=1`. Basket detail uses
`https://itomarkets.com/api/baskets/{basket_id}/bootstrap?stream=1`. Require
HTTP 200, `contractVersion: ito.public_basket_read.v1`, and a parseable
`generated_at`. Require a `baskets` array for catalog responses; require
`basket`, `underlyers`, `charts`, `metrics`, and `commentary` objects for detail
responses. Record the URL, response `Date`, `generated_at`, `Cache-Control`,
`Age`, `Last-Modified`, and any `x-ito-edge-cache` value. Treat an edge `stale`
marker as stale provenance even when `generated_at` is recent. Do not send
credentials to this public endpoint, follow cross-origin redirects, or silently
accept a changed contract version.

## First-run authentication handoff

Resolve a concrete basket-read source and its authentication contract before
requesting authentication. The public catalog/detail endpoints require no login
and are sufficient for comparisons whose required fields they contain. If no
authenticated basket-read source/tool is configured, use public or pasted input
and do not request compute credentials.

`ecc ito auth --json` is an optional, validation-only compute identity probe. It
does not start login and cannot unlock basket reads. Use it only when the user
explicitly requests compute-account identity validation in addition to the
basket comparison; never present it as basket-source authentication.

For a concrete authenticated basket source whose documented contract explicitly
uses the canonical Itô device credential (the public `/api/v1` does not):

1. Run `ecc ito auth --json` only if that source contract requires the same
   identity. This is validation-only and never starts login.
2. On missing, expired, or confirmed revoked credentials, pause and return
   `AUTH_REQUIRED` or `AUTH_REVOKED`. Tell the user to run `ecc ito login`; it
   performs device authorization, opens the verification page by default, and
   stores the device token in macOS Keychain. `ecc ito login --no-browser`
   suppresses the browser handoff. ECC itself performs no browser automation.
3. Preserve a secret-free resume summary containing the originating task/agent,
   user request, selected input identifiers, and completed read-only steps.
4. After the user reports completion, return to the originating agent and run
   `ecc ito auth --json` once more. Resume only the original read-only request;
   never broaden scope because login succeeded.

`ITO_API_KEY` may be forwarded by compute `auth` only when already configured. Do not
read or display its value. The canonical Itô client is a separately installed,
currently unpublished dependency configured by an explicit absolute
`ECC_ITO_CLI_EXECUTABLE`; ECC does not discover it through `PATH`. If absent,
return `AUTH_REQUIRED` with installation guidance from `ito-compute`, without
inventing a successful auth result.

## Deterministic normalization and comparison

For the same normalized input and the same explicit comparison time, produce
the same output.

1. Copy inputs; never mutate source objects. Normalize text with Unicode NFKC,
   trim it, collapse internal whitespace, and use case-folded text only for
   matching. Preserve display text.
2. Convert timestamps to UTC RFC 3339. Treat missing/unparseable `as_of` as
   `null` with `freshness_status: unknown`; never substitute the current time. Reject non-finite numbers and
   probabilities outside `[0,1]`. Do not infer missing weights.
3. Deduplicate only exact normalized `underlier_id` values. If duplicate records
   disagree, retain the first record after provenance ordering and add a
   conflict; do not silently merge facts. Sort underliers by normalized
   `underlier_id`, then label. Sort sources by `source_type`, `source_uri`,
   `as_of`, and `retrieved_at`, with `null` last.
4. Use the user's freshness threshold when supplied. Otherwise use 24 hours for
   market/basket observations and 30 days for notes/research. Compare `as_of`
   with the explicit comparison time: older is `stale`, within threshold is
   `fresh`, and absent/unparseable is `unknown`. State the freshness threshold.
5. Match by exact stable ID first, then exact normalized claim/event text. Do
   not use fuzzy similarity as proof. Classify an item as:
   - `match`: same claim/direction and compatible horizon;
   - `conflict`: opposing claim, incompatible horizon, or duplicate ID with
     inconsistent facts;
   - `missing`: no target evidence for that underlier;
   - `stale`: otherwise relevant target evidence outside its threshold.
6. Keep mixed-source disagreement visible. Sort every result array by
   `underlier_id`, then evidence `source_uri`. Use explicit `null` for unknown
   scalar fields and empty arrays for no findings.

## Recovery and safe failure

- Missing/invalid fields: `INVALID_INPUT`; identify fields without echoing
  sensitive content.
- Missing/expired credentials required by a concrete basket source:
  `AUTH_REQUIRED`; provide that source's documented handoff. Use
  `AUTH_REVOKED` only when the source confirms revocation. A generic 401 is not
  proof of revocation. A 403/insufficient read scope is `AUTH_FORBIDDEN`; do not
  retry or broaden scope.
- Timeout/network/5xx/malformed response: `SOURCE_TIMEOUT`; make at most one
  read-only retry when the user-specified deadline permits. Never replace a
  failed live read with mock or stale data while calling it live.
- 429: honor a valid `Retry-After` within the user deadline; otherwise stop as
  `SOURCE_TIMEOUT`. Do not loop indefinitely.
- Required stale data: return `STALE_SOURCE` as blocked unless the user
  explicitly accepts the displayed timestamps for informational comparison.
  Even then, preserve `freshness_status: stale`.
- Unsupported CLI/tool or any state-changing request: `UNSUPPORTED_OPERATION`.

Partial results use `status: blocked`, retain only source-backed partial arrays,
and include `incomplete: true` plus the applicable error. They must never be
presented as a successful complete comparison.

## Output contract

Default to concise Markdown in this order: basket summary, comparison target,
provenance/freshness, matches, conflicts or stale assumptions, missing context,
and a user-action checklist containing research questions only. When structured
output is requested, emit JSON with stable key order and no extra keys:

```json
{
  "schema_version": "1.0",
  "status": "ok",
  "comparison_time": "2026-01-01T00:00:00Z",
  "basket": {"basket_id": "example", "label": "Example", "underliers": []},
  "target": {"label": "Research notes", "source_type": "user_provided"},
  "sources": [],
  "freshness_thresholds": {"market_hours": 24, "research_days": 30},
  "matches": [],
  "conflicts": [],
  "stale_assumptions": [],
  "missing_context": [],
  "checklist": [],
  "disclaimer": "This comparison is informational and not investment or trading advice."
}
```

Blocked output uses the same leading key order and contains no fabricated data:

```json
{
  "schema_version": "1.0",
  "status": "blocked",
  "incomplete": true,
  "error": {"code": "AUTH_REQUIRED", "message": "Read-only Itô authentication is required.", "retryable": true},
  "resume": {"originating_agent": "current", "completed_steps": []},
  "disclaimer": "This comparison is informational and not investment or trading advice."
}
```

Allowed error codes are `AUTH_REQUIRED`, `AUTH_REVOKED`, `AUTH_FORBIDDEN`,
`SOURCE_TIMEOUT`, `STALE_SOURCE`, `INVALID_INPUT`, and
`UNSUPPORTED_OPERATION`.

Always end human-readable output with exactly:

```text
This comparison is informational and not investment or trading advice.
```
