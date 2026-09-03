from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "docs-governance" / "scripts" / "audit-docs.py"


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
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"], cwd=project, check=True
    )
    subprocess.run(["git", "config", "user.name", "Test"], cwd=project, check=True)


def test_artifact_scope_fails_on_broken_markdown_link(project: Path) -> None:
    (project / "guide.md").write_text("[missing](docs/missing.md)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout


def test_artifact_scope_resolves_root_relative_links_inside_project(
    project: Path,
) -> None:
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
        (project / "guide.md").write_text(
            "[outside](../outside.md)\n", encoding="utf-8"
        )
        result = run_audit(project, "artifacts")
        assert result.returncode == 1
        assert "Broken Markdown link" in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_artifact_scope_does_not_read_markdown_symlinked_outside_project(
    project: Path,
) -> None:
    outside = project.parent / "outside-secret.md"
    outside.write_text("[secret](missing-token-value.md)\n", encoding="utf-8")
    try:
        (project / "outside.md").symlink_to(outside)
        result = run_audit(project, "artifacts")
        assert result.returncode == 1
        assert "Markdown source resolves outside the project root" in result.stdout
        assert "missing-token-value" not in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_artifact_scope_reports_a_broken_markdown_symlink(project: Path) -> None:
    (project / "broken.md").symlink_to(project / "missing.md")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Markdown source is not a regular file" in result.stdout


def test_artifact_scope_reports_non_utf8_markdown(project: Path) -> None:
    (project / "invalid.md").write_bytes(b"\xff\xfe")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Cannot read Markdown source as a UTF-8 regular file" in result.stdout


def test_artifact_scope_reports_a_nul_encoded_link_without_crashing(
    project: Path,
) -> None:
    (project / "guide.md").write_text("[invalid](a%00b.md)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout
    assert "Traceback" not in result.stderr


def test_artifact_scope_ignores_protocol_relative_external_links(project: Path) -> None:
    (project / "guide.md").write_text(
        "[asset](//cdn.example.com/file.js)\n", encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_external_uri_schemes_case_insensitively(
    project: Path,
) -> None:
    (project / "guide.md").write_text(
        "[secure](HTTPS://example.com/guide)\n"
        "[transfer](ftp://example.com/file)\n"
        "[identifier](urn:isbn:9780140328721)\n"
        "[paper](doi:10.1000/182)\n"
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


def test_artifact_scope_checks_windows_drive_paths_as_local_paths(
    project: Path,
) -> None:
    (project / "guide.md").write_text(
        "[slash](C:/docs/guide.md)\n[backslash](C:\\docs\\guide.md)\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout


def test_artifact_scope_checks_colon_shaped_local_paths_as_local_paths(
    project: Path,
) -> None:
    (project / "guide.md").write_text("[local](docs:guide.md)\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link: 'guide.md' -> 'docs:guide.md'" in result.stdout


def test_artifact_scope_escapes_percent_encoded_control_characters(
    project: Path,
) -> None:
    (project / "guide.md").write_text(
        "[unsafe](missing%0A%1B%5B2J.md)\n", encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "missing\\n\\x1b[2J.md" in result.stdout
    assert "\x1b" not in result.stdout


def test_artifact_scope_ignores_query_and_fragment_in_local_links(
    project: Path,
) -> None:
    (project / "guide.md").write_text(
        "[details](target.md?version=2#usage)\n", encoding="utf-8"
    )
    (project / "target.md").write_text("# Target\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_resolves_markdown_destinations_with_parentheses_and_spaces(
    project: Path,
) -> None:
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


def test_artifact_scope_ignores_links_inside_code_examples(project: Path) -> None:
    (project / "guide.md").write_text(
        "`[inline](missing-inline.md)`\n\n```md\n[fenced](missing-fenced.md)\n```\n",
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_title_with_escaped_quotes(project: Path) -> None:
    (project / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (project / "index.md").write_text(
        '[guide](guide.md "The \\"Guide\\"")\n',
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_ignores_title_with_closing_parenthesis(project: Path) -> None:
    (project / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (project / "index.md").write_text(
        '[guide](guide.md "Guide)")\n',
        encoding="utf-8",
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_checks_angle_wrapped_destination_with_title(
    project: Path,
) -> None:
    (project / "index.md").write_text(
        '[missing](<guide.md> "Guide")\n', encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link: 'index.md' -> 'guide.md'" in result.stdout


@pytest.mark.parametrize(
    "usage",
    ("[guide][docs]", "[docs][]", "[docs]"),
)
def test_artifact_scope_checks_reference_style_markdown_links(
    project: Path, usage: str
) -> None:
    (project / "index.md").write_text(
        f"{usage}\n\n[docs]: missing-guide.md\n", encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Broken Markdown link" in result.stdout
    assert "missing-guide.md" in result.stdout


def test_adr_scope_requires_every_file_in_index(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("# ADR Index\n", encoding="utf-8")
    (adr_dir / "0001-storage.md").write_text(
        "# ADR-0001\n\nStatus: accepted\n", encoding="utf-8"
    )
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR is missing from the canonical index" in result.stdout


def test_adr_scope_accepts_indexed_decision(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text(
        "[decision](ADR-001-Storage.md)\n", encoding="utf-8"
    )
    (adr_dir / "ADR-001-Storage.md").write_text(
        "# ADR-001\n\nStatus: accepted\n", encoding="utf-8"
    )
    result = run_audit(project, "adr")
    assert result.returncode == 0, result.stdout


def test_adr_scope_accepts_documented_bold_status_metadata(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text(
        "[decision](0001-storage.md)\n", encoding="utf-8"
    )
    (adr_dir / "0001-storage.md").write_text(
        "# ADR-0001\n\n**Status**: accepted\n", encoding="utf-8"
    )
    result = run_audit(project, "adr")
    assert result.returncode == 0, result.stdout


def test_adr_scope_audits_common_adr_prefixed_filenames(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text(
        "[decision](ADR-001-Storage.md)\n", encoding="utf-8"
    )
    (adr_dir / "ADR-001-Storage.md").write_text("# ADR-001\n", encoding="utf-8")
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR has no parseable status" in result.stdout


def test_adr_scope_requires_an_actual_index_link(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text(
        "TODO: add 0001-storage.md later\n", encoding="utf-8"
    )
    (adr_dir / "0001-storage.md").write_text(
        "# ADR-0001\n\nStatus: accepted\n", encoding="utf-8"
    )
    result = run_audit(project, "adr")
    assert result.returncode == 1
    assert "ADR is missing from the canonical index" in result.stdout


def test_adr_scope_ignores_the_bundled_template(project: Path) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("# ADR index\n", encoding="utf-8")
    (adr_dir / "template.md").write_text(
        "# Title\n\nStatus: proposed\n", encoding="utf-8"
    )
    result = run_audit(project, "adr")
    assert result.returncode == 0, result.stdout


def test_adr_scope_does_not_read_an_adr_symlinked_outside_project(
    project: Path,
) -> None:
    adr_dir = project / "docs" / "adr"
    adr_dir.mkdir(parents=True)
    outside = project.parent / "outside-adr.md"
    outside.write_text("private ADR body\n", encoding="utf-8")
    try:
        (adr_dir / "README.md").write_text(
            "[outside](0001-outside.md)\n", encoding="utf-8"
        )
        (adr_dir / "0001-outside.md").symlink_to(outside)
        result = run_audit(project, "adr")
        assert result.returncode == 1
        assert "ADR source resolves outside the project root" in result.stdout
        assert "private ADR body" not in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_custom_role_map_supports_existing_adr_layout(project: Path) -> None:
    adr_dir = project / "docs" / "architecture" / "decisions"
    adr_dir.mkdir(parents=True)
    (adr_dir / "README.md").write_text("[0001](0001-storage.md)\n", encoding="utf-8")
    (adr_dir / "0001-storage.md").write_text(
        "# ADR-0001\n\nStatus: accepted\n", encoding="utf-8"
    )
    governance = project / ".governance"
    governance.mkdir()
    (governance / "docs-map.json").write_text(
        json.dumps(
            {
                "adr_dir": "docs/architecture/decisions",
                "adr_index": "docs/architecture/decisions/README.md",
            }
        ),
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


def test_artifact_scope_rejects_unregistered_test_id_when_tests_ledger_exists(
    project: Path,
) -> None:
    docs = project / "docs"
    docs.mkdir()
    (project / "TESTS.md").write_text("# TESTS\n\nTEST-ORDER-001\n", encoding="utf-8")
    (docs / "spec.md").write_text(
        "Must be verified by TEST-ORDER-002.\n", encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "TEST-IDs are missing from the test registry" in result.stdout


def test_artifact_scope_ignores_lowercase_test_hyphenated_prose(
    project: Path,
) -> None:
    (project / "TESTS.md").write_text("# TESTS\n\nTEST-ORDER-001\n", encoding="utf-8")
    (project / "guide.md").write_text("Use a test-driven workflow.\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 0, result.stdout


def test_artifact_scope_reports_a_non_utf8_test_registry(project: Path) -> None:
    (project / "TESTS.md").write_bytes(b"\xff\xfe")
    (project / "spec.md").write_text("Verified by TEST-ORDER-001.\n", encoding="utf-8")
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Cannot read test registry as a UTF-8 regular file" in result.stdout
    assert "Traceback" not in result.stderr


def test_log_move_to_archive_preserves_append_only_history(project: Path) -> None:
    configure_git(project)
    old = "# LOG\n\n## [2026-01-01] init | one\n## [2026-01-02] fix | two\n"
    (project / "PROJECT_LOG.md").write_text(old, encoding="utf-8")
    subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=project, check=True)
    subprocess.run(
        ["git", "commit", "-m", "init"], cwd=project, capture_output=True, check=True
    )
    (project / "PROJECT_LOG.md").write_text(
        "# LOG\n\n## [2026-01-02] fix | two\n", encoding="utf-8"
    )
    (project / "PROJECT_LOG.archive.md").write_text(
        "# archive\n\n## [2026-01-01] init | one\n", encoding="utf-8"
    )
    result = run_audit(project, "spine")
    assert result.returncode == 0, result.stdout
    assert (
        "Active and archived history remain append-only when combined" in result.stdout
    )


def test_spine_scope_detects_recreated_root_level_deletion_zone_file(
    project: Path,
) -> None:
    (project / "PROJECT_STATUS.md").write_text(
        "# Status\n\n## Deletion Zone\n\n- `legacy_parser.py`\n", encoding="utf-8"
    )
    (project / "legacy_parser.py").write_text("# recreated\n", encoding="utf-8")
    result = run_audit(project, "spine")
    assert result.returncode == 1
    assert "Deletion-zone target has been recreated" in result.stdout


@pytest.mark.parametrize(
    "value",
    (
        "ftp://example.com/legacy.py",
        "mailto:legacy@example.com",
        "urn:legacy:parser",
        pytest.param(
            r"..\legacy.py",
            marks=pytest.mark.skipif(
                sys.platform.startswith("win"),
                reason="the Windows path would escape the temporary project",
            ),
        ),
    ),
)
def test_spine_scope_ignores_unsafe_deletion_zone_values(
    project: Path, value: str
) -> None:
    candidate = project / value
    candidate.parent.mkdir(parents=True, exist_ok=True)
    candidate.write_text("# unrelated\n", encoding="utf-8")
    (project / "PROJECT_STATUS.md").write_text(
        f"# Status\n\n## Deletion Zone\n\n- `{value}`\n", encoding="utf-8"
    )
    result = run_audit(project, "spine")
    assert result.returncode == 0, result.stdout


def test_spine_scope_handles_missing_git_without_traceback(project: Path) -> None:
    (project / "PROJECT_LOG.md").write_text(
        "# LOG\n\n## [2026-01-01] init | one\n", encoding="utf-8"
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(project), "--scope", "spine"],
        text=True,
        capture_output=True,
        check=False,
        env={"PATH": ""},
    )
    assert result.returncode == 0, result.stdout
    assert "Git history is unavailable" in result.stdout
    assert "Traceback" not in result.stderr


def test_spine_scope_warns_when_root_has_no_git_head(project: Path) -> None:
    (project / "PROJECT_LOG.md").write_text(
        "# LOG\n\n## [2026-01-01] init | one\n", encoding="utf-8"
    )
    result = run_audit(project, "spine")
    assert result.returncode == 0, result.stdout
    assert "Git history is unavailable" in result.stdout
    assert "append-only when combined" not in result.stdout


def test_log_duplicate_removal_is_detected(project: Path) -> None:
    configure_git(project)
    event = "## [2026-01-01] fix | same event\n"
    (project / "PROJECT_LOG.md").write_text(
        "# LOG\n\n" + event + event, encoding="utf-8"
    )
    subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=project, check=True)
    subprocess.run(
        ["git", "commit", "-m", "init"], cwd=project, capture_output=True, check=True
    )
    (project / "PROJECT_LOG.md").write_text("# LOG\n\n" + event, encoding="utf-8")
    result = run_audit(project, "spine")
    assert result.returncode == 0, result.stdout
    assert "1 working-tree history events differ from HEAD" in result.stdout


def test_role_map_rejects_absolute_paths(project: Path) -> None:
    governance = project / ".governance"
    governance.mkdir()
    (governance / "docs-map.json").write_text(
        json.dumps({"context": str(project / "CONTEXT.md")}), encoding="utf-8"
    )
    result = run_audit(project, "context")
    assert result.returncode == 1
    assert "must be repository-relative" in result.stdout


def test_role_map_rejects_a_directory_for_a_file_role(project: Path) -> None:
    (project / "docs").mkdir()
    governance = project / ".governance"
    governance.mkdir()
    (governance / "docs-map.json").write_text(
        json.dumps({"context": "docs"}), encoding="utf-8"
    )
    result = run_audit(project, "context")
    assert result.returncode == 1
    assert "file role maps to a non-file" in result.stdout


def test_role_map_rejects_a_missing_mapped_source(project: Path) -> None:
    governance = project / ".governance"
    governance.mkdir()
    (governance / "docs-map.json").write_text(
        json.dumps({"contract": "docs/missing-contract.md"}), encoding="utf-8"
    )
    result = run_audit(project, "artifacts")
    assert result.returncode == 1
    assert "Mapped documentation source does not exist" in result.stdout


def test_role_map_does_not_follow_a_mapping_symlinked_outside_project(
    project: Path,
) -> None:
    governance = project / ".governance"
    governance.mkdir()
    outside = project.parent / "outside-map.json"
    outside.write_text('{"context": "private-context.md"}\n', encoding="utf-8")
    try:
        (governance / "docs-map.json").symlink_to(outside)
        result = run_audit(project, "context")
        assert result.returncode == 1
        assert "repository-contained regular file" in result.stdout
        assert "private-context" not in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_default_role_does_not_follow_a_symlink_outside_project(project: Path) -> None:
    outside = project.parent / "outside-context.md"
    outside.write_text("private context\n", encoding="utf-8")
    try:
        (project / "CONTEXT.md").symlink_to(outside)
        result = run_audit(project, "context")
        assert result.returncode == 1
        assert "Documentation role resolves outside the project root" in result.stdout
        assert "private context" not in result.stdout
    finally:
        outside.unlink(missing_ok=True)


def test_audit_does_not_modify_repository_files(project: Path) -> None:
    (project / "guide.md").write_text("[missing](docs/missing.md)\n", encoding="utf-8")
    before = {
        path.relative_to(project): path.read_bytes()
        for path in project.rglob("*")
        if path.is_file()
    }

    result = run_audit(project, "full")

    after = {
        path.relative_to(project): path.read_bytes()
        for path in project.rglob("*")
        if path.is_file()
    }
    assert result.returncode == 1
    assert after == before
