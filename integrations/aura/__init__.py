"""
AURA trust-check adapter — opt-in, read-only counterparty reputation.

    from aura import before_settle, AuraUntrusted

    try:
        before_settle(counterparty_did)
        settle_payment(counterparty_did, amount)
    except AuraUntrusted as e:
        abort(str(e))

Zero dependencies (pure stdlib). Does not sign, hold keys, or move funds.
See README.md for the enable section and THREAT_MODEL.md for the boundary.
"""

from .adapter import (
    DEFAULT_ALLOW,
    DEFAULT_BASE_URL,
    AuraUntrusted,
    AuraVerdict,
    aura_verdict,
    before_settle,
    require_trust,
)

__all__ = [
    "aura_verdict",
    "before_settle",
    "require_trust",
    "AuraVerdict",
    "AuraUntrusted",
    "DEFAULT_BASE_URL",
    "DEFAULT_ALLOW",
]

__version__ = "0.1.0"
