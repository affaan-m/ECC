"""Tests for runner module — scenario execution + subprocess error handling."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import pytest
from scripts.runner import _parse_stream_json, _setup_sandbox, run_scenario


@dataclass(frozen=True)
class _FakeScenario:
    """Minimal Scenario-like object for runner tests (avoids generator deps)."""

    id: str
    prompt: str = "do nothing"
    setup_commands: tuple[str, ...] = ()


class TestSetupSandboxSkipsShellBuiltins:
    """Setup commands containing shell builtins (cd/pushd/popd) must be skipped.

    Regression: subprocess.run(["cd", ...]) raises FileNotFoundError because
    cd is a shell builtin, not an external binary. Real-world scenarios often
    include "cd subdir" in setup_commands assuming shell semantics, so the
    runner must tolerate this rather than crashing the whole scenario.
    """

    def test_skips_cd(self, tmp_path):
        scenario = _FakeScenario(
            id="t1",
            setup_commands=("cd subdir",),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        # git init runs once; "cd subdir" must NOT be passed to subprocess
        assert ["git", "init"] in called_args
        assert ["cd", "subdir"] not in called_args

    def test_skips_pushd_popd(self, tmp_path):
        scenario = _FakeScenario(
            id="t2",
            setup_commands=("pushd dir", "popd"),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        assert ["pushd", "dir"] not in called_args
        assert ["popd"] not in called_args

    def test_tolerates_missing_executable(self, tmp_path):
        """A scenario referencing an unavailable tool must not crash setup."""
        scenario = _FakeScenario(
            id="t3",
            setup_commands=("nonexistent-tool-xyz arg",),
        )

        def fake_run(args, **kwargs):
            if args[0] == "nonexistent-tool-xyz":
                raise FileNotFoundError(2, "No such file or directory")
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            # Must NOT raise — missing tools are skipped, not fatal
            _setup_sandbox(tmp_path, scenario)

    def test_real_commands_still_run(self, tmp_path):
        """Skip logic must not break legitimate setup commands."""
        scenario = _FakeScenario(
            id="t4",
            setup_commands=("touch file.txt", "cd ignored", "echo hi"),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        # Real commands present, cd absent
        assert ["touch", "file.txt"] in called_args
        assert ["echo", "hi"] in called_args
        assert ["cd", "ignored"] not in called_args


class TestRunScenarioMaxTurnsTermination:
    """rc=1 with terminal_reason=max_turns is graceful termination, not failure.

    claude -p returns rc=1 when --max-turns is reached, but the stream-json
    output is still valid. Treating this as RuntimeError aborts scenarios
    that would have produced useful observations. Detect the marker in stdout
    and downgrade rc=1 + max_turns to non-fatal.
    """

    def test_rc1_with_max_turns_marker_returns_normally(self, tmp_path, monkeypatch):
        scenario = _FakeScenario(id="mt1", prompt="long task", setup_commands=())

        # Skip sandbox setup side effects
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        max_turns_stdout = (
            '{"type":"system","subtype":"init","session_id":"s1"}\n'
            '{"type":"result","terminal_reason":"max_turns"}\n'
        )

        fake_result = subprocess.CompletedProcess(
            args=["claude"], returncode=1, stdout=max_turns_stdout, stderr=""
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            # Must NOT raise — max_turns is graceful termination
            run_scenario(scenario, model="haiku")

    def test_rc1_without_max_turns_marker_still_raises(self, tmp_path, monkeypatch):
        """Real failures (rc≠0 with no max_turns marker) must still raise."""
        scenario = _FakeScenario(id="mt2", prompt="oops", setup_commands=())
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        fake_result = subprocess.CompletedProcess(
            args=["claude"], returncode=1, stdout="", stderr="auth error"
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            with pytest.raises(RuntimeError, match="claude -p failed"):
                run_scenario(scenario, model="haiku")


class TestParseStreamJsonRedactsHomePath:
    """Observations feed grade() and then a written report (results/<skill>.md) —
    a raw absolute path bakes the operator's username into every tool call
    that touched anything under $HOME. --add-dir restricts the sandbox, but
    scenario setup_commands or the model's own tool calls can still reference
    $HOME directly (e.g. a Bash command using ~ expansion, or a scenario that
    legitimately needs to read a dotfile). Redact to a portable placeholder
    rather than persisting the raw path.
    """

    def _stream_json_for(self, tool_input: dict, output_content: object) -> str:
        return (
            '{"type":"assistant","message":{"content":[{"type":"tool_use",'
            '"id":"tu1","name":"Read","input":' + json.dumps(tool_input) + "}]}}\n"
            '{"type":"user","session_id":"s1","message":{"content":[{"type":'
            '"tool_result","tool_use_id":"tu1","content":' + json.dumps(output_content) + "}]}}\n"
        )

    @staticmethod
    def _set_home(monkeypatch: pytest.MonkeyPatch, home: str) -> None:
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(home)))

    def test_posix_input_string_leaves_and_embedded_paths_redacted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                "command": f"cat '{home}/notes/secrets.env' && echo home={home}, done",
                "nested": {"paths": [f"{home}/one", f"{home}/two"]},
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        assert len(events) == 1
        assert home not in events[0].input
        parsed_input = json.loads(events[0].input)
        assert parsed_input["command"] == "cat '~/notes/secrets.env' && echo home=~, done"
        assert parsed_input["nested"]["paths"] == ["~/one", "~/two"]

    def test_windows_home_with_unicode_and_backslashes_redacted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = r"C:\Users\Zoë"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                "paths": [
                    home + r"\Documents\résumé.txt",
                    "C:/Users/Zoë/資料.txt",
                ]
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        assert len(events) == 1
        parsed_input = json.loads(events[0].input)
        assert parsed_input["paths"] == [
            r"~\Documents\résumé.txt",
            "~/資料.txt",
        ]

    def test_sibling_and_embedded_prefix_paths_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        outside_paths = [
            "/home/alice-old/report.txt",
            "/home/alice2/report.txt",
            "/tmp/home/alice/report.txt",
        ]
        stdout = self._stream_json_for(
            {"paths": outside_paths},
            [{"type": "text", "text": path} for path in outside_paths],
        )
        events = _parse_stream_json(stdout)

        assert json.loads(events[0].input)["paths"] == outside_paths
        assert [item["text"] for item in json.loads(events[0].output)] == outside_paths

    def test_list_output_redacts_nested_string_leaves(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/Users/reviewer"
        self._set_home(monkeypatch, home)
        output_content = [
            {"type": "text", "text": f"created {home}/résumé.txt"},
            {"type": "metadata", "paths": [home, f"{home}/資料.json"]},
        ]
        stdout = self._stream_json_for({"file_path": "irrelevant"}, output_content)
        events = _parse_stream_json(stdout)

        assert json.loads(events[0].output) == [
            {"type": "text", "text": "created ~/résumé.txt"},
            {"type": "metadata", "paths": ["~", "~/資料.json"]},
        ]

    def test_redacts_before_json_serialization_and_5000_character_truncation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        boundary_value = "x" * 4977 + f" {home}/secret.txt" + "tail" * 20
        stdout = self._stream_json_for(
            {"command": boundary_value},
            boundary_value,
        )
        events = _parse_stream_json(stdout)

        assert len(events[0].input) == 5000
        assert "~/secret" in events[0].input
        assert "/home/" not in events[0].input
        assert len(events[0].output) == 5000
        assert "~/secret.txt" in events[0].output
        assert "/home/" not in events[0].output


class TestRunScenarioErrorIncludesStdoutTail:
    """Error messages must include stdout tail, not only stderr.

    When claude -p fails inside an LLM call, useful diagnostic context often
    appears in stdout (partial stream-json events, model error JSON), not
    stderr. Including stdout tail in the RuntimeError message dramatically
    improves debug-ability without adding any new dependency.
    """

    def test_error_message_contains_stdout_tail(self, tmp_path, monkeypatch):
        scenario = _FakeScenario(id="e1", prompt="x", setup_commands=())
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        diagnostic_marker = "DIAG_STDOUT_MARKER_xyz123"
        fake_result = subprocess.CompletedProcess(
            args=["claude"],
            returncode=2,
            stdout=f"some context {diagnostic_marker} more text",
            stderr="generic error",
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            with pytest.raises(RuntimeError) as excinfo:
                run_scenario(scenario, model="haiku")

        # Stdout marker MUST appear in the error message
        assert diagnostic_marker in str(excinfo.value)
