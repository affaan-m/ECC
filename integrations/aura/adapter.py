"""
AURA trust-check adapter — a zero-dependency, read-only reputation lookup.

Drop this module into any agent/host project to gate a sensitive action
(settlement, delegation, tool execution) behind a backward-looking trust
verdict for the *counterparty* agent. It does NOT sign, hold keys, move
funds, or touch your wallet. It makes one HTTP GET and returns a verdict.

Design boundary (intentional):
  - read-only:   the only network call is GET /check?did=...
  - no auth:     /check is a public endpoint; no API key, no secret
  - no coupling: pure stdlib (urllib). No third-party imports, no SDK.
  - fail-closed: on network failure the verdict is `unknown`, and the
                 default gate (before_settle) rejects `unknown` — so an
                 unreachable AURA never silently waves a counterparty
                 through. Flip `fail_open=True` to invert that.

Public API:
    aura_verdict(did)             -> AuraVerdict   (never raises on network)
    before_settle(did, allow=...) -> AuraVerdict   (raises AuraUntrusted)
    require_trust                 = before_settle  (alias)
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

__all__ = [
    "aura_verdict",
    "before_settle",
    "require_trust",
    "AuraVerdict",
    "AuraUntrusted",
    "DEFAULT_BASE_URL",
    "DEFAULT_ALLOW",
]

DEFAULT_BASE_URL = "https://agent.auraopenprotocol.org"
DEFAULT_TIMEOUT = 8  # seconds

# Verdicts safe to proceed with by default. Rejects `high_risk` (poor track
# record) and `unknown` (no verifiable history / endpoint unreachable).
DEFAULT_ALLOW = ("trusted", "caution", "new")

# All verdict classes the /check endpoint can return.
VERDICTS = ("trusted", "caution", "high_risk", "new", "unknown")


class AuraUntrusted(Exception):
    """Raised by before_settle() when a counterparty fails the trust gate."""

    def __init__(self, verdict: "AuraVerdict") -> None:
        self.verdict = verdict
        super().__init__(
            f"trust gate rejected {verdict.did}: {verdict.verdict} — {verdict.reason}"
        )


@dataclass(frozen=True)
class AuraVerdict:
    """
    Result of a zero-auth trust check on a counterparty DID.

    Fields:
        did          the DID that was checked
        verdict      one of trusted | caution | high_risk | new | unknown
        reason       human-readable explanation
        score        composite 0..1, or None when there is no history
        has_history  True once the agent has on-chain interactions
        dimensions   per-dimension breakdown (which axis is weak), or None
        raw          the untouched JSON body, for callers that want more
    """

    did: str
    verdict: str
    reason: str = ""
    score: Optional[float] = None
    has_history: bool = False
    dimensions: Optional[dict[str, float]] = None
    # False only when AURA could not be reached (network/parse failure) and the
    # verdict is a synthetic `unknown`. A reachable AURA that genuinely returns
    # `unknown` has reachable=True. before_settle's fail_open keys on this, not
    # on the verdict alone, so it can't wave through unverified counterparties.
    reachable: bool = True
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def ok(self) -> bool:
        """True for verdicts safe to proceed with (trusted / caution)."""
        return self.verdict in ("trusted", "caution")

    def as_dict(self) -> dict[str, Any]:
        """The minimal {verdict, reason, score} contract, plus did/ok."""
        return {
            "did": self.did,
            "verdict": self.verdict,
            "reason": self.reason,
            "score": self.score,
            "ok": self.ok,
        }

    @classmethod
    def from_payload(cls, did: str, body: dict[str, Any]) -> "AuraVerdict":
        verdict = str(body.get("verdict", "unknown"))
        if verdict not in VERDICTS:
            verdict = "unknown"
        return cls(
            did=body.get("did", did),
            verdict=verdict,
            reason=str(body.get("reason", "")),
            score=body.get("score"),
            has_history=bool(body.get("has_history", False)),
            dimensions=body.get("dimensions"),
            raw=body,
        )

    @classmethod
    def unreachable(cls, did: str, reason: str) -> "AuraVerdict":
        """A synthetic `unknown` verdict for network/parse failures."""
        return cls(did=did, verdict="unknown", reason=reason, reachable=False)


# Indirection point so tests can inject canned responses without a network.
# Signature: (url: str, timeout: float) -> dict   (raises on transport error)
def _http_get_json(url: str, timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "aura-adapter/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
        return json.loads(resp.read().decode("utf-8"))


def aura_verdict(
    did: str,
    *,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = DEFAULT_TIMEOUT,
    _fetch: Callable[[str, float], dict[str, Any]] = _http_get_json,
) -> AuraVerdict:
    """
    Look up the trust verdict for a counterparty DID. Never raises on a
    network/parse failure — returns an `unknown` verdict instead, leaving the
    proceed/abort decision to the caller's policy (see before_settle).

        v = aura_verdict("did:aura:z6Mk...")
        print(v.verdict, v.reason, v.score)

    `_fetch` is an injection seam for tests; production callers ignore it.
    """
    if not did or not str(did).startswith("did:"):
        raise ValueError(f"invalid DID: {did!r} (must start with 'did:')")

    url = f"{base_url.rstrip('/')}/check?" + urllib.parse.urlencode({"did": did})
    try:
        body = _fetch(url, timeout)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return AuraVerdict.unreachable(did, f"AURA unreachable: {e}")
    except (json.JSONDecodeError, ValueError) as e:
        return AuraVerdict.unreachable(did, f"AURA returned non-JSON: {e}")

    if not isinstance(body, dict):
        return AuraVerdict.unreachable(did, "AURA returned an unexpected shape")
    return AuraVerdict.from_payload(did, body)


def before_settle(
    did: str,
    *,
    allow: tuple[str, ...] = DEFAULT_ALLOW,
    fail_open: bool = False,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = DEFAULT_TIMEOUT,
    _fetch: Callable[[str, float], dict[str, Any]] = _http_get_json,
) -> AuraVerdict:
    """
    Gate a sensitive action behind a trust check. Returns the verdict on pass,
    raises AuraUntrusted on fail.

        try:
            before_settle(counterparty_did)   # rejects high_risk + unknown
            settle_payment(counterparty_did, amount)
        except AuraUntrusted as e:
            abort(str(e))

    Tighten to reject brand-new agents too:
        before_settle(did, allow=("trusted", "caution"))

    fail_open=True makes an *unreachable* AURA pass through (transport failure
    only — a reachable AURA that returns `unknown` is still rejected). Off by
    default — absence of evidence is not evidence of trust.
    """
    v = aura_verdict(did, base_url=base_url, timeout=timeout, _fetch=_fetch)

    if v.verdict in allow:
        return v
    # fail_open only excuses a transport failure, never a reachable `unknown`.
    if fail_open and not v.reachable:
        return v
    raise AuraUntrusted(v)


# Alias — same gate, name that reads better at non-payment call sites.
require_trust = before_settle
