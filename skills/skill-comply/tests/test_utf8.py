"""UTF-8 file and CLI boundaries must preserve Unicode under legacy locales."""

import json
import locale
import os
import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from typing import Any, Callable

import pytest
import yaml

from scripts import classifier, parser, run, runner, scenario_generator, spec_generator
from scripts.grader import ComplianceResult
from scripts.parser import ComplianceSpec, Detector, ObservationEvent, Step
from scripts.runner import ScenarioRun
from scripts.scenario_generator import Scenario

TEXT = "caf\u00e9 \u65e5\u672c"
PROMPT_TEXT = "consign\u00e9e"
SPEC = {"id": "unicode", "name": TEXT, "source_rule": TEXT, "version": "1",
        "steps": [], "scoring": {"threshold_promote_to_hook": 0.6}}


def mock_cli(payload: str) -> Callable[..., subprocess.CompletedProcess[str]]:
    """Emulate decoding UTF-8 CLI bytes using the caller's selected encoding."""
    def execute(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        assert command[:2] == ["claude", "-p"]
        assert TEXT in kwargs["input"]
        encoding = kwargs.get("encoding") or locale.getpreferredencoding(False)
        return subprocess.CompletedProcess(command, 0, stdout=payload.encode("utf-8").decode(encoding), stderr="")
    return execute


@pytest.mark.parametrize("kind", ["trace", "spec"])
def test_parser_reads_utf8(tmp_path: Path, kind: str) -> None:
    source = tmp_path / "source.txt"
    if kind == "trace":
        record = {"timestamp": "T0000", "event": "tool_complete", "tool": "Read",
                  "session": "unicode", "input": TEXT, "output": TEXT}
        source.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        assert parser.parse_trace(source)[0].input == TEXT
    else:
        source.write_text(yaml.safe_dump(SPEC, allow_unicode=True), encoding="utf-8")
        assert parser.parse_spec(source).name == TEXT


def test_invalid_unicode_trace_keeps_line_diagnostic(tmp_path: Path) -> None:
    source = tmp_path / "invalid.jsonl"
    source.write_text('{"input": "' + TEXT + '", invalid}', encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid JSON at line 1"):
        parser.parse_trace(source)


@pytest.mark.parametrize("kind", ["spec", "scenarios"])
def test_generators_preserve_utf8(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text(TEXT, encoding="utf-8")
    module = spec_generator if kind == "spec" else scenario_generator
    monkeypatch.setattr(module, "PROMPTS_DIR", tmp_path)
    (tmp_path / f"{kind[:-1] if kind == 'scenarios' else kind}_generator.md").write_text(
        PROMPT_TEXT + " {skill_content} {spec_yaml}", encoding="utf-8",
    )
    response = SPEC if kind == "spec" else {"scenarios": [
        {"id": "one", "level": 1, "level_name": TEXT, "description": TEXT, "prompt": TEXT},
    ]}
    execute = mock_cli(yaml.safe_dump(response, allow_unicode=True))
    def checked_execute(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        assert PROMPT_TEXT in kwargs["input"]
        return execute(command, **kwargs)
    monkeypatch.setattr(module.subprocess, "run", checked_execute)
    if kind == "spec":
        assert spec_generator.generate_spec(skill, max_retries=0).name == TEXT
    else:
        assert scenario_generator.generate_scenarios(skill, "steps: []")[0].prompt == TEXT


def test_spec_retry_preserves_utf8(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text(TEXT, encoding="utf-8")
    responses = iter(["steps: [invalid", yaml.safe_dump(SPEC, allow_unicode=True)])
    prompts: list[str] = []
    def execute(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        prompts.append(kwargs["input"])
        return mock_cli(next(responses))(command, **kwargs)
    monkeypatch.setattr(spec_generator.subprocess, "run", execute)
    assert spec_generator.generate_spec(skill, max_retries=1).name == TEXT
    assert len(prompts) == 2
    assert "PREVIOUS ATTEMPT FAILED" in prompts[1]


def test_classifier_preserves_utf8(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "classifier.md").write_text(PROMPT_TEXT + " {steps_description} {tool_calls}", encoding="utf-8")
    monkeypatch.setattr(classifier, "PROMPTS_DIR", tmp_path)
    execute = mock_cli(json.dumps({TEXT: [0]}, ensure_ascii=False))
    def checked_execute(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        assert PROMPT_TEXT in kwargs["input"]
        return execute(command, **kwargs)
    monkeypatch.setattr(classifier.subprocess, "run", checked_execute)
    spec = ComplianceSpec("unicode", TEXT, TEXT, "1", (Step(TEXT, TEXT, True, Detector(TEXT)),), 0.6)
    trace = [ObservationEvent("T0000", "tool_complete", "Read", "unicode", TEXT, TEXT)]
    assert classifier.classify_events(spec, trace) == {TEXT: [0]}


def test_runner_preserves_utf8_capture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "SANDBOX_BASE", tmp_path)
    monkeypatch.setattr(runner, "_setup_sandbox", lambda *_args: None)
    messages = [
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "one", "name": "Read", "input": TEXT}]}},
        {"type": "user", "session_id": "unicode", "message": {"content": [{"type": "tool_result", "tool_use_id": "one", "content": TEXT}]}},
    ]
    payload = "\n".join(json.dumps(message, ensure_ascii=False) for message in messages)
    monkeypatch.setattr(runner.subprocess, "run", mock_cli(payload))
    scenario = Scenario("unicode", 1, "one", TEXT, TEXT, ())
    assert runner.run_scenario(scenario).observations[0].output == TEXT


@pytest.mark.skipif(os.name == "nt", reason="Windows does not use the POSIX locale for argv encoding")
def test_real_cli_receives_utf8_prompt_on_stdin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A real child process catches Unicode argv failures that mocked run calls miss."""
    fake_cli = tmp_path / "claude"
    fake_cli.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys\n"
        "data = sys.stdin.buffer.read()\n"
        "with open(os.environ['ECC_FAKE_CLAUDE_STDIN'], 'wb') as stream:\n"
        "    stream.write(data)\n"
        "with open(os.environ['ECC_FAKE_CLAUDE_RESPONSE'], 'rb') as stream:\n"
        "    sys.stdout.buffer.write(stream.read())\n",
        encoding="ascii",
    )
    fake_cli.chmod(0o755)
    captured = tmp_path / "stdin.bin"
    response = tmp_path / "response.yaml"
    response.write_text(yaml.safe_dump(SPEC, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("ECC_FAKE_CLAUDE_STDIN", str(captured))
    monkeypatch.setenv("ECC_FAKE_CLAUDE_RESPONSE", str(response))
    monkeypatch.setenv("PATH", str(tmp_path) + os.pathsep + os.environ["PATH"])

    skill = tmp_path / "SKILL.md"
    skill.write_text(TEXT, encoding="utf-8")
    assert spec_generator.generate_spec(skill, max_retries=0).name == TEXT
    assert TEXT.encode("utf-8") in captured.read_bytes()


def test_report_is_written_as_utf8(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text(TEXT, encoding="utf-8")
    output = tmp_path / "report.md"
    monkeypatch.setattr(run, "__file__", str(tmp_path / "scripts/run.py"))
    monkeypatch.setattr(sys, "argv", ["skill-comply", str(skill), "--output", str(output)])
    monkeypatch.setattr(run, "generate_spec", lambda *_args, **_kwargs: parser.ComplianceSpec("unicode", TEXT, TEXT, "1", (), 0.6))
    scenario = Scenario("unicode", 1, TEXT, TEXT, TEXT, ())
    observation = ObservationEvent("T0000", "tool_complete", "Read", "unicode", TEXT, TEXT)
    monkeypatch.setattr(run, "generate_scenarios", lambda *_args, **_kwargs: [scenario])
    monkeypatch.setattr(run, "run_scenario", lambda *_args, **_kwargs: ScenarioRun(scenario, (observation,), tmp_path))
    monkeypatch.setattr(run, "grade", lambda *_args, **_kwargs: ComplianceResult("unicode", (), 0.5, True, {}))
    monkeypatch.setattr(run, "generate_report", lambda *_args, **_kwargs: TEXT)
    run.main()
    assert output.read_text(encoding="utf-8") == TEXT


def test_utf8_boundaries_under_legacy_encoding() -> None:
    if os.environ.get("ECC_UTF8_TEST_CHILD") == "1":
        pytest.skip("The child process must not launch another child")
    script = dedent("""
        import codecs
        import io
        import locale
        import os
        import sys
        from typing import IO, Any

        assert sys.flags.utf8_mode == 0
        if os.name == "nt":
            # Windows ignores LC_ALL for text I/O; emulate its legacy default.
            original_open = io.open
            def legacy_open(
                file: Any, mode: str = "r", buffering: int = -1,
                encoding: str | None = None, *args: Any, **kwargs: Any,
            ) -> IO[Any]:
                if "b" not in mode and encoding in (None, "locale"):
                    encoding = "cp1252"
                return original_open(file, mode, buffering, encoding, *args, **kwargs)
            io.open = legacy_open
            locale.getencoding = lambda: "cp1252"
            locale.getpreferredencoding = lambda do_setlocale=True: "cp1252"
        else:
            assert codecs.lookup(locale.getencoding()).name == "ascii"
        with io.open(os.devnull) as probe:
            assert codecs.lookup(probe.encoding).name in {"ascii", "cp1252"}

        import pytest
        raise SystemExit(pytest.main(sys.argv[1:]))
    """)
    source = Path(__file__).resolve()
    result = subprocess.run(
        [sys.executable, "-X", "utf8=0", "-c", script, str(source),
         "-c", str(source.parents[1] / "pyproject.toml"), "-q",
         "-k", "not test_utf8_boundaries_under_legacy_encoding", "-p", "no:cacheprovider"],
        cwd=source.parents[1],
        env={**os.environ, "LC_ALL": "C", "PYTHONCOERCELOCALE": "0", "PYTHONUTF8": "0",
             "PYTHONIOENCODING": "utf-8", "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
             "PYTEST_ADDOPTS": "", "ECC_UTF8_TEST_CHILD": "1"},
        capture_output=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
