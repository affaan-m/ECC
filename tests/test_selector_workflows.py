"""Offline operator workflows for the public selector API and CLI entries."""

import io
import json
import os
import socket
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

from llm.cli.selector import interactive_select, main
from llm.providers import get_provider

SOURCE = Path(__file__).resolve().parents[1] / "src"
HOME_CONFIG = "LLM_PROVIDER=ollama\nLLM_MODEL=home-must-stay-untouched\n"
NETWORK_GUARD = """
import sys
def deny_network(event, args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        raise RuntimeError("Selector workflows must remain offline")
sys.addaudithook(deny_network)
"""


@dataclass(frozen=True)
class Operator:
    project: Path
    env: dict[str, str]

    def run(
        self, args: list[str], answers: str = ""
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, *args],
            input=answers,
            cwd=self.project,
            env=self.env,
            text=True,
            capture_output=True,
            timeout=15,
            check=True,
        )

    def selection(self) -> list[str]:
        """Resolve saved configuration in a fresh process without inference."""
        result = self.run(
            [
                "-c",
                "import json; from llm import get_provider; p = get_provider(); "
                "print(json.dumps([p.provider_type.value, p.get_default_model()]))",
            ]
        )
        selection: list[str] = json.loads(result.stdout)
        return selection


@pytest.fixture
def operator(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Operator]:
    home = tmp_path / "home"
    project = tmp_path / "project"
    guard = tmp_path / "offline"
    for directory in (home, project, guard):
        directory.mkdir()
    home.joinpath(".llm.env").write_text(HOME_CONFIG)
    guard.joinpath("sitecustomize.py").write_text(NETWORK_GUARD)
    env = {
        "HOME": str(home),
        "PATH": os.defpath,
        "PYTHONPATH": os.pathsep.join((str(guard), str(SOURCE))),
        "PYTHONUTF8": "1",
        "ANTHROPIC_API_KEY": "offline-test-key",
        "OPENAI_API_KEY": "offline-test-key",
    }
    monkeypatch.chdir(project)
    for name in tuple(os.environ):
        if name.startswith(("LLM_", "OLLAMA_", "ATLAS_", "ASTRAFLOW_")):
            monkeypatch.delenv(name)
    # Record absent values too: persist=True writes directly to os.environ.
    for name in ("LLM_PROVIDER", "LLM_MODEL"):
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)
    for name in ("HOME", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setenv(name, env[name])

    def deny_network(*args: object, **kwargs: object) -> None:
        pytest.fail("Selector workflow attempted a network connection")

    monkeypatch.setattr(socket.socket, "connect", deny_network)
    monkeypatch.setattr(socket.socket, "connect_ex", deny_network)
    monkeypatch.setattr(socket, "getaddrinfo", deny_network)
    yield Operator(project, env)
    assert home.joinpath(".llm.env").read_text() == HOME_CONFIG


@pytest.mark.parametrize("entry", ["module", "console"])
def test_real_cli_creates_loads_and_replaces_project_selection(
    operator: Operator, entry: str
) -> None:
    if entry == "console":
        script = Path(sys.executable).parent / "llm-select"
        if not script.is_file():
            pytest.skip(
                "Installed llm-select console entry unavailable; module entry still exercised"
            )
        args = [str(script)]
    else:
        args = ["-m", "llm"]

    assert operator.selection() == ["claude", "claude-sonnet-4-6"]
    origin = operator.run(["-c", "import llm; print(llm.__file__)"])
    assert Path(origin.stdout.strip()).resolve() == SOURCE / "llm" / "__init__.py"
    first = operator.run(args, "3\n2\n")
    assert "Available Providers:" in first.stdout
    assert "Local Ollama models" in first.stdout
    assert "Available Models:" in first.stdout
    assert "Mistral - Fast & efficient" in first.stdout
    assert "Ready to use!" in first.stdout
    assert "export LLM_PROVIDER=ollama" in first.stdout
    assert "export LLM_MODEL=mistral" in first.stdout
    assert first.stderr == ""
    config = operator.project / ".llm.env"
    assert config.read_text() == "LLM_PROVIDER=ollama\nLLM_MODEL=mistral\n"
    assert operator.selection() == ["ollama", "mistral"]

    second = operator.run(args, "2\n2\n")
    assert "GPT-4o-mini - Fast & affordable" in second.stdout
    assert second.stderr == ""
    assert config.read_text() == "LLM_PROVIDER=openai\nLLM_MODEL=gpt-4o-mini\n"
    assert operator.selection() == ["openai", "gpt-4o-mini"]
    assert (
        "LLM_PROVIDER" not in os.environ
    )  # A child cannot select for its parent shell.


@pytest.mark.parametrize(
    "provider_number,provider,model,description",
    [
        (1, "claude", "claude-sonnet-4-6", "Claude Sonnet 4.6 - Balanced"),
        (2, "openai", "gpt-4o-mini", "GPT-4o-mini - Fast & affordable"),
        (3, "ollama", "mistral", "Mistral - Fast & efficient"),
    ],
)
def test_default_catalog_selection_is_saved_without_changing_current_environment(
    operator: Operator,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    provider_number: int,
    provider: str,
    model: str,
    description: str,
) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(f" {provider_number} \n 2 \n"))

    assert interactive_select() == (provider, model)

    output = capsys.readouterr().out
    assert "LLM Provider Selector" in output
    assert description in output
    assert "Config saved to" in output
    assert "Config loaded to current session" not in output
    assert "LLM_MODEL" not in os.environ
    assert operator.selection() == [provider, model]


