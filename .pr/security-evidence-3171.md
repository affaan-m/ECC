# Security Evidence — PR #3172 / #3171

Commit under review: observe.sh Layer-1 allowlist adds `sdk-cli`.

## Changed security-sensitive surface
- `skills/continuous-learning-v2/hooks/observe.sh` (agent hook entrypoint allowlist)

## Threat model (bounded)
- **Risk if missing `sdk-cli`**: interactive Agent SDK CLI sessions never observe (availability/coverage gap).
- **Risk if allowlist too broad**: non-interactive bots could start the observer. Mitigated by Layers 2–5 (`ECC_HOOK_PROFILE=minimal`, `ECC_SKIP_OBSERVE=1`, `agent_id`, path exclusions) — unchanged by this PR.
- **No secrets / auth tokens / billing / webhook handlers** were modified.

## Security-focused validation artifacts (this PR)
1. **Focused security regression test** (new): `tests/hooks/observe-entrypoint-security.test.js`
   - Asserts source allowlist includes `sdk-cli`
   - Asserts Layer-1 allows: `cli`, `sdk-ts`, `sdk-cli`, `claude-desktop`, `claude-vscode`
   - Asserts Layer-1 rejects: `unknown-bot`, `ci-bot`
2. **Supply-chain IOC scan** (repo gate): `npm run security:ioc-scan`

## Command output (local)

### observe-entrypoint-security.test.js
```text

=== observe.sh Layer-1 entrypoint security (#3171) ===

  ✓ source allowlist includes sdk-cli
  ✓ Layer-1 allows cli
  ✓ Layer-1 allows sdk-ts
  ✓ Layer-1 allows sdk-cli
  ✓ Layer-1 allows claude-desktop
  ✓ Layer-1 allows claude-vscode
  ✓ Layer-1 rejects unknown-bot
  ✓ Layer-1 rejects ci-bot

All Layer-1 security checks passed.
```

### npm run security:ioc-scan
```text

> ecc-universal@2.2.1 security:ioc-scan
> node scripts/ci/scan-supply-chain-iocs.js

Supply-chain IOC scan passed for /workspace/pr-work/ECC-3171 (12 files inspected)
```

## Conclusion
Allowlist change is covered by a dedicated security regression test plus the repository IOC scan. Unknown entrypoints remain denied at Layer-1.
