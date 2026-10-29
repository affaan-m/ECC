"""Tests for runner module — scenario execution + subprocess error handling."""

from __future__ import annotations

import json
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from scripts.runner import (
    SANDBOX_BASE,
    _parse_stream_json,
    _safe_sandbox_dir,
    _setup_sandbox,
    run_scenario,
)
from scripts.scenario_generator import Scenario


@dataclass(frozen=True)
class _FakeScenario:
    """Minimal Scenario-like object for runner tests (avoids generator deps)."""

    id: str
    prompt: str = "do nothing"
    setup_commands: tuple[str, ...] = ()


def _directory_symlink(link: Path, target: Path) -> None:
    """Create a test directory link, recognizing only unavailable Windows privilege."""
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError as error:
        if sys.platform == "win32" and getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows symlink privilege is unavailable (error 1314)")
        raise


class TestDirectorySymlinkFixture:
    def test_windows_success_keeps_directory_link_flag(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform="win32"))
        with patch.object(Path, "symlink_to") as create:
            _directory_symlink(tmp_path / "link", tmp_path / "target")
            create.assert_called_once_with(tmp_path / "target", target_is_directory=True)

    def test_only_windows_privilege_error_is_skipped(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform="win32"))
        error = OSError("controlled missing symlink privilege")
        setattr(error, "winerror", 1314)
        with patch.object(Path, "symlink_to", side_effect=error):
            with pytest.raises(pytest.skip.Exception, match="error 1314"):
                _directory_symlink(tmp_path / "link", tmp_path / "target")

    @pytest.mark.parametrize(
        ("platform", "winerror"),
        [("win32", 5), ("win32", None), ("linux", 1314), ("darwin", 1314)],
    )
    def test_other_errors_still_fail(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
        platform: str, winerror: int | None,
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform=platform))
        error = PermissionError("controlled unrelated link failure")
        if winerror is not None:
            setattr(error, "winerror", winerror)
        with patch.object(Path, "symlink_to", side_effect=error):
            with pytest.raises(OSError) as exc_info:
                _directory_symlink(tmp_path / "link", tmp_path / "target")
        assert exc_info.value is error


class TestSafeSandboxDirectory:
    def test_empty_id_cannot_delete_the_shared_base(self) -> None:
        with (
            patch("scripts.runner.Path.exists", return_value=True),
            patch("scripts.runner.shutil.rmtree") as remove,
            patch("scripts.runner.Path.mkdir") as mkdir,
            patch("scripts.runner.subprocess.run") as execute,
        ):
            execute.return_value = subprocess.CompletedProcess([], 0, stdout="", stderr="")
            with pytest.raises(ValueError, match="sandbox"):
                run_scenario(_FakeScenario(id=""))
            remove.assert_not_called()
            mkdir.assert_not_called()
            execute.assert_not_called()

    def test_resolved_base_is_not_a_scenario_directory(self) -> None:
        with patch("scripts.runner.Path.resolve", return_value=SANDBOX_BASE):
            with pytest.raises(ValueError, match="sandbox"):
                _safe_sandbox_dir("alias")

    def test_valid_id_keeps_existing_sanitization(self) -> None:
        assert _safe_sandbox_dir("scenario/one") == SANDBOX_BASE / "scenario_one"

    def test_resolved_escape_is_still_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "sandbox"
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch.object(Path, "resolve", side_effect=[tmp_path / "outside", base]):
            with pytest.raises(ValueError):
                _safe_sandbox_dir("escape")


class TestSandboxBaseBoundary:
    def test_live_base_link_preserves_outside_files(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base = tmp_path / "base"
        _directory_symlink(base, outside)
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with pytest.raises(ValueError, match="base"):
            _safe_sandbox_dir("probe")
        assert sentinel.read_bytes() == b"outside must remain unchanged"
        assert not (target / ".git").exists()

    def test_setup_rechecks_base_before_cleanup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        base.mkdir()
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        selected = _safe_sandbox_dir("probe")
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base.rmdir()
        _directory_symlink(base, outside)
        with pytest.raises(ValueError, match="base"):
            _setup_sandbox(selected, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert sentinel.read_bytes() == b"outside must remain unchanged"
        assert not (target / ".git").exists()

    def test_public_scenario_rejects_base_link_before_subprocess(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base = tmp_path / "base"
        _directory_symlink(base, outside)
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                run_scenario(Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
            execute.assert_not_called()
        assert sentinel.read_bytes() == b"outside must remain unchanged"

    def test_dangling_base_link_is_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        _directory_symlink(base, tmp_path / "missing")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with pytest.raises(ValueError, match="base"):
            _safe_sandbox_dir("probe")

    @pytest.mark.parametrize("entry", ["safe", "setup"])
    def test_directory_reparse_attributes_are_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entry: str
    ) -> None:
        base = tmp_path / "base"
        target = base / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"preserve before reparse refusal")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        original = Path.lstat
        def controlled_lstat(path: Path) -> object:
            if path == base:
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_file_attributes=0x400)
            return original(path)
        monkeypatch.setattr(Path, "lstat", controlled_lstat)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                if entry == "safe":
                    _safe_sandbox_dir("probe")
                else:
                    _setup_sandbox(target, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
            execute.assert_not_called()
        assert sentinel.read_bytes() == b"preserve before reparse refusal"

    @pytest.mark.parametrize("existing", [False, True])
    def test_valid_setup_preserves_outside_sentinel(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, existing: bool
    ) -> None:
        base = tmp_path / "base"
        target = base / "probe"
        if existing:
            target.mkdir(parents=True)
            (target / "stale").write_bytes(b"prior scenario")
        outside = tmp_path / "outside-sentinel"
        outside.write_bytes(b"preserve outside")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        _setup_sandbox(_safe_sandbox_dir("probe"), Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert (target / ".git").is_dir()
        assert not (target / "stale").exists()
        assert outside.read_bytes() == b"preserve outside"

    def test_regular_file_base_is_rejected_before_cleanup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        base.write_bytes(b"preserve base file")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                _safe_sandbox_dir("probe")
            execute.assert_not_called()
        assert base.read_bytes() == b"preserve base file"

    def test_parent_alias_remains_usable(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        parent = tmp_path / "real-parent"
        parent.mkdir()
        alias = tmp_path / "parent-alias"
        _directory_symlink(alias, parent)
        base = alias / "base"
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        target = _safe_sandbox_dir("probe")
        _setup_sandbox(target, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert (parent / "base/probe/.git").is_dir()


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


@pytest.mark.unit
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

    def test_mapping_keys_are_redacted_without_silent_collision(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = r"C:\Users\Zoë"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                home + r"\private.txt": "first",
                r"c:\users\zoë\private.txt": "second",
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        parsed_input = json.loads(events[0].input)
        assert home not in events[0].input
        assert parsed_input == {
            r"~\private.txt": "first",
            r"~\private.txt#2": "second",
        }

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
