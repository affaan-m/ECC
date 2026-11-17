"""Only the final result frame can make an exit-1 run usable for grading."""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from scripts import runner
from scripts.scenario_generator import Scenario


@pytest.fixture
def run_cli_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[str, int], runner.ScenarioRun]:
    """Exercise run_scenario with a real, local process instead of a provider."""
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    program = tmp_path / "emit.py"
    program.write_text(
        "import pathlib, sys\n"
        "sys.stdin.read()\n"
        "sys.stdout.buffer.write(pathlib.Path(sys.argv[1]).read_bytes())\n"
        "sys.stderr.write('controlled CLI diagnostic')\n"
        "sys.exit(int(sys.argv[2]))\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "_safe_sandbox_dir", lambda _id: sandbox)
    monkeypatch.setattr(runner, "_setup_sandbox", lambda *args, **kwargs: None)
    monkeypatch.setattr(runner, "_install_gh_stub", lambda _path: sandbox)
    real_run = subprocess.run

    def execute(stdout: str, returncode: int = 1) -> runner.ScenarioRun:
        stream = tmp_path / "stream.jsonl"
        stream.write_text(stdout, encoding="utf-8")

        def local_cli(
            args: list[str], **kwargs: Any
        ) -> subprocess.CompletedProcess[str]:
            assert args[:2] == ["claude", "-p"]
            return real_run(
                [sys.executable, str(program), str(stream), str(returncode)],
                **kwargs,
            )

        monkeypatch.setattr(runner.subprocess, "run", local_cli)
        return runner.run_scenario(
            Scenario("terminal", 1, "test", "Local CLI boundary", "No provider", ()),
            model="haiku",
        )

    return execute


def _jsonl(*messages: dict[str, Any], compact: bool = True) -> str:
    separators = (",", ":") if compact else (", ", ": ")
    return (
        "\n".join(json.dumps(message, separators=separators) for message in messages)
        + "\n"
    )


def _tool_trace() -> str:
    return _jsonl(
        {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "read-1",
                        "name": "Read",
                        "input": {"file_path": "notes.md"},
                    },
                ]
            },
        },
        {
            "type": "user",
            "session_id": "local-session",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "read-1",
                        "content": "kept evidence",
                    },
                ]
            },
        },
    )


@pytest.mark.unit
@pytest.mark.parametrize("compact", [True, False])
@pytest.mark.parametrize(
    "termination",
    [
        {"terminal_reason": "max_turns"},
        {"subtype": "error_max_turns"},
        {"subtype": "error_max_turns", "terminal_reason": "max_turns"},
        {"subtype": "error_max_turns", "terminal_reason": None},
    ],
)
def test_turn_limit_result_preserves_tool_observations(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    compact: bool,
    termination: dict[str, Any],
) -> None:
    stdout = _tool_trace() + _jsonl(
        {"type": "result", "is_error": True, **termination},
        compact=compact,
    )
    result = run_cli_output(stdout, 1)

    assert not result.timed_out
    assert len(result.observations) == 1
    observed = result.observations[0]
    assert (observed.tool, observed.output, observed.session) == (
        "Read",
        "kept evidence",
        "local-session",
    )
    assert json.loads(observed.input) == {"file_path": "notes.md"}


@pytest.mark.unit
@pytest.mark.parametrize(
    "misleading_event",
    [
        {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "t",
                        "name": "Write",
                        "input": {"terminal_reason": "max_turns"},
                    },
                ]
            },
        },
        {
            "type": "assistant",
            "terminal_reason": "max_turns",
            "message": {"content": []},
        },
        {"type": "system", "terminal_reason": "max_turns"},
        {
            "type": "result",
            "subtype": "error_during_execution",
            "details": {"terminal_reason": "max_turns"},
        },
        {
            "type": "result",
            "terminal_reason": "max_turns",
            "parent_tool_use_id": "child",
        },
    ],
)
def test_nested_or_nonterminal_markers_do_not_mask_cli_failure(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    misleading_event: dict[str, Any],
) -> None:
    with pytest.raises(RuntimeError, match="claude -p failed"):
        run_cli_output(_tool_trace() + _jsonl(misleading_event), 1)


@pytest.mark.unit
@pytest.mark.parametrize(
    "final_result",
    [
        {"subtype": "error_during_execution", "terminal_reason": "api_error"},
        {"subtype": "error_max_budget_usd", "terminal_reason": "budget_exhausted"},
        {"subtype": "success", "terminal_reason": "completed"},
        {"subtype": "error_max_turns", "terminal_reason": "api_error"},
        {"subtype": "error_during_execution", "terminal_reason": "max_turns"},
        {},
    ],
)
def test_last_result_overrides_an_earlier_turn_limit(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    final_result: dict[str, Any],
) -> None:
    stdout = _tool_trace() + _jsonl(
        {"type": "result", "terminal_reason": "max_turns"},
        {"type": "result", **final_result},
    )
    with pytest.raises(RuntimeError, match="claude -p failed"):
        run_cli_output(stdout, 1)


@pytest.mark.unit
def test_trailing_system_event_does_not_hide_final_result(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
) -> None:
    stdout = _tool_trace() + _jsonl(
        {"type": "result", "terminal_reason": "max_turns"},
        {"type": "system", "subtype": "prompt_suggestion"},
    )
    assert len(run_cli_output(stdout, 1).observations) == 1


@pytest.mark.unit
@pytest.mark.parametrize("returncode", [2, 7])
def test_other_exit_codes_remain_failures(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    returncode: int,
) -> None:
    stdout = _tool_trace() + _jsonl({"type": "result", "terminal_reason": "max_turns"})
    with pytest.raises(RuntimeError, match=f"rc={returncode}"):
        run_cli_output(stdout, returncode)


@pytest.mark.unit
def test_zero_exit_does_not_need_a_turn_limit(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
) -> None:
    assert len(run_cli_output(_tool_trace(), 0).observations) == 1


@pytest.mark.unit
@pytest.mark.parametrize(
    "stdout",
    [
        "",
        'diagnostic: "terminal_reason":"max_turns"\n',
        '{"type":"result","terminal_reason":"max_turns"',
        '[{"type":"result","terminal_reason":"max_turns"}]\n',
        "null\n",
    ],
)
def test_missing_or_malformed_result_is_not_a_turn_limit(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    stdout: str,
) -> None:
    with pytest.raises(RuntimeError, match="claude -p failed"):
        run_cli_output(stdout, 1)


@pytest.mark.unit
@pytest.mark.parametrize("trailing", ['{"type":"result"', "null\n", "not JSON\n"])
def test_corrupt_trailing_output_does_not_reuse_an_earlier_result(
    run_cli_output: Callable[[str, int], runner.ScenarioRun],
    trailing: str,
) -> None:
    stdout = _jsonl({"type": "result", "terminal_reason": "max_turns"}) + trailing
    with pytest.raises(RuntimeError, match="claude -p failed"):
        run_cli_output(stdout, 1)
