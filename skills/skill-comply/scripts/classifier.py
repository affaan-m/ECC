"""Classify tool calls against compliance steps using LLM."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

from scripts.parser import ComplianceSpec, ObservationEvent

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


class ClassifierParseError(RuntimeError):
    """Raised when the classifier output cannot be parsed."""


def classify_events(
    spec: ComplianceSpec,
    trace: list[ObservationEvent],
    model: str = "haiku",
) -> dict[str, list[int]]:
    """Classify which tool calls match which compliance steps.

    Returns {step_id: [event_indices]} via a single LLM call.
    """
    if not trace:
        return {}

    steps_desc = "\n".join(
        f"- {step.id}: {step.detector.description}"
        for step in spec.steps
    )

    tool_calls = "\n".join(
        f"[{i}] {event.tool}: input={event.input[:500]} output={event.output[:200]}"
        for i, event in enumerate(trace)
    )

    prompt_template = (PROMPTS_DIR / "classifier.md").read_text(encoding="utf-8")
    prompt = (
        prompt_template
        .replace("{steps_description}", steps_desc)
        .replace("{tool_calls}", tool_calls)
    )

    result = subprocess.run(
        ["claude", "-p", "--model", model, "--output-format", "text"],
        input=prompt,
        capture_output=True,
        encoding="utf-8",
        timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"classifier subprocess failed (rc={result.returncode}): "
            f"{result.stderr[:500]}"
        )

    return _parse_classification(result.stdout)


def _parse_classification(text: str) -> dict[str, list[int]]:
    """Parse LLM classification output into {step_id: [event_indices]}."""
    text = text.strip()
    # Strip markdown fences
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    cleaned = "\n".join(lines)

    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ClassifierParseError(
                f"classifier returned non-dict JSON: {type(parsed).__name__}"
            )
        for value in parsed.values():
            if not isinstance(value, list):
                raise ClassifierParseError(
                    f"classifier returned non-list JSON value: {type(value).__name__}"
                )
            if any(isinstance(i, bool) or (isinstance(i, float) and not i.is_integer()) for i in value):
                raise ValueError("tool call indices must be whole numbers, not booleans")
        return {k: [int(i) for i in v] for k, v in parsed.items()}
    except (json.JSONDecodeError, ValueError, TypeError, OverflowError) as e:
        raise ClassifierParseError(
            f"failed to parse classification output: {e}"
        ) from e
