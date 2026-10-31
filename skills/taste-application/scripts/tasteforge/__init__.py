"""TasteForge: a repeatable taste-driven video workflow.

Canonicalizes the recovered TasteForge/FAL-video flow (2026-08) into a
maintained, stdlib-only package:

* deterministic schemas for interviews, style packs, timelines, and reports;
* offline inspect / validate / interview / distill / apply / export workflows;
* provider (Fal) integrations as optional adapters that FAIL CLOSED - this
  package performs no network calls and never claims a provider workflow is
  saved merely because a local reference exists.

Raw recovered sources stay outside Git; only a small documented metadata
fixture ships under ``tasteforge/fixtures/`` (see the ECC skill SOURCE.md).
"""

from __future__ import annotations

__version__ = "1.0.0"

__all__ = [
    "apply",
    "cli",
    "contract",
    "distill",
    "export",
    "interview",
    "pack",
    "providers",
    "provenance",
    "schema",
    "timeline",
    "workflow",
]
