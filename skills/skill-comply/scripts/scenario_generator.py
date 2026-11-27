"""Generate pressure scenarios from skill + spec using LLM."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import yaml

from scripts.utils import extract_yaml

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


@dataclass(frozen=True)
class Scenario:
    id: str
    level: int
    level_name: str
    description: str
    prompt: str
    setup_commands: tuple[str, ...]
    files: tuple[tuple[str, str], ...] = ()


def generate_scenarios(
    skill_path: Path,
    spec_yaml: str,
    model: str = "haiku",
) -> list[Scenario]:
    """Generate 3 scenarios with decreasing prompt strictness.

    Calls claude -p with the scenario_generator prompt, parses YAML output.
    """
    skill_content = skill_path.read_text(encoding="utf-8")
    prompt_template = (PROMPTS_DIR / "scenario_generator.md").read_text(encoding="utf-8")
    prompt = (
        prompt_template
        .replace("{skill_content}", skill_content)
        .replace("{spec_yaml}", spec_yaml)
    )

    result = subprocess.run(
        ["claude", "-p", "--model", model, "--output-format", "text"],
        input=prompt,
        capture_output=True,
        encoding="utf-8",
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude -p failed: {result.stderr}")

    if not result.stdout.strip():
        raise RuntimeError("claude -p returned empty output")

    raw_yaml = extract_yaml(result.stdout)
    parsed = yaml.safe_load(raw_yaml)

    scenarios: list[Scenario] = []
    for s in parsed["scenarios"]:
        scenarios.append(Scenario(
            id=s["id"],
            level=s["level"],
            level_name=s["level_name"],
            description=s["description"],
            prompt=s["prompt"].strip(),
            setup_commands=tuple(s.get("setup_commands", [])),
            files=_parse_files(s["id"], s.get("files")),
        ))

    return sorted(scenarios, key=lambda s: s.level)


def _parse_files(scenario_id: str, raw: object) -> tuple[tuple[str, str], ...]:
    """Validate a scenario's ``files`` mapping (relative path -> text content).

    LLM output is untrusted: a list, a bare value, or a null body would
    otherwise become the text "None" or crash the run after generation.
    """
    if raw is None:
        return ()
    if not isinstance(raw, dict):
        raise ValueError(
            f"Scenario {scenario_id!r}: files must be a mapping of path to content, "
            f"got {type(raw).__name__}"
        )
    for path, content in raw.items():
        if not isinstance(path, str) or not path.strip():
            raise ValueError(f"Scenario {scenario_id!r}: file path must be a non-empty string")
        if not isinstance(content, str):
            raise ValueError(
                f"Scenario {scenario_id!r}: content of {path!r} must be a string, "
                f"got {type(content).__name__}"
            )
    return tuple(raw.items())
