---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.interceptor.ts"
---
# Angular Security

> This file extends [common/security.md](../common/security.md) with Angular specific content.

## XSS Prevention

Angular auto-sanitizes bound values. Never bypass the sanitizer on user-controlled input.

```typescript
// WRONG: Bypasses sanitization — XSS risk
this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(userInput);

// CORRECT: Sanitize explicitly before trusting
this.safeHtml = this.sanitizer.sanitize(SecurityContext.HTML, userInput);
```

- Never use `bypassSecurityTrust*` methods without a documented, reviewed reason
- Avoid `[innerHTML]` with untrusted content — use `innerText` or a sanitizing pipe
- Never bind `[href]` to user input — Angular does not block `javascript:` URLs in all contexts
- Never construct template strings from user data

## HTTP Security

Use `HttpClient` exclusively — never raw `fetch()` or `XHR` unless no alternative exists.

```typescript
// WRONG: Bypasses interceptors (auth headers, error handling, logging)
const res = await fetch('/api/users');

// CORRECT
users$ = this.http.get<User[]>('/api/users');
```

- Attach auth tokens via interceptors — never hardcode in individual service calls
- Type and validate API responses — treat external data as `unknown` at the boundary
- Never log HTTP responses that may contain tokens, PII, or credentials

## Secret Management

```typescript
// WRONG: Hardcoded secret in source
const apiKey = 'sk-live-xxxx';

// CORRECT: Injected via environment
import { environment } from '../environments/environment';
const apiKey = environment.apiKey;
```

- Treat `environment.ts` as a config shape — never store real secrets in source-controlled environment files
- Inject production secrets via CI/CD (environment variables, secret managers)

## Route Guards

Every authenticated or role-restricted route must have a guard. Never rely on hiding UI elements alone.

```typescript
{
  path: 'admin',
  canMatch: [authGuard, roleGuard('admin')],
  loadChildren: () => import('./admin/admin.routes'),
}
```

Use `canMatch` for sensitive routes — it prevents the route module from loading at all for unauthorized users.

## SSR Security

When using Angular SSR:

- Never expose server-side environment variables to the client via `TransferState` unless they are intentionally public
- Sanitize all inputs before server-side rendering — DOM-based XSS can occur server-side too
- Avoid `window`, `document`, `localStorage` on the server — gate with `isPlatformBrowser` or inject via `DOCUMENT` token

## Content Security Policy

Configure CSP headers server-side. Avoid `unsafe-inline` in `script-src`. When using SSR with inline scripts, use nonces via Angular's CSP support.

## Agent Support

- Use **security-reviewer** skill for comprehensive security audits
