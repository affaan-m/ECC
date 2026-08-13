#!/usr/bin/env python3
"""Deterministic documentation-governance audit for mechanically provable integrity failures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote


DEFAULT_ROLES = {
    "constitution": "CLAUDE.md",
    "map": "CLAUDE_MAP.md",
    "status": "PROJECT_STATUS.md",
    "history": "PROJECT_LOG.md",
    "history_archive": "PROJECT_LOG.archive.md",
    "agents": "AGENTS.md",
    "context": "CONTEXT.md",
    "contract": "CONTRACT.md",
    "tests": "TESTS.md",
    "regression": "REGRESSION.md",
    "adr_dir": "docs/adr",
    "adr_index": "docs/adr/README.md",
}
ENTRY_RE = re.compile(
    r"^## \[(?P<date>\d{4}-\d{2}-\d{2})\]\s+(?P<type>[^|\n]+?)\s*\|\s*(?P<summary>[^\n]+)$",
    re.MULTILINE,
)
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
CODE_PATH_RE = re.compile(r"`([^`\n]+)`")
TEST_ID_RE = re.compile(r"\bTEST-[A-Z0-9][A-Z0-9-]*\b", re.IGNORECASE)
ADR_FILE_RE = re.compile(r"^\d{4}-[a-z0-9-]+\.md$")
ADR_TARGET_RE = re.compile(r"\b\d{4}-[a-z0-9-]+\.md\b")
IGNORED_DIRS = {".git", ".governance", ".venv", "node_modules", "vendor", "__pycache__"}
IGNORED_REFERENCE_MARKERS = ("*", "{", "}", "<", ">", "…", "...")


class Report:
    def __init__(self) -> None:
        self.failures = 0

    def section(self, title: str) -> None:
        print(f"\n[{title}]")

    def ok(self, message: str) -> None:
        print(f"  ✓ {message}")

    def warn(self, message: str) -> None:
        print(f"  WARN: {message}")

    def fail(self, message: str) -> None:
        self.failures += 1
        print(f"  ✗ {message}")


def load_roles(root: Path, report: Report) -> dict[str, str]:
    roles = dict(DEFAULT_ROLES)
    mapping_path = root / ".governance" / "docs-map.json"
    if not mapping_path.exists():
        return roles
    try:
        custom = json.loads(mapping_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.fail(f"Cannot read .governance/docs-map.json: {exc}")
        return roles
    if not isinstance(custom, dict):
        report.fail(".governance/docs-map.json must be a role-to-relative-path object")
        return roles
    for role, value in custom.items():
        if role not in roles or not isinstance(value, str) or not value.strip():
            report.fail(f"Invalid documentation role mapping: {role!r} -> {value!r}")
            continue
        candidate = (root / value).resolve()
        if root != candidate and root not in candidate.parents:
            report.fail(f"Documentation role mapping escapes the project root: {role} -> {value}")
            continue
        roles[role] = value
    report.ok("Loaded custom documentation role mapping from .governance/docs-map.json")
    return roles


def role_path(root: Path, roles: dict[str, str], role: str) -> Path:
    return root / roles[role]


def markdown_files(root: Path) -> list[Path]:
    result: list[Path] = []
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        result.append(path)
    return sorted(result)


def event_contents(text: str) -> list[str]:
    matches = list(ENTRY_RE.finditer(text))
    result: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result.append(text[match.start() : end].strip())
    return result


def git_show(root: Path, relative: str) -> str | None:
    command = subprocess.run(
        ["git", "show", f"HEAD:{relative}"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    return command.stdout if command.returncode == 0 else None


def normalize_link_target(raw: str) -> str | None:
    target = raw.strip().split(maxsplit=1)[0].strip("<>")
    target = unquote(target.split("#", 1)[0])
    if not target or target.startswith(("#", "http://", "https://", "mailto:", "tel:", "data:")):
        return None
    return target


def resolve_target(root: Path, source: Path, target: str) -> Path:
    if target.startswith("/"):
        return Path(target)
    return (source.parent / target).resolve()


def check_markdown_links(root: Path, files: list[Path], report: Report) -> None:
    broken: list[str] = []
    for source in files:
        if "templates" in source.relative_to(root).parts:
            continue
        text = source.read_text(encoding="utf-8")
        for raw in MARKDOWN_LINK_RE.findall(text):
            target = normalize_link_target(raw)
            if target is None:
                continue
            resolved = resolve_target(root, source, target)
            if not resolved.exists():
                broken.append(f"{source.relative_to(root)} -> {target}")
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"Broken Markdown link: {item}")
    else:
        report.ok("All local Markdown links resolve")


def plausible_code_path(value: str) -> bool:
    if any(marker in value for marker in IGNORED_REFERENCE_MARKERS):
        return False
    if any(character.isspace() for character in value):
        return False
    if value.startswith(("http://", "https://", "$", ".governance/")):
        return False
    if re.fullmatch(r"/[a-z0-9-]+", value):
        return False
    return "/" in value or value.endswith((".md", ".py", ".sh", ".json", ".yaml", ".yml"))


def check_spine_paths(root: Path, roles: dict[str, str], report: Report) -> None:
    broken: list[str] = []
    for role in ("constitution", "map", "agents", "context", "contract", "tests", "regression"):
        source = role_path(root, roles, role)
        if not source.exists():
            continue
        for value in CODE_PATH_RE.findall(source.read_text(encoding="utf-8")):
            if not plausible_code_path(value):
                continue
            candidate = Path(value)
            resolved = candidate if candidate.is_absolute() else root / candidate
            if not resolved.exists():
                broken.append(f"{source.relative_to(root)} -> {value}")
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"Referenced spine/artifact path does not exist: {item}")
    else:
        report.ok("Referenced paths in spine and optional artifacts exist")


def check_status_resurrection(root: Path, roles: dict[str, str], report: Report) -> None:
    status = role_path(root, roles, "status")
    if not status.exists():
        report.warn("No status artifact; skipping deletion-zone checks")
        return
    text = status.read_text(encoding="utf-8")
    match = re.search(r"(?:Deletion Zone|\u5220\u9664\u533a)(?P<body>.*?)(?:\n## |\Z)", text, re.DOTALL | re.IGNORECASE)
    resurrected: list[str] = []
    if match:
        for value in CODE_PATH_RE.findall(match.group("body")):
            if plausible_code_path(value) and (root / value).exists():
                resurrected.append(value)
    if resurrected:
        for value in sorted(set(resurrected)):
            report.fail(f"Deletion-zone target has been recreated: {value}")
    else:
        report.ok("No deletion-zone targets were recreated")


def check_log(root: Path, roles: dict[str, str], report: Report, threshold: int) -> None:
    active_path = role_path(root, roles, "history")
    archive_path = role_path(root, roles, "history_archive")
    if not active_path.exists():
        report.warn("No history artifact; skipping append-only integrity checks")
        return

    active_text = active_path.read_text(encoding="utf-8")
    archive_text = archive_path.read_text(encoding="utf-8") if archive_path.exists() else ""
    active_events = event_contents(active_text)
    current_events = set(active_events + event_contents(archive_text))
    previous_events: set[str] = set()
    for relative in (roles["history"], roles["history_archive"]):
        previous = git_show(root, relative)
        if previous is not None:
            previous_events.update(event_contents(previous))
    missing = previous_events - current_events
    if missing:
        report.fail(f"{len(missing)} history events were removed or rewritten without verbatim archival")
    else:
        report.ok("Active and archived history remain append-only when combined")

    if len(active_events) > threshold:
        report.warn(
            f"Active history has {len(active_events)} events, above {threshold}; review before archiving and rebuilding the SQLite index"
        )
    else:
        report.ok(f"Active history has {len(active_events)} events, within the {threshold} threshold")

    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".governance/project-log.sqlite"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if tracked.returncode == 0:
        report.fail(".governance/project-log.sqlite is a derived index and must not be committed")


def parse_adr_status(text: str) -> str | None:
    patterns = (
        r"(?im)^[-*]?\s*(?:status|\u72b6\u6001)\s*[:\uFF1A]\s*`?([a-z]+)`?\s*$",
        r"(?im)^##\s+(?:status|\u72b6\u6001)\s*\n+\s*`?([a-z]+)`?\s*$",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).lower()
    return None


def check_adr(root: Path, roles: dict[str, str], report: Report) -> None:
    adr_dir = role_path(root, roles, "adr_dir")
    if not adr_dir.exists():
        report.warn("No ADR directory exists; create ADRs lazily for real decisions")
        return
    index = role_path(root, roles, "adr_index")
    if not index.exists():
        report.fail("ADR directory exists without a canonical README.md index")
        return
    index_text = index.read_text(encoding="utf-8")
    for raw in MARKDOWN_LINK_RE.findall(index_text):
        target = normalize_link_target(raw)
        if target is not None and target.endswith(".md") and not resolve_target(root, index, target).exists():
            report.fail(f"ADR index link does not exist: docs/adr/README.md -> {target}")
    custom_layout = (
        roles["adr_dir"] != DEFAULT_ROLES["adr_dir"]
        or roles["adr_index"] != DEFAULT_ROLES["adr_index"]
    )
    if custom_layout:
        adr_files = sorted(path for path in adr_dir.glob("*.md") if path.resolve() != index.resolve())
    else:
        adr_files = sorted(path for path in adr_dir.glob("*.md") if ADR_FILE_RE.match(path.name))
    missing_from_index = [path.name for path in adr_files if path.name not in index_text]
    for name in missing_from_index:
        report.fail(f"ADR is missing from the canonical index: docs/adr/{name}")

    if custom_layout:
        if not missing_from_index:
            report.ok(f"Custom ADR index covers all {len(adr_files)} Markdown decision files")
        report.warn("Custom ADR naming and lifecycle require semantic review; deterministic checks cover only index and link integrity")
        return

    allowed = {"proposed", "accepted", "deprecated", "superseded"}
    for path in adr_files:
        text = path.read_text(encoding="utf-8")
        status = parse_adr_status(text)
        if status is None:
            report.fail(f"ADR has no parseable status: {path.relative_to(root)}")
        elif status not in allowed:
            report.fail(f"ADR status is unsupported: {path.relative_to(root)} -> {status}")
        supersedes = re.search(r"(?ims)^##\s+Supersedes\s*\n(?P<body>.*?)(?:\n## |\Z)", text)
        if supersedes and supersedes.group("body").strip().lower() not in {"none", "\u65e0"}:
            targets = ADR_TARGET_RE.findall(supersedes.group("body"))
            if not targets:
                report.warn(f"ADR Supersedes target cannot be parsed deterministically: {path.relative_to(root)}")
            for target in targets:
                if not (adr_dir / target).exists():
                    report.fail(f"ADR Supersedes target does not exist: {path.relative_to(root)} -> {target}")
    if not missing_from_index and all(parse_adr_status(path.read_text(encoding="utf-8")) in allowed for path in adr_files):
        report.ok(f"ADR index covers all {len(adr_files)} decision files")


def check_test_ids(root: Path, roles: dict[str, str], files: list[Path], report: Report) -> None:
    tests_file = role_path(root, roles, "tests")
    refs: set[str] = set()
    for path in files:
        parts = path.relative_to(root).parts
        if path == tests_file or any(
            section in parts for section in ("templates", "skills", "commands", "agents", "references")
        ):
            continue
        refs.update(value.upper() for value in TEST_ID_RE.findall(path.read_text(encoding="utf-8")))
    refs.discard("TEST-ID")
    if not refs:
        report.ok("No cross-document TEST-ID references found")
        return
    if not tests_file.exists():
        report.warn(f"Found {len(refs)} TEST-ID references but no mapped test registry; review whether they are examples")
        return
    defined = {value.upper() for value in TEST_ID_RE.findall(tests_file.read_text(encoding="utf-8"))}
    missing = refs - defined
    if missing:
        report.fail("TEST-IDs are missing from the test registry: " + ", ".join(sorted(missing)))
    else:
        report.ok("All cross-document TEST-IDs resolve to the test registry")


def check_orphans(root: Path, files: list[Path], report: Report) -> None:
    candidates = [
        path
        for path in files
        if "docs" in path.relative_to(root).parts
        and "templates" not in path.relative_to(root).parts
        and path.name != "README.md"
    ]
    all_text = {path: path.read_text(encoding="utf-8") for path in files}
    orphans: list[str] = []
    for candidate in candidates:
        relative = candidate.relative_to(root).as_posix()
        if not any(
            path != candidate and (relative in text or candidate.name in text)
            for path, text in all_text.items()
        ):
            orphans.append(relative)
    if orphans:
        report.warn("Possible orphan documents; review whether to link or archive: " + ", ".join(orphans))
    else:
        report.ok("No possible orphan documents found under docs/")


def check_spine(root: Path, roles: dict[str, str], report: Report, threshold: int) -> None:
    report.section("spine")
    for role in ("constitution", "map", "status", "history"):
        name = roles[role]
        if role_path(root, roles, role).exists():
            report.ok(f"{name} exists ({role})")
        else:
            report.warn(f"{name} is missing ({role}); this may be valid under progressive adoption")
    check_spine_paths(root, roles, report)
    check_status_resurrection(root, roles, report)
    check_log(root, roles, report, threshold)


def check_context(root: Path, roles: dict[str, str], report: Report) -> None:
    report.section("context")
    context = role_path(root, roles, "context")
    if not context.exists():
        report.warn("No context artifact; do not create an empty shell without stable domain language")
        return
    report.ok("Context artifact exists; terminology boundaries and code consistency require semantic review")


def check_artifacts(root: Path, roles: dict[str, str], report: Report) -> None:
    report.section("artifacts")
    files = markdown_files(root)
    check_markdown_links(root, files, report)
    check_test_ids(root, roles, files, report)
    check_orphans(root, files, report)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--scope", choices=("spine", "context", "adr", "artifacts", "full"), default="full")
    parser.add_argument("--log-threshold", type=int, default=200)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 2
    report = Report()
    roles = load_roles(root, report)
    if args.scope in ("spine", "full"):
        check_spine(root, roles, report, args.log_threshold)
    if args.scope in ("context", "full"):
        check_context(root, roles, report)
    if args.scope in ("adr", "full"):
        report.section("adr")
        check_adr(root, roles, report)
    if args.scope in ("artifacts", "full"):
        check_artifacts(root, roles, report)

    print()
    if report.failures:
        print(f"✗ Deterministic audit failed with {report.failures} issue(s). Fix integrity errors before semantic review.")
        return 1
    print("✓ Deterministic audit passed. Review warnings manually, then continue to semantic audit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
