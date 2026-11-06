---
name: web-perimeter-owasp-2025-audit
description: Passive, non-destructive web perimeter security auditing mapped to OWASP Top 10:2025 surface leads, CDN Unkeyed Header Web Cache Poisoning (X-Forwarded-Host), supply chain manifest exposure, git object dumping prevention (/.git/HEAD), cryptographic headers, and AI crawler boundary governance (llms.txt, robots.txt). Use when auditing production domains, configuring Cloudflare/Vercel/Nginx edge security, or preparing pre-launch perimeter checks.
metadata:
  origin: ECC
---

# Web Perimeter Security Audit (OWASP Top 10:2025 Surface Leads)

Conduct non-destructive, deterministic perimeter security audits against web applications, APIs, and CDN edges. Map observable edge findings to relevant **OWASP Top 10:2025** categories as **perimeter leads**, and verify fixes with reproducible checks before shipping to production.

## Scope & Unverified Application-Layer Areas

External HTTP response headers, CDN cache behavior, crawler policies, and disclosure files only inspect the **publicly observable edge perimeter**. Passing this checklist does **not** establish full OWASP Top 10:2025 compliance. Always report the following application-layer areas as **unverified by perimeter probing** unless backed by separate code review and authenticated testing:

- **Authorization & Object-Level Access Control (A01:2025):** BOLA/IDOR, tenant isolation, and privilege escalation require authenticated multi-role integration tests ([OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)).
- **Authentication & Session Lifecycle (A07:2025):** MFA enforcement, credential stuffing defenses, token rotation, and server-side session revocation cannot be proven from `Set-Cookie` flags alone ([OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).
- **Injection & Business Logic Processing (A05 / A06:2025):** SQL/NoSQL/command injection, SSRF, and race conditions require source analysis (SAST) and targeted DAST ([OWASP Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html)).
- **Internal Security Logging & Alerting (A09:2025):** Audit trail completeness, tamper resistance, and SIEM alerting must be verified inside the telemetry pipeline ([OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)).

## Important Safety Contract

- Never send destructive payloads, brute-force traffic, or unisolated cache-poisoning probes against shared production cache keys.
- Before sending any `X-Forwarded-Host` or `X-Forwarded-Scheme` probe against a live target, first prove query-key isolation using fresh, validated hexadecimal cache-busters (`set -euo pipefail`, `CB_A=$(openssl rand -hex 8)` and `CB_B=$(openssl rand -hex 8)`):
  1. Fail closed before sending any request if `CB_A` or `CB_B` is empty, equal, or does not match `^[0-9a-f]{16}$`.
  2. Send a clean request with `?__cb=${CB_A}` (`--connect-timeout 3 --max-time 5`), repeat the identical `?__cb=${CB_A}` request at most twice (max 3 requests total, `--max-time 5` each) to confirm a cache `HIT`, and then send a single clean request with `?__cb=${CB_B}` (`--max-time 5`) and verify it produces a cache `MISS`.
  3. If `HIT` followed by `MISS` is not confirmed within those bounded attempts, abort the live probe and run it only against an isolated staging environment.
- Use a private `mktemp -d` working directory with `trap` cleanup for all captured headers and bodies; never write to predictable shared `/tmp` filenames.
- Verify real HTTP responses rather than relying on framework defaults; reverse proxies and CDNs frequently strip or override upstream headers.
- Treat `403 Forbidden` on directory roots (such as `/.git/`) as insufficient unless direct object paths (`/.git/HEAD`, `/.git/config`) also return `404`/`403`.
- Keep all checks local by default (`curl` / standard system tools). Only invoke external CLIs or remote scorecard APIs when the user explicitly opts in and approves sharing the target hostname.

## When to Activate

- Auditing a live domain or staging environment before launch
- Reviewing Cloudflare, Vercel, AWS CloudFront, Nginx, or Next.js middleware security configurations
- Investigating CDN Web Cache Poisoning (`X-Forwarded-Host`, `X-Forwarded-Scheme`) or CORS origin reflection
- Hardening supply chain artifacts (`package-lock.json`, `/.npmrc`, `/.yarnrc.yml`, source maps) and AI crawler boundaries (`llms.txt`, `robots.txt`, `security.txt`)

## Perimeter Audit Workflow

### 1. Exposed Artifacts, CORS & Cache Isolation Leads (Related to A01 / A02:2025)

1. **Direct Git Object & Config Artifact Exposure (`git-dumper` vector):**
   - Disabling directory indexing on `/.git/` (`403 Forbidden`) does **not** prevent repository reconstruction if direct object paths remain readable.
   - Probe each path using a bounded, file-specific signature (`--connect-timeout 3 --max-time 5`) without printing sensitive contents:
     - `/.git/HEAD`: check if status is `200` and the first line matches `^ref: refs/` or a 40-character hex SHA (`^[0-9a-f]{40}$`).
     - `/.git/config`: check if status is `200` and the body contains `[core]` or a `[remote "` section header.
     - `/docker-compose.yml`: check if status is `200` and the body contains a top-level `services:` block.
     - Environment configuration paths (such as `/<dotenv-artifact>`): check if status is `200` and lines match `^[A-Z][A-Z0-9_]+=` without `<!DOCTYPE` or `<html`, reporting only a boolean detection signal and never echoing secret values.
2. **CORS Arbitrary Origin Reflection:**
   - Send `Origin: https://evil-probe.invalid` with `--connect-timeout 3 --max-time 5`.
   - If the response reflects `Access-Control-Allow-Origin: https://evil-probe.invalid` together with `Access-Control-Allow-Credentials: true`, record it as a **HIGH-priority perimeter lead**. Verify whether the endpoint serves authenticated or non-public user data in a browser context before escalating to **CRITICAL** (public endpoints that return identical unauthenticated content regardless of cookies are a lower-severity misconfiguration).
3. **Unkeyed Header Web Cache Poisoning (Bounded Probe & Local Staging Fixture):**
   - Only after proving query-key isolation (`?__cb=${CB_A}` reaches `HIT` within 3 bounded requests while `?__cb=${CB_B}` returns `MISS`) or on an isolated staging host, run the bounded probe inside a private temporary directory:
     ```bash
     set -euo pipefail
     CB_A="$(openssl rand -hex 8)"
     CB_B="$(openssl rand -hex 8)"
     if [[ ! "${CB_A}" =~ ^[0-9a-f]{16}$ ]] || [[ ! "${CB_B}" =~ ^[0-9a-f]{16}$ ]] || [[ "${CB_A}" == "${CB_B}" ]]; then
       echo "Fail closed: invalid cache-buster entropy" >&2
       exit 1
     fi

     WORK_DIR="$(mktemp -d)"
     trap 'rm -rf "${WORK_DIR}"' EXIT

     TARGET_BASE="https://example.com/"
     # Step 1: Prove query-key isolation (max 3 attempts for HIT on CB_A, then MISS on CB_B)
     CACHE_HIT=0
     for attempt in 1 2 3; do
       curl -sS --connect-timeout 3 --max-time 5 -D "${WORK_DIR}/iso_a_headers.txt" -o /dev/null "${TARGET_BASE}?__cb=${CB_A}"
       if grep -Eiq '^(cf-cache-status:\s*HIT|x-cache:\s*Hit|age:\s*[1-9])' "${WORK_DIR}/iso_a_headers.txt"; then
         CACHE_HIT=1
         break
       fi
     done
     curl -sS --connect-timeout 3 --max-time 5 -D "${WORK_DIR}/iso_b_headers.txt" -o /dev/null "${TARGET_BASE}?__cb=${CB_B}"
     if [[ "${CACHE_HIT}" -ne 1 ]] || grep -Eiq '^(cf-cache-status:\s*HIT|x-cache:\s*Hit|age:\s*[1-9])' "${WORK_DIR}/iso_b_headers.txt"; then
       echo "Aborting live probe: query-key cache isolation not proven; use isolated staging." >&2
       exit 1
     fi

     # Step 2: Isolated GET probe on a fresh cache-buster key
     CB_PROBE="$(openssl rand -hex 8)"
     [[ "${CB_PROBE}" =~ ^[0-9a-f]{16}$ ]] || exit 1
     PROBE_URL="${TARGET_BASE}?__cb=${CB_PROBE}"

     curl -sS --connect-timeout 3 --max-time 5 \
       -D "${WORK_DIR}/probe_headers.txt" -o "${WORK_DIR}/probe_body.txt" "${PROBE_URL}" \
       -H "X-Forwarded-Host: cache-probe.invalid" \
       -H "X-Forwarded-Scheme: nothttps"

     # Step 3: Clean follow-up GET to the identical URL without probe headers
     curl -sS --connect-timeout 3 --max-time 5 \
       -D "${WORK_DIR}/clean_headers.txt" -o "${WORK_DIR}/clean_body.txt" "${PROBE_URL}"
     ```
   - Flag **MEDIUM (Unkeyed Input Reflection)** if `cache-probe.invalid` appears in `${WORK_DIR}/probe_headers.txt` (`Location`) or `${WORK_DIR}/probe_body.txt` on the first request alone.
   - Escalate to **HIGH (Confirmed Web Cache Poisoning)** only when the subsequent clean follow-up request (`${WORK_DIR}/clean_headers.txt` and `${WORK_DIR}/clean_body.txt`) is served from cache (`CF-Cache-Status: HIT`, `X-Cache: Hit from cloudfront`, or `Age > 0`) **and** replays the injected `cache-probe.invalid` reflection or poisoned `4xx`/`5xx` status.
   - **Self-Contained Local Staging Fixture (Positive Replay vs. Negative Control):**
     To validate your detection logic locally without touching external networks, run this loopback fixture:
     ```bash
     python3 - << 'EOF'
     import http.server, threading, urllib.request

     STORE = {}
     class EdgeFixture(http.server.BaseHTTPRequestHandler):
         def log_message(self, *args): pass
         def do_GET(self):
             mode, _, query = self.path.partition("?")
             xfh = self.headers.get("X-Forwarded-Host", "clean.example")
             # /vulnerable caches by query only (unkeyed X-Forwarded-Host)
             # /safe includes X-Forwarded-Host in the cache key (negative control)
             key = (mode, query) if mode == "/vulnerable" else (mode, query, xfh)
             if key in STORE:
                 body, hit = STORE[key], "HIT"
             else:
                 body = f"<link href='https://{xfh}/app.js'>".encode()
                 STORE[key], hit = body, "MISS"
             self.send_response(200)
             self.send_header("CF-Cache-Status", hit)
             self.end_headers()
             self.wfile.write(body)

     srv = http.server.HTTPServer(("127.0.0.1", 0), EdgeFixture)
     port = srv.server_port
     threading.Thread(target=srv.serve_forever, daemon=True).start()

     def check_path(path):
         url = f"http://127.0.0.1:{port}{path}?__cb=deadbeef01234567"
         req1 = urllib.request.Request(url, headers={"X-Forwarded-Host": "cache-probe.invalid"})
         urllib.request.urlopen(req1, timeout=3).read()
         resp2 = urllib.request.urlopen(url, timeout=3)
         body2 = resp2.read().decode()
         hit2 = resp2.headers.get("CF-Cache-Status")
         return hit2 == "HIT" and "cache-probe.invalid" in body2

     assert check_path("/vulnerable") is True, "Expected positive replay detection on /vulnerable"
     assert check_path("/safe") is False, "Expected negative control to stay clean on /safe"
     srv.shutdown()
     print("Staging fixture verified: positive replay detected and negative control clean.")
     EOF
     ```

### 2. Software Supply Chain & Integrity Leads (Related to A03 / A08:2025)

1. **Public Lockfile & Registry Config Exposure:**
   - Verify that `/package.json`, `/package-lock.json`, `/pnpm-lock.yaml`, and `/yarn.lock` return `404` or `403` in production so attackers cannot harvest your exact dependency tree (SBOM).
   - Explicitly probe `/.npmrc` and `/.yarnrc.yml` using bounded, non-exfiltrating signatures (`--connect-timeout 3 --max-time 5`): check whether HTTP status is `200` and lines match `^(registry|@[a-z0-9_-]+:registry|//[^:]+:_authToken|npmScopes:|npmRegistries:|npmAuthToken:|nodeLinker:)` without `<!DOCTYPE` or `<html`. Report only the HTTP status code and boolean detection result; never print configuration contents or token values.
2. **Production Source Maps & Subresource Integrity (SRI):**
   - Check whether production JavaScript bundles expose `.js.map` files containing original TypeScript/business logic.
   - Require `integrity="sha384-..."` and `crossorigin="anonymous"` on third-party `<script>` tags loaded from external CDNs.

### 3. Transport & Browser Policy Leads (Related to A04 / A05:2025)

1. **Conditional Strict Transport Security (HSTS) & TLS Posture:**
   - Verify that plain `http://` redirects immediately (`301`/`308`) to `https://` and that HTTPS responses include `Strict-Transport-Security` with an appropriate `max-age` (e.g., `max-age=31536000`).
   - Treat `includeSubDomains` and `preload` as **conditional deployment decisions**, not universal defaults:
     - Only add `includeSubDomains` after confirming that **every** subdomain under the registered domain supports valid HTTPS; otherwise browsers will refuse connections to HTTP-only internal or legacy subdomains.
     - Keep `preload` submission a separate, explicit operational decision after reviewing the [HSTS preload requirements](https://hstspreload.org/), because removal from browser preload lists takes months to propagate.
2. **Content-Security-Policy (CSP) Evaluation:**
   - Verify that `Content-Security-Policy` defines `default-src`, `script-src`, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors`.
   - Flag `script-src 'unsafe-eval'` **independently** whenever present, because cryptographic nonces (`'nonce-...'`) and hashes (`'sha256-...'`) only neutralize `'unsafe-inline'` and do **not** disable `eval()` or string-to-code execution.
   - Flag `script-src 'unsafe-inline'` unless accompanied by `'strict-dynamic'` or per-response nonces/hashes (and no `unsafe-inline` fallback in modern browsers).

### 4. Crawler Boundary & Session Cookie Leads (Related to A06 / A07:2025)

1. **AI Crawler & Agentic Boundary Governance:**
   - Verify whether `robots.txt` explicitly defines rules for AI crawlers (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`) and whether `/llms.txt` or `/.well-known/agent.json` declares machine-readable usage policies.
   - Because attackers routinely spoof `User-Agent: ChatGPT-User` or `Googlebot` to bypass naive WAF rules, never trust `User-Agent` strings alone: verify crawlers using **Forward-Confirmed Reverse DNS (FCrDNS)** (`PTR` lookup on the client IP followed by a forward `A`/`AAAA` lookup confirming the IP matches the official domain), official published IP CIDR lists (e.g., OpenAI/Anthropic IP ranges), or cryptographic HTTP message signatures (`RFC 9421` Web Bot Auth).
2. **Session Cookie Hardening (Perimeter Surface):**
   - Every `Set-Cookie` header carrying an authentication or session identifier must include `HttpOnly` and `Secure`.
   - Evaluate `SameSite` and lifetime against the application's architecture:
     - Default to `SameSite=Lax` (or `Strict`) for first-party flows; only permit `SameSite=None; Secure` when intentional cross-site embedding/federation is required and explicit anti-CSRF tokens or Fetch Metadata (`Sec-Fetch-Site`) checks are enforced.
     - Ephemeral browser-session cookies may intentionally omit `Max-Age` and `Expires` so they clear on browser close; persistent cookies must set a bounded `Max-Age` or `Expires` appropriate to the session risk tier.

### 5. Error Surface & Disclosure Policy Leads (Related to A09 / A10:2025)

1. **Fail-Closed Error Handling (No Stack Trace Leaks):**
   - Request a non-existent route (`/api/__probe_404_<random>`) with `--connect-timeout 3 --max-time 5` and verify that the server returns a clean, minimal JSON or HTML error without leaking stack traces (`java.sql.SQLException`, `PrismaClientKnownRequestError`, `Traceback`, `at Object.<anonymous>`, `/var/task/`, `node_modules/`).
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

// Add "; includeSubDomains" only after confirming every subdomain supports HTTPS.
// Add "; preload" only as an explicit decision per https://hstspreload.org/ requirements.
const HSTS_POLICY =
  process.env.HSTS_ENABLE_PRELOAD === "true"
    ? "max-age=63072000; includeSubDomains; preload"
    : process.env.HSTS_INCLUDE_SUBDOMAINS === "true"
      ? "max-age=31536000; includeSubDomains"
      : "max-age=31536000";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: HSTS_POLICY },
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
// 2) middleware.ts — deny dotfiles, git metadata, registry configs, and lockfiles while preserving public /.well-known endpoints
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_WELL_KNOWN_PATHS = new Set([
  "/.well-known/security.txt",
  "/.well-known/agent.json",
]);

const BLOCKED_PATH_PREFIXES = [
  "/.git",
  "/.npmrc",
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
