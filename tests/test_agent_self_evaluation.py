"""Input-mode regressions for the standalone agent output evaluator."""

import argparse
import errno
import importlib.util
import io
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import NoReturn

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "skills/agent-self-evaluation/scripts/evaluate.py"
PI_SCRIPT = SCRIPT.parents[3] / "pi/core/skills/agent-self-evaluation/scripts/evaluate.py"


def args(**overrides: object) -> argparse.Namespace:
    return argparse.Namespace(**{"interactive": False, "task": None, "output": None, **overrides})


def test_output_file_uses_piped_task(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "response.txt"
    output.write_text("All tests passed.", encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", io.StringIO("Add retry logic"))

    assert evaluator._read_input(args(output=str(output))) == ("Add retry logic", "All tests passed.")


def test_explicit_task_takes_precedence_over_pipe(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "response.txt"
    output.write_text("Answer", encoding="utf-8")
    stream = io.StringIO("Ignored pipe")
    monkeypatch.setattr(sys, "stdin", stream)

    assert evaluator._read_input(args(task="Explicit task", output=str(output))) == ("Explicit task", "Answer")
    assert stream.tell() == 0


def test_output_file_without_task_does_not_read_terminal(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "response.txt"
    output.write_text("Answer", encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(isatty=lambda: True))

    assert evaluator._read_input(args(output=str(output))) == (None, "Answer")


def test_no_output_file_keeps_stdin_as_output(evaluator: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO("Piped answer"))
    assert evaluator._read_input(args(task="Inline task")) == ("Inline task", "Piped answer")


def test_interactive_mode_keeps_prompt_and_stdin(evaluator: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _prompt: "  Interactive task  ")
    monkeypatch.setattr(sys, "stdin", io.StringIO("Interactive answer"))
    assert evaluator._read_input(args(interactive=True)) == ("Interactive task", "Interactive answer")


def test_task_can_still_be_read_from_file(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    task = tmp_path / "task.txt"
    task.write_text("File task", encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", io.StringIO("Piped answer"))
    assert evaluator._read_input(args(task=str(task))) == ("File task", "Piped answer")


def test_missing_output_file_still_fails(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO("Task"))
    with pytest.raises(SystemExit) as exc_info:
        evaluator._read_input(args(output=str(tmp_path / "missing.txt")))
    assert exc_info.value.code == 1
    assert "not found" in capsys.readouterr().err


@pytest.mark.parametrize("output_kind", ["missing", "directory"])
def test_invalid_output_is_rejected_before_reading_pipe(
    evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, output_kind: str
) -> None:
    output = tmp_path / "output.txt"
    if output_kind == "directory":
        output.mkdir()
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(
        isatty=lambda: False,
        read=lambda: pytest.fail("Required output must be validated before waiting for piped input"),
    ))
    error = (IsADirectoryError, PermissionError) if output_kind == "directory" else SystemExit
    with pytest.raises(error):
        evaluator._read_input(args(output=str(output)))


def test_cli_uses_piped_task_for_conciseness_score(evaluator: ModuleType, tmp_path: Path) -> None:
    output = tmp_path / "response.txt"
    output.write_text("Verified with tests. " * 25, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-X", "utf8", str(evaluator.__file__), "--output", str(output)],
        input="Fix bug",
        capture_output=True,
        encoding="utf-8",
        check=True,
        timeout=10,
    )
    assert re.search(r"Conciseness[^\n]*3/5", result.stdout)


def test_long_inline_task_remains_text(evaluator: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "response.txt"
    output.write_text("Answer", encoding="utf-8")
    task = "Long explicit task description. " * 60
    monkeypatch.setattr(sys, "stdin", io.StringIO("Ignored pipe"))
    assert evaluator._read_input(args(task=task, output=str(output))) == (task, "Answer")


@pytest.mark.parametrize("error_code", [errno.EACCES, errno.EISDIR])
def test_task_read_does_not_hide_other_file_errors(evaluator: ModuleType, monkeypatch: pytest.MonkeyPatch, error_code: int) -> None:
    def fail_open(_path: str) -> NoReturn:
        raise OSError(error_code, "Cannot read task")

    monkeypatch.setattr("builtins.open", fail_open)
    with pytest.raises(OSError) as captured:
        evaluator._read_file_or_text("task-file")
    assert captured.value.errno == error_code


@pytest.fixture(params=[SCRIPT, PI_SCRIPT], ids=["canonical", "pi"])
def evaluator(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    spec = importlib.util.spec_from_file_location("task_input_evaluator", request.param)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("platform", ["win32", "linux", "darwin"])
@pytest.mark.parametrize("required", [False, True], ids=["optional", "required"])
@pytest.mark.parametrize(
    "error_code", [errno.EINVAL, errno.ENOENT, errno.ENAMETOOLONG, errno.EACCES, errno.EISDIR, errno.EIO]
)
def test_file_error_fallback_is_platform_and_mode_scoped(
    evaluator: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    platform: str,
    required: bool,
    error_code: int,
) -> None:
    task = "Long inline task. " * 60
    error = OSError(error_code, "Cannot read file")

    def fail_open(_path: str) -> NoReturn:
        raise error

    monkeypatch.setattr(evaluator.sys, "platform", platform)
    monkeypatch.setattr("builtins.open", fail_open)
    can_fallback = error_code in (errno.ENOENT, errno.ENAMETOOLONG) or (
        error_code == errno.EINVAL and platform == "win32" and not required
    )
    if can_fallback and not required:
        assert evaluator._read_file_or_text(task) == task
    elif can_fallback:
        with pytest.raises(SystemExit) as captured_exit:
            evaluator._read_file_or_text(task, required=True)
        assert captured_exit.value.code == 1
        assert "not found" in capsys.readouterr().err
    else:
        with pytest.raises(OSError) as captured_error:
            evaluator._read_file_or_text(task, required=required)
        assert captured_error.value is error
