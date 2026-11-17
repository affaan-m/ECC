"""Tests for provider-selection compute guidance."""

import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest

SELECTOR_PATH = Path(__file__).parents[1] / "src" / "llm" / "cli" / "selector.py"
SPEC = importlib.util.spec_from_file_location("ecc_selector", SELECTOR_PATH)
assert SPEC is not None and SPEC.loader is not None
SELECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SELECTOR)
print_self_host_compute_notice = SELECTOR.print_self_host_compute_notice

URL_TOKEN_PATTERN = re.compile(r"https?://[^\s<>\"'`()\[\]{}\\]+")
EXPECTED_COMPUTE_ROUTE = (
    "https",
    "compute.itomarkets.com",
    "",
    "",
    "",
)


def assert_exact_compute_route(content: str) -> None:
    candidates = URL_TOKEN_PATTERN.findall(content)
    routes = (
        urlsplit(candidate.rstrip(".,;:!?"))
        for candidate in candidates
    )
    assert any(route == EXPECTED_COMPUTE_ROUTE for route in routes), (
        "Should include the exact Itô compute route"
    )


def test_compute_route_validation_rejects_deceptive_lookalike_host():
    deceptive_output = "https://compute.itomarkets.com.attacker.example"

    with pytest.raises(AssertionError, match="exact Itô compute route"):
        assert_exact_compute_route(deceptive_output)


def test_ollama_notice_routes_to_ito_without_claiming_serving(capsys):
    print_self_host_compute_notice("ollama")

    output = capsys.readouterr().out
    assert_exact_compute_route(output)
    assert "preferred compute sponsor" in output
    assert "Any GPU provider works" in output
    assert "sponsorship link is passive" in output
    assert "ecc ito find" in output
    assert "explicitly configured canonical Itô CLI" in output
    assert "submits a live authenticated RFQ" in output
    assert "does not reserve capacity" in output
    assert "Managed inference through Itô is not live yet" in output


def test_managed_provider_does_not_show_self_host_compute_notice(capsys):
    print_self_host_compute_notice("openai")

    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("color_name", SELECTOR.Color.__members__)
def test_color_strings_preserve_ansi_values(color_name: str) -> None:
    color = SELECTOR.Color[color_name]

    assert str(color) == color.value
    assert f"{color}" == color.value


def test_banner_prints_ansi_colors_instead_of_enum_names(
    capsys: pytest.CaptureFixture[str],
) -> None:
    SELECTOR.print_banner()

    output = capsys.readouterr().out
    assert output.startswith("\033[96m\n")
    assert "LLM Provider Selector" in output
    assert output.endswith("\033[0m\n")
    assert "Color." not in output


def test_interactive_selection_supports_cp1252_output(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import runpy, sys; selector = runpy.run_path(sys.argv[1]); "
            "selector['interactive_select']("
            "providers=[('custom', 'Custom provider')], "
            "models_per_provider={'custom': [('ascii-model', 'Custom model')]}, "
            "persist=True)",
            str(SELECTOR_PATH),
        ],
        input="1\n1\n",
        encoding="cp1252",
        env={**os.environ, "PYTHONIOENCODING": "cp1252:strict"},
        capture_output=True,
        cwd=tmp_path,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert "LLM Provider Selector" in result.stdout
    assert "Config saved to" in result.stdout
    assert "Config loaded to current session" in result.stdout
    assert (tmp_path / ".llm.env").read_text() == "LLM_PROVIDER=custom\nLLM_MODEL=ascii-model\n"
