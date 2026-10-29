"""Helpers for reasoning text that self-hosted models leave in message content."""

from __future__ import annotations

import json
import os

THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"

_TRUTHY = {"1", "true", "yes", "on"}


def prefilled_reasoning_from_env(name: str) -> bool:
    """Read an explicit reasoning-format flag from the environment."""
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def strip_reasoning(
    content: str, *, leading: bool = False, prefilled: bool = False
) -> str:
    """Drop a leading reasoning block from model output.

    Some deployments put reasoning in ``content`` instead of a separate field.
    This helper makes no assumptions about a hosted API or model name.

    Content is preserved by default, including complete leading XML documents.
    Enable ``leading=True`` only for a deployment whose declared format is
    ``<think>...</think>answer``. Unterminated reasoning remains unchanged.

    ``prefilled=True`` is for deployments whose chat template prefills the
    opening tag in the generation prompt, so the model only ever emits
    ``...</think>answer``. Only enable it when the model is known to behave this
    way: everything up to the first closing tag is then treated as reasoning.
    """
    if not leading and not prefilled:
        return content

    stripped = content.lstrip()
    if stripped.startswith(THINK_OPEN):
        close = stripped.find(THINK_CLOSE, len(THINK_OPEN))
        if close == -1:
            return content
        return stripped[close + len(THINK_CLOSE) :].lstrip()

    if not prefilled:
        return content

    close = content.find(THINK_CLOSE)
    if close == -1 or THINK_OPEN in content[:close] or _is_json_document(content):
        return content
    return content[close + len(THINK_CLOSE) :].lstrip()


def _is_json_document(content: str) -> bool:
    """Whether ``content`` is one complete JSON object or array.

    Reasoning followed by a closing tag is never valid JSON, so a structured
    answer that carries the tag inside a string value is left whole. Input
    nested too deeply for the parser to finish is kept whole as well: reasoning
    does not open with that many brackets, so cutting it would only risk
    truncating a real answer.
    """
    stripped = content.strip()
    if not stripped.startswith(("{", "[")):
        return False
    try:
        json.loads(stripped)
    except RecursionError:
        return True
    except ValueError:
        return False
    return True
