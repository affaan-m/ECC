"""
Canned /check responses — one per verdict class.

These are recorded shapes of real GET /check?did=... responses, used so the
test suite runs offline with no network. Pass `make_fetch(...)` as the
`_fetch` argument to aura_verdict / before_settle to replay them.
"""

from __future__ import annotations

from typing import Any, Callable

# did -> recorded /check JSON body
RECORDED: dict[str, dict[str, Any]] = {
    "did:aura:trusted-bot": {
        "did": "did:aura:trusted-bot",
        "verdict": "trusted",
        "reason": "strong on-chain track record (composite 0.86)",
        "has_history": True,
        "score": 0.86,
        "interactions": 142,
        "dimensions": {
            "task_completion": 0.92,
            "delivery_speed": 0.81,
            "output_quality": 0.88,
            "honesty": 0.90,
            "financial_integrity": 0.95,
            "security_compliance": 0.79,
            "collaboration": 0.84,
            "dispute_history": 0.83,
        },
    },
    "did:aura:caution-bot": {
        "did": "did:aura:caution-bot",
        "verdict": "caution",
        "reason": "mixed history (composite 0.55)",
        "has_history": True,
        "score": 0.55,
        "interactions": 31,
        "dimensions": {"financial_integrity": 0.41, "task_completion": 0.62},
    },
    "did:aura:risky-bot": {
        "did": "did:aura:risky-bot",
        "verdict": "high_risk",
        "reason": "poor track record (composite 0.22)",
        "has_history": True,
        "score": 0.22,
        "interactions": 18,
        "dimensions": {"financial_integrity": 0.12, "dispute_history": 0.20},
    },
    "did:aura:fresh-bot": {
        "did": "did:aura:fresh-bot",
        "verdict": "new",
        "reason": "registered identity, no interactions yet",
        "has_history": False,
        "score": None,
        "interactions": 0,
    },
    "did:aura:ghost-bot": {
        "did": "did:aura:ghost-bot",
        "verdict": "unknown",
        "reason": "no track record — unverified counterparty",
        "has_history": False,
        "score": None,
        "interactions": 0,
    },
}


def make_fetch(
    table: dict[str, dict[str, Any]] | None = None,
) -> Callable[[str, float], dict[str, Any]]:
    """
    Build a `_fetch` stand-in that replays RECORDED bodies by DID parsed from
    the query string. Unknown DIDs replay the `unknown` body.
    """
    table = RECORDED if table is None else table

    def _fetch(url: str, timeout: float) -> dict[str, Any]:
        from urllib.parse import parse_qs, urlparse

        did = parse_qs(urlparse(url).query).get("did", [""])[0]
        return table.get(did, RECORDED["did:aura:ghost-bot"])

    return _fetch


def raising_fetch(exc: Exception) -> Callable[[str, float], dict[str, Any]]:
    """Build a `_fetch` that always raises — simulates an unreachable AURA."""

    def _fetch(url: str, timeout: float) -> dict[str, Any]:
        raise exc

    return _fetch
