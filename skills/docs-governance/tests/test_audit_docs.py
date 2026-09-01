from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit-docs.py"
pytestmark = pytest.mark.unit


@pytest.fixture
def project(tmp_path: Path) -> Path:
    return tmp_path


def run_audit(project: Path, scope: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(project), "--scope", scope],
        text=True,
        capture_output=True,
        check=False,
    )


def configure_git(project: Path) -> None:
    subprocess.run(["git", "init"], cwd=project, capture_output=True, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=project, check=True)


def test_artifact_scope_fails_on_broken_markdown_link(project: Path) -> None:
    (project / "guide.md").write_text("[missing](docs/missing.md)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout


def test_artifact_scope_resolves_root_relative_links_inside_project(project: Path) -> None:
    docs = project / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text("[status](/PROJECT_STATUS.md)\n", encoding="utf-8")
    (project / "PROJECT_STATUS.md").write_text("# Status\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_rejects_links_that_escape_project(project: Path) -> None:
    outside = project.parent / "outside.md"
    outside.write_text("# Outside\n", encoding="utf-8")
    try:
        (project / "guide.md").write_text("[outside](../outside.md)\n", encoding="utf-8")
        result = run_audit(project, "artifacts")
        assert result.returncode == 1
        assert "Broken Markdown link" in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_artifact_scope_ignores_protocol_relative_external_links(project: Path) -> None:
    (project / "guide.md").write_text("[asset](//cdn.example.com/file.js)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_external_uri_schemes_case_insensitively(project: Path) -> None:
    (project / "guide.md").write_text(
        "[secure](HTTPS://example.com/guide)\n"
        "[transfer](ftp://example.com/file)\n"
        "[identifier](urn:isbn:9780140328721)\n"
        "[text](sms:+15555550123)\n"
        "[location](geo:37.786971,-122.399677)\n"
        "[mail](mailto:docs@example.com)\n"
        "[phone](tel:+15555550123)\n"
        "[inline](data:text/plain,hello)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_opaque_external_uri_schemes(project: Path) -> None:
    (project / "guide.md").write_text(
        "[magnet](magnet:?xt=urn:btih:abcdef)\n"
        "[chat](irc:channel)\n"
        "[news](news:comp.lang.python)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_checks_windows_drive_paths_as_local_paths(project: Path) -> None:
    (project / "guide.md").write_text(
        "[slash](C:/docs/guide.md)\n"
        "[backslash](C:\\docs\\guide.md)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout


def test_artifact_scope_checks_colon_shaped_local_paths_as_local_paths(project: Path) -> None:
    (project / "guide.md").write_text("[local](docs:guide.md)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link: guide.md -> docs:guide.md" in result.stdout


def test_artifact_scope_ignores_query_and_fragment_in_local_links(project: Path) -> None:
    (project / "guide.md").write_text("[details](target.md?version=2#usage)\n", encoding="utf-8")
    (project / "target.md").write_text("# Target\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_resolves_markdown_destinations_with_parentheses_and_spaces(project: Path) -> None:
    (project / "topic (draft).md").write_text("# Draft\n", encoding="utf-8")
    (project / "guide with spaces.md").write_text("# Guide\n", encoding="utf-8")
    (project / "index.md").write_text(
        "[topic](topic (draft).md)\n[guide](<guide with spaces.md>)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_optional_markdown_link_titles(project: Path) -> None:
    (project / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (project / "index.md").write_text(
        '[plain](guide.md "Guide")\n[wrapped](<guide.md> "Guide")\n',
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_title_with_escaped_quotes(project: Path) -> None:
    (project / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (project / "index.md").write_text(
        '[guide](guide.md "The \\\"Guide\\\"")\n',
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_checks_angle_wrapped_destination_with_title(project: Path) -> None:
    (project / "index.md").write_text('[missing](<guide.md> "Guide")\n', encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link: index.md -> guide.md" in result.stdout


def test_adr_scope_requires_every_file_in_index(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("# ADR Index\n", encoding="utf-8")
    (adr_dir / "0001-storage.md").write_text("# ADR-0001\n\nStatus: accepted\n", encoding="utf-8")
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR is missing from the canonical index" in result.stdout


def test_adr_scope_accepts_indexed_decision(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("[decision](ADR-001-Storage.md)\n", encoding="utf-8")
    (adr_dir / "ADR-001-Storage.md").write_text("# ADR-001\n\nStatus: final\n", encoding="utf-8")
    result = run_audit(project, "adr")
    assert result.returncode == 0, result.stdout


def test_custom_role_map_supports_existing_adr_layout(project: Path) -> None:
    adr_dir = project / "docs" / "architecture" / "decisions"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("[0001](0001-storage.md)\n", encoding="utf-8")
    (adr_dir / "0001-storage.md").write_text("# ADR-0001\n\nStatus: accepted\n", encoding="utf-8")
    governance = project / ".governance"
    governance.mkdir()
    (governance / "docs-map.json").write_text(
        json.dumps({"adr_dir": "docs/architecture/decisions", "adr_index": "docs/architecture/decisions/README.md"}),
        encoding="utf-8",
    )
    result = run_audit(project, "adr")
    assert result.returncode == 0, result.stdout
    assert "custom documentation role mapping" in result.stdout


def test_adr_scope_rejects_missing_index_link(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("[missing](0002-missing.md)\n", encoding="utf-8")
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR index link does not exist" in result.stdout


def test_adr_scope_rejects_missing_supersedes_target(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("[new](0002-new.md)\n", encoding="utf-8")
    (adr_dir / "0002-new.md").write_text(
        "# ADR-0002\n\nStatus: accepted\n\n## Supersedes\n\n[old](0001-old.md)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR Supersedes target does not exist" in result.stdout


def test_artifact_scope_rejects_unregistered_test_id_when_tests_ledger_exists(project: Path) -> None:
    docs = project / "docs"
    docs.mkdir()
    (project / "TESTS.md").write_text("# TESTS\n\nTEST-ORDER-001\n", encoding="utf-8")
    (docs / "spec.md").write_text("Must be verified by TEST-ORDER-002.\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "TEST-IDs are missing from the test registry" in result.stdout


def test_log_move_to_archive_preserves_append_only_history(project: Path) -> None:
    configure_git(project)
    old = "# LOG\n\n## [2026-01-01] init | one\n## [2026-01-02] fix | two\n"
    (project / "PROJECT_LOG.md").write_text(old, encoding="utf-8")
    subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=project, capture_output=True, check=True)
    (project / "PROJECT_LOG.md").write_text("# LOG\n\n## [2026-01-02] fix | two\n", encoding="utf-8")
    (project / "PROJECT_LOG.archive.md").write_text("# archive\n\n## [2026-01-01] init | one\n", encoding="utf-8")
    result = run_audit(project, "spine")
    assert result.returncode == 0, result.stdout
    assert "Active and archived history remain append-only when combined" in result.stdout


def test_log_duplicate_removal_is_detected(project: Path) -> None:
    configure_git(project)
    event = "## [2026-01-01] fix | same event\n"
    (project / "PROJECT_LOG.md").write_text("# LOG\n\n" + event + event, encoding="utf-8")
    subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=project, capture_output=True, check=True)
    (project / "PROJECT_LOG.md").write_text("# LOG\n\n" + event, encoding="utf-8")
    result = run_audit(project, "spine")
    assert result.returncode == 1
    assert "1 history events were removed" in result.stdout
