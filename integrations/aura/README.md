# AURA trust-check adapter

Opt-in, **read-only** counterparty reputation for agent hosts. One HTTP GET
answers *"can I trust this agent before I delegate work or settle a payment?"*

- **Zero dependencies** — pure Python stdlib. Vendor the `aura/` folder, no `pip install`.
- **Read-only** — the only network call is `GET /check?did=...`. No auth, no API key.
- **No coupling** — does not sign, hold keys, move funds, or touch your wallet.
- **Off by default** — nothing runs until you call it. Disabled = delete the import.

## Enable (opt-in)

It's a gate you call explicitly at a trust boundary — there is no global hook,
no monkey-patching, no background calls. Wrap the action you want to protect:

```python
from aura import before_settle, AuraUntrusted

def settle(counterparty_did: str, amount: float) -> None:
    try:
        before_settle(counterparty_did)        # rejects high_risk + new + unknown
    except AuraUntrusted as e:
        log.warning("blocked: %s", e)
        return                                  # your policy decides what to do
    pay(counterparty_did, amount)               # your existing logic, untouched
```

Prefer to read the verdict yourself instead of raising?

```python
from aura import aura_verdict

v = aura_verdict(counterparty_did)
print(v.verdict)   # trusted | caution | high_risk | new | unknown
print(v.reason)    # human-readable explanation
print(v.score)     # composite 0..1, or None when there's no history
print(v.ok)        # True for trusted/caution

# v.dimensions tells you *which* axis is weak, not just the aggregate:
if v.dimensions and v.dimensions.get("financial_integrity", 1) < 0.4:
    require_manual_review()   # placeholder for your own policy
```

> `v.ok` reflects the *verdict class* (True for `trusted`/`caution`). Use the
> gate's return/raise for the policy decision and `v.ok` for display.

## Verdicts

| verdict | meaning | `ok` |
|---|---|---|
| `trusted` | strong on-chain track record (composite >= 0.70) | yes |
| `caution` | mixed history (0.40-0.70) | yes |
| `high_risk` | poor track record (< 0.40) | no |
| `new` | registered identity, no interactions yet | no |
| `unknown` | no track record, or AURA was unreachable | no |

## Policy knobs

```python
# Explicitly allow brand-new agents during a controlled onboarding flow:
before_settle(did, allow=("trusted", "caution", "new"))

# Treat an *unreachable* AURA as a pass (fail-open). Off by default —
# absence of evidence is not evidence of trust.
before_settle(did, fail_open=True)

# Point at a self-hosted / staging gateway:
before_settle(did, base_url="https://my-aura-mirror.example", timeout=5)
```

`require_trust` is an alias of `before_settle` for non-payment call sites.

## Failure behavior

`aura_verdict()` **never raises on a network or parse error** — it returns an
`unknown` verdict with the reason set. The gate then decides:

- **default (`fail_open=False`)** — `unknown` is rejected → an unreachable AURA
  blocks the action. *Fail-closed.*
- **`new` verdict** — rejected by default because the agent has no interaction
  history. Onboarding flows can explicitly add `new` to `allow`.
- **`fail_open=True`** — `unknown` from a transport failure is allowed through.
  HTTP errors, malformed JSON, and invalid response shapes remain blocked
  because the endpoint was reached but did not return a trustworthy verdict.

Removing the adapter leaves your existing allow/deny logic untouched. While
the gate is enabled, an AURA outage blocks the protected action by default;
callers must explicitly choose `fail_open=True` to preserve availability.

## Tests

Offline — every call replays a recorded `/check` body, no network:

```bash
python -m pytest aura/tests -q
```

Covers all five verdict classes, the gate's allow-list + `fail_open`, the
unreachable path, and input validation. See `tests/fixtures.py` for the
recorded response shapes.

## Boundary & threats

See [THREAT_MODEL.md](./THREAT_MODEL.md) — what the verdict does and does not
prove, and the failure modes a verifier should account for.

## Carry the AURA badge

Show your live trust verdict in your own README — it updates automatically and
links back to your AURA profile:

```markdown
[![AURA Verified](https://agent.auraopenprotocol.org/badge?did=YOUR_DID)](https://agent.auraopenprotocol.org/check?did=YOUR_DID)
```

A shields-style badge colored by verdict (`trusted` green, `caution` amber,
`high_risk` red, `new` blue, `unknown` grey). Add `&score=1` to show the
composite score. No DID yet? The bare badge is a generic mark:

```markdown
[![Powered by AURA](https://agent.auraopenprotocol.org/badge)](https://auraopenprotocol.org)
```

## What's behind the verdict

[AURA Open Protocol](https://auraopenprotocol.org) — W3C DID identity plus 8
on-chain reputation dimensions on Base L2 (`task_completion`, `delivery_speed`,
`output_quality`, `honesty`, `financial_integrity`, `security_compliance`,
`collaboration`, `dispute_history`). Docs: [AURA developer docs](https://dev.auraopenprotocol.org)
