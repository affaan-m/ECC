"""Classify tool calls against compliance steps using LLM."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

from scripts.parser import ComplianceSpec, ObservationEvent

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


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

    prompt_template = (PROMPTS_DIR / "classifier.md").read_text()
    prompt = (
        prompt_template
        .replace("{steps_description}", steps_desc)
        .replace("{tool_calls}", tool_calls)
    )

    result = subprocess.run(
        ["claude", "-p", prompt, "--model", model, "--output-format", "text"],
        capture_output=True,
        text=True,
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
            logger.warning("Classifier returned non-dict JSON: %s", type(parsed).__name__)
            return {}
        return {
            k: [int(i) for i in v]
            for k, v in parsed.items()
            if isinstance(v, list)
        }
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning("Failed to parse classification output: %s", e)
        return {}
