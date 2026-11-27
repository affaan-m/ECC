---
name: launch-readiness-audit
description: Audit a product homepage for directory and link-preview readiness across 16 static HTML checks, prepare a canonical launch listing kit, filter startup and AI directories by Domain Rating and link type, and verify live directory backlinks. Use before launching a SaaS, AI tool, or developer product on launchpads and directories.
metadata:
  origin: ECC
---

# Launch Readiness & Directory Audit

Verify that a product homepage renders clean static HTML for directory reviewers and link-preview bots, assemble a single reusable listing kit, select target launch directories without badge-swap surprises, and confirm whether published listings pass a followed backlink.

## When to Activate

- Preparing a SaaS, AI tool, or developer product for launch week across directories and launchpads.
- Checking whether a landing page exposes complete static HTML metadata (`<title>`, meta description, reachable `og:image`, X card, canonical, favicon, `<h1>`, JSON-LD, `robots.txt`, `sitemap.xml`) before submitting.
- Filtering candidate launch directories by Ahrefs Domain Rating (DR), `dofollow` vs `nofollow`, free vs paid routes, and reciprocal badge requirements.
- Auditing live directory listing URLs to confirm whether they render a direct followed anchor or hide behind `rel="nofollow"`, redirects, or `noindex`.

For broader ongoing search strategy (keyword mapping, Core Web Vitals, content hubs), use the `seo` skill. For edge security headers and OWASP perimeter checks, use `web-perimeter-owasp-2025-audit`.

## Workflow

### 1. Run Static HTML Launch Readiness Checks

Directory crawlers and link-preview bots usually read raw HTTP HTML without running client-side JavaScript. Inspect the production URL first — either locally with `curl` or via an optional keyless MCP call.

#### Local static HTML check (zero external dependencies)

```bash
TARGET="https://example.com"
curl -sSIL --max-redirs 5 --connect-timeout 5 --max-time 10 "$TARGET" | head -n 30
HTML="$(curl -sSL --connect-timeout 5 --max-time 10 "$TARGET")"
printf '%s\n' "$HTML" | grep -iE '<title>|name="description"|name="viewport"|property="og:|name="twitter:|rel="canonical"|rel="icon"|<h1|application/ld\+json|noindex' | head -n 40
# Inspect visible static body copy (without JS execution)
printf '%s\n' "$HTML" | python3 -c '
import sys, html.parser
class TextOnly(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.skip = False; self.out = []
    def handle_starttag(self, t, a):
        if t in ("script", "style", "noscript"): self.skip = True
    def handle_endtag(self, t):
        if t in ("script", "style", "noscript"): self.skip = False
    def handle_data(self, d):
        if not self.skip and d.strip(): self.out.append(d.strip())
p = TextOnly(); p.feed(sys.stdin.read())
print(" ".join(p.out)[:400])
'
# Fetch full bodies so Disallow: / rules and valid XML sitemaps are checked, not just HTTP status
curl -sSL --max-time 5 "${TARGET%/}/robots.txt" | head -n 30
curl -sSL --max-time 5 "${TARGET%/}/sitemap.xml" | head -n 20
```

Confirm all 16 checks before submitting anywhere:

| Check | Pass Criteria |
| --- | --- |
| HTTPS & status | Final URL uses `https://` and returns HTTP `200` (not parked or 404) |
| Indexability | No `noindex` in `<meta name="robots">` or `X-Robots-Tag` |
| `<title>` | Present, specific, 30–65 characters |
| Meta description | Present, plain text, 70–160 characters |
| `og:image` | Declared and returns HTTP `200` with an image `Content-Type` |
| X / Twitter card | `twitter:card` (`summary_large_image` or `summary`) present |
| Favicon | Reachable `<link rel="icon">` or `/favicon.ico` |
| Canonical | Self-referencing `<link rel="canonical">` on the production custom domain |
| Mobile viewport | `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| Primary `<h1>` | Single clear heading visible in static HTML |
| Structured data | Valid JSON-LD (`SoftwareApplication`, `WebApplication`, or `Organization`) |
| `robots.txt` & `sitemap.xml` | Both reachable and do not block the homepage |
| Static body | Meaningful copy present in initial HTML without JS execution |
| Response latency | Fast TTFB from public networks |

#### Optional keyless MCP audit

If you want a scored 16-point report and access to a 1,600+ directory dataset, [SaaSCity's keyless Streamable HTTP MCP server](https://saascity.io/mcp) (`https://saascity.io/api/mcp`) requires no API key:

```json
{
  "mcpServers": {
    "saascity": {
      "type": "http",
      "url": "https://saascity.io/api/mcp"
    }
  }
}
```

