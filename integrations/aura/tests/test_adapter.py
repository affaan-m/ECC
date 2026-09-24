"""
Offline tests for the AURA trust-check adapter.

Runs with plain `pytest` (or `python -m pytest`). No network: every call
replays a recorded /check body via the `_fetch` injection seam.

Coverage:
  - one assertion per verdict class (trusted / caution / high_risk / new / unknown)
  - the before_settle gate: allow-list pass/reject, custom allow, fail_open
  - the network-failure path (fail-closed by default, pass with fail_open)
  - input validation
"""

from __future__ import annotations

import urllib.error

import pytest

from aura.adapter import AuraUntrusted, aura_verdict, before_settle
from aura.tests.fixtures import make_fetch, raising_fetch

FETCH = make_fetch()


# ── verdict classes ─────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "did,expected,ok",
    [
        ("did:aura:trusted-bot", "trusted", True),
        ("did:aura:caution-bot", "caution", True),
        ("did:aura:risky-bot", "high_risk", False),
        ("did:aura:fresh-bot", "new", False),
        ("did:aura:ghost-bot", "unknown", False),
    ],
)
def test_verdict_classes(did, expected, ok):
    v = aura_verdict(did, _fetch=FETCH)
    assert v.verdict == expected
    assert v.ok is ok
    assert v.did == did
    assert isinstance(v.reason, str) and v.reason


def test_minimal_dict_contract():
    v = aura_verdict("did:aura:trusted-bot", _fetch=FETCH)
    d = v.as_dict()
    assert set(d) >= {"verdict", "reason", "score"}
    assert d["verdict"] == "trusted"
    assert d["score"] == 0.86


def test_dimensions_exposed_for_history():
    v = aura_verdict("did:aura:risky-bot", _fetch=FETCH)
    assert v.has_history is True
    assert v.dimensions["financial_integrity"] == 0.12


def test_new_agent_has_no_score():
    v = aura_verdict("did:aura:fresh-bot", _fetch=FETCH)
    assert v.score is None
    assert v.has_history is False


# ── the before_settle gate ───────────────────────────────────────────────────

def test_gate_allows_trusted():
    v = before_settle("did:aura:trusted-bot", _fetch=FETCH)
    assert v.verdict == "trusted"


def test_gate_allows_caution_and_new_by_default():
    assert before_settle("did:aura:caution-bot", _fetch=FETCH).verdict == "caution"
    assert before_settle("did:aura:fresh-bot", _fetch=FETCH).verdict == "new"


def test_gate_rejects_high_risk():
    with pytest.raises(AuraUntrusted) as ei:
        before_settle("did:aura:risky-bot", _fetch=FETCH)
    assert ei.value.verdict.verdict == "high_risk"


def test_gate_rejects_unknown_by_default():
    with pytest.raises(AuraUntrusted):
        before_settle("did:aura:ghost-bot", _fetch=FETCH)


def test_strict_allow_rejects_new():
    with pytest.raises(AuraUntrusted):
        before_settle("did:aura:fresh-bot", allow=("trusted", "caution"), _fetch=FETCH)


# ── network-failure path ──────────────────────────────────────────────────────

def test_unreachable_returns_unknown_not_raise():
    fetch = raising_fetch(urllib.error.URLError("connection refused"))
    v = aura_verdict("did:aura:trusted-bot", _fetch=fetch)
    assert v.verdict == "unknown"
    assert "unreachable" in v.reason.lower()


def test_gate_fail_closed_on_unreachable():
    fetch = raising_fetch(urllib.error.URLError("connection refused"))
    with pytest.raises(AuraUntrusted):
        before_settle("did:aura:trusted-bot", _fetch=fetch)


def test_gate_fail_open_passes_on_unreachable():
    fetch = raising_fetch(urllib.error.URLError("connection refused"))
    v = before_settle("did:aura:trusted-bot", fail_open=True, _fetch=fetch)
    assert v.verdict == "unknown"
    assert v.reachable is False


def test_fail_open_does_not_pass_reachable_unknown():
    # A reachable AURA that returns `unknown` (ghost DID) is still rejected even
    # with fail_open — fail_open only excuses transport failures.
    with pytest.raises(AuraUntrusted):
        before_settle("did:aura:ghost-bot", fail_open=True, _fetch=FETCH)


def test_reachable_verdict_marked_reachable():
    v = aura_verdict("did:aura:ghost-bot", _fetch=FETCH)
    assert v.reachable is True


# ── input validation ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["", "not-a-did", "z6Mk-no-prefix", None])
def test_rejects_bad_did(bad):
    with pytest.raises(ValueError):
        aura_verdict(bad, _fetch=FETCH)
