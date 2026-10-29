---
name: web-perimeter-owasp-2025-audit
description: Passive, non-destructive web perimeter security auditing across OWASP Top 10:2025 ("The 10 Gates"), CDN Unkeyed Header Web Cache Poisoning (X-Forwarded-Host), supply chain manifest exposure, git object dumping prevention (/.git/HEAD), cryptographic headers, and AI crawler boundary governance (llms.txt, robots.txt). Use when auditing production domains, configuring Cloudflare/Vercel/Nginx edge security, or preparing pre-launch security gates.
metadata:
  origin: ECC
---

# Web Perimeter & OWASP Top 10:2025 Audit

Conduct non-destructive, deterministic perimeter security audits against web applications, APIs, and CDN edges. Map every finding to **OWASP Top 10:2025 ("The 10 Gates")** and verify fixes with reproducible checks before shipping to production.

## Important

- Never send destructive payloads, brute-force traffic, or unisolated cache-poisoning probes against shared production cache keys.
- Before sending any `X-Forwarded-Host` or `X-Forwarded-Scheme` probe against a live target, first prove query-key isolation using fresh random per-run values (`CB_A=$(openssl rand -hex 8)` and `CB_B=$(openssl rand -hex 8)`): send a clean request with `?__cb=${CB_A}` (`--max-time 5`), repeat the identical `?__cb=${CB_A}` request at most twice (max 3 requests total, `--max-time 5` each) to confirm a cache `HIT`, and then send a single clean request with `?__cb=${CB_B}` (`--max-time 5`) and verify it produces a cache `MISS`. If `HIT` followed by `MISS` is not confirmed within those bounded attempts, abort the live probe and run it only against an isolated staging environment.
- Verify real HTTP responses rather than relying on framework defaults; reverse proxies and CDNs frequently strip or override upstream headers.
- Treat `403 Forbidden` on directory roots (such as `/.git/`) as insufficient unless direct object paths (`/.git/HEAD`, `/.git/config`) also return `404`/`403`.
- Keep all checks local by default (`curl` / standard system tools). Only invoke external CLIs or remote scorecard APIs when the user explicitly opts in and approves sharing the target hostname.

## When to Activate

- Auditing a live domain or staging environment before launch
- Reviewing Cloudflare, Vercel, AWS CloudFront, Nginx, or Next.js middleware security configurations
- Investigating CDN Web Cache Poisoning (`X-Forwarded-Host`, `X-Forwarded-Scheme`) or CORS origin reflection
- Hardening supply chain artifacts (`package-lock.json`, registry config files, source maps) and AI crawler boundaries (`llms.txt`, `robots.txt`, `security.txt`)

## Audit Workflow: The 10 Gates (OWASP Top 10:2025)

### Gate 1 & Gate 2: Broken Access Control & Security Misconfiguration (A01 / A02:2025)

1. **Direct Git Object & Config Artifact Exposure (`git-dumper` vector):**
   - Disabling directory indexing on `/.git/` (`403 Forbidden`) does **not** prevent repository reconstruction if direct object paths remain readable.
   - Probe each path using a bounded, file-specific signature without printing sensitive contents:
     - `/.git/HEAD`: check if status is `200` and the first line matches `^ref: refs/` or a 40-character hex SHA (`^[0-9a-f]{40}$`).
     - `/.git/config`: check if status is `200` and the body contains `[core]` or a `[remote "` section header.
     - `/docker-compose.yml`: check if status is `200` and the body contains a top-level `services:` block.
     - Environment configuration paths (such as `/<dotenv-artifact>`): check if status is `200` and lines match `^[A-Z][A-Z0-9_]+=` without `<!DOCTYPE` or `<html`, reporting only a boolean detection signal and never echoing secret values.
2. **CORS Arbitrary Origin Reflection:**
   - Send `Origin: https://evil-probe.invalid`.
   - If the response reflects `Access-Control-Allow-Origin: https://evil-probe.invalid` together with `Access-Control-Allow-Credentials: true`, record it as a **HIGH-priority lead**. Verify whether the endpoint serves authenticated or non-public user data in a browser context before escalating to **CRITICAL** (public endpoints that return identical unauthenticated content regardless of cookies are a lower-severity misconfiguration).
3. **Unkeyed Header Web Cache Poisoning (DoS / Defacement Vector):**
   - Only after proving query-key isolation (repeated request for query `A` returns `HIT` while distinct query `B` returns `MISS`) or on an isolated staging host, send a `GET` request with a fresh cache-buster and capture both headers and body:
     ```bash
     CB=$(openssl rand -hex 8)
     URL="https://example.com/?__cb=${CB}"
     # 1) Send isolated GET probe with unkeyed header candidates
     curl -sS -D /tmp/probe_headers.txt -o /tmp/probe_body.txt "${URL}" \
       -H "X-Forwarded-Host: cache-probe.invalid" \
       -H "X-Forwarded-Scheme: nothttps"
     # 2) Immediately send a clean follow-up GET to the identical URL without probe headers
     curl -sS -D /tmp/clean_headers.txt -o /tmp/clean_body.txt "${URL}"
     ```
   - Flag **MEDIUM (Unkeyed Input Reflection)** if `cache-probe.invalid` appears in `/tmp/probe_headers.txt` (`Location`) or `/tmp/probe_body.txt` on the first request alone.
   - Escalate to **HIGH (Confirmed Web Cache Poisoning)** only when the subsequent clean follow-up request (`/tmp/clean_headers.txt` and `/tmp/clean_body.txt`) is served from cache (`CF-Cache-Status: HIT`, `X-Cache: Hit from cloudfront`, or `Age > 0`) **and** replays the injected `cache-probe.invalid` reflection or poisoned `4xx`/`5xx` status.