@pytest.mark.parametrize("persist", [False, True])
def test_custom_catalog_updates_saved_selection_and_optionally_current_process(
    operator: Operator,
    monkeypatch: pytest.MonkeyPatch,
    persist: bool,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "codellama")
    operator.project.joinpath(".llm.env").write_text(
        "LLM_PROVIDER=ollama\nLLM_MODEL=mistral\n"
    )
    monkeypatch.setattr(sys, "stdin", io.StringIO("1\n1\n"))

    assert interactive_select(
        providers=[("ollama", "Operator local catalog")],
        models_per_provider={
            "ollama": [("Custom/MixedCase-model", "Installed local model")]
        },
        persist=persist,
    ) == ("ollama", "Custom/MixedCase-model")

    assert operator.selection() == ["ollama", "Custom/MixedCase-model"]
    assert get_provider().get_default_model() == (
        "Custom/MixedCase-model" if persist else "codellama"
    )


def test_cli_reprompts_for_malformed_and_out_of_range_choices(
    operator: Operator,
) -> None:
    result = operator.run(["-m", "llm"], "text\n0\n-1\n99\n 3 \n1.5\n0\n99\n 2 \n")

    assert result.stdout.count("Please enter a number.") == 2
    assert result.stdout.count("Invalid selection. Try again.") == 5
    assert "Ready to use!" in result.stdout
    assert result.stderr == ""
    assert operator.selection() == ["ollama", "mistral"]


@pytest.mark.parametrize("answers", [" \n", "3\n\t\n"], ids=["provider", "model"])
@pytest.mark.parametrize(
    "existing", [False, True], ids=["new-project", "saved-project"]
)
def test_cli_cancellation_preserves_existing_config_or_creates_nothing(
    operator: Operator,
    answers: str,
    existing: bool,
) -> None:
    config = operator.project / ".llm.env"
    original = b"# operator notes\nLLM_PROVIDER=ollama\nLLM_MODEL=codellama\n"
    if existing:
        config.write_bytes(original)

    result = operator.run(["-m", "llm"], answers)

    assert "Selection cancelled." in result.stdout
    assert "Config saved" not in result.stdout
    assert "Ready to use!" not in result.stdout
    assert result.stderr == ""
    if existing:
        assert config.read_bytes() == original
        assert operator.selection() == ["ollama", "codellama"]
    else:
        assert not config.exists()


@pytest.mark.parametrize(
    "providers,models,answers,message",
    [
        ([], {}, "", "No providers available."),
        ([("ollama", "Local")], {}, "1\n", "No models available."),
        ([("custom", "Operator catalog")], None, "1\n", "No models available."),
        (None, None, "\n", "Available Providers:"),
        (None, None, "3\n\n", "Available Models:"),
    ],
)
def test_interactive_cancellation_handles_empty_catalogs_without_overwriting_config(
    operator: Operator,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    providers: list[tuple[str, str]] | None,
    models: dict[str, list[tuple[str, str]]] | None,
    answers: str,
    message: str,
) -> None:
    config = operator.project / ".llm.env"
    original = "LLM_PROVIDER=ollama\nLLM_MODEL=codellama\n"
    config.write_text(original)
    monkeypatch.setattr(sys, "stdin", io.StringIO(answers))

    assert interactive_select(providers, models, persist=True) is None

    assert message in capsys.readouterr().out
    assert config.read_text() == original
    assert "LLM_PROVIDER" not in os.environ


@pytest.mark.parametrize(
    "answers", ["bad\n0\n3\nwrong\n99\n2\n", "\n"], ids=["select", "cancel"]
)
def test_public_main_sets_current_selection_or_exits_cleanly(
    operator: Operator,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    answers: str,
) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(answers))
    if answers == "\n":
        with pytest.raises(SystemExit) as cancelled:
            main()
        assert cancelled.value.code == 0
        assert "Selection cancelled." in capsys.readouterr().out
        assert not operator.project.joinpath(".llm.env").exists()
        assert "LLM_PROVIDER" not in os.environ
    else:
        main()
        output = capsys.readouterr().out
        assert "Ready to use!" in output
        assert "Config loaded to current session" in output
        assert os.environ["LLM_PROVIDER"] == "ollama"
        assert os.environ["LLM_MODEL"] == "mistral"
        assert get_provider().get_default_model() == "mistral"


def test_subprocess_network_guard_is_active(operator: Operator) -> None:
    """Prove the CLI child environment would reject accidental provider access."""
    result = operator.run(
        [
            "-c",
            "import socket; "
            "\ntry: socket.create_connection(('127.0.0.1', 9))"
            "\nexcept RuntimeError as error: print(error)"
            "\nelse: raise AssertionError('Network guard missing')",
        ]
    )
    assert "Selector workflows must remain offline" in result.stdout
