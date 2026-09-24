"""Run scenarios via claude -p and parse tool calls from stream-json output."""

from __future__ import annotations

import json
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from scripts.parser import ObservationEvent
from scripts.scenario_generator import Scenario

SANDBOX_BASE = Path("/tmp/skill-comply-sandbox")
ALLOWED_MODELS = frozenset({"haiku", "sonnet", "opus"})
ALLOWED_SETUP_EXECUTABLES = frozenset({
    "git", "npm", "pip", "pip3",
    "touch", "mkdir", "cp", "mv", "echo",
    "chmod", "unzip", "tar",
})
# Shell builtins cannot be invoked via subprocess.run; cwd is already
# controlled by the cwd= keyword. Scenarios that include these in
# setup_commands (a common shell-style convention) must be tolerated.
SHELL_BUILTINS = frozenset({"cd", "pushd", "popd"})
REPORT_VALUE_LIMIT = 5000


@dataclass(frozen=True)
class ScenarioRun:
    scenario: Scenario
    observations: tuple[ObservationEvent, ...]
    sandbox_dir: Path


def run_scenario(
    scenario: Scenario,
    model: str = "sonnet",
    max_turns: int = 30,
    timeout: int = 300,
) -> ScenarioRun:
    """Execute a scenario and extract tool calls from stream-json output."""
    if model not in ALLOWED_MODELS:
        raise ValueError(f"Unknown model: {model!r}. Allowed: {ALLOWED_MODELS}")

    sandbox_dir = _safe_sandbox_dir(scenario.id)
    _setup_sandbox(sandbox_dir, scenario)

    result = subprocess.run(
        [
            "claude", "-p", scenario.prompt,
            "--model", model,
            "--max-turns", str(max_turns),
            "--add-dir", str(sandbox_dir),
            "--allowedTools", "Read,Write,Edit,Bash,Glob,Grep",
            "--output-format", "stream-json",
            "--verbose",
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=sandbox_dir,
    )

    # claude -p returns rc=1 when --max-turns is reached, but the stream-json
    # output is still complete and parseable. Treat this graceful termination
    # as non-fatal so scenarios that hit the turn cap still produce usable
    # observations.
    nonfatal_max_turns = (
        result.returncode == 1
        and '"terminal_reason":"max_turns"' in result.stdout
    )
    if result.returncode != 0 and not nonfatal_max_turns:
        # Include both stderr and stdout tails. claude -p often surfaces the
        # actual failure context (model error JSON, partial stream-json) on
        # stdout, while stderr carries generic transport / auth messages.
        # Showing both dramatically reduces "rc=N: <empty>" debugging dead-ends.
        raise RuntimeError(
            f"claude -p failed (rc={result.returncode}): "
            f"stderr={result.stderr[:500]!r} stdout_tail={result.stdout[-500:]!r}"
        )

    observations = _parse_stream_json(result.stdout)

    return ScenarioRun(
        scenario=scenario,
        observations=tuple(observations),
        sandbox_dir=sandbox_dir,
    )


def _safe_sandbox_dir(scenario_id: str) -> Path:
    """Sanitize scenario ID and ensure path stays within sandbox base."""
    safe_id = re.sub(r"[^a-zA-Z0-9\-_]", "_", scenario_id)
    path = SANDBOX_BASE / safe_id
    # Validate path stays within sandbox base (raises ValueError on traversal)
    path.resolve().relative_to(SANDBOX_BASE.resolve())
    return path


def _setup_sandbox(sandbox_dir: Path, scenario: Scenario) -> None:
    """Create sandbox directory and run setup commands."""
    if sandbox_dir.exists():
        shutil.rmtree(sandbox_dir)
    sandbox_dir.mkdir(parents=True)

    subprocess.run(["git", "init"], cwd=sandbox_dir, capture_output=True)

    for cmd in scenario.setup_commands:
        parts = shlex.split(cmd)
        if not parts or parts[0] in SHELL_BUILTINS:
            # Shell builtins (cd/pushd/popd) cannot run as subprocess; skip.
            continue
        if parts[0] not in ALLOWED_SETUP_EXECUTABLES:
            # Restrict to known-safe executables to prevent arbitrary code execution.
            continue
        try:
            subprocess.run(parts, cwd=sandbox_dir, capture_output=True)
        except FileNotFoundError:
            # Setup tool not installed in this environment; skip rather than
            # crash the whole scenario. The compliance run continues.
            continue


def _redact_home_path(text: str) -> str:
    """Replace the operator's home directory with a portable placeholder.

    Observations flow into grade() and then into a written report
    (results/<skill>.md) that's meant to be read, diffed, and shared —
    an absolute path bakes the operator's username into every tool call
    that happened to touch anything under $HOME (including the sandbox
    itself, which lives under a tempdir but scenario setup_commands or
    an agent's own tool calls can still reference $HOME directly).
    """
    home = str(Path.home()).rstrip("/\\")
    if not home or home == "/" or re.fullmatch(r"[A-Za-z]:", home):
        return text

    parts = re.split(r"[\\/]+", home)
    home_pattern = r"[\\/]".join(re.escape(part) for part in parts)
    right_boundary = r"(?=$|[\\/]|[\s\"'`,;:)}\]])"
    flags = re.IGNORECASE if re.match(r"^[A-Za-z]:[\\/]", home) else 0
    pattern = re.compile(
        rf"(?<![\w.~+-]){home_pattern}{right_boundary}",
        flags,
    )
    return pattern.sub("~", text)


def _redact_home_paths(value: object) -> object:
    """Return a copy with home paths redacted from string keys and leaves.

    Redacted mapping keys receive a stable numeric suffix when two original
    keys collapse to the same portable value. This preserves every observation
    without leaking the original home path or silently dropping data.
    """
    if isinstance(value, str):
        return _redact_home_path(value)
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, item in value.items():
            redacted_key = _redact_home_path(key) if isinstance(key, str) else key
            candidate = redacted_key
            suffix = 2
            while candidate in redacted:
                candidate = f"{redacted_key}#{suffix}"
                suffix += 1
            redacted[candidate] = _redact_home_paths(item)
        return redacted
    if isinstance(value, list):
        return [_redact_home_paths(item) for item in value]
    return value


def _serialize_report_value(value: object) -> str:
    """Redact structured report data before encoding and truncating it."""
    redacted = _redact_home_paths(value)
    if isinstance(redacted, (dict, list)):
        serialized = json.dumps(redacted)
    else:
        serialized = str(redacted)
    return serialized[:REPORT_VALUE_LIMIT]


def _parse_stream_json(stdout: str) -> list[ObservationEvent]:
    """Parse claude -p stream-json output into ObservationEvents.

    Stream-json format:
    - type=assistant with content[].type=tool_use → tool call (name, input)
    - type=user with content[].type=tool_result → tool result (output)
    """
    events: list[ObservationEvent] = []
    pending: dict[str, dict] = {}
    event_counter = 0

    for line in stdout.strip().splitlines():
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = msg.get("type")

        if msg_type == "assistant":
            content = msg.get("message", {}).get("content", [])
            for block in content:
                if block.get("type") == "tool_use":
                    tool_use_id = block.get("id", "")
                    tool_input = block.get("input", {})
                    pending[tool_use_id] = {
                        "tool": block.get("name", "unknown"),
                        "input": _serialize_report_value(tool_input),
                        "order": event_counter,
                    }
                    event_counter += 1

        elif msg_type == "user":
            content = msg.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    tool_use_id = block.get("tool_use_id", "")
                    if tool_use_id in pending:
                        info = pending.pop(tool_use_id)
                        output_content = block.get("content", "")
                        events.append(ObservationEvent(
                            timestamp=f"T{info['order']:04d}",
                            event="tool_complete",
                            tool=info["tool"],
                            session=msg.get("session_id", "unknown"),
                            input=info["input"],
                            output=_serialize_report_value(output_content),
                        ))

    for _tool_use_id, info in pending.items():
        events.append(ObservationEvent(
            timestamp=f"T{info['order']:04d}",
            event="tool_complete",
            tool=info["tool"],
            session="unknown",
            input=info["input"],
            output="",
        ))

    return sorted(events, key=lambda e: e.timestamp)
