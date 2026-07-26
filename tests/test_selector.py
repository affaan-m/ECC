"""Tests for provider-selection compute guidance."""

import importlib.util
import re
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