### Gate 3 & Gate 8: Software Supply Chain & Data Integrity Failures (A03 / A08:2025)

1. **Public Lockfile & Registry Config Exposure:**
   - Verify that `/package.json`, `/package-lock.json`, `/pnpm-lock.yaml`, and `/yarn.lock` return `404` or `403` in production so attackers cannot harvest your exact dependency tree (SBOM).
   - Probe package-manager registry configuration paths (`/.yarnrc.yml` and package-manager registry config files) using bounded, non-exfiltrating signatures (for example, checking whether status is `200` and lines match `^(registry|@[a-z0-9_-]+:registry|npmScopes:|nodeLinker:)` without `<!DOCTYPE` or `<html`), reporting only the HTTP status and boolean match without printing file contents or tokens.
2. **Production Source Maps & Subresource Integrity (SRI):**
   - Check whether production JavaScript bundles expose `.js.map` files containing original TypeScript/business logic.
   - Require `integrity="sha384-..."` and `crossorigin="anonymous"` on third-party `<script>` tags loaded from external CDNs.

### Gate 4 & Gate 5: Cryptographic Failures & Injection Boundaries (A04 / A05:2025)

1. **Strict Transport Security (HSTS) & TLS Posture:**
   - Verify `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (`max-age >= 31536000`) and ensure plain `http://` redirects immediately (`301`/`308`) to `https://`.
2. **Content-Security-Policy (CSP) Evaluation:**
   - Verify that `Content-Security-Policy` defines `default-src`, `script-src`, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors`.
   - Flag `script-src 'unsafe-eval'` **independently** whenever present, because cryptographic nonces (`'nonce-...'`) and hashes (`'sha256-...'`) only neutralize `'unsafe-inline'` and do **not** disable `eval()` or string-to-code execution.
   - Flag `script-src 'unsafe-inline'` unless accompanied by `'strict-dynamic'` or per-response nonces/hashes (and no `unsafe-inline` fallback in modern browsers).

### Gate 6 & Gate 7: Insecure Design, Bot Governance & Auth Hardening (A06 / A07:2025)

1. **AI Crawler & Agentic Boundary Governance:**
   - Verify whether `robots.txt` explicitly defines rules for AI crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`) and whether `/llms.txt` or `/.well-known/agent.json` declares machine-readable usage policies.
   - Because attackers routinely spoof `User-Agent: ChatGPT-User` or `Googlebot` to bypass naive WAF rules, never trust `User-Agent` strings alone: verify crawlers using **Forward-Confirmed Reverse DNS (FCrDNS)** (`PTR` lookup on the client IP followed by a forward `A`/`AAAA` lookup confirming the IP matches the official domain), official published IP CIDR lists (e.g., OpenAI/Anthropic IP ranges), or cryptographic HTTP message signatures (`RFC 9421` Web Bot Auth).
2. **Session Cookie Hardening:**
   - Every `Set-Cookie` header carrying an authentication or session identifier must include `HttpOnly` and `Secure`.
   - Evaluate `SameSite` and lifetime against the application's architecture:
     - Default to `SameSite=Lax` (or `Strict`) for first-party flows; only permit `SameSite=None; Secure` when intentional cross-site embedding/federation is required and explicit anti-CSRF tokens or Fetch Metadata (`Sec-Fetch-Site`) checks are enforced.
     - Ephemeral browser-session cookies may intentionally omit `Max-Age` and `Expires` so they clear on browser close; persistent cookies must set a bounded `Max-Age` or `Expires` appropriate to the session risk tier.

### Gate 9 & Gate 10: Telemetry & Exceptional Conditions (A09 / A10:2025)

1. **Fail-Closed Error Handling (No Stack Trace Leaks):**
   - Request a non-existent route (`/api/__probe_404_<random>`) and verify that the server returns a clean, minimal JSON or HTML error without leaking stack traces (`java.sql.SQLException`, `PrismaClientKnownRequestError`, `Traceback`, `at Object.<anonymous>`, `/var/task/`, `node_modules/`).
2. **Vulnerability Disclosure Policy (`/.well-known/security.txt`):**
   - Verify RFC 9116 compliance (`Contact:` and non-expired `Expires:` fields) at `/.well-known/security.txt`.

## Optional External Verification (Explicit Opt-In Only)

By default, perform all checks locally using the `curl` workflows above so private or staging hostnames never leave the local environment. If the user explicitly authorizes third-party scanning for a public domain, pin the exact CLI package version before execution:

```bash
# Opt-in only (requires user approval for external package execution / domain disclosure):
npx @stealthmark/cli@0.1.6 audit https://example.com
```

## Remediation Reference (Next.js Headers + Path Denial Middleware)

`next.config.ts` `headers()` attaches response headers only—it does **not** block access to sensitive paths. Pair `next.config.ts` with edge `middleware.ts` (or upstream Nginx/Cloudflare rules) to deny access to hidden repository metadata and lockfiles while preserving intentional public discovery endpoints:

```typescript
// 1) next.config.ts — baseline perimeter response headers & source map hardening
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Vary", value: "Accept-Encoding, Origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

```typescript
// 2) middleware.ts — deny dotfiles, git metadata, and lockfiles while preserving public /.well-known endpoints
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_WELL_KNOWN_PATHS = new Set([
  "/.well-known/security.txt",
  "/.well-known/agent.json",
]);

const BLOCKED_PATH_PREFIXES = [
  "/.git",
  "/.yarnrc.yml",
  "/package.json",
  "/package-lock.json",
  "/pnpm-lock.yaml",
  "/yarn.lock",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    (pathname.startsWith("/.") && !PUBLIC_WELL_KNOWN_PATHS.has(pathname)) ||
    BLOCKED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}
```