Tools available on `https://saascity.io/api/mcp`:
- `check_launch_readiness({ url })` — 16-point static HTML audit returning a `0–100` score, `verdict` (`ready`, `almost_ready`, `not_ready`), and per-check fixes.
- `recommend_launch_directories({ product_type, free_only })` — curated launchpads and evergreen directories (`saas`, `ai`, `devtools`, `any`) with editorial notes.
- `find_launch_directories({ min_dr, link_type, pricing, exclude_badge_exchange, category, limit, offset })` — filter 1,600+ directories by Ahrefs DR, `dofollow`/`nofollow`, pricing, and badge-swap requirements.
- `get_launch_directory({ domain })` — vet a single directory before paying.
- `check_backlink({ page_url, your_domain })` — verify live listing HTML for direct links, `rel` attributes, redirects, and `noindex`.

If `verdict` is `not_ready`, fix every `FAIL` item in the repository and re-check before submitting anywhere.

### 2. Assemble One Canonical Listing Kit

Prepare all submission fields once and confirm them with the user so descriptions stay consistent:

```yaml
product_name: ""          # 3-60 chars
website_url: "https://"   # Custom production domain (avoid preview subdomains)
tagline: ""               # 10-100 chars: what it does and for whom
short_description: ""     # 150-280 chars, plain text
long_description: ""      # 300-1000 chars: problem, users, differentiator
pricing: ""               # free | freemium | paid | open-source
tags: []                  # 5-10 concise keywords
logo_square: ""           # 512x512 PNG/SVG
og_image: ""              # 1200x630 PNG/JPG reachable over HTTPS
```

### 3. Sequence Submissions into Three Waves

Group candidate directories into a dated Markdown or CSV checklist (`directory`, `submit_url`, `dr`, `link_type`, `pricing`, `badge_exchange`, `status`):

1. **Wave 1 (Days 1–3):** Time-sensitive launch platforms where voting windows and launch-day momentum matter.
2. **Wave 2 (Days 4–10):** High-DR evergreen software and AI directories with free or freemium routes (see [free dofollow directories](https://saascity.io/free-dofollow-directories) or query `find_launch_directories`).
3. **Wave 3 (Days 11–14):** Niche vertical catalogs, developer communities, and review sites once real users can leave feedback.

### 4. Verify Live Backlinks After Approval

Once a directory publishes your listing, inspect its static HTML (locally with `curl` or via `check_backlink`):

```bash
LISTING="https://directory.example/tools/your-product"
DOMAIN="yourdomain.com"
# Keep response headers (for X-Robots-Tag: noindex) and parse complete <a> tags regardless of quote style or line breaks
curl -isSL --max-time 10 "$LISTING" | python3 -c '
import sys, html.parser
domain = sys.argv[1].lower()
raw = sys.stdin.read()
headers, _, body = raw.partition("\r\n\r\n")
if not body: headers, _, body = raw.partition("\n\n")
for line in headers.splitlines():
    if line.lower().startswith(("http/", "x-robots-tag:", "location:")):
        print("HEADER:", line)
class LinkCheck(html.parser.HTMLParser):
    def handle_starttag(self, tag, attrs):
        d = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta" and d.get("name", "").lower() == "robots":
            print("META ROBOTS:", d.get("content", ""))
        elif tag == "link" and "canonical" in d.get("rel", "").lower().split():
            print("CANONICAL:", d.get("href", ""))
        elif tag == "a" and domain in d.get("href", "").lower():
            print("ANCHOR:", {"href": d.get("href"), "rel": d.get("rel", "")})
LinkCheck().feed(body)
' "$DOMAIN"
```

Classify each live listing as `dofollow` (direct anchor, no `nofollow`/`ugc`/`sponsored`, indexable page), `nofollow`, `redirect_only`, or `not_found` (JS-rendered or missing).

## Anti-Patterns

- Submitting a preview host (`*.vercel.app`, `*.netlify.app`) instead of the canonical custom domain — most directories reject preview subdomains permanently.
- Paying for a directory listing without checking whether its live pages use `noindex`, redirect wrappers, or `rel="nofollow"`.
- Treating `"unknown"` link type or pricing as free or dofollow.
- Attempting to bypass CAPTCHAs, email verification, or OAuth walls — always pause and let the user complete interactive gates in their browser.
- Submitting forms or triggering paid checkouts without explicit user approval.

## Related Skills

- `seo` — ongoing technical SEO, structured data, Core Web Vitals, and content strategy
- `web-perimeter-owasp-2025-audit` — edge security headers and OWASP perimeter checks
- `marketing-campaign` — broader launch campaign messaging and channel planning

## Reference

Adapted from the open-source MIT starter skill [best-directories/directory-submission-skill](https://github.com/best-directories/directory-submission-skill) and [SaaSCity MCP docs](https://saascity.io/mcp).
