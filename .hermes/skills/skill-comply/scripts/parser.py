"""Parse observation traces (JSONL) and compliance specs (YAML)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ObservationEvent:
    timestamp: str
    event: str
    tool: str
    session: str
    input: str
    output: str


@dataclass(frozen=True)
class Detector:
    description: str
    after_step: str | None = None
    before_step: str | None = None


@dataclass(frozen=True)
class Step:
    id: str
    description: str
    required: bool
    detector: Detector


@dataclass(frozen=True)
class ComplianceSpec:
    id: str
    name: str
    source_rule: str
    version: str
    steps: tuple[Step, ...]
    threshold_promote_to_hook: float


def parse_trace(path: Path) -> list[ObservationEvent]:
    """Parse a JSONL observation trace file into sorted events."""
    if not path.is_file():
        raise FileNotFoundError(f"Trace file not found: {path}")

    text = path.read_text().strip()
    if not text:
        return []

    events: list[ObservationEvent] = []
    for i, line in enumerate(text.splitlines(), 1):
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON at line {i}: {e}") from e
        try:
            events.append(ObservationEvent(
                timestamp=raw["timestamp"],
                event=raw["event"],
                tool=raw["tool"],
                session=raw["session"],
                input=raw.get("input", ""),
                output=raw.get("output", ""),
            ))
        except KeyError as e:
            raise ValueError(f"Missing required field {e} at line {i}") from e

    return sorted(events, key=lambda e: e.timestamp)


def parse_spec(path: Path) -> ComplianceSpec:
    """Parse a YAML compliance spec file."""
    if not path.is_file():
        raise FileNotFoundError(f"Spec file not found: {path}")
    raw = yaml.safe_load(path.read_text())

    steps: list[Step] = []
    for s in raw["steps"]:
        d = s["detector"]
        steps.append(Step(
            id=s["id"],
            description=s["description"],
            required=s["required"],
            detector=Detector(
                description=d["description"],
                after_step=d.get("after_step"),
                before_step=d.get("before_step"),
            ),
        ))

    if "scoring" not in raw:
        raise KeyError("Missing 'scoring' section in compliance spec")

    return ComplianceSpec(
        id=raw["id"],
        name=raw["name"],
        source_rule=raw["source_rule"],
        version=raw["version"],
        steps=tuple(steps),
        threshold_promote_to_hook=raw["scoring"]["threshold_promote_to_hook"],
    )
