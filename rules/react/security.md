---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/components/**/*.ts"
  - "**/app/**/*.ts"
  - "**/pages/**/*.ts"
---
# React Security

> This file extends [typescript/security.md](../typescript/security.md) and [common/security.md](../common/security.md) with React specific content.

## XSS via `dangerouslySetInnerHTML`

CRITICAL. The prop name is deliberately scary — treat every usage as a code review halt.

```tsx
// CRITICAL: unsanitized user input
<div dangerouslySetInnerHTML={{ __html: userBio }} />

// CORRECT options:
// 1. Render as text
<div>{userBio}</div>

// 2. Render parsed markdown via a library that sanitizes
<ReactMarkdown>{userBio}</ReactMarkdown>

// 3. If raw HTML is required, sanitize first with DOMPurify
import DOMPurify from "isomorphic-dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userBio) }} />
```

Audit checklist for every `dangerouslySetInnerHTML` call:

- Is the input always under our control? Document the source.
- If user-derived: is it sanitized at the **same call site**? (Sanitization at the API boundary is acceptable only if every consumer is verified.)
- Is the sanitizer config allowlisting tags, not denylisting?

## Unsafe URL Schemes

Validate schemes for user-provided navigation and resource URLs. Whether a URL can execute code depends on its scheme, the element, and browser behavior; do not treat every `data:` resource as executable.

```tsx
// CRITICAL: javascript: URL injection
<a href={user.website}>Visit</a>   // if user.website = "javascript:alert(1)"

// CORRECT: validate scheme
function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
  } catch {
    return undefined;
  }
  return undefined;
}
<a href={safeUrl(user.website)}>Visit</a>
```

React 19 blocks `javascript:` URLs in `src` and `href`; older React versions may only warn. This does not replace an application-specific scheme allowlist for other URLs. See the [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide#other-breaking-changes).

## `target="_blank"` Without `rel`

`<a target="_blank">` without `rel="noopener noreferrer"` lets the target page access `window.opener` and run navigation hijacks.

```tsx
// WRONG
<a href={externalUrl} target="_blank">External</a>

// CORRECT
<a href={externalUrl} target="_blank" rel="noopener noreferrer">External</a>
```

Modern browsers default to `noopener` when `target="_blank"`, but do not rely on browser defaults — be explicit.

## Server Action Input Validation

Server Actions (`"use server"`) run with the same trust level as a public API endpoint. Validate every input.

```tsx
"use server";
import { z } from "zod";

const Input = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
});

export async function updateUser(_state: unknown, formData: FormData) {
  const parsed = Input.safeParse({
    email: formData.get("email"),
    age: Number(formData.get("age")),
  });
  if (!parsed.success) return { error: parsed.error.flatten() };
  // ...
}
```

- Authenticate inside the action — do not trust the client-side route gate
- Authorize: confirm the current user has permission for the specific record they are mutating
- Rate limit sensitive actions

## Secret Exposure via Env Vars

Prefixed env vars are bundled into the client. Treat them as public.

| Framework | Public prefix | Private |
|---|---|---|
| Next.js | `NEXT_PUBLIC_*` | All others |
| Vite | `VITE_*` | `.env` server-side only |
| Create React App | `REACT_APP_*`, plus `NODE_ENV` and `PUBLIC_URL` | All others (anything without the `REACT_APP_` prefix is server-side only) |
| Remix | `process.env` access in `loader`/`action` only | Same |

```ts
// CRITICAL: secret leaked to client bundle
const apiKey = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;
```

Audit on every PR that touches env vars: would this string in the public bundle be a problem?

## Authentication / Authorization

- Never store sessions in `localStorage` — accessible to any XSS. Use httpOnly secure cookies.
- Never trust client-set state to gate sensitive UI. Render-gating in JSX prevents display, not access — the API must enforce.
- CSRF: cookie-based auth requires CSRF tokens or `SameSite=Strict`/`Lax` cookies
- Use double-submit cookies or origin verification for form actions when not using framework defaults

## Content Security Policy (CSP)

Configure server-side. The minimum acceptable CSP for a React app:

```
default-src 'self';
script-src 'self' 'nonce-{REQUEST_NONCE}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https://api.example.com;
frame-ancestors 'none';
```

- Avoid `unsafe-inline` and `unsafe-eval` in `script-src`
- For SSR with inline scripts (Next.js streaming, hydration data), use per-request nonces — both Next.js and Remix support nonce injection
- `style-src 'unsafe-inline'` is often unavoidable for CSS-in-JS libraries — document the tradeoff

## Unvalidated State Updates

```tsx
// WRONG: untrusted JSON spread directly into state
const update = await req.json();
setState({ ...state, ...update });    // untrusted keys can overwrite application state

// CORRECT: parse with a schema, or guard keys
const Allowed = z.object({ name: z.string(), email: z.string().email() });
const parsed = Allowed.parse(await req.json());
setState({ ...state, ...parsed });
```

Object spread copies own enumerable properties without invoking target setters. A JSON `__proto__` key becomes an own data property here; it does not change the new object's prototype. Keep schema validation to restrict permitted state fields. Separately audit setter-based assignment and unsafe deep merges for prototype pollution. See [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties).

## SSR Template Injection

When using `renderToString` or `renderToPipeableStream`:

- All values rendered inside JSX are escaped by React — safe
- Values passed to `dangerouslySetInnerHTML` are NOT escaped — same rules as client
- Manually constructed HTML wrappers around the React output must be escaped or sanitized — never concatenate user input into the surrounding HTML template

## Third-Party Components

- Audit `npm audit` before adding any UI library
- Check that the library does not internally use `dangerouslySetInnerHTML` on its input (e.g., rich text editors)
- Pin versions, review changelogs before major upgrades
- Be wary of components that accept HTML strings as props

## Source Map Exposure in Production

Production builds should ship without source maps, or with sourcemaps uploaded to an error tracker (Sentry) and stripped from the public bundle. Public source maps leak internal logic and file structure.

## Agent Support

- Use `security-reviewer` agent for comprehensive security audits across the codebase
- Use `react-reviewer` agent for React-specific patterns and the above rules in active code review
