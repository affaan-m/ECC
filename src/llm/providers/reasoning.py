"""Helpers for reasoning text that self-hosted models leave in message content."""

from __future__ import annotations

import json
import os

THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"

_TRUTHY = {"1", "true", "yes", "on"}


def prefilled_reasoning_from_env(name: str) -> bool:
    """Read a ``*_PREFILLED_REASONING`` flag from the environment."""
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def strip_reasoning(content: str, *, prefilled: bool = False) -> str:
    """Drop a leading reasoning block from model output.

    Hosted APIs return reasoning in a separate field, but self-hosted reasoning
    models (vLLM or llama.cpp without a reasoning parser, Ollama models without
    a thinking template) put it in ``content``.

    By default only a balanced block that opens the output is removed:
    ``<think>...</think>answer``. Anything else is returned unchanged, so an
    answer that merely mentions the tags (including a lone or reversed closing
    tag) is never truncated, and neither is unterminated reasoning (for example
    when ``max_tokens`` cut the model off before it reached an answer).

    ``prefilled=True`` is for deployments whose chat template prefills the
    opening tag in the generation prompt, so the model only ever emits
    ``...</think>answer``. Only enable it when the model is known to behave this
    way: everything up to the first closing tag is then treated as reasoning.
    """
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
    answer that carries the tag inside a string value is left whole.
    """
    stripped = content.strip()
    if not stripped.startswith(("{", "[")):
        return False
    try:
        json.loads(stripped)
    except ValueError:
        return False
    return True
