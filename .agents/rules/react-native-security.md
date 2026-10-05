---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# React Native / Expo Security

> This file extends [common/security.md](common-security.md) with React Native / Expo specific content.
> The mandatory pre-commit checklist and Security Response Protocol from common/security.md still apply.

## The Bundle Is Public

Treat everything shipped in the app as readable by an attacker. A mobile binary can be unpacked.

- NEVER ship real secrets (private API keys, service-role keys, signing secrets) in the JS bundle or `app.config`.
- Public/anon keys (e.g. Supabase anon key, Firebase config) are acceptable ONLY when protected by server-side rules (RLS, security rules). Enforce authorization on the backend, never in the client.
- Keep privileged operations behind your own server / edge functions.

## Secret & Token Storage

- Store auth tokens and sensitive values in `expo-secure-store` (Keychain / Keystore) — never in `AsyncStorage` or plain MMKV.
- Do not persist secrets in Redux/Zustand state that may be serialized to disk.

## Configuration

- Read environment via `expo-constants` / `app.config.ts` `extra`, and `EXPO_PUBLIC_*` only for genuinely public values.
- Keep build secrets in EAS secrets, not in the repo.

## Network & Data

- HTTPS only; reject cleartext. Consider certificate pinning for high-risk apps.
- Validate ALL external data (API responses, deep-link params, push payloads) with Zod before use.
- Validate and sanitize deep links and universal links — never route or grant access based on unvalidated params.

## Permissions & Privacy

- Request the minimum device permissions, at the moment they are needed, with clear rationale.
- Declare data collection accurately for App Store / Play Store privacy disclosures.

## Dependencies

- Run `expo-doctor` and `npm audit` regularly; keep the Expo SDK and native deps current.
- Use `/security-scan` (AgentShield) on the agent configuration itself.
