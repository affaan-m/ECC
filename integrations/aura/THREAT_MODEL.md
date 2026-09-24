# Threat model — AURA trust-check adapter

A short, honest boundary statement. The verdict is **one backward-looking
signal**, not a security guarantee. Read this before treating `trusted` as a
green light for anything irreversible.

## What the verdict proves

- The DID has (or lacks) an on-chain interaction history on AURA, summarized
  into a composite score and per-dimension breakdown.
- It is **backward-looking**: a statement about past recorded behavior, not a
  prediction or an authorization for the *current* proposed action.

## What it explicitly does NOT prove

- **Not action-safety.** A `trusted` agent can still propose a malicious or
  buggy transaction. Pair this with a forward-looking action-risk check
  (contract simulation, policy engine) and keep the two signals separate so
  the policy decision stays auditable.
- **Not execution quality.** It says nothing about whether *this* call will
  succeed.
- **Not identity proof of the live caller.** It checks a DID's reputation, not
  that the entity you're talking to controls that DID (see "Spoofed DID").

## Failure modes a caller must account for

| # | Threat | Mitigation in this adapter | Residual risk owned by caller |
|---|---|---|---|
| 1 | **Endpoint unreachable / timeout** | Returns `unknown` (never raises). Gate is fail-closed by default. | Choose `fail_open` deliberately; pick a sane `timeout`. |
| 2 | **Spoofed DID** — caller claims a DID it doesn't control | Out of scope: adapter checks reputation, not control of the key. | Verify DID control (signature challenge / auth) **before** trusting the verdict. |
| 3 | **Stale verdict** — score lags very recent bad behavior | Each call is live (no caching here). | If you cache the result, bound the TTL; don't reuse a verdict across sessions. |
| 4 | **Endpoint MITM / response tampering** | HTTPS to a pinned host (`agent.auraopenprotocol.org`). Verdict strings are validated against a fixed allow-list; unknown values collapse to `unknown`. | Don't point `base_url` at an untrusted mirror. Consider TLS pinning if your runtime supports it. |
| 5 | **Score gaming / Sybil** — cheap DIDs farming a `trusted` score | Inherited from AURA's on-chain cost + dispute dimension; not solvable in the adapter. | Weight `dimensions` (e.g. require non-trivial `interactions` / `dispute_history`) for high-value actions rather than trusting the aggregate alone. |
| 6 | **Over-trust** — using the verdict as sole gate for irreversible value | `new`/`unknown` rejected by default; `dimensions` exposed. | For high-value settlement, combine with action-risk + escrow + manual review. |

## Data handled

- **Sent:** only the counterparty DID, as a query parameter to `/check`. No
  PII, no payloads, no secrets, no keys.
- **Stored:** nothing. The adapter is stateless; it holds the DID only for the
  duration of the call.
- **Received:** the public `/check` JSON body. Surfaced verbatim on `.raw`.

## Trust boundary summary

```
your host  --(DID only, HTTPS GET)-->  AURA /check  -->  verdict
   |                                                        |
   |  forward-looking action-risk check (separate, yours)   |
   v                                                        v
            policy decision (auditable, your code)
```

The adapter sits on the read-only reputation edge. Signing, fund movement,
and the final allow/deny decision stay in your code, where they can be audited.
