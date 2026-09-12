"""Optional provider adapters. There are none, by design.

The recovered TasteForge flow used Fal for vision distillation, image-to-3D,
reference-to-video generation, and hosted ffmpeg composition. In this
repeatable lane those become *optional adapters* that FAIL CLOSED:

* the default registry is empty;
* looking up a provider raises before any network-capable module is imported;
* even opting in requires BOTH an explicit runtime registration with
  ``authorize=True`` AND the ``TASTEFORGE_ALLOW_PROVIDERS`` environment flag,
  and no adapter ships with this package.

Nothing in this module (or package) imports fal_client, urllib, sockets, or
any other network facility.
"""

from __future__ import annotations

import os
from typing import Any, Callable

ALLOW_ENV = "TASTEFORGE_ALLOW_PROVIDERS"

_FAIL_CLOSED_MESSAGE = (
    "provider {provider!r} is not available: provider generation in "
    "TasteForge requires explicit separately authorized execution. This "
    "package ships no provider adapters and performs no network calls; the "
    "deterministic offline workflows (inspect/validate/interview/distill "
    "dry-run/apply local/export) need no provider."
)


class ProviderNotAuthorizedError(RuntimeError):
    """Raised before any provider interaction when access is not authorized."""


AdapterFactory = Callable[[], Any]


def list_providers() -> list[str]:
    """Registered provider ids. Always empty in this lane."""
    return sorted(_REGISTRY)


def get(provider: str) -> Any:
    """Return the adapter for ``provider`` or fail closed.

    Fails closed - raising before any import or I/O - unless the provider was
    explicitly registered with authorization AND the opt-in environment flag
    is set. No provider is ever registered by this package.
    """
    entry = _REGISTRY.get(provider)
    if entry is None or not entry.get("authorized"):
        raise ProviderNotAuthorizedError(_FAIL_CLOSED_MESSAGE.format(provider=provider))
    if os.environ.get(ALLOW_ENV, "").strip().lower() not in {"1", "true", "yes", "on"}:
        raise ProviderNotAuthorizedError(_FAIL_CLOSED_MESSAGE.format(provider=provider))
    return entry["factory"]()


def register(
    provider: str,
    callable_factory: AdapterFactory,
    *,
    authorize: bool = False,
) -> None:
    """Register an adapter factory. Refuses silent authorization.

    ``authorize=True`` without the ``TASTEFORGE_ALLOW_PROVIDERS`` environment
    flag is still a refusal: enabling a provider is a two-step deliberate act,
    never a default.
    """
    if not authorize:
        raise ProviderNotAuthorizedError(
            _FAIL_CLOSED_MESSAGE.format(provider=provider)
        )
    _REGISTRY[provider] = {"factory": callable_factory, "authorized": True}


def reset() -> None:
    """Clear the registry (test helper)."""
    _REGISTRY.clear()


_REGISTRY: dict[str, dict[str, Any]] = {}
